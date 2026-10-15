# PropertyFlow

A real-time property rental, maintenance, and amenity management platform built with React, Vite, Express, and Supabase.

The public home page and authenticated workspaces use a shared midnight architectural visual system. The landing hero includes a responsive, procedural Three.js building on motion-enabled desktop browsers; architectural photography remains as the lightweight fallback on smaller screens, reduced-motion settings, or unavailable WebGL.

## Prerequisites

- Node.js 20+ recommended
- A Supabase project
- A local browser with access to the frontend and backend ports

## Environment configuration

### Frontend

Create or update `client/.env` with:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:5001/api
```

The project includes `client/.env.example` as the template.

### Backend

Create or update `server/.env` with:

```bash
PORT=5001
FRONTEND_ORIGIN=http://localhost:5173
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> Note: In this local environment, port 5000 is already used by the macOS AirTunes service, so the app runs on 5001 locally. The sample `.env.example` keeps the standard 5000 default for a clean deployment setup.

## Supabase setup

1. Sign in to your Supabase project.
2. Open the SQL editor.
3. Run the migration in `server/supabase/schema.sql`.
4. Run `server/supabase/role_workflows_migration.sql` to add units, maintenance photos/comments, notifications, activity, booking disputes, and booking lifecycle fields.
5. Run `server/supabase/feature_security_migration.sql` to enforce API-only domain writes, fix recursive read policies, validate relationships and booking slots, and extend Realtime.
6. Run `server/supabase/maintenance_completion_review_migration.sql` to enable staff proof submissions and manager review.
7. Run `server/supabase/maintenance_comment_rls_migration.sql` to allow authenticated request participants to post comments under row-level security.
8. Configure Supabase Auth email invitations and verify the private `maintenance-photos` storage bucket exists (the workflow migration creates it).
9. Add each deployed frontend origin plus its `/reset-password` path to Supabase Auth's allowed redirect URLs.
10. Enable Realtime for `maintenance_requests`, `maintenance_comments`, `amenity_bookings`, `notifications`, and `activity_events` if they are not already in the `supabase_realtime` publication.
11. Keep the service-role key on the server only. Maintenance photos are uploaded with short-lived signed URLs issued by the API after it verifies request access; do not expose the service-role key in the frontend.
12. Create a manager account and assign its `profiles.role` through a trusted admin process.

## Install dependencies

From the project root:

```bash
npm install
cd client && npm install
cd ../server && npm install
```

## Start the apps

In the project root:

```bash
npm run dev
```

This starts the Express API and Vite client together.

You can also run them individually:

```bash
npm run server
npm run client
```

## Database migration

Run:

```bash
cd server
psql "$DATABASE_URL" -f supabase/schema.sql
```

If you are using the Supabase SQL editor, copy the contents of `server/supabase/schema.sql` into a new SQL query and execute it.
Then execute `server/supabase/role_workflows_migration.sql`, `server/supabase/feature_security_migration.sql`, `server/supabase/maintenance_completion_review_migration.sql`, and `server/supabase/maintenance_comment_rls_migration.sql` in that order. These follow-up migrations are additive and can be run again. Do not rerun the base schema against an existing database.

## First manager account and role setup

1. Register an account from the frontend login page.
2. Use the Supabase dashboard to confirm the user is created.
3. Add the relevant `profiles` record in the `profiles` table.
4. Set the `role` field to `manager` through a trusted admin process.
5. Only trusted administrators should assign manager or maintenance roles. The app rejects client-side attempts to escalate a user role.

## Core feature checks

- Public home page: visit `/`; account access is available at `/login` and `/register`, with password recovery on the sign-in page.
- Dashboard: visit `/` after authentication.
- Maintenance requests: create a request from the maintenance page.
- Maintenance collaboration: invite staff, assign a request, verify its property and unit location, upload completion proof, submit resolution notes for manager review, and approve or return the work before it is marked complete for tenants.
- Amenity bookings: create a reservation from the amenities page.
- Booking lifecycle: check in/out, cancel within the property's cancellation cutoff, and raise/resolve a booking dispute.
- Manager operations: add properties and units, invite or assign tenants, manage amenity hours, and review overdue requests and activity.
- Notifications: verify assignment, maintenance, and booking updates appear in the notifications inbox.
- Real-time updates: open two browser tabs and create or update the same record from one tab; updates should reflect in the other.

## Testing

Run backend tests:

```bash
cd server && npm test
```

Run frontend checks:

```bash
cd client && npm run lint && npm run build
```

## Deployment

- Frontend: deploy the Vite app to Vercel with the production `VITE_*` environment variables configured.
- Backend: deploy the Express server to a Node.js host like Render, Railway, or a VPS.
- Use the same Supabase environment values in production and keep `SUPABASE_SERVICE_ROLE_KEY` server-only.

## Manual dashboard configuration

Some setup cannot be automated from code:

- Enable Realtime on the selected tables in Supabase.
- Add your own project URL and keys in the `.env` files.
- Create the first manager and assign the role in a secure admin flow.
- Apply the supplied workflow and security migrations; they configure row-level security and domain write permissions.
