import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../src/config/supabase.js';
import app from '../src/app.js';

if (process.env.NODE_ENV === 'production') throw new Error('Use a development/test Supabase project.');
const admin = createSupabaseAdminClient();
const users = [];
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  for (const role of ['tenant', 'manager', 'maintenance_staff']) {
    const email = `registration-${randomUUID()}@example.invalid`;
    const password = `${randomUUID()}Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { full_name: 'Registration role fixture', registration_role: role } });
    if (created.error) throw created.error;
    const id = created.data.user.id;
    users.push(id);
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    const headers = { Authorization: `Bearer ${signedIn.data.session.access_token}` };
    const url = `http://127.0.0.1:${server.address().port}/api/profile`;
    const response = await fetch(url, { headers });
    const payload = await response.json();
    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.profile.role, role);
    const changed = await client.auth.updateUser({ data: { registration_role: role === 'manager' ? 'maintenance_staff' : 'manager' } });
    if (changed.error) throw changed.error;
    const reread = await fetch(url, { headers });
    assert.equal((await reread.json()).profile.role, role, 'A later metadata edit changed the assigned role');
    console.log(JSON.stringify({ check: `registration-role:${role}`, passed: true, emailDeliveryTested: false }));
  }
} finally {
  for (const id of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  await new Promise((resolve) => server.close(resolve));
  console.log('Temporary registration test users cleaned up.');
}
