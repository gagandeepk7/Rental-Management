# First deployment on Vercel

The repository now supports one Vercel project: React static assets and the Express API under `/api`. Supabase continues to provide authentication, PostgreSQL, private file storage, and Realtime. You do not need a second backend host.

## What is configured

- Import the **repository root**, not `client/` or `server/`. Keep Framework Preset **Other**; `vercel.json` supplies the install command, build command, output directory, API function, and SPA fallback.
- Runtime: Node 22 (`.nvmrc` and package engines).
- `api/index.mjs` exports Express without opening a listening port. The existing `npm run dev` still works locally.
- `/api/*` routes go to Express. Existing static files are served before other page paths fall back to `index.html`, including `/bookings`, `/maintenance`, and `/reset-password`.
- Production browser requests use `/api`. Backend CORS permits the project's Vercel production and preview domains, plus explicitly configured custom origins. Other Vercel projects are not automatically allowed.
- Production startup/build rejects missing credentials, privileged browser keys, and localhost URLs.
- API counters are stored atomically in PostgreSQL to survive Vercel cold starts and multiple function instances. General API traffic: 600 requests/minute/IP; API auth routes: 15 attempts/15 minutes/IP. Database-store failure rejects requests rather than bypassing rate limiting. Health checks are exempt. Browser-direct Supabase auth retains Supabase's own throttling.
- Internal database/error details stay out of API responses. Explicit validation and permission messages remain available.
- Browser sessions persist on refresh; confirmation, invitation/password setup, and recovery links have explicit destinations.
- Three.js and Supabase are split into smaller chunks. Strict module initialization order is enabled and checked in a real browser.

## Database preparation

The additive setup is `server/supabase/deployment_all_migrations.sql`. It includes workflow/security/completion/comment policies, private photo reads, Realtime publication, production rate counters, a service-only database diagnostic, and restrictive participant privacy boundaries that also constrain legacy permissive policies. The base `schema.sql` is intentionally excluded. Do not run the base schema again on an existing project.

After applying SQL, run from `server/`:

```sh
npm run audit:database
npm run test:live
node scripts/peer-privacy-smoke.mjs
node scripts/production-http-smoke.mjs
```

The live smoke runner creates temporary synthetic accounts/property data, signs in using actual Supabase auth, tests permissions/storage/Realtime/concurrent booking conflicts, and cleans up only those fixtures. It never sends invitation or recovery emails. It refuses to run in `NODE_ENV=production` and targets a local API backed by your configured database. The HTTP security runner verifies production middleware using temporary shared rate counters.

## Vercel environment variables

A private `.env.vercel` file was prepared locally from your existing Supabase configuration. It is ignored by Git and deployment uploads and readable only by your OS account. **Do not commit it or put its contents into chat.** Import it through Vercel Project Settings → Environment Variables, or enter these values manually:

| Variable | Value/source | Browser-visible |
| --- | --- | --- |
| `SUPABASE_URL` | Existing server Supabase URL | No |
| `SUPABASE_ANON_KEY` | Existing public/anon key | No (a separate public copy is below) |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server service key | **Never** |
| `VITE_SUPABASE_URL` | Same project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Same public/anon key | Yes |
| `VITE_API_URL` | `/api` | Yes |

Set values for **Production** and **Preview** only if both should use this database; use a separate Supabase project for preview data when isolation is needed. Vercel supplies `NODE_ENV=production`, `VERCEL_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`. Leave `FRONTEND_ORIGIN` unset on the first deployment to use those exact domains. For a custom domain later, set `FRONTEND_ORIGIN=https://your-domain.example` (comma-separated for multiple exact origins). Do not copy the local `http://localhost:5173` origin into production.

Templates are in `client/.env.example`, `client/.env.production.example`, and `server/.env.example`. Never give the service key a `VITE_` prefix.

## Deploy and configure authentication

1. Push the repository to your Git provider, excluding all private environment files.
2. In Vercel, choose **Add New → Project**, import the repository, and keep the root directory as the repository root.
3. Add/import the environment variables above before the first deployment, then deploy using the repository configuration.
4. Copy the production URL Vercel assigns, such as `https://your-project.vercel.app`.
5. In Supabase → Authentication → URL Configuration, set **Site URL** to that exact production origin. Add these exact **Redirect URLs**:
   - `https://your-project.vercel.app/login`
   - `https://your-project.vercel.app/reset-password`
6. If retaining local development links, also allow `http://localhost:5173/login` and `http://localhost:5173/reset-password`. Add preview URLs explicitly if you need auth email links in previews; avoid broad wildcard domains.
7. Verify production email delivery/SMTP and sender configuration for signup confirmation, invitation, and password recovery.
8. Run `node scripts/check-deployment.mjs https://your-project.vercel.app`. Open `/api/health`, refresh `/bookings` and `/maintenance`, and test login, recovery links, photo upload/view, live maintenance updates, and booking conflicts from separate accounts on the deployed domain.

Environment variables in a Vite bundle are embedded at build time: redeploy after changing public frontend variables. Hosted environment settings and auth redirect configuration have not been changed automatically because no Vercel project/domain or Supabase management login was connected.

## Verification record

See `docs/deployment-readiness.md` for actual results and remaining hosted checks. A successful local browser check verifies built assets and SPA fallback behavior; it does not substitute for hitting the final Vercel domain.

Official references: [Vercel Express functions](https://vercel.com/docs/frameworks/backend/express), [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Vite production builds](https://vite.dev/guide/build.html).
