BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.phc_booking_alerts DROP CONSTRAINT phc_booking_alerts_source_check;
ALTER TABLE public.phc_booking_alerts ADD CONSTRAINT phc_booking_alerts_source_check CHECK(source IN('online_paid','clinic_confirmed','setup_test'));
CREATE FUNCTION public.phc_queue_alert_email_test(p_actor uuid,p_key uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 PERFORM public.phc_require_admin(p_actor);
 IF p_key IS NULL THEN RAISE EXCEPTION 'Test reference required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_email_test',0));
 SELECT id INTO result FROM public.phc_booking_alerts WHERE source='setup_test' AND booking_id=p_key AND channel='email';
 IF FOUND THEN RETURN result;END IF;
 IF EXISTS(SELECT 1 FROM public.phc_booking_alerts WHERE source='setup_test' AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Please wait one minute before another test';END IF;
 INSERT INTO public.phc_booking_alerts(source,booking_id,channel,payload)VALUES('setup_test',p_key,'email','{"test":true}'::jsonb)RETURNING id INTO result;
 INSERT INTO public.phc_audit_log(actor,action,entity_id)VALUES(p_actor,'notification_email_test',result::text);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.phc_queue_alert_email_test(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phc_queue_alert_email_test(uuid,uuid) TO service_role;
COMMIT;
