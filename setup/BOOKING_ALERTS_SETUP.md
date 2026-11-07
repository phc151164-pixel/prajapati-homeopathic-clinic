# Clinic booking notifications

Status: owner has saved Production email credentials/flags. Email rollout and a synthetic inbox test are next. WhatsApp credentials and approval are still required. Do not tell the owner alerts are active until a test reaches both destinations.

Authorized destinations: clinic email `phc151164@gmail.com` and WhatsApp recipient `+91 8103684642`. These are server-controlled; no public request chooses a notification recipient. Notification contents: patient name/mobile, date/time in IST, consultation type/mode, saved fee, payment status and booking reference. No clinical notes, symptoms, passwords, admin tokens or gateway secrets are sent.

## Events and delivery

The additive migration `supabase/migrations/20261107221809_booking_alert_outbox.sql` creates a private RLS-protected outbox and triggers. It does not rewrite existing bookings or backfill old notifications. New paid online bookings and doctor-approved Pay at Clinic appointments each create one job per channel. Pending/unpaid online attempts and unapproved clinic requests do not notify.

`booking-alert-dispatch` is a Netlify scheduled function every minute, production only, with independent OFF-by-default channel flags. Netlify does not expose scheduled functions as public URLs. Preview deployments cannot send patient data. Provider/API calls occur outside payment transactions. Missing configuration leaves jobs pending, shown in Doctor Dashboard → Booking notifications. Provider acceptance is not confirmed inbox delivery or WhatsApp read status.

Email retries use a stable Resend idempotency key; retries stop before its 24h expiration. WhatsApp uncertain timeout/5xx outcomes go to review rather than automatic resend, because the API does not promise request idempotency. A returned WhatsApp `wamid` or email ID means provider accepted, not delivered/read. Lease guards prevent concurrent workers from processing the same job. Old jobs and exhausted retries need review. Do not manually resend a review entry until provider delivery history is checked. There is deliberately no public send endpoint or one-click unsafe resend.

## Email setup

1. Owner creates a Resend account using `phc151164@gmail.com`, verifies that email and creates a sending API key. Store the key directly in Netlify Production secret `RESEND_API_KEY`; never paste it in chat or git.
2. Configure `PHC_ALERT_EMAIL_FROM`. A verified sending domain is recommended for production. Resend's `onboarding@resend.dev` sender is restricted to sending to the account's own email, so it can only be used here if that account email is exactly the authorized clinic recipient. Verify current provider account restrictions before enabling it.
3. Set Production `PHC_EMAIL_ALERTS_ENABLED=true` and `PHC_BOOKING_ALERTS_ENABLED=true` only after the migration and reviewed code deploy. Keep all preview flags false. Check the clinic inbox, spam and provider history with a synthetic test before using real patient notifications.

## WhatsApp setup

Requires Meta WhatsApp Cloud API or a separately chosen official provider. A WhatsApp Business mobile app login or number alone does not supply sending API access. Do not move or deregister the existing clinic number as part of this change. Choose/verify the API sending number separately from the alert destination. If the same number is proposed as both sender and recipient, resolve that setup before attempting sends.

Store Production-only secrets `WHATSAPP_ACCESS_TOKEN` and config `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (supported version from Meta API Setup), `WHATSAPP_ALERT_TEMPLATE`, `WHATSAPP_TEMPLATE_LANGUAGE`. Use a durable authorized token and approved template; temporary setup tokens are insufficient for unattended operation. Provider charges/account restrictions require owner review.

Proposed template name: `phc_booking_alert`; language `en_US`; eight ordered BODY text parameters:

> PHC clinic appointment notification. A new appointment has been confirmed. Patient name: {{1}}. Patient mobile: {{2}}. Appointment date: {{3}}. Appointment time: {{4}}. Consultation details: {{5}}. Saved consultation fee: {{6}}. Payment status: {{7}}. Clinic booking reference: {{8}}. Open the private Doctor Dashboard to review the latest appointment status and full record.

Meta decides approval and category. This text is a proposal, not an approved template. The clinic owner requested receipt of alerts on this number. Do not use that consent for patient marketing or sending to patients. Set `PHC_WHATSAPP_ALERTS_ENABLED=true` only after template approval and a synthetic recipient test. Missing WhatsApp config must not block email.

## Release

Email and WhatsApp can be released independently; missing WhatsApp setup never blocks email. The owner can queue an idempotent, rate-limited synthetic email from Booking notifications → Send setup test email. No real booking/payment is created.

Apply to PHC Safety Test first; verify RLS/no public execution and rollback-only test payment→queue idempotency. Owner configures provider credentials privately. Verify a synthetic email and template notification, then deploy only after reviewed approval. No historical patient data is sent automatically. Existing payment keys, live switch, fees, bookings and confirmations must remain unchanged.
