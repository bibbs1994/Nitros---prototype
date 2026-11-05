# Support Center staging setup

This feature branch is staging-only. It fails closed unless the request host
exactly matches `NITROS_STAGING_HOST` and `NITROS_STAGING_DEPLOYMENT=true`.
Do not attach a production domain or production Supabase project.

## Migration order

Apply `supabase/migrations/202611020001_tenant_foundation.sql` first, then
`supabase/migrations/202611020002_support_center.sql`, only in an isolated empty
staging Supabase project. The first migration is included because the verified
shop identity contract uses its `tenants`, `tenant_memberships`, and
`has_tenant_permission` tables. No production migration was applied.

Create/invite synthetic staging Auth users and assign shop memberships through
the owner-controlled Supabase administration path. The local portal PIN/name is
not a support identity. The front end never receives a service-role key.

## Staging-only environment values

- `NITROS_STAGING_DEPLOYMENT=true`
- `NITROS_STAGING_HOST=<exact assigned HTTPS hostname, hostname only>`
- `NITROS_STAGING_SUPABASE_REF=<verified staging project ref>`
- `SUPABASE_URL=<same staging project HTTPS URL>`
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` (public key only)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; needed solely by push outbox dispatch)
- `SUPPORT_VAPID_PUBLIC_KEY`, `SUPPORT_VAPID_PRIVATE_KEY`,
  `SUPPORT_VAPID_SUBJECT` (server-side Web Push configuration)
- `SUPPORT_PUSH_CRON_SECRET` (server-only; at least 32 characters)

The Support Center stores the Supabase session in same-origin local storage so
the owner can refresh the portal and still load the unread badge; it uses Supabase
refresh-token rotation, coordinates refreshes with Web Locks where supported, and
clears the session on sign-out. This relies on the portal's existing HTTPS origin
and XSS protections. Review CSP/XSS posture before production release.

The config endpoint exposes only the staging Supabase URL, public anon key,
approved origin, public VAPID key, and a boolean indicating push readiness. It
never returns the service-role key or VAPID private key.

## Push delivery and retries

New ticket submission writes an outbox row in the same database transaction.
The API attempts immediate Web Push delivery using the server-only service role
and VAPID keys. The protected `api/support-push-dispatch.mjs` route retries due
outbox rows with backoff and revokes expired subscriptions. A project scheduler
must invoke that route regularly to guarantee retries when the immediate send
fails. No shared `vercel.json` Cron entry is added because it would also affect
the production project when this branch is later merged. Select an isolated
staging scheduler (for example, a staging-only Vercel Cron configuration or
Supabase scheduled invocation) and authorize it before deployment.

## Owner acceptance requirements

1. Verify the staging HTTPS host and Supabase project ref in their dashboards.
2. Create synthetic owner/member Auth users and assign only synthetic shop
   memberships. Configure a private support attachment bucket via the migration.
3. Add the variables above only to the separate staging project; never copy
   production credentials.
4. Generate VAPID keys and a distinct cron secret locally and enter them directly
   into staging settings. Do not paste them into chat or commit them.
5. Configure the isolated scheduler. Verify ticket creation while the owner portal
   is closed sends a push to an opted-in iPhone Home Screen app, and that failed
   delivery remains visible/retryable in the outbox.
6. Run two-tenant isolation, attachment access, offline retry, admin reply/status,
   acknowledgement, reload, and push-revocation acceptance tests.

No staging URL, Supabase config, user session, VAPID configuration, or real push
delivery has been verified from this local worktree. No deployment was performed.
