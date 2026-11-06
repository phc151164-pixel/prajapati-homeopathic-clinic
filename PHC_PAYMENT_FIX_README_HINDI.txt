CURRENT REVIEW: Read PHC_REVIEW_AND_SETUP.md first. Older instructions below are historical; do not activate payments or run production SQL. Keep PHC_LIVE_PAYMENTS_ENABLED=false. Test orders now require an isolated staging environment.

PHC ONLINE BOOKING - CORRECTED FILES (06 Nov 2026)

Yeh ZIP source-code fixes hai; live payment activate nahi hua hai.

KYA CHECK KIYA / FIX KIYA:
- Original PHC design, assets, logo, patient booking form unchanged.
- Duplicate debug logs (PHC_SECRET_TEST and public Supabase target) removed.
- Availability works even if payment keys temporarily absent (database keys required).
- Online order errors now log which step failed: reserve / razorpay_order / attach_order.
- Server logs avoid secrets and patient names/phone numbers.
- Razorpay order failures show useful patient-safe error and release temporary hold.
- Payment verification additionally validates INR and authentic Razorpay data.
- Webhook checks payment details directly through Razorpay before confirming.
- Setup instructions use correct PHC_SUPABASE_SERVER_KEY variable.

IMPORTANT: 401 in old Netlify logs might have been from Razorpay (not Supabase),
because reserve booking records were created and subsequently cancelled.
The old log did not identify which provider returned 401. The new code does.

NETLIFY VARIABLES - PRODUCTION CONTEXT (NEVER put secret values in this ZIP):
SUPABASE_URL = https://<your-project>.supabase.co (NO /rest/v1)
PHC_SUPABASE_SERVER_KEY = correct legacy service_role key for SAME Supabase project
RAZORPAY_KEY_ID = test-mode ID e.g. rzp_test_... (must match secret)
RAZORPAY_KEY_SECRET = secret from SAME Razorpay test key pair
RAZORPAY_WEBHOOK_SECRET = separate webhook signing secret

NEXT WHEN NETLIFY RESUMES:
1. Make one GitHub upload replacing changed files from this ZIP (or upload full ZIP contents to repo), and one production deployment.
2. Check /.netlify/functions/consult-availability?date=YYYY-MM-DD => ready:true and slots.
3. Choose a FUTURE green slot; click Continue to Payment.
4. Look at Netlify Functions > consult-create-order logs for stage/provider/status if error.
5. If checkout opens, use ONLY Razorpay Test Mode to test and check confirm status and webhook.
6. Verify corresponding Supabase booking status = paid and second browser shows Booked.
7. Do NOT collect real patient payments until payment, confirmation, refunds/reconciliation,
   and clinic's terms/privacy policy are fully verified.

IMPORTANT OPERATIONAL LIMITATION:
A pending payment beyond the 15-minute slot hold and asynchronous webhooks may
require manual reconciliation. Verify the payment in Razorpay Dashboard before
any manual appointment confirmation or refund. Never ask patient to pay twice.

DO NOT paste keys into GitHub, chats, HTML, JavaScript or this ZIP.
