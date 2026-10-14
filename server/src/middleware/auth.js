import { createSupabaseUserClient } from "../config/supabase.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const client = createSupabaseUserClient(token);
    if (!client) {
      return res
        .status(500)
        .json({ error: "Supabase is not configured for auth checks." });
    }

    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    req.user = user;
    req.supabase = client;
    return next();
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Authentication failed.", details: error.message });
  }
}

export function getUserRole(user) {
  return user?.app_metadata?.role || "tenant";
}
