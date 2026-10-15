import 'dotenv/config';
import { createSupabaseAdminClient } from '../src/config/supabase.js';
const db = createSupabaseAdminClient();
if (!db) throw new Error('Server Supabase environment variables are missing.');
const signatures = {
  profiles: 'id,role', properties: 'id,timezone,booking_cancellation_hours',
  property_members: 'id,can_manage_bookings', property_units: 'id,is_active',
  tenant_assignments: 'id,unit_id',
  maintenance_requests: 'id,unit_id,due_at,resolution_notes,completion_submitted_at,completion_reviewed_at,completion_reviewed_by,completion_review_notes',
  maintenance_photos: 'id,is_completion_proof', maintenance_comments: 'id,is_internal',
  amenity_bookings: 'id,checked_in_at,checked_out_at,cancelled_at,cancelled_by',
  amenities: 'id,slot_duration_minutes', notifications: 'id', activity_events: 'id', booking_disputes: 'id',
};
let failed = false;
for (const [table, columns] of Object.entries(signatures)) {
  const { error } = await db.from(table).select(columns).limit(0);
  console.log(JSON.stringify({ check: `schema:${table}`, passed: !error, ...(error ? { code: error.code, message: error.message } : {}) }));
  if (error) failed = true;
}
const { data: bucket, error: bucketError } = await db.storage.getBucket('maintenance-photos');
console.log(JSON.stringify({ check: 'storage:maintenance-photos', passed: !bucketError && bucket?.public === false, private: bucket?.public === false, sizeLimit: bucket?.file_size_limit, mimeTypes: bucket?.allowed_mime_types }));
const { data: diagnostic, error: diagnosticError } = await db.rpc('deployment_security_audit');
const expectedRealtime = ['maintenance_requests','maintenance_comments','maintenance_photos','amenity_bookings','notifications','activity_events','amenities','property_members'];
const expectedTriggers = ['prevent_profile_role_changes','validate_assignment_relationships','validate_maintenance_relationships','validate_booking_slot','limit_maintenance_photos'];
const diagnosticPassed = !diagnosticError && diagnostic && Object.values(diagnostic.rls || {}).every(Boolean)
  && Object.keys(diagnostic.rls || {}).length >= 14
  && ['amenity_bookings_no_overlap','tenant_unit_assignment_no_overlap'].every((name) => diagnostic.constraints?.includes(name))
  && expectedTriggers.every((name) => diagnostic.triggers?.includes(name))
  && expectedRealtime.every((name) => diagnostic.realtime?.includes(name))
  && ['Booking participant privacy boundary','Maintenance participant privacy boundary'].every((name) => diagnostic.policies?.some((policy) => policy.name === name))
  && diagnostic.comments_insert_allowed === true
  && diagnostic.direct_bookings_insert_allowed === false && diagnostic.direct_maintenance_update_allowed === false;
console.log(JSON.stringify({ check: 'database:policies-triggers-realtime', passed: Boolean(diagnosticPassed), ...(diagnosticError ? { code: diagnosticError.code, message: diagnosticError.message } : { results: diagnostic }) }));
const { data: authUsers, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
console.log(JSON.stringify({ check: 'admin-credentials', passed: !authError && Boolean(authUsers) }));

console.log(JSON.stringify({ check: 'note', message: 'Schema signatures alone do not prove policies or migrations. SQL diagnostics must also pass; hosted auth redirect settings require project-management access.' }));
process.exitCode = failed || bucketError || !diagnosticPassed || authError ? 1 : 0;
