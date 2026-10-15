import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient, createSupabaseUserClient } from '../src/config/supabase.js';
import app from '../src/app.js';

if (process.env.NODE_ENV === 'production') throw new Error('Run fixtures against the local API, not the production server.');
const admin = createSupabaseAdminClient();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api`;
const users = []; const objects = []; const channels = [];
let propertyId; let failures = 0;
const runId = randomUUID();
const check = async (name, fn) => {
  try { await fn(); console.log(JSON.stringify({ check: name, passed: true })); }
  catch (error) { failures++; console.log(JSON.stringify({ check: name, passed: false, message: error.message })); }
};
const must = ({ data, error }) => { if (error) throw new Error(`Database ${error.code || error.status || 'operation'}: ${error.message}`); return data; };
async function api(session, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function account(role) {
  const email = `deploy-${randomUUID()}@example.invalid`;
  const password = `${randomUUID()}Aa1!`;
  const data = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Deployment smoke fixture' } }));
  users.push(data.user.id);
  must(await admin.from('profiles').update({ role }).eq('id', data.user.id));
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const session = must(await client.auth.signInWithPassword({ email, password })).session;
  return { id: data.user.id, session, db: createSupabaseUserClient(session.access_token) };
}
try {
  const manager = await account('manager');
  const tenant = await account('tenant');
  const staff = await account('maintenance_staff');
  const outsider = await account('tenant');
  const property = await api(manager.session, '/properties', 'POST', { name: `Deployment smoke ${runId}`, address: 'Temporary test fixture' });
  assert.equal(property.status, 201, property.body.error); propertyId = property.body.property.id;
  must(await admin.from('properties').update({ timezone: 'UTC' }).eq('id', propertyId));
  const unit = must(await admin.from('property_units').insert({ property_id: propertyId, unit_number: 'TEST-1' }).select().single());
  const today = new Date().toISOString().slice(0, 10);
  must(await admin.from('tenant_assignments').insert({ property_id: propertyId, tenant_id: tenant.id, unit_id: unit.id, lease_start: today, status: 'active' }));
  must(await admin.from('property_members').insert([{ property_id: propertyId, user_id: tenant.id, membership_role: 'tenant' }, { property_id: propertyId, user_id: staff.id, membership_role: 'maintenance_staff' }]));
  let requestId; let amenity;
  await check('tenant-assigned-property', async () => {
    const result = await api(tenant.session, '/tenant/property'); assert.equal(result.status, 200); assert.equal(result.body.property.id, propertyId);
  });
  await check('tenant-create-maintenance', async () => {
    const result = await api(tenant.session, '/maintenance', 'POST', { title: 'Deployment fixture issue', description: 'Temporary automated role verification', priority: 'low' });
    assert.equal(result.status, 201, result.body.error); requestId = result.body.maintenanceRequest.id;
  });
  if (requestId) {
    await check('staff-cannot-update-unassigned-task', async () => assert.equal((await api(staff.session, `/maintenance/${requestId}/status`, 'PATCH', { status: 'in_progress' })).status, 403));
    await check('manager-assign-task', async () => assert.equal((await api(manager.session, `/manager/maintenance/${requestId}/assignment`, 'PATCH', { staff_id: staff.id })).status, 200));
    await check('realtime-assigned-task-status', async () => {
      await tenant.db.realtime.setAuth(tenant.session.access_token);
      let resolveEvent;
      const event = new Promise((resolve) => { resolveEvent = resolve; });
      const channel = tenant.db.channel(`deployment-${runId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'maintenance_requests', filter: `id=eq.${requestId}` }, () => resolveEvent(true));
      channels.push({ client: tenant.db, channel });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 15000);
        channel.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } if (status === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('Realtime channel rejected')); } });
      });
      const result = await api(staff.session, `/maintenance/${requestId}/status`, 'PATCH', { status: 'in_progress' }); assert.equal(result.status, 200);
      let timer;
      try { await Promise.race([event, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No Realtime update delivered')), 15000); })]); } finally { clearTimeout(timer); }
    });
    await check('comment-rls-and-internal-privacy', async () => {
      must(await staff.db.from('maintenance_comments').insert({ request_id: requestId, author_id: staff.id, body: 'Private smoke note', is_internal: true }));
      must(await tenant.db.from('maintenance_comments').insert({ request_id: requestId, author_id: tenant.id, body: 'Tenant smoke note' }));
      const notes = must(await tenant.db.from('maintenance_comments').select('id,is_internal').eq('request_id', requestId));
      assert.equal(notes.some((note) => note.is_internal), false);
      const internal = await tenant.db.from('maintenance_comments').insert({ request_id: requestId, author_id: tenant.id, body: 'Forbidden private note', is_internal: true }); assert.ok(internal.error);
    });
    await check('tenant-cannot-directly-change-maintenance-status', async () => {
      const result = await tenant.db.from('maintenance_requests').update({ status: 'in_progress' }).eq('id', requestId).select(); assert.ok(result.error || result.data.length === 0);
    });
    await check('private-photo-upload-and-access', async () => {
      const signed = await api(tenant.session, `/maintenance/${requestId}/photos/upload-url`, 'POST', { file_name: 'fixture.png', content_type: 'image/png' });
      assert.equal(signed.status, 200, signed.body.error); objects.push(signed.body.object_path);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64');
      must(await tenant.db.storage.from('maintenance-photos').uploadToSignedUrl(signed.body.object_path, signed.body.token, png, { contentType: 'image/png' }));
      const attach = await api(tenant.session, `/maintenance/${requestId}/photos`, 'POST', { photos: [{ object_path: signed.body.object_path, file_name: 'fixture.png', content_type: 'image/png' }] }); assert.equal(attach.status, 201, attach.body.error);
      must(await tenant.db.storage.from('maintenance-photos').download(signed.body.object_path));
      const forbidden = await outsider.db.storage.from('maintenance-photos').download(signed.body.object_path); assert.ok(forbidden.error);
    });
    await check('unrelated-user-cannot-view-request-comments', async () => assert.equal((await api(outsider.session, `/maintenance/${requestId}/comments`)).status, 404));
  }
  await check('tenant-cannot-promote-own-role', async () => {
    const result = await tenant.db.from('profiles').update({ role: 'manager' }).eq('id', tenant.id); assert.ok(result.error);
  });
  await check('manager-create-amenity', async () => {
    const result = await api(manager.session, '/amenities', 'POST', { property_id: propertyId, name: 'Smoke amenity', opening_time: '09:00', closing_time: '21:00', slot_duration_minutes: 60 });
    assert.equal(result.status, 201, result.body.error); amenity = result.body.amenity;
  });
  if (amenity) {
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const booking = { amenity_id: amenity.id, property_id: propertyId, booking_date: date, check_in_time: '10:00', check_out_time: '11:00' };
    await check('simultaneous-api-bookings-only-one-wins', async () => {
      const results = await Promise.all([api(tenant.session, '/bookings', 'POST', booking), api(tenant.session, '/bookings', 'POST', booking)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      const id = results.find((result) => result.status === 201).body.booking.id;
      assert.equal((await api(staff.session, `/bookings/${id}`, 'PATCH', { action: 'check_in' })).status, 403);
      assert.equal((await api(tenant.session, `/bookings/${id}`, 'PATCH', { action: 'cancel' })).status, 200);
    });
    await check('database-overlap-constraint-under-concurrency', async () => {
      const row = { ...booking, user_id: tenant.id, check_in_time: '12:00', check_out_time: '13:00' };
      const results = await Promise.all([admin.from('amenity_bookings').insert(row), admin.from('amenity_bookings').insert(row)]);
      assert.equal(results.filter((result) => !result.error).length, 1);
      assert.equal(results.find((result) => result.error)?.error.code, '23P01');
    });
    await check('tenant-cannot-bypass-booking-api', async () => {
      const result = await tenant.db.from('amenity_bookings').insert({ ...booking, user_id: tenant.id, check_in_time: '14:00', check_out_time: '15:00' }); assert.ok(result.error);
    });
    await check('authorized-staff-check-in-out', async () => {
      must(await admin.from('property_members').update({ can_manage_bookings: true }).eq('property_id', propertyId).eq('user_id', staff.id));
      const now = new Date(); const hour = now.getUTCHours();
      if (hour >= 23) throw new Error('Current UTC hour cannot fit an in-day booking fixture. Rerun earlier.');
      const liveAmenity = must(await admin.from('amenities').insert({ property_id: propertyId, name: 'Live check-in fixture', opening_time: '00:00', closing_time: '23:59', slot_duration_minutes: 1 }).select().single());
      const futureMinute = new Date(Date.now() + 60000);
      const startTime = futureMinute.toISOString().slice(11, 16);
      const endTime = new Date(futureMinute.getTime() + 60000).toISOString().slice(11, 16);
      const row = must(await admin.from('amenity_bookings').insert({ amenity_id: liveAmenity.id, property_id: propertyId, user_id: tenant.id, booking_date: today, check_in_time: startTime, check_out_time: endTime }).select().single());
      assert.equal((await api(staff.session, `/bookings/${row.id}`, 'PATCH', { action: 'check_in' })).status, 400);
      const startsAt = Date.parse(`${today}T${startTime}:00Z`);
      console.log(JSON.stringify({ check: 'staff-live-slot-wait', waitMs: Math.max(0, startsAt - Date.now() + 500) }));
      await new Promise((resolve) => setTimeout(resolve, Math.min(60000, Math.max(0, startsAt - Date.now() + 500))));
      assert.equal((await api(staff.session, `/bookings/${row.id}`, 'PATCH', { action: 'check_in' })).status, 200);
      must(await admin.from('property_members').update({ can_manage_bookings: false }).eq('property_id', propertyId).eq('user_id', staff.id));
      assert.equal((await api(staff.session, `/bookings/${row.id}`, 'PATCH', { action: 'check_out' })).status, 403);
      must(await admin.from('property_members').update({ can_manage_bookings: true }).eq('property_id', propertyId).eq('user_id', staff.id));
      assert.equal((await api(staff.session, `/bookings/${row.id}`, 'PATCH', { action: 'check_out' })).status, 200);

    });
  }
} catch (error) { failures++; console.log(JSON.stringify({ check: 'fixture-setup', passed: false, message: error.message })); }
finally {
  for (const { client, channel } of channels) await client.removeChannel(channel);
  if (objects.length) { const result = await admin.storage.from('maintenance-photos').remove(objects); if (result.error) { failures++; console.log(JSON.stringify({ check: 'cleanup-storage', passed: false })); } }
  if (propertyId) { const result = await admin.from('properties').delete().eq('id', propertyId); if (result.error) { failures++; console.log(JSON.stringify({ check: 'cleanup-property', passed: false })); } }
  for (const id of users.reverse()) { const result = await admin.auth.admin.deleteUser(id); if (result.error) { failures++; console.log(JSON.stringify({ check: 'cleanup-account', passed: false, fixtureId: id })); } }
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ summary: 'Live database/API smoke tests finished; temporary fixtures cleaned up.', failures }));
process.exitCode = failures ? 1 : 0;
