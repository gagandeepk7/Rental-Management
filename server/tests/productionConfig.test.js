import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicSupabaseKey, validateFrontendConfig } from '../../shared/productionConfig.mjs';
import { runtimeConfig } from '../src/config/runtime.js';
import { publicDatabaseError } from '../src/utils/publicError.js';
import { SupabaseRateLimitStore } from '../src/middleware/rateLimit.js';
import fs from 'node:fs';

const publicKey = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
const secretKey = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
const frontend = { VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_ANON_KEY: publicKey, VITE_API_URL: '/api' };
const backend = { NODE_ENV: 'production', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: secretKey, VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'test.vercel.app', VERCEL_URL: 'preview.vercel.app' };
test('production frontend rejects missing config, local API URLs, and privileged keys', () => {
  assert.doesNotThrow(() => validateFrontendConfig(frontend, true));
  assert.throws(() => validateFrontendConfig({}, true));
  assert.throws(() => validateFrontendConfig({ ...frontend, VITE_API_URL: 'http://localhost:5001/api' }, true));
  assert.throws(() => validateFrontendConfig({ ...frontend, VITE_SUPABASE_ANON_KEY: secretKey }, true));
  assert.throws(() => validateFrontendConfig({ ...frontend, VITE_SERVICE_ROLE_KEY: secretKey }, true));
  assert.equal(isPublicSupabaseKey('sb_secret_example'), false);
});
test('production server requires credentials and exact HTTPS origins', () => {
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production' }));
  assert.throws(() => runtimeConfig({ ...backend, FRONTEND_ORIGIN: 'http://localhost:5173' }));
  const config = runtimeConfig(backend);
  assert.deepEqual(config.origins, ['https://test.vercel.app', 'https://preview.vercel.app']);
  assert.equal(config.proxyHops, 1);
  assert.equal(config.origins.includes('https://attacker.vercel.app'), false);
});
test('database errors expose safe messages rather than SQL/internal details', () => {
  const message = publicDatabaseError({ code: 'XX000', message: 'secret database relation internal_schema.user_passwords' });
  assert.doesNotMatch(message, /secret|internal_schema|passwords/);
});
test('distributed rate store hashes client identifiers and preserves atomic counts', async () => {
  let args;
  const store = new SupabaseRateLimitStore('api', { rpc: async (name, params) => { args = { name, params }; return { data: { total_hits: 601, reset_at: '2026-10-15T12:00:00Z' } }; } });
  store.init({ windowMs: 60000 });
  const result = await store.increment('192.0.2.1');
  assert.equal(args.name, 'consume_api_rate_limit');
  assert.match(args.params.bucket_key, /^[a-f0-9]{64}$/);
  assert.equal(args.params.window_seconds, 60);
  assert.equal(result.totalHits, 601);
  assert.equal(result.resetTime.toISOString(), '2026-10-15T12:00:00.000Z');
});
test('rate store fails closed on database failure', async () => {
  const store = new SupabaseRateLimitStore('api', { rpc: async () => ({ error: { message: 'internal db details' } }) });
  store.init({ windowMs: 60000 });
  await assert.rejects(() => store.increment('192.0.2.1'), /unavailable/);
});
test('client-root Vercel deploy builds only Vite and supports SPA routes', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../client/vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.framework, 'vite');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.functions, undefined);
  assert.equal(config.installCommand, undefined);
  assert.equal(config.rewrites[0].destination, '/index.html');
  for (const path of ['/bookings', '/maintenance', '/reset-password']) {
    assert.match(path, new RegExp(`^${config.rewrites[0].source}$`));
  }
});
