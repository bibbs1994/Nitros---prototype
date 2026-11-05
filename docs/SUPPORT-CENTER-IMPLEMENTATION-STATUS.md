# Support Center implementation status

## Scope and isolation

Implemented on the uncommitted `feature/support-ticket-center` worktree, based
on `feature/encrypted-drive-backup` at `39ce500c2cfd0ec8716a926d82cb76811e870fe5`.
No commit, push, merge, deployment, production configuration change, live
customer-data access, or live Google Drive operation was performed.

The Support Center uses the existing tenant identity foundation. Customer APIs
require a verified Supabase session and tenant membership; administrator APIs
require the owner permission. The runtime fails closed unless the request is
served from the explicitly configured staging host with staging mode enabled.
Ticket history, acknowledgements, messages, events, and push delivery outbox are
persisted in Supabase. Screenshot objects use a private bucket and bounded image
decode/re-encode before storage. The browser does not receive service-role or
VAPID private credentials.

## Verification performed

- Full Node test suite: **683 passed, 0 failed**.
- JavaScript module syntax: **112 files passed `node --check`**.
- Focused Support Center, tenant-auth, ticket, attachment, and push checks were
  included in the full suite; the earlier focused run also passed **24/24**.
- The full suite initially surfaced two stale service-worker source-pattern
  assertions. Updated those assertions to verify the current network-first
  navigation and explicit static-asset cache policy; the rerun passed 683/683.
- Tests use mocks and synthetic data. No real Supabase project, Vercel
  deployment, iPhone push, or live ticket workflow was exercised.

## Deployment and operational blockers

No verified staging HTTPS host, isolated Supabase project reference, staging
users/memberships, public configuration, server-only service role, VAPID keys,
or isolated push scheduler is available in this worktree. Configure these only
in a separate staging project, following
[`SUPPORT-CENTER-STAGING-SETUP.md`](SUPPORT-CENTER-STAGING-SETUP.md), then run
the staging acceptance checks. A scheduler is required to retry failed push
outbox deliveries when immediate delivery fails. Email is not used as a
notification fallback.

The owner unread badge requires an authenticated owner session. Background push
requires user opt-in, HTTPS, browser/platform support, and an installed Home
Screen web app on iOS/iPadOS; it cannot be promised for a closed ordinary Safari
tab. Test on the intended iPhone and Home Screen app before release.

The existing activated restore cannot be post-verified from the current
environment. The previously recorded audit had `matchesExpected: null`, and the
original isolated browser profile/backup hash is not available here. Do not
represent the prior activation as an exact-match restore until the original
verified backup or its canonical data hash and the isolated profile can be
compared.

## Review state

**Ready for code review; not ready for staging acceptance or production.** The
uncommitted worktree is isolated. Review the API authorization boundary, SQL
policies/RPCs, session storage/XSS posture, push scheduler, and staging
configuration before any deployment. No production integration or release is
approved by this status record.
