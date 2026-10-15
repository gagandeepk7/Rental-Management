import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
process.env.NODE_ENV = 'production';
process.env.FRONTEND_ORIGIN = 'https://smoke.example.com';
process.env.TRUST_PROXY_HOPS = '1';
const { default: app } = await import('../src/app.js');
const { createSupabaseAdminClient } = await import('../src/config/supabase.js');
const db = createSupabaseAdminClient();
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const ip = `198.51.100.${randomBytes(1)[0] || 1}`;
const headers = { 'x-forwarded-for': ip, 'Content-Type': 'application/json' };
try {
  const allowed = await fetch(`${base}/api/health`, { headers: { Origin: process.env.FRONTEND_ORIGIN } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), process.env.FRONTEND_ORIGIN);
  const blocked = await fetch(`${base}/api/health`, { headers: { Origin: 'https://untrusted.example.com' } });
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  const malformed = await fetch(`${base}/api/bookings`, { method: 'POST', headers, body: '{invalid' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'Invalid JSON request.' });
  assert.equal((await fetch(`${base}/api/profile`, { headers })).status, 401);
  let response;
  for (let index = 0; index < 16; index++) {
    response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers, body: '{}' });
    if (index < 15) assert.equal(response.status, 400);
  }
  assert.equal(response.status, 429);
  assert.ok(response.headers.get('retry-after'));
  assert.deepEqual(await response.json(), { error: 'Too many requests. Please try again later.' });
  assert.equal(response.headers.get('x-powered-by'), null);
  console.log(JSON.stringify({ check: 'production-http-security', passed: true, checks: ['exact CORS origins','generic JSON errors','unauthenticated request denied','shared-database rate limit','429 and Retry-After','no framework header'] }));
} finally {
  const keys = ['api','auth'].map((scope) => createHash('sha256').update(`${scope}:${ip}`).digest('hex'));
  const { error } = await db.from('api_rate_limits').delete().in('key_hash', keys);
  if (error) console.error('Rate fixture cleanup failed.');
  await new Promise((done) => server.close(done));
}
