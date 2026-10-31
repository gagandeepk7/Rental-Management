// Keep manager-only data out of resident and maintenance-staff requests.
export async function fetchStaffWorkspace(role, fetchResource) {
  const [staffResponse, capabilityResponse] = await Promise.all([
    role === 'manager'
      ? fetchResource('/manager/staff', 'staff')
      : { staff: [] },
    role === 'maintenance_staff'
      ? fetchResource('/staff/permissions', 'staff permissions')
      : { check_in_property_ids: [] },
  ]);
  return { staffResponse, capabilityResponse };
}
