-- New confirmed bookings only. No backfill or payment changes. Delivery is OFF until configured.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.phc_booking_alerts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text NOT NULL CHECK(source IN('online_paid','clinic_confirmed')),booking_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN('email','whatsapp')),payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','sent','review')),
 attempts integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),first_attempt_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),lease uuid,lease_until timestamptz,
 provider_id text,last_code text,sent_at timestamptz,
 UNIQUE(source,booking_id,channel)
);
CREATE INDEX phc_booking_alerts_due ON public.phc_booking_alerts(next_attempt_at,created_at) WHERE state IN('pending','sending');
ALTER TABLE public.phc_booking_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phc_booking_alerts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.phc_booking_alerts TO service_role;
CREATE FUNCTION public.phc_enqueue_booking_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 RETURN NEW;
END $$;
CREATE TRIGGER phc_queue_paid_booking_alert AFTER INSERT OR UPDATE OF status ON public.online_bookings FOR EACH ROW EXECUTE FUNCTION public.phc_enqueue_booking_alert();
CREATE TRIGGER phc_queue_clinic_booking_alert AFTER INSERT OR UPDATE OF status ON public.phc_clinic_requests FOR EACH ROW EXECUTE FUNCTION public.phc_enqueue_booking_alert();
CREATE FUNCTION public.phc_claim_booking_alerts(p_channels text[]) RETURNS SETOF public.phc_booking_alerts LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Uncertain WhatsApp outcomes cannot be retried automatically: provider has no idempotency key.
 UPDATE public.phc_booking_alerts SET state='review',last_code='ambiguous_delivery',lease=NULL,lease_until=NULL WHERE state='sending' AND lease_until<now() AND channel='whatsapp';
 UPDATE public.phc_booking_alerts SET state='pending',lease=NULL,lease_until=NULL WHERE state='sending' AND lease_until<now() AND channel='email';
 UPDATE public.phc_booking_alerts a SET state='review',last_code='booking_no_longer_confirmed' WHERE state='pending' AND source='clinic_confirmed' AND NOT EXISTS(SELECT 1 FROM public.phc_clinic_requests c WHERE c.id=a.booking_id AND c.status='confirmed');
 -- Resend keys expire at 24h; stop before then instead of risking duplicate mail.
 UPDATE public.phc_booking_alerts SET state='review',last_code='retry_window_expired' WHERE state='pending' AND (created_at<now()-interval '7 days' OR first_attempt_at<now()-interval '23 hours' OR attempts>=6);
 RETURN QUERY WITH picked AS(SELECT id FROM public.phc_booking_alerts WHERE state='pending' AND channel=ANY(p_channels) AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 2)
 UPDATE public.phc_booking_alerts a SET state='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' FROM picked p WHERE a.id=p.id RETURNING a.*;
END $$;
CREATE FUNCTION public.phc_finish_booking_alert(p_id uuid,p_lease uuid,p_result text,p_provider text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_result NOT IN('accepted','retry','rejected','ambiguous') THEN RAISE EXCEPTION 'Invalid delivery result';END IF;
 UPDATE public.phc_booking_alerts SET state=CASE WHEN p_result='accepted' THEN 'sent' WHEN p_result='retry' AND attempts<6 THEN 'pending' ELSE 'review' END,
 provider_id=CASE WHEN p_result='accepted' THEN left(p_provider,200) ELSE provider_id END,last_code=p_result,
 sent_at=CASE WHEN p_result='accepted' THEN now() ELSE sent_at END,next_attempt_at=now()+make_interval(secs=>least(3600,60*(2^least(attempts,5))::integer)),lease=NULL,lease_until=NULL
 WHERE id=p_id AND state='sending' AND lease=p_lease AND lease_until>now();RETURN FOUND;
END $$;
CREATE FUNCTION public.phc_read_booking_alerts(p_actor uuid,p_page integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.phc_require_admin(p_actor);
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,source,booking_id,channel,state,attempts,created_at,sent_at,last_code FROM public.phc_booking_alerts ORDER BY created_at DESC LIMIT 31 OFFSET greatest(0,least(coalesce(p_page,0),100000))*30)x));
END $$;
DO $$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['phc_enqueue_booking_alert()','phc_claim_booking_alerts(text[])','phc_finish_booking_alert(uuid,uuid,text,text)','phc_read_booking_alerts(uuid,integer)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO service_role';
 END LOOP;
END $$;
COMMIT;
