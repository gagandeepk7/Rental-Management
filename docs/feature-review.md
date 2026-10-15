# Role workflow review

Reviewed the React pages, Express routes, base SQL schema, tenant assignment migration, and workflow migration. Existing screens, APIs, and tables were reused; no replacement UI or duplicate domain tables were added. The application represents owners with the `manager` role and staff with `maintenance_staff`.

| Role | Existing functionality retained | Gaps addressed |
| --- | --- | --- |
| Tenant | Assigned property/unit view; maintenance creation and photos; comments and status; amenity directory and slot selection; booking list/cancellation/check-in/out; notification inbox | Live comment refresh; attach/retry photos on an existing request; prevent resubmission after partial creation; refresh private availability every 15 seconds plus permitted Realtime events; hide started slots; booking confirmation and check-in/out notifications |
| Manager/Owner | Properties and units; tenant leases; staff invitations/membership/booking permissions; assignment; amenities/hours/slot size; cancellation cutoff; dashboard/overdue work; CSV reports; activity | Editable property timezone; property-local cancellation/check-in validation; reports reuse live shell data; live activity refresh; boolean staff-permission validation |
| Staff | Assigned tasks, issue photos/property address, status updates, comments/internal notes, resolution notes, completed assigned tasks, authorized booking operations | Display unit location and update timestamps; live comments; hide tenant-only creation button; existing-request photo attachments; tested booking permission boundary |

## Backend and database changes

- Strict calendar-date and clock-time validation, maintenance text/priority validation, confirmed-only creation, future slot checks, and existing slot alignment/operating-hours rules.
- Existing GiST exclusion constraint remains the final defense against simultaneous overlapping bookings. The base schema now enables the required `btree_gist` extension.
- Booking lifecycle updates use conditional database filters to reject stale concurrent actions. Check-in is limited to the reservation window; checkout requires check-in; checked-in reservations cannot be cancelled.
- Attachment registration verifies uploaded objects, limits totals, and has a database trigger that serializes per-request attachment inserts.
- `feature_security_migration.sql` revokes direct domain writes from browser roles. Express remains the canonical write boundary, checking stored roles and property ownership before using its server-only service client. Existing RLS reads and private storage upload policies are retained.
- Read policies for properties and membership use caller-scoped helper functions to avoid recursive RLS evaluation.
- Database triggers validate unit/property relationships, tenant profiles, staff/property assignment on reassignment, resolution notes, and new booking slot rules.
- Realtime publication adds photos, amenities, and membership changes. Notification and activity subscriptions continue using existing tables.
- Fixed three policy recreation statements so the existing workflow migration can be rerun.

## Verification

- 37 backend tests passed. Frontend ESLint and production build passed (build reports a bundle-size warning).
- Backend Node tests exercise actual Express route handlers with mocked Supabase HTTP responses. They cover all three roles, unrelated managers, unassigned staff, unauthorized staff booking operations, internal comment access, resolution notes, booking lifecycle sequencing, and stale-update conflict detection.
- Booking utility tests cover malformed/normalized dates, invalid times, overlap/adjacency, local dates, already-started slots, and configured short slot durations.
- Frontend ESLint and production build run locally.
- Supabase schema was inspected read-only using the configured server connection. No customer records were displayed or modified.

## Deployment and incomplete verification

The configured Supabase project has base tables but is missing `property_units`, `maintenance_comments`, and `notifications`; it also lacks `maintenance_requests.unit_id`, `properties.timezone`, `properties.booking_cancellation_hours`, and `property_members.can_manage_bookings`. The existing workflow migration is therefore required for the already-written workflows to operate.

Apply, in order, to the existing project:

1. `server/supabase/role_workflows_migration.sql`
2. `server/supabase/feature_security_migration.sql`

For a fresh project, run the corrected `schema.sql` first. Do not rerun the base schema on the existing project. Both follow-up migrations can be rerun. Database schema changes require a SQL connection or the Supabase SQL editor; the supplied application service key provides table access but not arbitrary migration execution.

The migrations have not been executed against the configured database. Database-trigger/RLS behavior, actual concurrent booking inserts, private storage uploads, Realtime delivery, and browser end-to-end flows for all three roles remain unverified until migration deployment and test accounts are available. The automated role tests use mocked database responses and do not replace those live checks.

After migration deployment, use separate tenant, manager, and staff sessions: create a photo request, assign it, post updates from staff, complete with notes, book a future amenity slot, attempt the same slot concurrently, then check in/out during its window. Verify a different manager cannot access the property, unassigned staff cannot change the task, tenants cannot read internal notes, and staff booking permissions can be granted/revoked by the owning manager.

Availability for other tenants' reservations is refreshed through a sanitized endpoint at 15-second intervals because RLS intentionally hides their booking rows; own/manager/authorized-staff events also refresh it immediately. Signed photo URLs retain the existing one-hour expiry. Notifications remain in-app; email, SMS, and push delivery were not requested or added.

## Updated tenant cancellation behavior

Tenants and owning managers can cancel confirmed, unused reservations until the slot starts. The former advance cancellation cutoff is no longer enforced or offered in property settings; its legacy column is retained. Both the page and API reject cancellation once a reservation starts. The booking page refreshes its clock automatically and marks unused confirmed reservations Expired at the slot end, using property time. Checked-in reservations keep checkout available; cancelled and completed statuses are preserved. Expired is a derived display state, without a database enum migration.

## Deployment verification update

The earlier missing-schema findings above are historical. The live database now has all workflow and completion-review columns; current migration/security and live-test results are maintained in `docs/deployment-readiness.md`. Follow `docs/deploy-vercel.md` for the single-project deployment configuration.
