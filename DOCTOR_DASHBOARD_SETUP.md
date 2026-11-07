# Doctor dashboard V2 — staging first

This branch extends the existing Netlify site; PR #1 was already merged at fbb9e5f. It does not create a new site, run SQL during deployment, or activate live payments. WhatsApp, Zoom and messaging are excluded.

## Implemented source

- `/admin` responsive doctor workspace, with Supabase email/password sign-in, logout, recovery and password update.
- Server validates Supabase `/auth/v1/user` and checks `phc_admin_accounts.active` on every protected call. No public registration endpoint. The frontend never receives Auth refresh/access tokens or service credentials.
- Host-only Secure/HttpOnly/SameSite=Strict cookies; access expires at most one hour, refresh cookie expires after eight hours of inactivity. Same-origin checks for every mutation. Origin is matched to the actual Netlify Request URL, propagated as rawUrl by the adapter; it does not depend on build-only deployment URL environment variables or caller-controlled forwarded headers. No patient data in browser storage. New endpoint rate limits, no-store responses, admin CSP and no framing.
- Patient registration, server-paginated partial name/mobile/Patient ID search and date/kind/status filters; profile history, notes, versioned editing, manual visits/follow-up plans, completed-visit counts, and metadata-only audit trail. Search indexes include trigram indexes.
- Bookings create provisional separate patient profiles; name/phone never automatically merge people. After verifying identity, the doctor can explicitly link the provisional record into an existing permanent Patient ID. Visits move, original profile becomes a retained alias; payment and booking records do not change. Alias notes remain in the original profile and are visible as retained notes on the active profile.
- Existing bookings are not backfilled automatically. An administrator explicitly links them after checking identity.
- Weekly morning/evening sessions, duration, lunch gaps, holidays/special-date sessions, date-specific breaks, per-slot blocking. Database locks and conflict checks preserve live reservations. All times use Asia/Kolkata.
- Server-authoritative new/follow-up fees snapshotted at atomic reservation. Existing payment verification and webhooks use the stored booking amount, so later fee changes cannot alter existing orders. Callbacks still require signatures and matching fetched Razorpay entities.
- Authenticated pending-payment reconciliation. Unpaid/order-linked holds are never released automatically.
- Online booking pause switch; deployment live-payment switch remains separately authoritative.

## Deliberate limits

- Pay at Clinic is disabled. Cash payment collection, receipt/audit and unpaid public reservation semantics need their own verified workflow.
- Manual follow-up entries are clinical history/plans, not online slot reservations. Do not promise a reserved appointment based solely on a manual plan.
- Paid or order-linked bookings cannot be moved/cancelled through ordinary editing. Refund/rescheduling and abandoned-order resolution remain separate work. Consultation completion never changes payment status or frees a paid slot.
- On each page Overview counts only the visible records, labelled accordingly. This release does not claim comprehensive business analytics.
- Partial patient history is paginated in batches of 100; patient and appointment lists in batches of 30. Old alias notes remain available as read-only retained notes on the consolidated profile.
- Local isolated PostgreSQL and mocked Auth tests are not a hosted Supabase login/email test. Desktop/mobile visual QA and hosted Razorpay regression remain pending until preview setup.
- No full production backup has been created by this task. The earlier recovery ZIP contains definitions, not a full patient database backup.

## Required owner steps: PHC Safety Test only

Staging migration is already applied; see verified installation below. Start at account setup (step 4); do not rerun steps 2–3.

1. Keep `PHC_LIVE_PAYMENTS_ENABLED=false` everywhere. Do not edit production variables.
2. Save a restorable staging database backup before applying SQL. At minimum export existing rows and definitions, but CSV exports alone are not a complete backup. Supabase CLI `db dump`/PostgreSQL tooling can provide schema/data; a successful restore must be verified separately.
3. Review and run `setup/PHC_DASHBOARD_V2_REVIEW_FIRST.sql` in **PHC Safety Test**, not PHC Online Booking. It is transactional and intentionally not silently rerunnable. If any precondition differs, stop and inspect.
   New tables: `phc_admin_accounts`, `phc_clinic_settings`, `phc_patients`, `phc_visits`, `phc_audit_log`. Adds `consultation_kind` and `slot_minutes` to existing bookings with legacy defaults. Adds RPCs/indexes; replaces confirmation and protection functions, preserving their server-only access. Widens the audited phc_closures_time_format CHECK from :00/:30 to any valid minute so configurable slot durations can be blocked safely. Existing financial fields and booking rows are not rewritten or removed.
   Prerequisite: pg_trgm must be installed in the `extensions` schema; inspect an existing different placement first. This migration must never relocate an installed extension blindly.
4. In staging Supabase Authentication, disable new public sign-ups. Add the doctor's email user through the owner dashboard and set a private password. Do not paste passwords or tokens into chat.
5. Copy that specific Auth user's UUID into the following allowlist statement, review the project, then run it:

   ```sql
   INSERT INTO public.phc_admin_accounts(user_id,active)
   VALUES ('REPLACE_WITH_VERIFIED_AUTH_USER_UUID'::uuid,true);
   ```

   Do not authorize an account solely because its email resembles the doctor's. Deactivation: set `active=false`; every request rechecks this table. Only owner SQL can manage admin membership; there is no browser membership editor.
