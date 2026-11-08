# Patient WhatsApp confirmations

Prepared for review; not live or sending. Meta credentials and template approval remain necessary. Existing clinic email alerts stay unchanged. No automatic video/audio calls are made by this feature: the clinic arranges calls manually at the confirmed slot.

## Behaviour

- The patient chooses audio/video and may opt in to WhatsApp updates at their entered mobile number. The checkbox starts unchecked.
- Name/mobile/date/time and consent are saved atomically with a new reservation or clinic request. Existing records default to opted out; there is no backfill.
- Only verified paid online bookings or doctor-approved clinic requests queue a patient message. An unapproved request or held/failed payment does not notify the patient. Clinic approval means slot confirmed; it does not imply payment collected.
- Audio and video use separate approved templates. They explain the 8103684642 caller number and that a change of time requires a WhatsApp request plus clinic confirmation. No automatic release, cancellation or rescheduling is added.
- Patient message contains name/date/time only. Clinical notes, symptoms, diagnoses, payment credentials and admin URLs are excluded.
- Dispatch targets `91` plus the saved booking mobile, never a recipient supplied to a public send endpoint. Consent is required in the saved payload. Duplicate callbacks cannot create duplicate patient jobs.
- Preview sending stays blocked. Ambiguous WhatsApp outcomes/expired leases go to review rather than automatically risking duplicate sends.

## Proposed templates (Meta must approve these)

Language: Hindi (`hi`). The BODY uses three ordered text parameters: patient name, confirmed date (`YYYY-MM-DD`), confirmed time (`HH:mm IST`). Use synthetic samples only when submitting templates.

### phc_patient_video_confirmed

नमस्ते {{1}}, Prajapati Homeopathic Clinic में आपकी वीडियो कंसल्टेशन बुकिंग {{2}} को {{3}} बजे के लिए कन्फर्म है। आपके तय स्लॉट पर क्लिनिक नंबर 8103684642 से WhatsApp वीडियो कॉल की जाएगी। समय बदलवाने के लिए इसी नंबर पर WhatsApp से अनुरोध भेजें। नया समय क्लिनिक की पुष्टि के बाद ही मान्य होगा। धन्यवाद।

### phc_patient_audio_confirmed

नमस्ते {{1}}, Prajapati Homeopathic Clinic में आपकी ऑडियो कंसल्टेशन बुकिंग {{2}} को {{3}} बजे के लिए कन्फर्म है। आपके तय स्लॉट पर क्लिनिक नंबर 8103684642 से फोन कॉल की जाएगी। समय बदलवाने के लिए इसी नंबर पर WhatsApp से अनुरोध भेजें। नया समय क्लिनिक की पुष्टि के बाद ही मान्य होगा। धन्यवाद।

## Server-only configuration

Shared Meta sender credentials: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`. Keep the existing WhatsApp Business app number intact; do not delete/deregister it. API sender onboarding/coexistence must be resolved with Meta before selecting a sender.

Patient-only options:

```
PHC_PATIENT_WHATSAPP_ENABLED=false
WHATSAPP_PATIENT_VIDEO_TEMPLATE=phc_patient_video_confirmed
WHATSAPP_PATIENT_AUDIO_TEMPLATE=phc_patient_audio_confirmed
WHATSAPP_PATIENT_TEMPLATE_LANGUAGE=hi
```

The global `PHC_BOOKING_ALERTS_ENABLED=true` gate and build-stamped production context are also required. Patient sending is independent of the clinic WhatsApp alert flag/templates. Keep the patient flag false until a synthetic video and audio delivery test passes to a consenting controlled test number. Do not copy tokens into chat or git.

## Migration and review

Apply `supabase/migrations/20261108164649_patient_whatsapp_confirmation.sql` to PHC Safety Test before deploying this branch. It adds nullable consent metadata/default false flags, private consent-aware booking wrappers and one outbox channel. It broadens the channel check and replaces existing enqueue/claim functions; no payment amount/status or existing schedule is rewritten.

Review staging and rollback-only consent/confirmation/idempotency tests, then configure Meta and verify delivery. Production schema and code rollout require review before activation. Never treat provider acceptance as verified delivery/read status. Patient updates are transactional booking notices, not marketing or general messaging.
