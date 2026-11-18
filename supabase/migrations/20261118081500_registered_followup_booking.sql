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
 UPDATE public.online_bookings SET status='expired' WHERE slot_date=p_date AND status='held' AND razorpay_order_id IS NULL AND held_until<=now();
 IF EXISTS(SELECT 1 FROM public.online_bookings b WHERE b.slot_date=p_date AND b.status IN('paid','held') AND (b.status='paid' OR b.razorpay_order_id IS NOT NULL OR b.held_until>now()) AND b.slot_time::time < p_time::time+duration*interval '1 minute' AND p_time::time < b.slot_time::time+b.slot_minutes*interval '1 minute') THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
 INSERT INTO public.online_bookings(slot_date,slot_time,mode,patient_name,mobile,amount_paise,consultation_kind,slot_minutes) VALUES(p_date,p_time,p_mode,btrim(p_name),p_mobile,amount,p_kind,duration) RETURNING id INTO booking_id;
 INSERT INTO public.phc_visits(patient_id,booking_id,visit_date,visit_time,kind,mode) VALUES(patient,booking_id,p_date,p_time,p_kind,p_mode);
 RETURN jsonb_build_object('id',booking_id,'amount_paise',amount,'slot_minutes',duration);
END $function$
;
REVOKE ALL ON FUNCTION public.phc_reserve_registered_followup(date,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phc_reserve_registered_followup(date,text,text,text,integer) TO service_role;
