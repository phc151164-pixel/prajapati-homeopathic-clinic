BEGIN;

CREATE TABLE public.phc_booking_otp_sends (
  mobile_hash bytea NOT NULL CHECK (octet_length(mobile_hash) = 32),
  sent_at timestamptz NOT NULL
);

ALTER TABLE public.phc_booking_otp_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phc_booking_otp_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.phc_booking_otp_sends TO service_role;

CREATE INDEX phc_booking_otp_sends_mobile_time
  ON public.phc_booking_otp_sends (mobile_hash, sent_at);
CREATE INDEX phc_booking_otp_sends_time ON public.phc_booking_otp_sends (sent_at);

CREATE FUNCTION public.phc_record_booking_otp_send(p_mobile_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  mobile_digest bytea;
  checked_at timestamptz;
  minute_count integer;
  hour_count integer;
BEGIN
  IF p_mobile_hash IS NULL OR p_mobile_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  mobile_digest := decode(p_mobile_hash, 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_booking_otp:' || p_mobile_hash, 0));
  checked_at := clock_timestamp();

  DELETE FROM public.phc_booking_otp_sends WHERE sent_at < checked_at - interval '24 hours';

  SELECT count(*) FILTER (WHERE sent_at > checked_at - interval '1 minute'), count(*)
    INTO minute_count, hour_count
  FROM public.phc_booking_otp_sends
  WHERE mobile_hash = mobile_digest AND sent_at > checked_at - interval '1 hour';

  IF minute_count >= 2 OR hour_count >= 5 THEN
    RETURN false;
  END IF;

  INSERT INTO public.phc_booking_otp_sends (mobile_hash, sent_at) VALUES (mobile_digest, checked_at);
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.phc_record_booking_otp_send(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phc_record_booking_otp_send(text) TO service_role;

COMMIT;
