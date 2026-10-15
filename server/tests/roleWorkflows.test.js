import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://workflow-test.invalid';
process.env.SUPABASE_ANON_KEY = 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
const { default: router } = await import('../src/routes/index.js');
const { requireAuth } = await import('../src/middleware/auth.js');
const { createSupabaseUserClient } = await import('../src/config/supabase.js');

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
  await route.stack.at(-1).handle({
    user: { id: actor },
    params: {},
    body: {},
    supabase: createSupabaseUserClient('test-user-token'),
    ...req,
  }, res, (error) => { throw error; });
  return res;
}
function mockDatabase({
  role,
  owner = actor,
  assigned = actor,
  permitted = false,
  cancellationHours = 0,
  booking = {},
  conflict = false,
  maintenanceStatus = 'pending',
  completionSubmittedAt = null,
  proofPhotos = [],
  units = [],
  activeAssignments = [],
}) {
  const writes = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.includes('/storage/v1/object/upload/sign/')) {
      return new Response(JSON.stringify({
        url: `${url.pathname.replace('/storage/v1', '')}?token=test-signed-upload-token`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const table = url.pathname.split('/').at(-1);
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    let data;
    if (method !== 'GET') {
      writes.push({
        table,
        method,
        body: JSON.parse(options.body || '{}'),
        url,
        authorization: headers.get('authorization'),
      });
      if (table === 'amenity_bookings' && conflict) data = [];
      else data = [{ id: requestId, tenant_id: tenant, property_id: propertyId, title: 'Leak', ...JSON.parse(options.body || '{}') }];
    } else if (table === 'profiles') data = [{ id: actor, role, full_name: 'Test actor' }];
    else if (table === 'properties') data = [{ id: propertyId, owner_id: owner, name: 'Test property', timezone: 'UTC', booking_cancellation_hours: cancellationHours }];
    else if (table === 'property_units') data = units;
    else if (table === 'maintenance_requests') data = [{ id: requestId, property_id: propertyId, tenant_id: role === 'tenant' ? actor : tenant, assigned_to: assigned, unit_id: null, title: 'Leak', status: maintenanceStatus, completion_submitted_at: completionSubmittedAt, resolution_notes: completionSubmittedAt ? 'Fixed the leak.' : null }];
    else if (table === 'maintenance_photos') data = proofPhotos;
    else if (table === 'tenant_assignments') data = activeAssignments;
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
  const writes = mockDatabase({ role: 'maintenance_staff', maintenanceStatus: 'in_progress' });
  const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { status: 'completed', resolution_notes: '   ' } });
  assert.equal(res.code, 400);
  assert.equal(writes.length, 0);
});

test('staff completion requires uploaded proof photo', async () => {
  const writes = mockDatabase({ role: 'maintenance_staff', maintenanceStatus: 'in_progress' });
  const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { status: 'completed', resolution_notes: 'Fixed the leak.' } });
  assert.equal(res.code, 400);
  assert.equal(writes.some((write) => write.table === 'maintenance_requests'), false);
});

test('staff submits proof for review without completing tenant-visible status', async () => {
  const writes = mockDatabase({
    role: 'maintenance_staff',
    maintenanceStatus: 'in_progress',
    proofPhotos: [{ id: 'proof-photo' }],
  });
  const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { status: 'completed', resolution_notes: 'Fixed the leak.' } });
  assert.equal(res.code, 200);
  const update = writes.find((write) => write.table === 'maintenance_requests');
  assert.equal(update.body.status, undefined);
  assert.equal(update.body.completion_submitted_at !== undefined, true);
  assert.equal(update.body.resolution_notes, 'Fixed the leak.');
  assert.equal(writes.some((write) => write.table === 'maintenance_comments'), false);
});

test('maintenance status changes do not create system comments', async () => {
  const writes = mockDatabase({ role: 'manager', maintenanceStatus: 'pending' });
  const res = await invoke('patch', '/maintenance/:id/status', {
    params: { id: requestId },
    body: { status: 'in_progress' },
  });
  assert.equal(res.code, 200);
  assert.equal(writes.some((write) => write.table === 'maintenance_comments'), false);
});

