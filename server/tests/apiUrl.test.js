import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBaseUrl, buildApiUrl } from '../../shared/apiUrl.mjs';
import { createApiClient } from '../../client/src/lib/apiClient.js';
const origin = 'https://property-management-api-2gu3.onrender.com';
for (const configured of [origin, `${origin}/`, `${origin}/api`, `${origin}/api/`, `  ${origin}/api  `]) {
  test(`normalizes ${JSON.stringify(configured)} to the Express mount`, () => {
    assert.equal(resolveApiBaseUrl(configured, { production: true }), `${origin}/api`);
  });
}
test('rejects invalid production API configuration rather than fetching the SPA', () => {
  for (const value of [undefined, '', '/api', `${origin}/api/api`, `${origin}/profile`, `${origin}?token=x`, `${origin}#fragment`, 'http://localhost:5000/api']) {
    assert.throws(() => resolveApiBaseUrl(value, { production: true }));
  }
});
test('keeps endpoint segments and availability query parameters inside /api', () => {
  const base = resolveApiBaseUrl(origin);
  for (const path of ['/profile', '/dashboard', '/maintenance', '/amenities', '/properties', '/bookings', '/notifications', '/manager/staff', '/staff/permissions', '/amenities/gym/availability?date=2026-10-16']) {
    assert.equal(buildApiUrl(base, path), `${origin}/api${path}`);
  }
  for (const path of ['/api/profile', '//untrusted.example/profile', 'https://untrusted.example/profile']) assert.throws(() => buildApiUrl(base, path));
});
test('API requests preserve bearer tokens, custom headers, method, body, and error responses', async () => {
  let request;
  const apiFetch = createApiClient(resolveApiBaseUrl(origin), async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
  const body = JSON.stringify({ action: 'cancel' });
  assert.deepEqual(await apiFetch('/bookings/123', { method: 'PATCH', body, headers: { 'X-Request-Id': 'test' } }, 'session-token'), { success: true });
  assert.equal(request.url, `${origin}/api/bookings/123`);
  assert.equal(request.options.headers.Authorization, 'Bearer session-token');
  assert.equal(request.options.headers['X-Request-Id'], 'test');
  assert.equal(request.options.method, 'PATCH');
  assert.equal(request.options.body, body);
  const rejected = createApiClient(resolveApiBaseUrl(origin), async () => new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401 }));
  await assert.rejects(() => rejected('/profile'), /Authentication required/);
});
