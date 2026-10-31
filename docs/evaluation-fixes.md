# Evaluation fixes — 31 October 2026

Registration now trims and normalizes email addresses, requires a name and a password of at least six characters, prevents duplicate submissions while pending, and explains invalid-address, email rate-limit, and connection errors. Confirmation instructions reflect whether signup returns a session. Login, registration, and password recovery use separate routes so browser navigation matches the visible form and clears stale feedback.

The connected Supabase public settings endpoint returned HTTP 200: email signup is enabled and email confirmation is required. This does not verify delivery to a real inbox or reproduce the evaluator’s exact address rejection. Provider-rejected addresses can still return HTTP 400; displaying an explanation does not override provider validation.

Workspace loads now report partial failures and offer retry. Visible tabs refresh every 30 seconds and on return to the tab to recover from missed Realtime events. Session initialization failures no longer leave the initial loading screen spinning forever.

Validation: 78 backend tests, frontend lint, and a production build with an absolute HTTPS API URL passed. Live Supabase/API checks passed for assigned properties, maintenance creation/assignment, comments and photo privacy, role restrictions, concurrent booking conflicts, cancellation, and staff check-in/out. The Realtime subscription connected but its update did not arrive within 15 seconds. Temporary live test accounts and records were cleaned up. The polling fallback limits stale data while hosted Realtime delivery needs investigation.

These are local source changes. Deploy the updated frontend and verify signup and confirmation with a real inbox on the production domain before resubmission.