6. Netlify **Deploy Previews only**, add:
   - `PHC_SUPABASE_AUTH_KEY`: staging publishable key or legacy anon key (not service_role).
   - `PHC_DASHBOARD_ENABLED`: `true` only after staging migration/account creation succeeds.
   Existing staging `SUPABASE_URL`, `PHC_SUPABASE_SERVER_KEY`, test Razorpay pair, webhook secret, `PHC_ENVIRONMENT=staging` must stay in that same isolated context. Keep production live switch false.
7. For staging recovery, set Supabase Auth **Site URL** to the exact PR preview URL ending in `/admin` (for PR #2, `https://deploy-preview-2--prajapatihomeopathicclinic.netlify.app/admin`). Allow only that exact recovery redirect URL. Default email templates work: the server sends a PKCE S256 challenge and keeps the verifier in a Secure/HttpOnly cookie for 10 minutes. The email returns a one-time code to `/admin`, exchanged server-side after the admin allowlist check. Open the email link in the same browser that requested it. Auth tokens never reach browser JavaScript or local storage. A custom token-hash template is optional when your SMTP configuration permits editing; the previous hash exchange remains supported. On the default provider, recovery email delivery is restricted to Supabase organization-team addresses and low rate limits. Custom SMTP is required before relying on recovery for arbitrary admin emails in production. Never publish a recovery link or screenshot its code/token.
8. Retry this PR's deploy, open `/admin`, sign in, and perform the hosted acceptance checks below.

## Hosted acceptance before approval to production

- Authorized doctor signs in; valid unlisted Supabase user is denied; no sign-up form exists.
- Logout, expiry/refresh, membership revocation and recovery email/password update work.
- Anonymous direct API/database requests cannot read patient data or perform admin writes.
- Create synthetic patient, search name/mobile/ID/date, edit details; stale edits reject rather than overwrite.
- Add two manual follow-ups, complete only an actual past visit; cancelled/pending plans do not increase completion count.
- Booking creates provisional profile. Verify explicit profile consolidation preserves all visits/notes and never touches financial records.
- Change unoccupied future date hours, add/remove break and holiday, observe public availability. Conflicting live bookings reject schedule changes.
- Change fees, reserve with server amount, attempt tampered browser amount and duplicate slot. Verify old test order still confirms at its old amount.
- Perform one successful and one failed Razorpay TEST payment on this PR. Point only the TEST webhook to this preview. Verify captured events, DB status and failed-order hold preservation.
- Check pending reconciliation through signed-in dashboard. Never reopen an unpaid order-linked slot automatically.
- Check small-screen and desktop layouts. Local browser access was unavailable in this environment, so no visual pass is claimed.
- Confirm public website/assets still work and production `paymentsEnabled` stays false.

## Production release gate

No production migration or merge is part of the staging setup. After hosted acceptance, obtain separate approval for the exact migration/commit and a full restorable production backup. Production owner must explicitly create and authorize their production Auth account; staging UUIDs/credentials must never be copied into production. Review Auth recovery Site URL/template and redirect allowlist for production.

Fallback: keep `PHC_DASHBOARD_ENABLED` unset/false before migration. Once new fee orders exist, do NOT roll back to the old fixed-300 verification code. Keep snapshot-aware verification deployed to process existing payments. Never run a destructive down migration or drop patient tables to undo a UI issue. Reverting financial functions requires a separately reviewed, order-aware recovery plan.

## Daily use

1. Open `/admin`, sign in with your authorized email/password; sign out on shared computers.
2. Timings & holidays → edit weekday sessions, duration, or a special date → save. Use gaps for lunch/breaks; empty sessions close a day.
3. Doctor calendar → date → Block slot / Reopen. Reserved bookings reject conflicting closure.
4. Patient records → search or Register patient → Open profile. Add visits/follow-ups and confidential notes. Mark consultation Completed only after it occurs.
5. Edit details corrects patient demographics; booking/payment snapshots remain unchanged. Link returning patient only after confirming identity.
6. Consultation fees → enter rupee fees → save. Newly reserved appointments use them; existing orders keep old amounts.
7. Pending payments → choose date → Check payment safely. The checker never releases unpaid orders.
8. Payment settings can pause online booking; cannot activate live payments. Pay at Clinic remains unavailable.
9. Security & account → password change and recent audit activity.

## Verified staging installation, 7 November 2026

After owner approval, a private application-table backup was saved and its fresh restore verified in isolated PGlite PostgreSQL: 8 booking rows restored with a matching database hash and booking guard. This is not a full Supabase/Auth/Storage/project backup.

Migration `phc_doctor_dashboard_v2_staging` was applied only to PHC Safety Test. All 8 existing booking records and closure records retain matching pre/post hashes. Five dashboard tables exist with RLS enabled, and public/authenticated table and PHC RPC access checks are false. Public schedule RPC returns the legacy 30-minute schedule and INR 300 fees. No production SQL or payment activation occurred. There are zero active admin accounts; Auth account creation, Auth settings, two Netlify Deploy Preview runtime variables and signed-in acceptance tests remain pending.

**Do not rerun the V2 schema script on PHC Safety Test.** It is already installed. Production still requires its separate backup, approval and migration workflow.
