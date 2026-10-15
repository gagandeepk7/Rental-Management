import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import apiRouter from "./routes/index.js";
import { runtimeConfig } from "./config/runtime.js";
import { createLimiters } from "./middleware/rateLimit.js";

const app = express();
const config = runtimeConfig();
const limits = createLimiters(config.production);
app.disable('x-powered-by');
app.set('trust proxy', config.proxyHops);

app.use((req, res, next) => {
  const startedAt = performance.now();
  res.once("finish", () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const requestLog = {
      type: "http_request",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: durationMs,
    };
    if (durationMs > 2000) {
      console.warn("Slow API response:", JSON.stringify(requestLog));
    } else {
      console.info(JSON.stringify(requestLog));
    }
  });
  next();
});

app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || config.origins.includes(origin)),
    credentials: true,
  }),
);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use('/api', (req, res, next) => req.path === '/health' ? next() : limits.api(req, res, next));
app.use('/api/auth', limits.auth);
app.use(express.json({ limit: "1mb" }));
if (!config.production) app.use(morgan("dev"));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "property-management-api",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", apiRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(JSON.stringify({ type: 'api_error', code: error.code || error.type || 'internal' }));
  const status = error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500;
  res.status(status).json({ error: status === 400 ? 'Invalid JSON request.' : status === 413 ? 'Request body is too large.' : 'Service temporarily unavailable. Please try again.' });
});

export default app;
