CURRENT REVIEW: Read PHC_REVIEW_AND_SETUP.md first. Older instructions below are historical; do not activate payments or run production SQL. Keep PHC_LIVE_PAYMENTS_ENABLED=false. Test orders now require an isolated staging environment.

# PHC payment safety: what is ready and what is not

**No production settings have been changed by this ZIP. Keep `PHC_LIVE_PAYMENTS_ENABLED=false`.**

This package builds on the reviewed safety ZIP. It adds one proposed SQL migration:
`setup/PHC_ORDER_ATTACH_HARDENING_REVIEW_FIRST.sql`. It prevents a Razorpay
order ID from being replaced once saved. Repeating the same order attachment
is allowed. The migration has NOT been run on Supabase.

## Important warnings

1. **Do not run `setup/booking_database.sql` on the live project.** It is a
   historical initial-setup script and contains older function definitions.
   Running it may undo your newer, safer production booking functions.
2. The two other proposed migration files are also **NOT applied**:
   `setup/PHC_SAFE_BOOKINGS_GUARD.sql` and
   `setup/PHC_ORDER_ATTACH_HARDENING_REVIEW_FIRST.sql`.
3. A saved Razorpay order may hold a slot indefinitely until someone
   reconciles the payment. That is intentional until there is a reliable,
   audited way to distinguish incomplete and successfully paid orders.
4. The `phc-reconcile` doctor tool can check for captured payments but does
   **not** automatically release an unpaid slot.
5. The online RLS policies, live webhook delivery, Netlify rate limit support,
   real database concurrency, and Netlify deploy have not been verified here.
6. The supplied safety ZIP uses `public/` as the Netlify publish directory.
   A GitHub deployment requires applying the code as a repository update,
   not blindly uploading this ZIP into an existing public folder.
7. The live-switch check is strict: only `YES` would allow creation of new
   orders with a live Razorpay key. Do not change it now.

## Tests run locally

`node --test tests/payment-safety.test.js` — 17 passed, 0 failed.
They use fake provider responses, not actual Razorpay charges or live Supabase.

## Before any deployment

A responsible adult with access to the clinic's accounts must review the
migrations and deploy first to a preview. Make a Supabase database backup,
confirm existing booking SQL versions, review RLS policies, and test the
complete payment flow using a supported Razorpay test environment.
No real payment should be started during the current safety review.
