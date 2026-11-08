-- Patient confirmations are opt-in and OFF until approved Meta templates are configured.
-- Existing rows remain opted out. No historical notification backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.online_bookings ADD COLUMN whatsapp_updates_opt_in boolean NOT NULL DEFAULT false,ADD COLUMN whatsapp_opt_in_at timestamptz,ADD COLUMN whatsapp_consent_version text;
ALTER TABLE public.online_bookings ADD CONSTRAINT online_bookings_whatsapp_consent CHECK((NOT whatsapp_updates_opt_in AND whatsapp_opt_in_at IS NULL AND whatsapp_consent_version IS NULL) OR (whatsapp_updates_opt_in AND whatsapp_opt_in_at IS NOT NULL AND whatsapp_consent_version='booking-whatsapp-v1'));
ALTER TABLE public.phc_clinic_requests ADD COLUMN whatsapp_updates_opt_in boolean NOT NULL DEFAULT false,ADD COLUMN whatsapp_opt_in_at timestamptz,ADD COLUMN whatsapp_consent_version text;
ALTER TABLE public.phc_clinic_requests ADD CONSTRAINT phc_clinic_requests_whatsapp_consent CHECK((NOT whatsapp_updates_opt_in AND whatsapp_opt_in_at IS NULL AND whatsapp_consent_version IS NULL) OR (whatsapp_updates_opt_in AND whatsapp_opt_in_at IS NOT NULL AND whatsapp_consent_version='booking-whatsapp-v1'));
ALTER TABLE public.phc_booking_alerts DROP CONSTRAINT phc_booking_alerts_channel_check;
ALTER TABLE public.phc_booking_alerts ADD CONSTRAINT phc_booking_alerts_channel_check CHECK(channel IN('email','whatsapp','patient_whatsapp'));
CREATE FUNCTION public.phc_reserve_online_slot_v3(p_date date,p_time text,p_mode text,p_name text,p_mobile text,p_kind text,p_whatsapp boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_whatsapp IS NULL THEN RAISE EXCEPTION 'WhatsApp preference required';END IF;
 result:=public.phc_reserve_online_slot_v2(p_date,p_time,p_mode,p_name,p_mobile,p_kind);
 IF p_whatsapp THEN UPDATE public.online_bookings SET whatsapp_updates_opt_in=true,whatsapp_opt_in_at=now(),whatsapp_consent_version='booking-whatsapp-v1' WHERE id=(result->>'id')::uuid;END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.phc_request_clinic_booking_v2(p_key uuid,p_date date,p_time text,p_mode text,p_name text,p_mobile text,p_kind text,p_whatsapp boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; existing boolean;
BEGIN
 IF p_whatsapp IS NULL THEN RAISE EXCEPTION 'WhatsApp preference required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_clinic_request:'||p_key::text,0));
 SELECT whatsapp_updates_opt_in INTO existing FROM public.phc_clinic_requests WHERE request_key=p_key;
 IF FOUND AND existing IS DISTINCT FROM p_whatsapp THEN RAISE EXCEPTION 'Request preference changed; use a new request reference';END IF;
 result:=public.phc_request_clinic_booking(p_key,p_date,p_time,p_mode,p_name,p_mobile,p_kind);
 IF existing IS NULL AND p_whatsapp THEN UPDATE public.phc_clinic_requests SET whatsapp_updates_opt_in=true,whatsapp_opt_in_at=now(),whatsapp_consent_version='booking-whatsapp-v1' WHERE id=(result->>'requestId')::uuid;END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.phc_enqueue_booking_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src text; payment text;
BEGIN
 IF TG_TABLE_NAME='online_bookings' THEN
  IF NEW.status<>'paid' THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND OLD.status='paid' THEN RETURN NEW;END IF;
  src:='online_paid';payment:='Paid online';
 ELSE
  IF NEW.status<>'confirmed' THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND OLD.status='confirmed' THEN RETURN NEW;END IF;
  src:='clinic_confirmed';payment:='Pay at Clinic - payment due';
 END IF;
 INSERT INTO public.phc_booking_alerts(source,booking_id,channel,payload)
 SELECT src,NEW.id,channel,jsonb_build_object('bookingId',NEW.id,'name',NEW.patient_name,'mobile',NEW.mobile,'date',NEW.slot_date,'time',NEW.slot_time,'mode',NEW.mode,'kind',NEW.consultation_kind,'amountPaise',NEW.amount_paise,'payment',payment)
 FROM unnest(ARRAY['email','whatsapp']) channel ON CONFLICT(source,booking_id,channel) DO NOTHING;
 IF NEW.whatsapp_updates_opt_in AND NEW.whatsapp_consent_version='booking-whatsapp-v1' AND NEW.whatsapp_opt_in_at IS NOT NULL THEN
 INSERT INTO public.phc_booking_alerts(source,booking_id,channel,payload)VALUES(src,NEW.id,'patient_whatsapp',jsonb_build_object('bookingId',NEW.id,'name',NEW.patient_name,'mobile',NEW.mobile,'date',NEW.slot_date,'time',NEW.slot_time,'mode',NEW.mode,'kind',NEW.consultation_kind,'amountPaise',NEW.amount_paise,'payment',payment,'consentVersion',NEW.whatsapp_consent_version)) ON CONFLICT(source,booking_id,channel)DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.phc_claim_booking_alerts(p_channels text[]) RETURNS SETOF public.phc_booking_alerts LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Uncertain WhatsApp outcomes cannot be retried automatically: provider has no idempotency key.
 UPDATE public.phc_booking_alerts SET state='review',last_code='ambiguous_delivery',lease=NULL,lease_until=NULL WHERE state='sending' AND lease_until<now() AND channel IN('whatsapp','patient_whatsapp');
 UPDATE public.phc_booking_alerts SET state='pending',lease=NULL,lease_until=NULL WHERE state='sending' AND lease_until<now() AND channel='email';
 UPDATE public.phc_booking_alerts a SET state='review',last_code='booking_no_longer_confirmed' WHERE state='pending' AND source='clinic_confirmed' AND NOT EXISTS(SELECT 1 FROM public.phc_clinic_requests c WHERE c.id=a.booking_id AND c.status='confirmed');
 -- Resend keys expire at 24h; stop before then instead of risking duplicate mail.
 UPDATE public.phc_booking_alerts SET state='review',last_code='retry_window_expired' WHERE state='pending' AND (created_at<now()-interval '7 days' OR first_attempt_at<now()-interval '23 hours' OR attempts>=6);
 RETURN QUERY WITH picked AS(SELECT id FROM public.phc_booking_alerts WHERE state='pending' AND channel=ANY(p_channels) AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 2)
 UPDATE public.phc_booking_alerts a SET state='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' FROM picked p WHERE a.id=p.id RETURNING a.*;
END $$;
DO $$ DECLARE sig text;BEGIN
 FOREACH sig IN ARRAY ARRAY['phc_reserve_online_slot_v3(date,text,text,text,text,text,boolean)','phc_request_clinic_booking_v2(uuid,date,text,text,text,text,text,boolean)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO service_role';
 END LOOP;
END $$;
COMMIT;
