ALTER TABLE public.phc_patients ADD COLUMN registration_pending boolean NOT NULL DEFAULT false;
-- Identify profiles created by the old online hold transaction. Preserve their IDs and history.
UPDATE public.phc_patients p SET registration_pending=true
WHERE p.merged_into IS NULL
AND EXISTS (
 SELECT 1 FROM public.phc_visits v JOIN public.online_bookings b ON b.id=v.booking_id
 WHERE v.patient_id=p.id AND b.status<>'paid' AND b.created_at=p.registered_at
)
AND NOT EXISTS (
 SELECT 1 FROM public.phc_visits v LEFT JOIN public.online_bookings b ON b.id=v.booking_id
 WHERE v.patient_id=p.id AND (b.id IS NULL OR b.status='paid')
);

CREATE FUNCTION public.phc_register_paid_online_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE patient uuid;
BEGIN
 SELECT v.patient_id INTO patient FROM public.phc_visits v WHERE v.booking_id=NEW.id;
 IF FOUND THEN
  UPDATE public.phc_patients SET registration_pending=false WHERE id=patient AND registration_pending;
 ELSE
  INSERT INTO public.phc_patients(full_name,mobile) VALUES(NEW.patient_name,NEW.mobile) RETURNING id INTO patient;
  INSERT INTO public.phc_visits(patient_id,booking_id,visit_date,visit_time,kind,mode)
  VALUES(patient,NEW.id,NEW.slot_date,NEW.slot_time,NEW.consultation_kind,NEW.mode);
 END IF;
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.phc_register_paid_online_booking() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER phc_register_paid_online_booking
AFTER UPDATE OF status ON public.online_bookings
FOR EACH ROW WHEN (NEW.status='paid' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.phc_register_paid_online_booking();

CREATE OR REPLACE FUNCTION public.phc_reserve_online_slot_v2(p_date date, p_time text, p_mode text, p_name text, p_mobile text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c jsonb; amount integer; duration integer; booking_id uuid;
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
 INSERT INTO public.online_bookings(slot_date,slot_time,mode,patient_name,mobile,amount_paise,consultation_kind,slot_minutes) VALUES(p_date,p_time,p_mode,btrim(p_name),p_mobile,amount,p_kind,duration) RETURNING id INTO booking_id;
 RETURN jsonb_build_object('id',booking_id,'amount_paise',amount,'slot_minutes',duration);
END $function$;

CREATE OR REPLACE FUNCTION public.phc_dashboard_read(p_actor uuid, p_section text, p_filter jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb; f date; t date; q text; page_no integer; pid uuid;
BEGIN
 PERFORM public.phc_require_admin(p_actor);
 f:=coalesce((p_filter->>'from')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date);
 t:=coalesce((p_filter->>'to')::date,f+30);q:=btrim(coalesce(p_filter->>'search',''));
 page_no:=greatest(0,least(coalesce((p_filter->>'page')::integer,0),100000));pid:=(p_filter->>'patient_id')::uuid;
 IF t<f OR t>f+366 THEN RAISE EXCEPTION 'Date range must be at most 366 days'; END IF;
 IF p_section='settings' THEN
 SELECT jsonb_build_object('config',config,'version',version) INTO result FROM public.phc_clinic_settings WHERE id;
 ELSIF p_section='patients' THEN
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb),'page',page_no) INTO result FROM (
 SELECT p.id,'PHC-'||lpad(p.patient_code::text,6,'0') patient_id,p.full_name,p.mobile,p.registered_at,p.version,
 (SELECT count(*) FROM public.phc_visits v WHERE v.patient_id=p.id AND state='completed') completed_visits
 FROM public.phc_patients p
 WHERE p.merged_into IS NULL AND NOT p.registration_pending AND (q='' OR lower(p.full_name) LIKE '%'||lower(replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_'))||'%' ESCAPE '\'
 OR p.mobile LIKE '%'||q||'%' OR 'PHC-'||lpad(p.patient_code::text,6,'0') ILIKE q||'%')
 AND (NOT coalesce((p_filter->>'filter_visits')::boolean,false) OR EXISTS(SELECT 1 FROM public.phc_visits v LEFT JOIN public.online_bookings b ON b.id=v.booking_id WHERE v.patient_id=p.id AND v.visit_date BETWEEN f AND t AND (coalesce(p_filter->>'kind','')='' OR v.kind=p_filter->>'kind') AND (coalesce(p_filter->>'status','')='' OR v.state=p_filter->>'status' OR b.status=p_filter->>'status')))
 ORDER BY p.patient_code DESC LIMIT 31 OFFSET page_no*30)x;
 ELSIF p_section='patient' THEN
 SELECT jsonb_build_object('patient',to_jsonb(p)||jsonb_build_object('patient_id','PHC-'||lpad(p.patient_code::text,6,'0')),
 'visits',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT v.*,CASE WHEN cr.id IS NULL THEN b.status WHEN cr.status='cancelled' THEN 'cancelled' WHEN cash.id IS NOT NULL THEN 'clinic_paid' ELSE 'clinic_due' END payment_status,coalesce(b.amount_paise,cr.amount_paise) amount_paise,b.razorpay_order_id,cash.receipt_number FROM public.phc_visits v LEFT JOIN public.online_bookings b ON b.id=v.booking_id LEFT JOIN public.phc_clinic_requests cr ON cr.id=v.clinic_request_id LEFT JOIN public.phc_cash_receipts cash ON cash.clinic_request_id=cr.id WHERE v.patient_id=p.id AND (b.id IS NULL OR b.status='paid') ORDER BY visit_date DESC,visit_time DESC LIMIT 100 OFFSET page_no*100)x),'[]'::jsonb),
 'source_profiles',coalesce((SELECT jsonb_agg(jsonb_build_object('patient_id','PHC-'||lpad(a.patient_code::text,6,'0'),'notes',a.admin_notes)) FROM public.phc_patients a WHERE a.merged_into=p.id),'[]'::jsonb),
 'summary',(SELECT jsonb_build_object('completed',count(*) FILTER(WHERE state='completed'),'first',min(visit_date),'latest',max(visit_date),'upcoming',count(*) FILTER(WHERE state='planned' AND visit_date>=(now() AT TIME ZONE 'Asia/Kolkata')::date)) FROM public.phc_visits WHERE patient_id=p.id)) INTO result FROM public.phc_patients p WHERE p.id=pid AND NOT p.registration_pending;
 ELSIF p_section IN ('appointments','overview','calendar') THEN
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb),'page',page_no) INTO result FROM (
 SELECT b.id,b.slot_date,b.slot_time,b.mode,b.patient_name,b.mobile,b.status,b.amount_paise,b.paid_at,b.consultation_kind,b.slot_minutes,b.held_until,
 v.id visit_id,v.patient_id,v.state visit_state,v.version visit_version,
 (b.status='paid' OR b.status='held' AND (b.razorpay_order_id IS NOT NULL OR b.held_until>now())) reserved
 FROM public.online_bookings b LEFT JOIN public.phc_visits v ON v.booking_id=b.id
 WHERE (p_section='calendar' OR b.status='paid') AND b.slot_date BETWEEN f AND t AND (coalesce(p_filter->>'status','')='' OR b.status=p_filter->>'status' OR v.state=p_filter->>'status')
 AND (coalesce(p_filter->>'kind','')='' OR b.consultation_kind=p_filter->>'kind')
 UNION ALL
 SELECT c.id,c.slot_date,c.slot_time,c.mode,c.patient_name,c.mobile,CASE WHEN r.id IS NULL THEN 'clinic_due' ELSE 'clinic_paid' END,c.amount_paise,r.received_at,c.consultation_kind,c.slot_minutes,NULL::timestamptz,v.id,v.patient_id,v.state,v.version,true
 FROM public.phc_clinic_requests c JOIN public.phc_visits v ON v.clinic_request_id=c.id LEFT JOIN public.phc_cash_receipts r ON r.clinic_request_id=c.id
 WHERE c.status='confirmed' AND c.slot_date BETWEEN f AND t AND (coalesce(p_filter->>'status','')='' OR (CASE WHEN r.id IS NULL THEN 'clinic_due' ELSE 'clinic_paid' END)=p_filter->>'status' OR v.state=p_filter->>'status') AND (coalesce(p_filter->>'kind','')='' OR c.consultation_kind=p_filter->>'kind')
 ORDER BY slot_date,slot_time LIMIT CASE WHEN p_section='calendar' THEN 1000 ELSE 31 END OFFSET CASE WHEN p_section='calendar' THEN 0 ELSE page_no*30 END)x;
 IF p_section='calendar' THEN result:=result||jsonb_build_object('slots',(SELECT coalesce(jsonb_agg(slot_time),'[]'::jsonb) FROM public.phc_schedule_slots(f)), 'closures',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.phc_closures c WHERE slot_date=f)); END IF;
 ELSIF p_section='unpaid' THEN
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]'::jsonb),'page',page_no)
 INTO result FROM (
 SELECT b.id,b.patient_name,b.mobile,b.created_at,b.slot_date,b.slot_time,b.consultation_kind,b.mode,b.amount_paise,
 CASE WHEN b.status='held' AND coalesce(b.checkout_deadline<=clock_timestamp(),b.razorpay_order_id IS NULL AND b.held_until<=now()) THEN 'expired' ELSE b.status END AS status
 FROM public.online_bookings b
 WHERE b.status<>'paid'
 AND b.created_at>=f::timestamp AT TIME ZONE 'Asia/Kolkata'
 AND b.created_at<(t+1)::timestamp AT TIME ZONE 'Asia/Kolkata'
 AND (q='' OR strpos(lower(b.patient_name),lower(q))>0 OR strpos(b.mobile,q)>0)
 ORDER BY b.created_at DESC,b.id DESC LIMIT 31 OFFSET page_no*30
 ) x;
 ELSIF p_section='audit' THEN
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) INTO result FROM(SELECT action,entity_id,at FROM public.phc_audit_log ORDER BY id DESC LIMIT 31 OFFSET page_no*30)x;
 ELSE RAISE EXCEPTION 'Unknown section';END IF;
 INSERT INTO public.phc_audit_log(actor,action,entity_id) VALUES(p_actor,'read:'||p_section,pid::text);
 RETURN coalesce(result,'{}'::jsonb);
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
 WHERE patient_code=p_registration AND mobile=p_mobile AND merged_into IS NULL AND NOT registration_pending FOR SHARE;
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