test('manager cannot approve work before staff submits it', async () => {
  const writes = mockDatabase({ role: 'manager' });
  const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { action: 'approve_completion' } });
  assert.equal(res.code, 400);
  assert.equal(writes.some((write) => write.table === 'maintenance_requests' && write.body.status === 'completed'), false);
});

test('manager approval marks submitted maintenance complete', async () => {
  const writes = mockDatabase({
    role: 'manager',
    maintenanceStatus: 'in_progress',
    completionSubmittedAt: '2026-01-01T12:00:00.000Z',
  });
  const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { action: 'approve_completion' } });
  assert.equal(res.code, 200);
  const update = writes.find((write) => write.table === 'maintenance_requests');
  assert.equal(update.body.status, 'completed');
  assert.equal(update.body.completion_reviewed_by, actor);
});

test('manager must explain requested completion changes', async () => {
  const writes = mockDatabase({
    role: 'manager',
    maintenanceStatus: 'in_progress',
    completionSubmittedAt: '2026-01-01T12:00:00.000Z',
  });
  const res = await invoke('patch', '/maintenance/:id/status', { params: { id: requestId }, body: { action: 'request_changes', review_notes: ' ' } });
  assert.equal(res.code, 400);
  assert.equal(writes.some((write) => write.table === 'maintenance_requests'), false);
});

test('manager property list reports persisted total and active unit counts', async () => {
  mockDatabase({
    role: 'manager',
    units: [
      { id: 'unit-1', property_id: propertyId, is_active: true },
      { id: 'unit-2', property_id: propertyId, is_active: true },
      { id: 'unit-3', property_id: propertyId, is_active: false },
    ],
  });
  const res = await invoke('get', '/manager/properties', {});
  assert.equal(res.code, 200);
  assert.equal(res.payload.properties[0].unit_count, 3);
  assert.equal(res.payload.properties[0].active_unit_count, 2);
});

test('tenant assignments cannot omit a unit when the property has active units', async () => {
  const writes = mockDatabase({
    role: 'manager',
    units: [{ id: 'unit-1', property_id: propertyId, is_active: true }],
  });
  const res = await invoke('post', '/tenant-assignments', {
    body: {
      tenant_id: tenant,
      property_id: propertyId,
      lease_start: '2026-01-01',
      status: 'active',
    },
  });
  assert.equal(res.code, 400);
  assert.equal(writes.some((write) => write.table === 'tenant_assignments'), false);
});

test('manager can add a unit to an existing tenant assignment', async () => {
  const writes = mockDatabase({
    role: 'manager',
    units: [{ id: 'unit-1', property_id: propertyId, is_active: true }],
    activeAssignments: [{
      id: 'assignment-1',
      tenant_id: tenant,
      property_id: propertyId,
      unit_id: null,
      status: 'active',
    }],
  });
  const res = await invoke('patch', '/tenant-assignments/:id', {
    params: { id: 'assignment-1' },
    body: { unit_id: 'unit-1' },
  });
  assert.equal(res.code, 200);
  const update = writes.find((write) => write.table === 'tenant_assignments');
  assert.equal(update.body.unit_id, 'unit-1');
});

test('assigned staff maintenance details include the tenant’s active apartment', async () => {
  mockDatabase({
    role: 'maintenance_staff',
    maintenanceStatus: 'in_progress',
    units: [{ id: 'unit-1', property_id: propertyId, unit_number: '401', is_active: true }],
    activeAssignments: [{ tenant_id: tenant, property_id: propertyId, unit_id: 'unit-1' }],
  });
  const res = await invoke('get', '/maintenance', {});
  assert.equal(res.code, 200);
  assert.equal(res.payload.maintenanceRequests[0].unit.unit_number, '401');
});

test('tenant cannot create internal comments', async () => {
  const writes = mockDatabase({ role: 'tenant' });
  const res = await invoke('post', '/maintenance/:id/comments', { params: { id: requestId }, body: { body: 'Private', is_internal: true } });
  assert.equal(res.code, 403);
  assert.equal(writes.length, 0);
});

