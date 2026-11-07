# PHC doctor dashboard: production release proposal

Status: prepared for owner review; production is unchanged. PR #2 remains unmerged. Live payments must stay `PHC_LIVE_PAYMENTS_ENABLED=false`.

## Already completed before this release

The existing public site, booking concurrency protections, server-side Razorpay verification, protected legacy doctor calendar, RLS/EXECUTE restrictions and public-only deployment were released through PR #1. Do not rebuild or rerun historical setup SQL.

## Proposed code release

One `/admin` workspace: email/password login, logout, server-side session validation and explicit admin allowlist; same-origin writes; secure HttpOnly cookies; PKCE password recovery compatible with default email templates; patient registration/search/profiles/notes/history; verified profile consolidation; weekly sessions, breaks, holidays, per-slot closures; new/follow-up fees; immutable booking amounts and verified payment reconciliation; metadata-only audit log. Adds a **Doctor sign in** link in the existing website footer.

Patient/public site remains accessible without login. Identifiable records and notes require authorized admin access. No WhatsApp, Zoom or message automation is included.

## Database proposal

Target only **PHC Online Booking**, `qiwhsmppyjwilscbiiaw`.

Reviewed script: `setup/PHC_DASHBOARD_V2_REVIEW_FIRST.sql`.
SHA256: `c461f46d18c54998730a8ffd88b4df9a1b563dbb11a4824e99b39036f66fb8dd`.

- Adds five private RLS tables: admin accounts, clinic settings, patients, visits and audit log.
- Adds legacy-default consultation kind and slot duration to existing bookings.
- Adds private server-only dashboard/schedule/reservation RPCs and search indexes.
- Preserves existing amounts, status, patient/payment references and appointment dates/times. Does not import staging records or automatically identify/merge patients.
- Replaces payment-confirmation/guard definitions to use immutable booking fee snapshots and stronger protection of financial fields. Existing provider signature and captured-payment checks stay mandatory.
- Widens the legacy closure time-format CHECK to valid minute offsets, enabling adjustable duration; configured slots and reserved-booking conflict checks still govern actual reservations.
- Does not change authentication membership, enable online payments, or run automatically during Netlify deployment.

## Recovery and validation

A private application-table recovery archive was saved before rollout. All **21 existing production booking rows** were restored in an isolated fresh PGlite PostgreSQL database; row hash matched and the existing guard was restored. The exact proposed V2 migration was then applied to that isolated restored database: all 21 rows retained matching hashes for existing fields, five tables had RLS, anonymous reads failed and public/authenticated PHC function execution remained denied.

This is an application-table recovery copy, **not a complete Supabase project backup**. Auth, Storage, secrets, provider settings, owner roles/configuration and hosted full-project recovery are excluded. Restore SQL intentionally requires a fresh disposable application database; never run it against an existing production schema.

Automated suite: **52 passing local tests** plus GitHub CI. Covers booking safeguards, amount snapshots, database permissions, schedule conflicts, duplicate reservations, patient/history/versioning, verified consolidation, CSRF, session cookies and PKCE recovery.

Owner-exercised staging acceptance: login/logout; registration/search/edit/follow-up/completed count; holiday add/remove; fee change/revert and unchanged old amounts; slot block/reopen; successful TEST payment with linked patient/visit; failed TEST payment retained as held; safe unpaid-order reconciliation; audit log; password reset and new-password login; phone login/layout. Public availability changes were independently checked. Recent mobile-button and preview-origin issues were fixed and deployed.

No failed automated checks remain. Live-payment launch, arbitrary-recipient production SMTP, paid-booking refund/rescheduling and abandoned-order release are not signed off by this release.

## Proposed deployment sequence — after explicit owner approval

1. Recheck production project identity, current count/hash and script SHA. Stop for unexpected drift.
2. Apply the pinned migration once to production and verify old-field hashes, RLS and EXECUTE grants.
3. Merge only the reviewed PR #2 commit, through the existing GitHub/Netlify workflow. Keep the dashboard runtime gate OFF until the production account/settings are ready; keep live payments OFF throughout.
4. Owner creates a separate verified Auth account in the production Supabase project and privately sets a password. Never copy the staging user UUID or password. Authorize only that verified production UUID in `phc_admin_accounts`.
5. Configure production runtime `PHC_SUPABASE_AUTH_KEY` with the production publishable/anon Auth key and `PHC_DASHBOARD_ENABLED=true`. Preserve existing production database URL/service credentials and Razorpay credentials; do not import staging keys/URLs. Explicitly retain `PHC_LIVE_PAYMENTS_ENABLED=false`.
6. Set production Auth Site URL to `https://prajapatihomeopathicclinic.netlify.app/admin`, with an exact redirect allowlist. Disable public signup; no UI registration is provided. Set up production SMTP before relying on recovery for non-team recipients; default mailer is restricted to organization-team addresses and low rate limits.
7. Verify owner login, protected records, website footer link, public website, anonymous API denials and production `paymentsEnabled=false`. No real payment is necessary or authorized.

## Boundaries and remaining work

- Pay at Clinic remains unavailable; manual cash collection/receipts and unpaid slot reservation require a separately reviewed workflow.
- Manual follow-up plans record clinical history/plans and do not reserve an online slot.
- Paid or order-linked bookings cannot be moved, cancelled or released through ordinary editing. Refund/rescheduling and abandoned-order resolution require separate work.
- Existing legacy bookings can be linked to patient profiles only after reliable identity verification. They are not bulk-merged by name/phone.
- Overview counts are labelled for visible records, not comprehensive business analytics.

## Initial recovery approach

If the newly enabled UI fails, turn only `PHC_DASHBOARD_ENABLED` off and retain the database/new records for investigation. Keep snapshot-aware payment verification running for existing orders. Do not roll back to old fixed-fee code after new-fee orders exist; do not drop new patient/history tables. Any database rollback must be separately reviewed against then-current records and outstanding payments.

## Owner decision

Approval is requested only for the pinned production migration and PR #2 code rollout with **live Razorpay payments disabled**. Production Auth credentials and final runtime settings still require the owner's private account actions. This is not approval to activate real payments.
