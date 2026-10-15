import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Check the built SPA with the same file-first /index.html fallback as Vercel.
const root = resolve('client/dist');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const candidate = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!candidate.startsWith(root + '/') && candidate !== root) { res.writeHead(403).end(); return; }
    const exists = await stat(candidate).then((file) => file.isFile()).catch(() => false);
    const path = exists ? candidate : resolve(root, 'index.html');
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(path));
  } catch { res.writeHead(500).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.stack || error.message));
  for (const path of ['/bookings', '/maintenance', '/reset-password']) {
    assert.equal((await page.goto(`${base}${path}`)).status(), 200);
    await page.waitForSelector('#root > *');
    assert.equal((await page.reload()).status(), 200);
  }
  await page.goto(`${base}/login`);
  await page.getByRole('heading', { name: 'Your home, in hand.' }).waitFor();
  await page.goto(base);
  await page.getByRole('heading', { name: /Beautifully considered/ }).waitFor();
  // Allow the lazy WebGL module and its split dependencies to execute.
  await page.waitForTimeout(2500);
  await page.locator('.architecture-scene canvas').waitFor();
  assert.equal(await page.locator('.architecture-scene--fallback').count(), 0, '3D renderer fell back after a runtime error');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ check: 'browser-production-bundle', passed: true, nestedRouteRefreshes: ['/bookings', '/maintenance', '/reset-password'], runtimeErrors: errors }));
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
