const registrationRoles = new Set(['tenant', 'manager', 'maintenance_staff']);

// Only the signed-in account can finish its one-time role selection.
// Later role edits through /profile remain forbidden.
export async function completeRegistrationRole(supabase, user, profile) {
  const requestedRole = user.user_metadata?.registration_role;
  if (!registrationRoles.has(requestedRole) || !user.email_confirmed_at ||
      user.app_metadata?.registration_role_assigned || profile?.role !== 'tenant') {
    return profile;
  }

  const { data, error } = await supabase.from('profiles')
    .update({ role: requestedRole })
    .eq('id', user.id).eq('role', 'tenant').select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Account setup changed. Please try again.');

  const { error: metadataError } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, registration_role_assigned: true },
  });
  if (metadataError) throw metadataError;
  return data;
}
