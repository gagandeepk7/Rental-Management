import test from 'node:test';
import assert from 'node:assert/strict';
import { completeRegistrationRole } from '../src/utils/registrationRole.js';

function fixture({ role = 'manager', currentRole = 'tenant', confirmed = true, assigned = false, fail = false } = {}) {
  const writes = [];
  const user = { id: 'signed-in-user', email_confirmed_at: confirmed ? '2026-10-31' : null,
    user_metadata: { registration_role: role }, app_metadata: { registration_role_assigned: assigned } };
  const profile = { id: user.id, role: currentRole };
  const db = {
    from(table) {
      const query = {
        update(change) { writes.push({ table, change, filters: [] }); return query; },
        eq(key, value) { writes.at(-1).filters.push([key, value]); return query; },
        select() { return query; },
        async maybeSingle() { return fail ? { error: new Error('database unavailable') } : { data: { ...profile, role } }; },
      };
      return query;
    },
    auth: { admin: { async updateUserById(id, change) { writes.push({ id, change }); return { error: null }; } } },
  };
  return { writes, user, profile, db };
}

for (const role of ['tenant', 'manager', 'maintenance_staff']) {
  test(`confirmed registration activates ${role} only for the signed-in user`, async () => {
    const f = fixture({ role });
    const result = await completeRegistrationRole(f.db, f.user, f.profile);
    assert.equal(result.role, role);
    assert.deepEqual(f.writes[0].filters, [['id', f.user.id], ['role', 'tenant']]);
    assert.equal(f.writes[1].id, f.user.id);
    assert.equal(f.writes[1].change.app_metadata.registration_role_assigned, true);
  });
}

for (const options of [{ role: 'admin' }, { role: undefined, assigned: true }, { confirmed: false }, { assigned: true }, { currentRole: 'manager' }, { currentRole: 'maintenance_staff' }]) {
  test(`does not change existing, unconfirmed or invalid-role accounts: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.deepEqual(await completeRegistrationRole(f.db, f.user, f.profile), f.profile);
    assert.deepEqual(f.writes, []);
  });
}

test('database failure does not mark onboarding complete', async () => {
  const f = fixture({ fail: true });
  await assert.rejects(completeRegistrationRole(f.db, f.user, f.profile), /database unavailable/);
  assert.equal(f.writes.length, 1);
});
