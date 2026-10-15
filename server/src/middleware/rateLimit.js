import { createHash } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { createSupabaseAdminClient } from '../config/supabase.js';

// Shared counters survive cold starts and work across all Vercel instances.
export class SupabaseRateLimitStore {
  constructor(scope, client = createSupabaseAdminClient()) { this.scope = scope; this.client = client; }
  init(options) { this.windowMs = options.windowMs; }
  async increment(key) {
    if (!this.client) throw new Error('Rate limit database is unavailable.');
    const digest = createHash('sha256').update(`${this.scope}:${key}`).digest('hex');
    const { data, error } = await this.client.rpc('consume_api_rate_limit', { bucket_key: digest, window_seconds: Math.ceil(this.windowMs / 1000) });
    if (error) throw new Error('Rate limit database is unavailable.');
    return { totalHits: Number(data.total_hits), resetTime: new Date(data.reset_at) };
  }
  async decrement() { /* All attempts count, including failed auth. */ }
  async resetKey() { /* Administrative resets are intentionally not exposed. */ }
}

export function createLimiters(production) {
  const make = (scope, windowMs, limit) => rateLimit({
    windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    ...(production ? { store: new SupabaseRateLimitStore(scope) } : {}),
    message: { error: 'Too many requests. Please try again later.' },
    // Never bypass protection when the shared store is unavailable.
    passOnStoreError: false,
  });
  return { api: make('api', 60000, 600), auth: make('auth', 15 * 60000, 15) };
}
