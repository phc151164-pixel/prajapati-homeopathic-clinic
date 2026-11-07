CURRENT REVIEW: Read PHC_REVIEW_AND_SETUP.md first. Older instructions below are historical; do not activate payments or run production SQL. Keep PHC_LIVE_PAYMENTS_ENABLED=false. Test orders now require an isolated staging environment.

# PHC Website — Safer Online Booking (Review Package)

**Status:** Code updated locally, **NOT DEPLOYED**. No Razorpay, Supabase, or Netlify account was changed.

**KEEP NEW LIVE PAYMENTS OFF:** In Netlify Production environment variables, keep
`PHC_LIVE_PAYMENTS_ENABLED=false` until you have finished the production checks.
For this code, a live key would require the exact value `YES` to create new live orders.
**Do not change the switch yet.**

## What changed

1. **Database safety migration:** `setup/PHC_SAFE_BOOKINGS_GUARD.sql` blocks accidental expiry,
   cancellation, or deletion of a booking already linked to a Razorpay order. It also protects
   paid bookings against being released by an accidental status update.
2. **Razorpay payment checks:** Payment callback and webhook check signature, captured amount,
   currency, and fully paid order state using Razorpay's own API.
3. **Pending payment review:** Doctor Calendar has a new "Show Pending Payments" button.
   A doctor with their private admin token can check a pending order with Razorpay and
   confirm a fully paid booking. The tool **never frees an unpaid slot**.
4. **Booking spam protection:** Added two Netlify function rate limit configurations for
   availability and new order creation. These must be checked on a Netlify deploy preview;
   local tests cannot prove edge rate limits are enforced by Netlify.
5. **Stop displaying an active payment button when payments are disabled.** Removed the
   inaccurate message claiming a Razorpay order always automatically expires.
6. **Website source privacy:** Public HTML and images are now under `/public/`, so Netlify
   should serve only this directory. Private SQL scripts, tests, and backend source are
   no longer inside the static publishing directory.
7. **Valid dates and input limits:** More careful date validation and limits on request sizes.
8. Added `robots.txt` and `sitemap.xml` for the public site (not security controls).

## Before ANY production deployment

1. Keep the GitHub backup you downloaded. Back up Supabase separately before any SQL changes.
2. Carefully check the actual live Supabase definition of `phc_reserve_online_slot` and
   `phc_change_closure` because that code was **not included in this repository ZIP**.
   The old `setup/booking_database.sql` should **NOT** be re-run on the live database.
3. Obtain explicit approval before deploying these code files or applying the safety migration.
4. For the database migration, inspect `setup/PHC_SAFE_BOOKINGS_GUARD.sql` with the current
   Supabase schema and existing triggers; apply it only to the correct project.
5. Run a staging/Deploy Preview with **Razorpay TEST** credentials, never live payments.
   Check Netlify function build, the two rate limits (429 after repeated calls),
   availability, doctor holidays, and pending-payment review.
6. Verify that `/setup/booking_database.sql` and `/netlify/functions/_common.js`
   are **not publicly accessible** on the deployed site (they should return 404).
7. Confirm webhook signing secret matches Razorpay and test webhook delivery to a staging
   environment; validate idempotent confirmation and duplicate booking with real Supabase tests.
8. Create/review an appropriate privacy notice, refund policy, and procedure for missed
   webhooks and delayed payments. Only an authorised merchant should activate real payments.

## Test results and limits

Run `node --test tests/payment-safety.test.js` from the repository root.
The included **17 simulated tests** pass against mocked Supabase/Razorpay API responses.
They are NOT live payments, NOT a real database concurrency test, and NOT a Netlify build test.
This work improves safety but does not guarantee that every possible issue has been found.

## Important: Abandoned payments

A Razorpay order may remain payable after the patient closes checkout. It is not safe to
release its appointment slot based only on time. **A linked order stays held until the
clinic confirms the payment result and takes any necessary refund/reschedule steps.**
A doctor's payment review checks paid orders only. It does NOT automatically cancel orders,
expire booking holds, issue refunds, or contact patients. Manual review can still be necessary.

## Required Netlify environment variables

Server-only variables: `SUPABASE_URL`, `PHC_SUPABASE_SERVER_KEY`,
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PHC_ADMIN_TOKEN`.
Do not put the secret values in this repository, a public file, chat, or screenshot.

## Notes

- New static publish directory: `public` (set in `netlify.toml`).
- Keep `netlify/functions` and `setup` outside `public`.
- Existing doctor closures in Supabase are not changed by this package.
- Old setup instructions in other `.txt` files predate this security update; this README
  is the current instruction file.
