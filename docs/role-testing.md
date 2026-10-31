# Reviewer access

Reviewers can register themselves at `/register` and choose Resident, Manager, or Maintenance staff. After confirming their email and signing in, the API activates the selected role. No Supabase dashboard edit is required. The login selector describes each workspace; the assigned database role controls permissions.

## Test the workflows

1. Register as Manager, confirm the email, and sign in. Create a property, a unit, and an amenity.
2. Register a Resident account with a separate email. From the manager workspace, assign that resident to the test property/unit.
3. Register a Maintenance staff account with another email. From the manager Staff page, use that same email to add the staff account to the property. Alternatively invite a new staff email and finish setup through the invitation.
4. As the resident, submit a maintenance request and book an amenity.
5. As manager, assign the request to the staff member.
6. As staff, open assigned tasks, upload completion evidence, and submit the work for review. As manager, approve or return it.

Use separate browser profiles to keep accounts signed in simultaneously. Managers see their own properties; staff see assigned work. An empty new workspace is expected until properties, memberships, and requests have been created. Reviewer accounts do not receive access to another manager's existing data.

## Deployment and verification

Deploy both updated frontend and backend. Supabase email delivery and `/login` and `/reset-password` redirects must work. Existing accounts keep their role; the new registration choice applies to accounts created with the updated form. Later profile or metadata edits do not switch an activated role.

`server/scripts/registration-role-smoke.mjs` checks automatic role activation and resistance to subsequent metadata role changes using temporary confirmed accounts; it does not send or verify email. Run it from `server/` using Node.js 22 and a test Supabase configuration. Temporary accounts are deleted afterward.
