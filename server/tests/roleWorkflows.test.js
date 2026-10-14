import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://workflow-test.invalid';
process.env.SUPABASE_ANON_KEY = 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
const { default: router } = await import('../src/routes/index.js');
const { requireAuth } = await import('../src/middleware/auth.js');

const originalFetch = globalThis.fetch;
const actor = '00000000-0000-4000-8000-000000000001';
const tenant = '00000000-0000-4000-8000-000000000002';
const propertyId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const bookingId = '00000000-0000-4000-8000-000000000005';

function responseRecorder() {
  return { code: 200, payload: null, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
}
async function invoke(method, path, req) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const res = responseRecorder();
  await route.stack.at(-1).handle({ user: { id: actor }, params: {}, body: {}, ...req }, res, (error) => { throw error; });
  return res;
}
function mockDatabase({ role, owner = actor, assigned = actor, permitted = false, booking = {}, conflict = false }) {
  const writes = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const table = url.pathname.split('/').at(-1);
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    let data;
    if (method !== 'GET') {
      writes.push({ table, method, body: JSON.parse(options.body || '{}'), url });
      if (table === 'amenity_bookings' && conflict) data = [];
      else data = [{ id: requestId, tenant_id: tenant, property_id: propertyId, title: 'Leak', ...JSON.parse(options.body || '{}') }];
    } else if (table === 'profiles') data = [{ id: actor, role, full_name: 'Test actor' }];
    else if (table === 'properties') data = [{ id: propertyId, owner_id: owner, timezone: 'UTC', booking_cancellation_hours: 0 }];
    else if (table === 'maintenance_requests') data = [{ id: requestId, property_id: propertyId, tenant_id: role === 'tenant' ? actor : tenant, assigned_to: assigned, title: 'Leak', status: 'pending' }];
    else if (table === 'property_members') data = [{ id: 'membership', can_manage_bookings: permitted }];
    else if (table === 'amenity_bookings') data = [{ id: bookingId, property_id: propertyId, user_id: tenant, status: 'confirmed', booking_date: new Date().toISOString().slice(0, 10), check_in_time: '00:00:00', check_out_time: '23:59:00', checked_in_at: null, checked_out_at: null, ...booking }];
    else data = [];
    if (headers.get('accept')?.includes('application/vnd.pgrst.object+json')) data = data[0] || null;
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return writes;
}
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('authentication rejects absent bearer token', async () => {
  const res = responseRecorder();
  await requireAuth({ headers: {} }, res, () => assert.fail('must not authorize'));
  assert.equal(res.code, 401);
});

for (const scenario of [
  { role: 'tenant', expected: 403 },
  { role: 'maintenance_staff', expected: 200 },
  { role: 'maintenance_staff', assigned: tenant, expected: 403 },
  { role: 'manager', expected: 200 },
  { role: 'manager', owner: tenant, expected: 403 },
]) {
  test(`maintenance update: ${JSON.stringify(scenario)}`, async () => {
    const writes = mockDatabase(scenario);
    const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { status: 'in_progress' } });
    assert.equal(res.code, scenario.expected);
    assert.equal(writes.some((write) => write.table === 'maintenance_requests'), scenario.expected === 200);
  });
}

test('staff completion requires resolution notes', async () => {
  const writes = mockDatabase({ role: 'maintenance_staff' });
  const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { status: 'completed', resolution_notes: '   ' } });
  assert.equal(res.code, 400);
  assert.equal(writes.length, 0);
});

test('tenant cannot create internal comments', async () => {
  const writes = mockDatabase({ role: 'tenant' });
  const res = await invoke('post', '/maintenance/:id/comments', { params: { id: requestId }, body: { body: 'Private', is_internal: true } });
  assert.equal(res.code, 403);
  assert.equal(writes.length, 0);
});

for (const scenario of [
  { role: 'maintenance_staff', permitted: false, expected: 403 },
  { role: 'maintenance_staff', permitted: true, expected: 200 },
  { role: 'manager', expected: 200 },
  { role: 'manager', owner: tenant, expected: 403 },
  { role: 'tenant', booking: { user_id: actor }, expected: 200 },
  { role: 'tenant', expected: 403 },
]) {
  test(`booking check-in: ${JSON.stringify(scenario)}`, async () => {
    const writes = mockDatabase(scenario);
    const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'check_in' } });
    assert.equal(res.code, scenario.expected);
    assert.equal(writes.some((write) => write.table === 'amenity_bookings'), scenario.expected === 200);
  });
}

test('authorized staff cannot cancel reservations', async () => {
  mockDatabase({ role: 'maintenance_staff', permitted: true });
  const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'cancel' } });
  assert.equal(res.code, 403);
});

test('check-out requires check-in', async () => {
  mockDatabase({ role: 'manager' });
  const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'check_out' } });
  assert.equal(res.code, 400);
});

test('cannot check in before the reservation date', async () => {
  mockDatabase({ role: 'manager', booking: { booking_date: '2099-01-01' } });
  const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'check_in' } });
  assert.equal(res.code, 400);
});

test('concurrent lifecycle update returns conflict and uses state filters', async () => {
  const writes = mockDatabase({ role: 'manager', conflict: true });
  const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'check_in' } });
  assert.equal(res.code, 409);
  const write = writes.find((item) => item.table === 'amenity_bookings');
  assert.equal(write.url.searchParams.get('status'), 'eq.confirmed');
  assert.equal(write.url.searchParams.get('checked_in_at'), 'is.null');
});
