import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchStaffWorkspace } from '../../client/src/lib/staffWorkspace.js';

for (const [role, expected] of [
  ['tenant', []],
  ['manager', ['/manager/staff']],
  ['maintenance_staff', ['/staff/permissions']],
  [null, []],
]) {
  test(`staff workspace requests only permitted resources for ${role}`, async () => {
    const requests = [];
    const result = await fetchStaffWorkspace(role, async (path) => {
      requests.push(path);
      return path === '/manager/staff' ? { staff: [{ id: 'staff-1' }] } : { check_in_property_ids: ['property-1'] };
    });
    assert.deepEqual(requests, expected);
    assert.deepEqual(result.staffResponse.staff, role === 'manager' ? [{ id: 'staff-1' }] : []);
    assert.deepEqual(result.capabilityResponse.check_in_property_ids, role === 'maintenance_staff' ? ['property-1'] : []);
  });
}

test('preserves request failures for workspace error reporting', async () => {
  const result = await fetchStaffWorkspace('manager', async () => null);
  assert.equal(result.staffResponse, null);
  assert.deepEqual(result.capabilityResponse, { check_in_property_ids: [] });
});
