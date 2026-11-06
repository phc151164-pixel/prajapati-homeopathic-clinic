# PHC review and setup — 7 November 2026 (IST)

Status: prepared locally; NOT deployed. No production database writes, orders, charges, account changes or payment activation were performed. Keep PHC_LIVE_PAYMENTS_ENABLED=false in Netlify's function environment. This file supersedes older setup and activation notes in this archive.

## Verified live observations

- Homepage returned HTTP 200.
- GET consult-availability for 2026-11-20 returned ready:true, paymentsEnabled:false, feePaise:30000, currency:INR, and slot status only. This confirms the public disabled state at review time; it does not expose or verify the actual environment-variable value.
- Browser displayed selectable slots despite paymentsEnabled:false. Deployed paid-booking.js differs from the reviewed package and omits the paymentsEnabled guard. Backend must remain authoritative.
- GET consult-create-order returned 405; no POST or test reservation was made against production.
- Unauthenticated GET phc-admin returned 401.
- /setup/booking_database.sql returned HTTP 200 with application/sql. This is source disclosure, not proof that secrets or patient records were exposed. /netlify.toml returned 404.

## Changes prepared in this archive

- Retained reviewed client payment-off handling and payment-in-progress refresh protection. Added submit-time payment-off guard.
- Test keys require PHC_ENVIRONMENT=staging and are rejected when CONTEXT=production. Live keys still require explicit YES; leave the value false.
- Callback verification checks returned provider order/payment IDs and handles valid uppercase hexadecimal signatures.
- Admin token comparison checks byte lengths before timingSafeEqual, preventing a Unicode token from throwing outside the handler's try block.
- public/ is the only Netlify publish directory. Forced 404 redirects additionally block setup, tests, function-source and .env paths. Verify these rules in a preview; they have not been deployed.
- Added GitHub Actions running payment-safety tests, secret-file ignore rules and an empty .env.example.
- Existing SQL migrations remain proposals and have NOT been executed or modified functionally.

## Security review outcome

The reviewed backend verifies checkout HMAC, fetches provider payment/order state, requires captured INR 300 payments, and does not treat the browser callback alone as payment proof. Webhooks validate the raw body HMAC and re-fetch the paid order. Existing payments can still be verified with new live orders disabled; verification can legitimately change a booking to paid when eventually deployed and invoked.

The supplied database function snapshot shows an older phc_attach_order definition that can replace an existing order on an unexpired held booking. The proposed attachment migration prevents replacement. Its actual production installation is unknown. Current RLS, function privileges, constraints and triggers cannot be inferred from that snapshot; inspect them read-only before approving any migration.

Do not rerun booking_database.sql on an existing database: it contains older reserve/confirmation definitions. Proposed SQL guard/attachment migrations require staging and separate owner approval. Also test NULL inputs and the mobile-number regular expression against actual PostgreSQL; the pasted definition is not an execution test.

Order-linked holds intentionally remain blocked until reviewed. They can therefore occupy slots indefinitely. Rate limits are defined for create-order and availability, but enforcement and plan support have not been verified. Do not claim they are active from source inspection alone. Rate limits alone do not prevent distributed slot exhaustion. A safe abandoned-order/refund/cancellation procedure remains a release blocker; do not blindly expire ordered holds.

## Finish setup in this order

1. GitHub: identify the actual repository URL and default branch. Apply this archive as a REVIEW BRANCH with netlify.toml, public/, netlify/, setup/, tests/ and .github/ at repository root; do not nest the project inside public/. Keep private credentials out of commits. Run the workflow and open a PR. No GitHub connection/repository was available during this review, so no commit or PR was created.
2. Netlify: identify and link that repository to the EXISTING clinic project. Use publish directory public and functions directory netlify/functions; no frontend build command is required. Deploy the review branch to a preview first. Ensure secrets are scoped to Functions in Netlify UI/API; netlify.toml build environment settings are not a substitute for function secrets. Keep production PHC_LIVE_PAYMENTS_ENABLED=false and PHC_ENVIRONMENT=production. Inspect the existing value rather than overwriting other secrets. Avoid auto-deploying the production branch until review is complete.
3. Staging: create/use a separate Supabase test project or properly isolated branch without real patient data. Use staging-only credentials in deploy previews and branch deploys; never inherit production database or live Razorpay credentials. Set PHC_ENVIRONMENT=staging and PHC_LIVE_PAYMENTS_ENABLED=false for staging. Configure rzp_test_ keys only there. Do not add production webhooks to preview URLs.
4. Supabase: collect read-only definitions/ACLs/RLS/indexes/triggers using setup/PHC_READ_ONLY_INSPECTION.sql. Review its output before any mutation. Production migrations remain approval-gated. Test approved candidate migrations on staging, including two simultaneous requests for one slot and duplicate payment confirmation. Function EXECUTE must be revoked from PUBLIC, anon and authenticated and granted only as needed to service_role. Keep patient table access server-only.
5. Razorpay: review account activation/KYC and capture settings in the owner's dashboard; this review does not activate anything. In TEST MODE, configure the staging endpoint /.netlify/functions/consult-webhook for order.paid and payment.captured, using a dedicated webhook secret matching staging's function environment. Test success, failure, duplicates, callback loss, delayed webhook, wrong amount/currency/order/signature, and reconciliation. Keep live credentials/configuration unchanged and never create a real payment during setup.
6. Preview acceptance: confirm checkout stays disabled when false with live keys; staging test keys work only against staging. Check mobile/desktop, doctor closure controls, public source-path 404s, and actual rate-limit enforcement. Compare deployed asset versions. Review privacy/refund/cancellation/contact text with clinic owner.
7. Production: after preview review, request explicit approval for exact database migration(s) before applying them. A production code deployment is separate from database migration and payment activation. Keep false through deployment and verification. Request separate explicit approval before any live-payment activation.

## Netlify function variables (enter secrets in Netlify, never in chat or GitHub)

| Variable | Production | Staging/preview |
| --- | --- | --- |
| PHC_LIVE_PAYMENTS_ENABLED | false | false |
| PHC_ENVIRONMENT | production | staging |
| SUPABASE_URL | Existing production project origin | Separate staging project origin |
| PHC_SUPABASE_SERVER_KEY | Existing server-only key | Staging server-only key |
| RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET | Keep existing settings; creation blocked | Matching rzp_test_ key pair |
| RAZORPAY_WEBHOOK_SECRET | Existing production webhook secret | Dedicated test webhook secret |
| PHC_ADMIN_TOKEN | Private random token, at least 32 characters | Different staging token |

## Validation and limits

node --test tests/payment-safety.test.js: 22 passed, 0 failed. Provider responses are mocked, with no actual payments or database writes. These tests do NOT establish database concurrency, SQL migration correctness, real webhook delivery, rate-limit enforcement, Netlify account settings or successful deployment. Production account access is still needed to finish those checks.

Official references:
- https://docs.netlify.com/build/functions/environment-variables/
- https://docs.netlify.com/build/functions/api/
- https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
- https://supabase.com/docs/guides/database/functions
- https://razorpay.com/docs/webhooks/validate-test
