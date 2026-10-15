# Deployment verification

The repository is configured for a single Vercel project, but has not been deployed. Hosted environment values and the final production authentication domain still require setup in Vercel/Supabase.

## Code and configuration

- Removed hardcoded Supabase URL/key fallbacks. Production builds reject missing values, localhost endpoints, and service/secret keys passed as browser keys.
- Prepared private, Git-ignored `.env.vercel` from the connected project credentials. It has not been uploaded to Vercel. Service credentials are never given a `VITE_` prefix; the built browser assets were scanned for the actual service key with no match.
- Added `vercel.json` and `api/index.mjs`: one deployment for React and Express, API routes before static files and SPA fallback. Production API requests use `/api`.
- Added exact origin allowlisting, trusted proxy configuration, serverless-safe PostgreSQL rate counters, 429/Retry-After responses, and generic responses for internal API/database errors.
- Added explicit confirmation/invitation/recovery destinations and persistent browser sessions across reloads.
- Removed vulnerable development-only nodemon dependency in favor of Node's built-in watch mode. Production dependency audits for both server and client reported zero vulnerabilities.
- Split Three.js source modules and Supabase into smaller bundles. Browser testing caught and fixed a split-module initialization-order error by enabling strict execution order. Final build has no chunk-size warning; largest JavaScript asset is below 300 kB before gzip.

## Verification performed

- Frontend ESLint: passed.
- Backend automated tests: 70 passed, including production config guards, secret-key rejection, safe errors, rate store behavior, and route configuration.
- Production frontend build: passed with `VITE_API_URL=/api`.
- Real headless Chrome: built landing/login pages render; 3D canvas renders without fallback or uncaught errors; `/bookings`, `/maintenance`, and `/reset-password` return the SPA on direct request and refresh. This uses a local static preview of the build, not the final Vercel network.
- Production middleware HTTP test against the real Supabase rate store: CORS allow/deny, malformed JSON safe response, unauthenticated access rejection, shared counter limit enforcement, 429/Retry-After, and no Express identification header all passed.

## Connected Supabase project

- Expected workflow and maintenance-completion table/column signatures exist.
- Private maintenance photo bucket: 10 MB limit with expected image MIME types.
- Security diagnostic verifies enabled RLS, booking/unit overlap constraints, security/validation triggers, required Realtime tables, comment insert grants, and denial of direct browser booking creation and maintenance status writes.
- Initial live tests exposed missing Realtime delivery and tenant photo reads. Both passed after the production SQL repair was applied.
- A same-property test exposed a separate legacy policy allowing peer booking reads. `peer_privacy_migration.sql` adds restrictive participant boundaries so permissive legacy policies cannot expand access.

Live role/API tests use temporary synthetic manager, tenant, staff, and unrelated-user accounts. They verify actual authentication, assigned property access, maintenance creation/assignment, private/internal comments, forbidden role escalation/status writes, signed photo upload and registration, tenant photo access and unrelated-user denial, Realtime maintenance updates, simultaneous booking conflict prevention through both API and database, cancellation, and staff check-in/out with grant/revoke enforcement. Test fixtures are removed afterward; customer records are not changed. No invitation or recovery emails are sent.

Final rerun after both SQL updates: **all live workflow checks passed with zero failures**, including Realtime, private photo access, concurrent booking conflicts, and staff grant/revoke behavior. Separate same-property tenant checks passed for both maintenance and bookings. Final security audit passed with both restrictive policies present. Temporary test accounts, properties, files, and rate-counter fixtures were cleaned up.

## Remaining hosted checks

These cannot run before there is a connected Vercel project and a deployed domain:

1. Import `.env.vercel` into Vercel environment settings and deploy the repository root.
2. Set Supabase Site URL and exact `/login` and `/reset-password` redirect URLs to the assigned production domain. Supabase management CLI is not logged in; the service key does not provide management-settings access.
3. Run `node scripts/check-deployment.mjs https://YOUR_PROJECT.vercel.app`.
4. Verify actual signup/invitation/recovery email delivery, authenticated role flows, uploads, and Realtime in browsers on that domain.

The local/API checks do not certify hosted auth redirects or email delivery. See `docs/deploy-vercel.md` for the first-deployment steps and official references.
