BEGIN;
SET LOCAL lock_timeout = '5s';

-- Only new checkout holds receive a deadline. Existing gateway orders keep their reconciliation path.
ALTER TABLE public.online_bookings ADD COLUMN checkout_deadline timestamptz;
ALTER TABLE public.online_bookings ALTER COLUMN checkout_deadline SET DEFAULT (clock_timestamp() + interval '2 minutes');

CREATE OR REPLACE FUNCTION public.phc_attach_order(p_id uuid, p_order text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
     AND (checkout_deadline IS NULL OR checkout_deadline > clock_timestamp())
     AND (
       (razorpay_order_id IS NULL AND held_until > now())
       OR razorpay_order_id = p_order
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking hold expired, missing, or linked to another order';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.phc_clinic_slot_free(p_date date, p_time text, p_minutes integer, p_ignore uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT NOT EXISTS(SELECT 1 FROM public.online_bookings b WHERE b.slot_date=p_date AND (b.status='paid' OR b.status='held' AND (coalesce(b.checkout_deadline>clock_timestamp(), b.razorpay_order_id IS NOT NULL OR b.held_until>now())))
 AND b.slot_time::time<p_time::time+p_minutes*interval '1 minute' AND p_time::time<b.slot_time::time+b.slot_minutes*interval '1 minute')
 AND NOT EXISTS(SELECT 1 FROM public.phc_clinic_requests c WHERE c.slot_date=p_date AND c.status='confirmed' AND c.id IS DISTINCT FROM p_ignore
 AND c.slot_time::time<p_time::time+p_minutes*interval '1 minute' AND p_time::time<c.slot_time::time+c.slot_minutes*interval '1 minute');
$function$;

CREATE OR REPLACE FUNCTION public.phc_confirm_paid_slot(p_order text, p_payment text, p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE booked uuid;
BEGIN
 IF p_order IS NULL OR p_order !~ '^order_[A-Za-z0-9]+$' OR p_payment IS NULL OR p_payment !~ '^pay_[A-Za-z0-9]+$' OR p_amount IS NULL OR p_amount<=0 THEN RETURN false;END IF;
 UPDATE public.online_bookings SET status='paid',paid_at=coalesce(paid_at,now()),razorpay_payment_id=coalesce(razorpay_payment_id,p_payment) WHERE razorpay_order_id=p_order AND amount_paise=p_amount AND status='held' AND (checkout_deadline IS NULL OR checkout_deadline>clock_timestamp()) AND (razorpay_payment_id IS NULL OR razorpay_payment_id=p_payment) RETURNING id INTO booked;
 RETURN booked IS NOT NULL OR EXISTS(SELECT 1 FROM public.online_bookings WHERE razorpay_order_id=p_order AND razorpay_payment_id=p_payment AND amount_paise=p_amount AND status='paid');
END $function$;

CREATE OR REPLACE FUNCTION public.phc_protect_paid_or_ordered_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN
 IF OLD.status='paid' OR OLD.status='held' AND OLD.razorpay_order_id IS NOT NULL THEN RAISE EXCEPTION 'Protected booking';END IF;RETURN OLD;END IF;
 IF NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR NEW.consultation_kind IS DISTINCT FROM OLD.consultation_kind OR NEW.slot_minutes IS DISTINCT FROM OLD.slot_minutes THEN RAISE EXCEPTION 'Financial snapshots are immutable';END IF;
 IF OLD.razorpay_order_id IS NOT NULL AND (NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id OR NEW.slot_date IS DISTINCT FROM OLD.slot_date OR NEW.slot_time IS DISTINCT FROM OLD.slot_time) THEN RAISE EXCEPTION 'Order-linked booking cannot be moved or replaced';END IF;
 IF OLD.status='paid' AND (NEW.status IS DISTINCT FROM 'paid' OR NEW.slot_date IS DISTINCT FROM OLD.slot_date OR NEW.slot_time IS DISTINCT FROM OLD.slot_time OR NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN RAISE EXCEPTION 'Paid booking is immutable';END IF;
 IF NEW.checkout_deadline IS DISTINCT FROM OLD.checkout_deadline THEN RAISE EXCEPTION 'Checkout deadline is immutable';END IF;
 IF OLD.status='held' AND OLD.razorpay_order_id IS NOT NULL AND NEW.status IN('cancelled','expired') AND NOT (NEW.status='expired' AND OLD.checkout_deadline IS NOT NULL AND OLD.checkout_deadline<=clock_timestamp()) THEN RAISE EXCEPTION 'Reconciliation required';END IF;
 IF NEW.status='paid' AND (NEW.razorpay_order_id IS NULL OR NEW.razorpay_payment_id IS NULL OR NEW.paid_at IS NULL) THEN RAISE EXCEPTION 'Payment references required';END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.phc_reserve_online_slot(p_date date, p_time text, p_mode text, p_name text, p_mobile text, p_fee integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    AND coalesce(checkout_deadline<=clock_timestamp(), razorpay_order_id IS NULL AND held_until<=now());
  INSERT INTO public.online_bookings(
    id,slot_date,slot_time,mode,patient_name,mobile,amount_paise,
    status,held_until,created_at
  ) VALUES (
    gen_random_uuid(),p_date,p_time,p_mode,btrim(p_name),p_mobile,30000,
    'held',now() + interval '15 minutes',now()
  ) RETURNING id INTO booking_id;
  RETURN booking_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.phc_reserve_online_slot_v2(p_date date, p_time text, p_mode text, p_name text, p_mobile text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c jsonb; amount integer; duration integer; booking_id uuid; patient uuid;
BEGIN
 SELECT config INTO c FROM public.phc_clinic_settings WHERE id FOR SHARE;
 IF c->>'onlineEnabled'<>'true' THEN RAISE EXCEPTION 'Online booking disabled';END IF;
 IF p_date IS NULL OR p_date<(now() AT TIME ZONE 'Asia/Kolkata')::date OR p_date>(now() AT TIME ZONE 'Asia/Kolkata')::date+90 OR p_time IS NULL OR NOT EXISTS(SELECT 1 FROM public.phc_schedule_slots(p_date,c) WHERE slot_time=p_time)
 OR (p_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND p_time::time<=(now() AT TIME ZONE 'Asia/Kolkata')::time)
 OR p_kind IS NULL OR p_kind NOT IN('new','followup') OR p_mode IS NULL OR p_mode NOT IN('audio','video') OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 80 OR p_mobile IS NULL OR p_mobile !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Invalid booking information' USING ERRCODE='22023';END IF;
 amount:=(c->>CASE WHEN p_kind='followup' THEN 'followupFeePaise' ELSE 'newFeePaise' END)::integer;duration:=(c->>'slotMinutes')::integer;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||p_date::text,0));
 IF EXISTS(SELECT 1 FROM public.phc_closures WHERE slot_date=p_date AND (slot_time IS NULL OR slot_time=p_time)) THEN RAISE EXCEPTION 'Consultations are closed for this date or time';END IF;
 UPDATE public.online_bookings SET status='expired' WHERE slot_date=p_date AND status='held' AND coalesce(checkout_deadline<=clock_timestamp(), razorpay_order_id IS NULL AND held_until<=now());
 IF EXISTS(SELECT 1 FROM public.online_bookings b WHERE b.slot_date=p_date AND b.status IN('paid','held') AND (b.status='paid' OR coalesce(b.checkout_deadline>clock_timestamp(), b.razorpay_order_id IS NOT NULL OR b.held_until>now())) AND b.slot_time::time < p_time::time+duration*interval '1 minute' AND p_time::time < b.slot_time::time+b.slot_minutes*interval '1 minute') THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
 -- Never merge by name/phone. Each unverified booking gets its own provisional profile.
 INSERT INTO public.phc_patients(full_name,mobile) VALUES(btrim(p_name),p_mobile) RETURNING id INTO patient;
 INSERT INTO public.online_bookings(slot_date,slot_time,mode,patient_name,mobile,amount_paise,consultation_kind,slot_minutes) VALUES(p_date,p_time,p_mode,btrim(p_name),p_mobile,amount,p_kind,duration) RETURNING id INTO booking_id;
 INSERT INTO public.phc_visits(patient_id,booking_id,visit_date,visit_time,kind,mode) VALUES(patient,booking_id,p_date,p_time,p_kind,p_mode);
 RETURN jsonb_build_object('id',booking_id,'amount_paise',amount,'slot_minutes',duration);
END $function$;

CREATE OR REPLACE FUNCTION public.phc_reserve_registered_followup(p_date date, p_time text, p_mode text, p_mobile text, p_registration integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c jsonb; amount integer; duration integer; booking_id uuid; patient uuid; p_name text; p_kind constant text := 'followup';
BEGIN
 SELECT id,full_name INTO patient,p_name FROM public.phc_patients
 WHERE patient_code=p_registration AND mobile=p_mobile AND merged_into IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration and mobile do not match' USING ERRCODE='P0002'; END IF;
 SELECT config INTO c FROM public.phc_clinic_settings WHERE id FOR SHARE;
 IF c->>'onlineEnabled'<>'true' THEN RAISE EXCEPTION 'Online booking disabled';END IF;
 IF p_date IS NULL OR p_date<(now() AT TIME ZONE 'Asia/Kolkata')::date OR p_date>(now() AT TIME ZONE 'Asia/Kolkata')::date+90 OR p_time IS NULL OR NOT EXISTS(SELECT 1 FROM public.phc_schedule_slots(p_date,c) WHERE slot_time=p_time)
 OR (p_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND p_time::time<=(now() AT TIME ZONE 'Asia/Kolkata')::time)
 OR p_kind IS NULL OR p_kind NOT IN('new','followup') OR p_mode IS NULL OR p_mode NOT IN('audio','video') OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 80 OR p_mobile IS NULL OR p_mobile !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Invalid booking information' USING ERRCODE='22023';END IF;
 amount:=(c->>CASE WHEN p_kind='followup' THEN 'followupFeePaise' ELSE 'newFeePaise' END)::integer;duration:=(c->>'slotMinutes')::integer;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||p_date::text,0));
 IF EXISTS(SELECT 1 FROM public.phc_closures WHERE slot_date=p_date AND (slot_time IS NULL OR slot_time=p_time)) THEN RAISE EXCEPTION 'Consultations are closed for this date or time';END IF;
 UPDATE public.online_bookings SET status='expired' WHERE slot_date=p_date AND status='held' AND coalesce(checkout_deadline<=clock_timestamp(), razorpay_order_id IS NULL AND held_until<=now());
 IF EXISTS(SELECT 1 FROM public.online_bookings b WHERE b.slot_date=p_date AND b.status IN('paid','held') AND (b.status='paid' OR coalesce(b.checkout_deadline>clock_timestamp(), b.razorpay_order_id IS NOT NULL OR b.held_until>now())) AND b.slot_time::time < p_time::time+duration*interval '1 minute' AND p_time::time < b.slot_time::time+b.slot_minutes*interval '1 minute') THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
 INSERT INTO public.online_bookings(slot_date,slot_time,mode,patient_name,mobile,amount_paise,consultation_kind,slot_minutes) VALUES(p_date,p_time,p_mode,btrim(p_name),p_mobile,amount,p_kind,duration) RETURNING id INTO booking_id;
 INSERT INTO public.phc_visits(patient_id,booking_id,visit_date,visit_time,kind,mode) VALUES(patient,booking_id,p_date,p_time,p_kind,p_mode);
 RETURN jsonb_build_object('id',booking_id,'amount_paise',amount,'slot_minutes',duration);
END $function$;
COMMIT;
