-- PHC SAFETY TEST ONLY. Do NOT run on PHC Online Booking.
-- Adds closures and replaces reservation/confirmation definitions.
-- Does not migrate, delete or copy existing patient records.
-- PHC_LIVE_PAYMENTS_ENABLED must remain false in Netlify.
-- Review the project name in Supabase BEFORE running this entire script.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.phc_closures (
  slot_date date NOT NULL,
  slot_time text,
  reason text NOT NULL DEFAULT 'Doctor unavailable',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phc_closures_time_format CHECK (
    slot_time IS NULL OR slot_time ~ '^([01][0-9]|2[0-3]):(00|30)$'
  )
);
CREATE UNIQUE INDEX phc_closures_unique_slot
ON public.phc_closures(slot_date, (coalesce(slot_time, 'ALL_DAY')));
ALTER TABLE public.phc_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phc_closures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phc_closures TO service_role;
ALTER TABLE public.online_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.online_bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_bookings TO service_role;

CREATE OR REPLACE FUNCTION public.phc_change_closure(
  p_date date, p_time text, p_closed boolean,
  p_reason text DEFAULT 'Doctor unavailable'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF p_date IS NULL OR p_closed IS NULL OR p_date < today_ist
     OR p_date > today_ist + 365 THEN
    RAISE EXCEPTION 'Invalid closure date or state' USING ERRCODE = '22023';
  END IF;
  IF p_time IS NOT NULL AND (
    p_time !~ '^([01][0-9]|2[0-3]):(00|30)$'
    OR NOT ((p_time >= '11:00' AND p_time < '14:00')
       OR (extract(dow FROM p_date) <> 0 AND p_time >= '17:00' AND p_time < '20:00'))
  ) THEN
    RAISE EXCEPTION 'Choose a valid clinic time' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:' || p_date::text, 0));
  IF p_closed THEN
    INSERT INTO public.phc_closures(slot_date, slot_time, reason)
    VALUES (p_date, p_time, left(coalesce(nullif(btrim(p_reason), ''), 'Doctor unavailable'), 120))
    ON CONFLICT (slot_date, (coalesce(slot_time, 'ALL_DAY')))
    DO UPDATE SET reason = excluded.reason;
  ELSE
    DELETE FROM public.phc_closures
    WHERE slot_date = p_date AND slot_time IS NOT DISTINCT FROM p_time;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.phc_reserve_online_slot(
  p_date date, p_time text, p_mode text, p_name text,
  p_mobile text, p_fee integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  booking_id uuid;
  min_slot integer;
  today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  time_ist time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
BEGIN
  IF p_date IS NULL OR p_date < today_ist OR p_date > today_ist + 90
     OR p_time IS NULL OR p_time !~ '^([01][0-9]|2[0-3]):(00|30)$'
     OR p_mode IS NULL OR p_mode NOT IN ('video','audio')
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 80
     OR p_mobile IS NULL OR p_mobile !~ '^[0-9]{10}$'
     OR p_fee IS DISTINCT FROM 30000 THEN
    RAISE EXCEPTION 'Invalid booking information' USING ERRCODE = '22023';
  END IF;
  min_slot := split_part(p_time, ':', 1)::integer * 60
            + split_part(p_time, ':', 2)::integer;
  IF NOT ((min_slot >= 660 AND min_slot + 30 <= 840)
      OR (extract(dow FROM p_date) <> 0 AND min_slot >= 1020 AND min_slot + 30 <= 1200))
     OR (p_date = today_ist AND p_time::time <= time_ist) THEN
    RAISE EXCEPTION 'Outside future clinic hours' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:' || p_date::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.phc_closures
    WHERE slot_date = p_date AND (slot_time IS NULL OR slot_time = p_time)
  ) THEN
    RAISE EXCEPTION 'Consultations are closed for this date or time';
  END IF;
  UPDATE public.online_bookings SET status = 'expired'
  WHERE slot_date = p_date AND slot_time = p_time AND status = 'held'
    AND razorpay_order_id IS NULL AND held_until <= now();
  INSERT INTO public.online_bookings(
    id,slot_date,slot_time,mode,patient_name,mobile,amount_paise,
    status,held_until,created_at
  ) VALUES (
    gen_random_uuid(),p_date,p_time,p_mode,btrim(p_name),p_mobile,30000,
    'held',now() + interval '15 minutes',now()
  ) RETURNING id INTO booking_id;
  RETURN booking_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.phc_confirm_paid_slot(
  p_order text, p_payment text, p_amount integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE booked uuid;
BEGIN
  IF p_order IS NULL OR p_order !~ '^order_[A-Za-z0-9]+$'
     OR p_payment IS NULL OR p_payment !~ '^pay_[A-Za-z0-9]+$'
     OR p_amount IS DISTINCT FROM 30000 THEN
    RETURN false;
  END IF;
  UPDATE public.online_bookings
  SET status = 'paid', paid_at = coalesce(paid_at, now()),
      razorpay_payment_id = coalesce(razorpay_payment_id, p_payment)
  WHERE razorpay_order_id = p_order AND amount_paise = 30000 AND status = 'held'
    AND (razorpay_payment_id IS NULL OR razorpay_payment_id = p_payment)
  RETURNING id INTO booked;
  IF booked IS NOT NULL THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.online_bookings
    WHERE razorpay_order_id = p_order AND razorpay_payment_id = p_payment
      AND amount_paise = 30000 AND status = 'paid'
  );
END;
$fn$;

-- Server verifies Razorpay signatures and captured payment BEFORE calling confirmation.
REVOKE ALL ON FUNCTION public.phc_change_closure(date,text,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phc_reserve_online_slot(date,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phc_confirm_paid_slot(text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phc_attach_order(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phc_cancel_held_slot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phc_protect_paid_or_ordered_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phc_change_closure(date,text,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phc_reserve_online_slot(date,text,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.phc_confirm_paid_slot(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.phc_attach_order(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phc_cancel_held_slot(uuid) TO service_role;

-- Transactional smoke tests. Synthetic rows are rolled back in the inner block.
-- Unexpected failures abort the installation; do not bypass a failure.
DO $test$
DECLARE d date; b uuid; o text; p text; rejected boolean;
BEGIN
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + n)::date INTO d
  FROM generate_series(1,89) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.online_bookings
    WHERE slot_date = (now() AT TIME ZONE 'Asia/Kolkata')::date + n
  ) ORDER BY n LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'No empty date available for staging smoke tests'; END IF;
  o := 'order_PHCTest' || replace(gen_random_uuid()::text, '-', '');
  p := 'pay_PHCTest' || replace(gen_random_uuid()::text, '-', '');
  BEGIN
    rejected := false;
    BEGIN
      PERFORM public.phc_reserve_online_slot(d,'11:00','video','PHC TEST','0000000000',1);
    EXCEPTION WHEN invalid_parameter_value THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Wrong fee was accepted'; END IF;

    rejected := false;
    BEGIN
      PERFORM public.phc_reserve_online_slot(d,NULL,'video','PHC TEST','0000000000',30000);
    EXCEPTION WHEN invalid_parameter_value THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'NULL time was accepted'; END IF;

    PERFORM public.phc_change_closure(d,'11:00',true,'Synthetic test');
    rejected := false;
    BEGIN
      PERFORM public.phc_reserve_online_slot(d,'11:00','video','PHC TEST','0000000000',30000);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'Consultations are closed for this date or time' THEN rejected := true;
      ELSE RAISE; END IF;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Closed slot was accepted'; END IF;
    PERFORM public.phc_change_closure(d,'11:00',false);

    b := public.phc_reserve_online_slot(d,'11:00','video','PHC TEST','0000000000',30000);
    rejected := false;
    BEGIN
      PERFORM public.phc_reserve_online_slot(d,'11:00','audio','PHC TEST','0000000000',30000);
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Duplicate slot was accepted'; END IF;

    PERFORM public.phc_attach_order(b,o);
    UPDATE public.online_bookings SET held_until = now() - interval '1 minute' WHERE id = b;
    PERFORM public.phc_attach_order(b,o);
    IF public.phc_confirm_paid_slot(o,p,1) THEN RAISE EXCEPTION 'Wrong confirmation fee accepted'; END IF;
    IF NOT public.phc_confirm_paid_slot(o,p,30000) THEN RAISE EXCEPTION 'Confirmation failed'; END IF;
    IF NOT public.phc_confirm_paid_slot(o,p,30000) THEN RAISE EXCEPTION 'Repeated confirmation failed'; END IF;
    IF public.phc_confirm_paid_slot(o,p || 'Other',30000) THEN RAISE EXCEPTION 'Different payment accepted'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.online_bookings'::regclass
        AND tgname = 'phc_guard_bookings_update' AND tgenabled = 'O' AND NOT tgisinternal)
    THEN RAISE EXCEPTION 'Expected booking guard trigger missing or disabled'; END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZP001', MESSAGE = 'Rollback synthetic fixtures';
  EXCEPTION WHEN SQLSTATE 'ZP001' THEN
    RAISE NOTICE 'PHC staging smoke tests passed; synthetic fixtures rolled back';
  END;
END;
$test$;
COMMIT;
SELECT 'PHC Safety Test setup installed; smoke tests passed; no payment activation performed' AS result;