test('authorized tenant comment is inserted with the caller JWT for RLS', async () => {
  const writes = mockDatabase({ role: 'tenant' });
  const res = await invoke('post', '/maintenance/:id/comments', {
    params: { id: requestId },
    body: { body: 'The leak is still present.', is_internal: false },
  });
  assert.equal(res.code, 201);
  assert.equal(res.payload.success, true);
  const commentInsert = writes.find((write) => write.table === 'maintenance_comments');
  assert.equal(commentInsert.method, 'POST');
  assert.equal(commentInsert.authorization, 'Bearer test-user-token');
  assert.equal(commentInsert.body.author_id, actor);
});

test('authorized tenant receives a signed URL scoped to maintenance photo storage', async () => {
  mockDatabase({ role: 'tenant' });
  const res = await invoke('post', '/maintenance/:id/photos/upload-url', {
    params: { id: requestId },
    body: {
      file_name: 'leak.jpg',
      content_type: 'image/jpeg',
      is_completion_proof: false,
    },
  });
  assert.equal(res.code, 200);
  assert.match(res.payload.object_path, new RegExp(`^${requestId}/`));
  assert.equal(res.payload.token, 'test-signed-upload-token');
});

test('only assigned staff can request completion-proof upload URLs', async () => {
  mockDatabase({ role: 'tenant' });
  const res = await invoke('post', '/maintenance/:id/photos/upload-url', {
    params: { id: requestId },
    body: {
      file_name: 'proof.jpg',
      content_type: 'image/jpeg',
      is_completion_proof: true,
    },
  });
  assert.equal(res.code, 403);
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

test('cannot check in after the reservation date has passed', async () => {
  mockDatabase({
    role: 'manager',
    booking: {
      booking_date: '2000-01-01',
      check_in_time: '10:00:00',
      check_out_time: '11:00:00',
    },
  });
  const res = await invoke('patch', '/bookings/:id', {
    params: { id: bookingId },
    body: { action: 'check_in' },
  });
  assert.equal(res.code, 400);
});

test('manager cannot cancel a booking after its reserved time has started', async () => {
  const writes = mockDatabase({
    role: 'manager',
    booking: {
      booking_date: '2000-01-01',
      check_in_time: '10:00:00',
      check_out_time: '11:00:00',
    },
  });
  const res = await invoke('patch', '/bookings/:id', {
    params: { id: bookingId },
    body: { action: 'cancel' },
  });
  assert.equal(res.code, 400);
  assert.equal(writes.some((write) => write.table === 'amenity_bookings'), false);
});

test('concurrent lifecycle update returns conflict and uses state filters', async () => {
  const writes = mockDatabase({ role: 'manager', conflict: true });
  const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'check_in' } });
  assert.equal(res.code, 409);
  const write = writes.find((item) => item.table === 'amenity_bookings');
  assert.equal(write.url.searchParams.get('status'), 'eq.confirmed');
  assert.equal(write.url.searchParams.get('checked_in_at'), 'is.null');
});

test('tenant can cancel an upcoming booking within the former advance cutoff', async () => {
  const starts = new Date(Date.now() + 60 * 60 * 1000);
  const writes = mockDatabase({ role: 'tenant', cancellationHours: 24, booking: {
    user_id: actor, booking_date: starts.toISOString().slice(0, 10),
    check_in_time: starts.toISOString().slice(11, 19),
  } });
  const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'cancel' } });
  assert.equal(res.code, 200);
  assert.equal(writes.find((write) => write.table === 'amenity_bookings').body.status, 'cancelled');
});
test('tenant cannot cancel an expired booking', async () => {
  const writes = mockDatabase({ role: 'tenant', booking: { user_id: actor, booking_date: '2020-01-01' } });
  const res = await invoke('patch', '/bookings/:id', { params: { id: bookingId }, body: { action: 'cancel' } });
  assert.equal(res.code, 400);
  assert.equal(writes.length, 0);
});
