PHC ONLINE AUDIO / VIDEO CONSULTATION BOOKING

STATUS: Website UI and server code are included, but LIVE PAYMENTS AND LIVE SLOT LOCKING
WILL NOT WORK UNTIL THE OWNER CONNECTS A DATABASE AND PAYMENT MERCHANT ACCOUNT.
CLINIC PRICE: ₹300 for audio and ₹300 for video, enforced server-side as 30000 paise.

HOW IT WORKS
- Monday-Saturday: 11:00-14:00 and 17:00-20:00 IST. Sunday: 11:00-14:00 IST.
- Every slot is 30 minutes, shared across BOTH video and audio. Only one booking per slot.
- Green = available; Amber = temporary 15-minute payment hold; Red = confirmed paid booking.
- Expired holds can be released and the slot becomes available again.
- After Razorpay confirms a captured payment, the slot is permanently booked in database.
- Patient payment happens on Razorpay Checkout; no card numbers are stored here.
- The clinic arranges audio/video call details manually; this does NOT create a video room.

IMPORTANT SETUP (NOT COMPLETED IN THIS PACKAGE)
1. Create a Supabase project (https://supabase.com). Run setup/booking_database.sql in
   the project's SQL Editor. Protect its service role key as a SERVER secret.
2. Create a Razorpay merchant account and complete its verification/KYC according
   to Razorpay rules (https://razorpay.com). Enable automatic payment capture.
   Set up test mode first; do not take real payments before testing.
3. In your Netlify project, under Project configuration > Environment variables,
   set the following for runtime FUNCTIONS:
     SUPABASE_URL = https://YOUR_PROJECT.supabase.co
     SUPABASE_SERVICE_ROLE_KEY = your-secret-service-role-key
     RAZORPAY_KEY_ID = your Razorpay test/live key ID
     RAZORPAY_KEY_SECRET = your Razorpay secret key
     RAZORPAY_WEBHOOK_SECRET = a NEW strong secret you configure in Razorpay
   Price is set in netlify/functions/_common.js as 30000 paise for both consultation types.
4. On Razorpay Dashboard, configure webhook:
   https://YOUR-SITE.netlify.app/.netlify/functions/consult-webhook
   Subscribe to events: order.paid and payment.captured. Use exactly the same
   RAZORPAY_WEBHOOK_SECRET for webhook verification.
5. Deploy via Netlify's normal site build/deploy process INCLUDING netlify/functions
   and netlify.toml. NOTE: drag-and-drop of a static folder may NOT build/deploy
   Functions. Connect a Git repository or run a Netlify CLI deploy/build so the
   server functions are deployed. Verify /.netlify/functions/consult-availability
   works before allowing patients to book.
6. Test simultaneous bookings and payment failure in RAZORPAY TEST MODE, plus
   verified callback + webhook. Only then switch to live credentials.
7. Secure clinic contact details: the database stores patient names and mobile
   numbers. Set a privacy policy, restrict staff access, and don't share records.
8. For any late capture after a hold expires and a different slot is booked,
   the payment may need MANUAL REFUND AND CLINIC RECONCILIATION. Inspect any
   'pending' payment warning. This starter doesn't automatically refund payments.

To see a preview of the website without payment credentials: open index.html in
Chrome (some browsers block local function calls), or publish static files to
Netlify. The UI explains why live booking is disabled when not configured.

IMPORTANT: This package does not instantly activate automatic appointment booking,
collect funds, or create a Google Meet / WhatsApp video room. Setup is required.

UPDATE: The booking section now says "Online Consultation" and displays available times as color-coded boxes. After selecting a green box, it previews payment methods; clicking Continue to Payment opens official Razorpay Checkout (after configuring your merchant account). Enabled methods can include UPI apps like PhonePe, debit/credit cards, net banking, and wallets. The checkout itself controls availability of payment methods. No custom payment processing is performed in HTML.
