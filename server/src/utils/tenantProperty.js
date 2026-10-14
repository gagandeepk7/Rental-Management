export async function getActiveTenantAssignment(supabase, userId) {
  if (!supabase || !userId) {
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: assignment, error } = await supabase
    .from("tenant_assignments")
    .select("*")
    .eq("tenant_id", userId)
    .eq("status", "active")
    .lte("lease_start", today)
    .or(`lease_end.is.null,lease_end.gte.${today}`)
    .order("lease_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (!assignment || !assignment.property_id) {
    return null;
  }

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("*")
    .eq("id", assignment.property_id)
    .maybeSingle();

  if (propertyError) {
    throw propertyError;
  }

  return {
    ...assignment,
    property,
  };
}

export async function getTenantPropertyFromMembership(supabase, userId) {
  if (!supabase || !userId) {
    return null;
  }

  const activeAssignment = await getActiveTenantAssignment(supabase, userId);
  if (activeAssignment?.property_id) {
    return {
      property_id: activeAssignment.property_id,
      unit_id: activeAssignment.unit_id || null,
      lease_start: activeAssignment.lease_start,
      lease_end: activeAssignment.lease_end,
      status: activeAssignment.status,
      membership_role: "tenant",
      created_at: activeAssignment.created_at,
      property: activeAssignment.property,
    };
  }

  const { data: assignmentHistory, error: assignmentHistoryError } =
    await supabase
      .from("tenant_assignments")
      .select("id")
      .eq("tenant_id", userId)
      .limit(1)
      .maybeSingle();
  if (assignmentHistoryError) throw assignmentHistoryError;
  if (assignmentHistory) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("property_members")
    .select("property_id, membership_role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw membershipError;
  }

  if (!membership || !membership.property_id) {
    return null;
  }

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("*")
    .eq("id", membership.property_id)
    .maybeSingle();

  if (propertyError) {
    throw propertyError;
  }

  return {
    property_id: membership.property_id,
    unit_id: null,
    membership_role: membership.membership_role,
    created_at: membership.created_at,
    property,
  };
}

export async function getPropertyIdForTenantMaintenance(supabase, userId) {
  const tenantProperty = await getTenantPropertyFromMembership(
    supabase,
    userId,
  );
  return tenantProperty ? tenantProperty.property_id : null;
}
