-- REVIEW ONLY: PROPOSED PRODUCTION PATCH. NOT EXECUTED.
-- Target: PHC Online Booking. Owner approval AND a restorable backup required.
-- Do NOT run PHC_SAFETY_TEST_SETUP.sql or historical booking_database.sql here.
-- This script installs five reviewed function definitions and one protection trigger.
-- It does not create/recreate tables, alter indexes, or run booking/payment DML.
-- Existing booking and closure rows are not updated or deleted by this migration.
-- Existing payment/order-linked holds will remain protected and require reconciliation.
-- Keep PHC_LIVE_PAYMENTS_ENABLED=false. This script cannot activate Razorpay.
-- Staging exercised the corresponding function logic. This production transaction
-- has only been syntax-checked; it has NOT been executed against production.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
 IF to_regclass('public.online_bookings') IS NULL
    OR to_regclass('public.phc_closures') IS NULL THEN
   RAISE EXCEPTION 'Expected existing PHC tables missing; stop and inspect';
 END IF;
 IF to_regclass('public.one_live_online_booking_per_slot') IS NULL THEN
   RAISE EXCEPTION 'Expected unique-slot index missing; stop and inspect';
 END IF;
 IF to_regprocedure('public.phc_reserve_online_slot(date,text,text,text,text,integer)') IS NULL
    OR to_regprocedure('public.phc_confirm_paid_slot(text,text,integer)') IS NULL
    OR to_regprocedure('public.phc_attach_order(uuid,text)') IS NULL
    OR to_regprocedure('public.phc_change_closure(date,text,boolean,text)') IS NULL
    OR to_regprocedure('public.phc_cancel_held_slot(uuid)') IS NULL THEN
   RAISE EXCEPTION 'Function signatures differ from reviewed audit; stop and inspect';
 END IF;
 IF EXISTS (
   SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.online_bookings'::regclass
     AND t.tgname = 'phc_guard_bookings_update'
     AND p.proname <> 'phc_protect_paid_or_ordered_booking'
 ) THEN
   RAISE EXCEPTION 'Unexpected existing trigger with the target name; stop and inspect';
 END IF;
END;
$preflight$;

-- Install the booking guard before restoring explicit execute permissions.
CREATE OR REPLACE FUNCTION public.phc_protect_paid_or_ordered_booking()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'paid' OR (OLD.status = 'held' AND OLD.razorpay_order_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Protected paid or payment-pending booking cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.razorpay_order_id IS NOT NULL AND NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id THEN
    RAISE EXCEPTION 'Razorpay order reference cannot be changed';
  END IF;
  IF OLD.status = 'paid' AND (NEW.status <> 'paid' OR NEW.slot_date IS DISTINCT FROM OLD.slot_date OR NEW.slot_time IS DISTINCT FROM OLD.slot_time) THEN
    RAISE EXCEPTION 'Paid appointment must not be released or moved automatically';
  END IF;
  IF OLD.status = 'held' AND OLD.razorpay_order_id IS NOT NULL AND NEW.status IN ('expired','cancelled') THEN
    RAISE EXCEPTION 'Pending Razorpay order needs payment reconciliation before release';
  END IF;
  IF NEW.status = 'paid' AND (NEW.razorpay_order_id IS NULL OR NEW.razorpay_payment_id IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'Paid booking requires payment references';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS phc_guard_bookings_update ON public.online_bookings;
CREATE TRIGGER phc_guard_bookings_update
BEFORE UPDATE OR DELETE ON public.online_bookings
FOR EACH ROW EXECUTE FUNCTION public.phc_protect_paid_or_ordered_booking();
-- Keep this trigger private; only the server-side database key should operate on bookings.
REVOKE ALL ON FUNCTION public.phc_protect_paid_or_ordered_booking() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.phc_attach_order(p_id uuid, p_order text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_id IS NULL OR p_order IS NULL OR p_order !~ '^order_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid order attachment';
  END IF;

  -- First attachment is permitted only while the temporary hold is active.
  -- Repeating the SAME attachment is safe even if the original hold timer
  -- has elapsed; replacing an order reference is never permitted.
  UPDATE public.online_bookings
     SET razorpay_order_id = p_order
   WHERE id = p_id
     AND status = 'held'
     AND (
       (razorpay_order_id IS NULL AND held_until > now())
       OR razorpay_order_id = p_order
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking hold expired, missing, or linked to another order';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.phc_attach_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phc_attach_order(uuid,text) TO service_role;

-- Replace existing closure/reservation/confirmation functions using staging-tested logic.
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


COMMIT;
SELECT 'Reviewed production definitions installed; no existing booking rows changed; no payment activation performed' AS result;
