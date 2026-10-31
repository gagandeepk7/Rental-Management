# PropertyFlow

A property rental, maintenance, and amenity management platform with dedicated workspaces for residents, property managers, and maintenance staff.

## Features

- **Residents:** view assigned properties, submit maintenance requests, upload photos, book amenities, and receive notifications.
- **Property managers:** manage properties, units, tenants, staff, amenities, and booking disputes; assign maintenance and review completed work.
- **Maintenance staff:** manage assigned tasks, submit completion evidence, and handle permitted amenity operations.
- **Account management:** email registration and confirmation, sign-in, password recovery, and role-based access.
- **Live updates:** Supabase Realtime with periodic refresh to recover missed events.

## Tech Stack

React 19 · Vite · Tailwind CSS · Node.js 22 · Express 5 · Supabase Auth, PostgreSQL, Storage, and Realtime

## Getting Started

### 1. Install dependencies

Use Node.js 22 and run from the repository root:

```bash
npm ci
npm --prefix client ci
npm --prefix server ci
```

### 2. Configure environment variables

Create `client/.env`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
VITE_API_URL=http://localhost:5001/api
```

Create `server/.env`:

```dotenv
PORT=5001
FRONTEND_ORIGIN=http://localhost:5173
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Keep environment files out of version control. The service-role key must remain on the server and must never use a `VITE_` prefix.

### 3. Set up Supabase

For a new database, run these files in the Supabase SQL editor in order:

1. [`schema.sql`](server/supabase/schema.sql)
2. [`deployment_all_migrations.sql`](server/supabase/deployment_all_migrations.sql)

For existing databases, apply only the required follow-up migrations; do not rerun the base schema. Verify the private `maintenance-photos` bucket and required Realtime publication settings.

Enable email signup, configure email delivery, and allow these authentication redirects:

```text
http://localhost:5173/login
http://localhost:5173/reset-password
```

Choose Resident, Manager, or Maintenance staff during registration. After email confirmation and sign-in, the account receives its selected role automatically. Managers can create properties and assign residents and staff.

### 4. Run locally

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API health: `http://localhost:5001/api/health`

For manager and staff account setup, see [role testing](docs/role-testing.md).

## Testing

```bash
npm --prefix server test
npm --prefix client run lint
VITE_API_URL=https://YOUR_BACKEND_HOST/api npm --prefix client run build
```

Optional integration checks: `npm --prefix server run test:live`. These create and clean up temporary records in the configured Supabase project; use a test project.

## Deployment

Deploy `client/` to Vercel and `server/` to a Node.js host such as Render. Use `npm ci` to install dependencies, `npm run build` for the frontend, and `npm start` for the backend.

Set the frontend's `VITE_API_URL` to the backend's absolute HTTPS URL ending in `/api`. On the backend, set `NODE_ENV=production` and `FRONTEND_ORIGIN` to the frontend origin, alongside the Supabase credentials. Update Supabase's Site URL and authentication redirects to the production frontend URLs, then redeploy.

## Verification

Backend tests, frontend lint, production build, and browser registration/navigation checks passed. Browser authentication responses were mocked; production email delivery still requires verification. Live Realtime delivery also needs investigation; periodic refresh provides a fallback.

See [evaluation fixes](docs/evaluation-fixes.md) for the detailed verification record.