CREATE OR REPLACE FUNCTION public.phc_dashboard_write(p_actor uuid, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE target_patient uuid; entity uuid; v public.phc_visits%rowtype; booking_record public.online_bookings%rowtype; c jsonb; d date; tm text; conflict boolean; result jsonb; changed integer;
BEGIN
 PERFORM public.phc_require_admin(p_actor);
 IF p_action='patient_merge' THEN
 entity:=(p_data->>'source_id')::uuid;
 IF p_data->>'identity_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirm patient identity first';END IF;
 SELECT id INTO STRICT target_patient FROM public.phc_patients WHERE 'PHC-'||lpad(patient_code::text,6,'0')=upper(p_data->>'target_code') AND merged_into IS NULL AND NOT registration_pending;
 IF target_patient=entity THEN RAISE EXCEPTION 'Choose a different profile';END IF;
 -- Deterministic row lock order prevents cross-merge deadlocks.
 PERFORM id FROM public.phc_patients WHERE id IN(entity,target_patient) ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.phc_patients WHERE id=entity AND merged_into IS NULL AND NOT registration_pending AND version=(p_data->>'version')::integer) OR EXISTS(SELECT 1 FROM public.phc_patients WHERE id=target_patient AND merged_into IS NOT NULL) THEN RAISE EXCEPTION 'Profile changed; reload';END IF;
 UPDATE public.phc_visits SET patient_id=target_patient,version=version+1,updated_at=now() WHERE patient_id=entity;
 UPDATE public.phc_patients SET merged_into=target_patient,version=version+1,updated_at=now() WHERE id=entity OR merged_into=entity;
 INSERT INTO public.phc_audit_log(actor,action,entity_id)VALUES(p_actor,'patient_merge_target',target_patient::text);
 entity:=target_patient;
 ELSIF p_action='patient_save' THEN
 entity:=(p_data->>'id')::uuid;
 IF length(btrim(p_data->>'name')) NOT BETWEEN 2 AND 80 OR (p_data->>'mobile') !~ '^[0-9]{10}$' OR length(coalesce(p_data->>'notes',''))>8000 OR NOT(p_data ?& ARRAY['name','mobile']) THEN RAISE EXCEPTION 'Invalid patient';END IF;
 IF entity IS NULL THEN
 INSERT INTO public.phc_patients(full_name,mobile,admin_notes) VALUES(btrim(p_data->>'name'),p_data->>'mobile',coalesce(p_data->>'notes','')) RETURNING id INTO entity;
 ELSE
 UPDATE public.phc_patients SET full_name=btrim(p_data->>'name'),mobile=p_data->>'mobile',admin_notes=coalesce(p_data->>'notes',''),updated_at=now(),version=version+1 WHERE id=entity AND merged_into IS NULL AND NOT registration_pending AND version=(p_data->>'version')::integer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record changed; reload before editing';END IF;
 END IF;
 ELSIF p_action='visit_save' THEN
 IF NOT EXISTS(SELECT 1 FROM public.phc_patients WHERE id=(p_data->>'patient_id')::uuid AND merged_into IS NULL AND NOT registration_pending) THEN RAISE EXCEPTION 'Use active patient profile';END IF;
 entity:=(p_data->>'id')::uuid;
 d:=(p_data->>'date')::date;tm:=p_data->>'time';
 IF d IS NULL OR d<'2000-01-01' OR d>'2100-12-31' OR tm IS NULL OR tm !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p_data->>'kind' NOT IN('new','followup') OR p_data->>'mode' NOT IN('audio','video','walkin') OR length(coalesce(p_data->>'notes',''))>12000 THEN RAISE EXCEPTION 'Invalid visit';END IF;
 IF entity IS NULL THEN
 -- Manual visit history / follow-up plan only; it is never a public slot reservation or paid booking.
 INSERT INTO public.phc_visits(patient_id,visit_date,visit_time,kind,mode,notes) VALUES((p_data->>'patient_id')::uuid,d,tm,p_data->>'kind',p_data->>'mode',coalesce(p_data->>'notes','')) RETURNING id INTO entity;
 ELSE
 SELECT * INTO STRICT v FROM public.phc_visits WHERE id=entity FOR UPDATE;
 IF v.booking_id IS NOT NULL AND (v.visit_date<>d OR v.visit_time<>tm OR v.mode<>p_data->>'mode' OR v.kind<>p_data->>'kind') THEN RAISE EXCEPTION 'PHC_PAYMENT_PROTECTED';END IF;
 UPDATE public.phc_visits SET visit_date=d,visit_time=tm,kind=p_data->>'kind',mode=p_data->>'mode',notes=coalesce(p_data->>'notes',''),updated_at=now(),version=version+1 WHERE id=entity AND version=(p_data->>'version')::integer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record changed; reload before editing';END IF;
 END IF;
 ELSIF p_action='link_booking' THEN
 SELECT * INTO STRICT booking_record FROM public.online_bookings WHERE id=(p_data->>'booking_id')::uuid FOR UPDATE;
 IF booking_record.status<>'paid' THEN RAISE EXCEPTION 'PHC_PAYMENT_PROTECTED';END IF;
 IF EXISTS(SELECT 1 FROM public.phc_visits WHERE booking_id=booking_record.id) THEN RAISE EXCEPTION 'PHC_IDENTITY_REVIEW';END IF;
 IF p_data->>'identity_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirm patient identity first';END IF;
 SELECT id INTO STRICT target_patient FROM public.phc_patients WHERE 'PHC-'||lpad(patient_code::text,6,'0')=upper(p_data->>'patient_code') AND merged_into IS NULL AND NOT registration_pending;
 INSERT INTO public.phc_visits(patient_id,booking_id,visit_date,visit_time,kind,mode) VALUES(target_patient,booking_record.id,booking_record.slot_date,booking_record.slot_time,booking_record.consultation_kind,booking_record.mode) RETURNING id INTO entity;
 ELSIF p_action='visit_status' THEN
 entity:=(p_data->>'id')::uuid;
 SELECT * INTO STRICT v FROM public.phc_visits WHERE id=entity FOR UPDATE;
 IF p_data->>'state' NOT IN ('completed','cancelled','no_show','planned') OR NOT(p_data?'state') THEN RAISE EXCEPTION 'Invalid visit state';END IF;
 IF v.booking_id IS NOT NULL THEN
 SELECT * INTO STRICT booking_record FROM public.online_bookings WHERE id=v.booking_id;
 IF booking_record.status<>'paid' OR p_data->>'state'='cancelled' THEN RAISE EXCEPTION 'PHC_PAYMENT_PROTECTED';END IF;
 END IF;
 IF p_data->>'state'='completed' AND (v.visit_date>(now() AT TIME ZONE 'Asia/Kolkata')::date OR (v.visit_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND v.visit_time>(now() AT TIME ZONE 'Asia/Kolkata')::time::text)) THEN RAISE EXCEPTION 'Future visit cannot be completed';END IF;
 UPDATE public.phc_visits SET state=p_data->>'state',updated_at=now(),version=version+1 WHERE id=entity AND version=(p_data->>'version')::integer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record changed; reload before editing';END IF;
 ELSIF p_action='settings_save' THEN
 c:=p_data->'config';PERFORM public.phc_validate_settings(c);
 -- Global lock order: settings first, date second. Reservations use same order.
 PERFORM 1 FROM public.phc_clinic_settings WHERE id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM public.online_bookings b WHERE b.slot_date>=(now() AT TIME ZONE 'Asia/Kolkata')::date AND (b.status='paid' OR b.status='held' AND (b.razorpay_order_id IS NOT NULL OR b.held_until>now())) AND (b.slot_minutes<>(c->>'slotMinutes')::integer OR NOT EXISTS(SELECT 1 FROM public.phc_schedule_slots(b.slot_date,c) s WHERE s.slot_time=b.slot_time))) INTO conflict;
 IF conflict THEN RAISE EXCEPTION 'PHC_SCHEDULE_CONFLICT';END IF;
 UPDATE public.phc_clinic_settings SET config=c,version=version+1,updated_at=now() WHERE id AND version=(p_data->>'version')::integer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings changed; reload before editing';END IF;
 ELSIF p_action='closure' THEN
 d:=(p_data->>'date')::date;tm:=nullif(p_data->>'time','');
 IF d IS NULL OR d<(now() AT TIME ZONE 'Asia/Kolkata')::date OR d>(now() AT TIME ZONE 'Asia/Kolkata')::date+365 OR NOT(p_data?'closed') OR jsonb_typeof(p_data->'closed')<>'boolean' THEN RAISE EXCEPTION 'Invalid closure';END IF;
 PERFORM 1 FROM public.phc_clinic_settings WHERE id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||d::text,0));
 IF tm IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.phc_schedule_slots(d) WHERE slot_time=tm) THEN RAISE EXCEPTION 'Invalid slot';END IF;
 IF (p_data->>'closed')::boolean THEN
 IF EXISTS(SELECT 1 FROM public.online_bookings WHERE slot_date=d AND (tm IS NULL OR slot_time=tm) AND (status='paid' OR status='held' AND (razorpay_order_id IS NOT NULL OR held_until>now()))) THEN RAISE EXCEPTION 'PHC_SCHEDULE_CONFLICT';END IF;
 INSERT INTO public.phc_closures(slot_date,slot_time,reason) VALUES(d,tm,left(coalesce(p_data->>'reason','Doctor unavailable'),120)) ON CONFLICT(slot_date,(coalesce(slot_time,'ALL_DAY'))) DO UPDATE SET reason=excluded.reason;
 ELSE DELETE FROM public.phc_closures WHERE slot_date=d AND slot_time IS NOT DISTINCT FROM tm;END IF;
 ELSE RAISE EXCEPTION 'Unknown action';END IF;
 INSERT INTO public.phc_audit_log(actor,action,entity_id) VALUES(p_actor,p_action,entity::text);
 RETURN jsonb_build_object('id',entity,'saved',true);
END $function$;
