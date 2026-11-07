CURRENT REVIEW: Read PHC_REVIEW_AND_SETUP.md first. Older instructions below are historical; do not activate payments or run production SQL. Keep PHC_LIVE_PAYMENTS_ENABLED=false. Test orders now require an isolated staging environment.

# PHC Go-Live Safety Checklist — Approval Required

- [ ] All website files deployed successfully to a **preview**, not production.
- [ ] Live payment switch still `false` in Production.
- [ ] Doctor holidays, booked slots and checkout UI visually tested on mobile and desktop.
- [ ] Netlify build recognises the two rateLimit rules and returns HTTP 429 when exceeded.
- [ ] Database backup made and current live SQL functions reviewed.
- [ ] SQL guard migration reviewed, tested on a staging database, then separately approved.
- [ ] Two concurrent bookings cannot hold the same slot (real database concurrency test).
- [ ] Successful test-mode captured payment marks booking `paid` exactly once.
- [ ] Failed/abandoned payment does not appear as `paid`.
- [ ] Late payment or failed webhook is found by doctor pending-payments review.
- [ ] Razorpay webhook HMAC checked with the raw body; duplicate notifications handled.
- [ ] Invalid signatures, wrong amounts, and wrong orders cannot confirm a booking.
- [ ] Public URLs do not expose SQL, server-side functions source, admin secrets or patient data.
- [ ] Privacy notice, contact details and cancellation/refund policy reviewed by clinic owner.
- [ ] Webhook delivery, errors, and payment/provider downtime recovery procedure documented.
- [ ] All account changes and activation approved separately by the authorised owner.

**Never claim 100% safe or start collecting live payments without these checks.**
