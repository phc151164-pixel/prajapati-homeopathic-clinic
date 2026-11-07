-- REVIEW FIRST. Apply to PHC Safety Test only initially, after a restorable backup.
-- Additive schema; no backfill/merge/delete of existing patients/bookings.
-- No payment activation. Keep PHC_LIVE_PAYMENTS_ENABLED=false.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.phc_protect_paid_or_ordered_booking()') IS NULL
 OR to_regclass('public.one_live_online_booking_per_slot') IS NULL THEN
 RAISE EXCEPTION 'Install and verify the reviewed booking protections first'; END IF;
END $$;
-- The audited legacy constraint allowed only :00/:30. Keep format validation
-- while allowing the configured duration to generate other minute offsets.
ALTER TABLE public.phc_closures DROP CONSTRAINT IF EXISTS phc_closures_time_format;
ALTER TABLE public.phc_closures ADD CONSTRAINT phc_closures_time_format
 CHECK(slot_time IS NULL OR slot_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
CREATE TABLE public.phc_admin_accounts (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.phc_clinic_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 config jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.phc_clinic_settings(id,config) VALUES(true,'{"slotMinutes":30,"newFeePaise":30000,"followupFeePaise":30000,"onlineEnabled":true,"payAtClinic":false,"weekly":[[["11:00","14:00"]],[["11:00","14:00"],["17:00","20:00"]],[["11:00","14:00"],["17:00","20:00"]],[["11:00","14:00"],["17:00","20:00"]],[["11:00","14:00"],["17:00","20:00"]],[["11:00","14:00"],["17:00","20:00"]],[["11:00","14:00"],["17:00","20:00"]]],"overrides":{}}');
CREATE TABLE public.phc_patients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 patient_code bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 full_name text NOT NULL CHECK(length(btrim(full_name)) BETWEEN 2 AND 80),
 mobile text NOT NULL CHECK(mobile ~ '^[0-9]{10}$'),
 admin_notes text NOT NULL DEFAULT '' CHECK(length(admin_notes)<=8000),
 registered_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 merged_into uuid REFERENCES public.phc_patients(id)
);
CREATE TABLE public.phc_visits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES public.phc_patients(id),
 booking_id uuid UNIQUE REFERENCES public.online_bookings(id),
 visit_date date NOT NULL, visit_time text NOT NULL CHECK(visit_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 kind text NOT NULL CHECK(kind IN ('new','followup')), mode text NOT NULL CHECK(mode IN ('audio','video','walkin')),
 state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','completed','cancelled','no_show')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=12000),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1
);
CREATE TABLE public.phc_audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid NOT NULL,
 action text NOT NULL, entity_id text, at timestamptz NOT NULL DEFAULT now()
 -- Deliberately excludes patient names, phone numbers, note content and credentials.
);
ALTER TABLE public.online_bookings ADD COLUMN consultation_kind text NOT NULL DEFAULT 'new' CHECK(consultation_kind IN ('new','followup'));
ALTER TABLE public.online_bookings ADD COLUMN slot_minutes integer NOT NULL DEFAULT 30 CHECK(slot_minutes BETWEEN 5 AND 180);
CREATE INDEX phc_patient_name_prefix ON public.phc_patients(lower(full_name) text_pattern_ops);
CREATE INDEX phc_patient_mobile ON public.phc_patients(mobile text_pattern_ops);
CREATE INDEX phc_visits_patient_date ON public.phc_visits(patient_id,visit_date DESC,visit_time DESC);
CREATE INDEX phc_visits_date ON public.phc_visits(visit_date,state);
-- pg_trgm supports partial-name search without scanning every patient.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX phc_patient_name_partial ON public.phc_patients USING gin(lower(full_name) extensions.gin_trgm_ops);
CREATE INDEX phc_patient_mobile_partial ON public.phc_patients USING gin(mobile extensions.gin_trgm_ops);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['phc_admin_accounts','phc_clinic_settings','phc_patients','phc_visits','phc_audit_log'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.phc_patients_patient_code_seq,public.phc_audit_log_id_seq TO service_role;

CREATE FUNCTION public.phc_require_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.phc_admin_accounts WHERE user_id=p_actor AND active) THEN
 RAISE EXCEPTION 'Administrator access denied' USING ERRCODE='42501'; END IF;
END $$;

-- A single validated schedule model is used by availability and atomic reservation.
CREATE FUNCTION public.phc_schedule_slots(p_date date,p_config jsonb DEFAULT NULL)
RETURNS TABLE(slot_time text) LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE c jsonb; ranges jsonb; r jsonb; start_min integer; end_min integer; n integer; duration integer;
BEGIN
 IF p_date IS NULL THEN RETURN; END IF;
 c:=p_config; IF c IS NULL THEN SELECT config INTO c FROM public.phc_clinic_settings WHERE id; END IF;
 duration:=(c->>'slotMinutes')::integer;
 IF duration NOT BETWEEN 5 AND 180 THEN RAISE EXCEPTION 'Invalid duration'; END IF;
 ranges:=coalesce(c->'overrides'->p_date::text,c->'weekly'->extract(dow FROM p_date)::integer);
 FOR r IN SELECT value FROM jsonb_array_elements(ranges) LOOP
 start_min:=split_part(r->>0,':',1)::integer*60+split_part(r->>0,':',2)::integer;
 end_min:=split_part(r->>1,':',1)::integer*60+split_part(r->>1,':',2)::integer;
 n:=start_min;
 WHILE n+duration<=end_min LOOP
 slot_time:=lpad((n/60)::text,2,'0')||':'||lpad((n%60)::text,2,'0');RETURN NEXT;n:=n+duration;
 END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION public.phc_validate_settings(c jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ranges jsonb; r jsonb; previous_end text; d text;
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR NOT(c ?& ARRAY['slotMinutes','newFeePaise','followupFeePaise','onlineEnabled','payAtClinic','weekly','overrides']) THEN RAISE EXCEPTION 'Missing settings';END IF;
 IF jsonb_typeof(c->'slotMinutes') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'newFeePaise') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'followupFeePaise') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'onlineEnabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c->'weekly') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'overrides') IS DISTINCT FROM 'object' OR c->'payAtClinic' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Invalid settings types';END IF;
 IF jsonb_typeof(c)<>'object' OR (c->>'slotMinutes')::integer NOT BETWEEN 5 AND 180
 OR (c->>'newFeePaise')::integer NOT BETWEEN 100 AND 10000000
 OR (c->>'followupFeePaise')::integer NOT BETWEEN 100 AND 10000000
 OR jsonb_typeof(c->'onlineEnabled')<>'boolean'
 OR c->'payAtClinic'<>'false'::jsonb
 OR jsonb_array_length(c->'weekly')<>7 OR jsonb_typeof(c->'overrides')<>'object'
 OR (SELECT count(*) FROM jsonb_object_keys(c->'overrides'))>365
 OR NOT(c ?& ARRAY['slotMinutes','newFeePaise','followupFeePaise','onlineEnabled','payAtClinic','weekly','overrides'])
 THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT jsonb_object_keys(c->'overrides') LOOP
 IF d !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR d::date<(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Invalid override date';END IF;
 END LOOP;
 FOR ranges IN SELECT value FROM jsonb_array_elements(c->'weekly') UNION ALL SELECT value FROM jsonb_each(c->'overrides') LOOP
 IF jsonb_typeof(ranges)<>'array' OR jsonb_array_length(ranges)>8 THEN RAISE EXCEPTION 'Invalid sessions';END IF;
 previous_end:='00:00';
 FOR r IN SELECT value FROM jsonb_array_elements(ranges) LOOP
 IF r->>0 IS NULL OR r->>1 IS NULL OR jsonb_typeof(r)<>'array' OR jsonb_array_length(r)<>2 OR (r->>0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 OR (r->>1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR r->>0 >= r->>1 OR r->>0<previous_end THEN RAISE EXCEPTION 'Sessions must be sorted and non-overlapping';END IF;
 previous_end:=r->>1;
 END LOOP;
 END LOOP;
END $$;

-- Read/write RPCs are service-role only; actor is taken from validated Auth user by server.
CREATE FUNCTION public.phc_dashboard_read(p_actor uuid,p_section text,p_filter jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 WHERE p.merged_into IS NULL AND (q='' OR lower(p.full_name) LIKE '%'||lower(replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_'))||'%' ESCAPE '\'
 OR p.mobile LIKE '%'||q||'%' OR 'PHC-'||lpad(p.patient_code::text,6,'0') ILIKE q||'%')
 AND (NOT coalesce((p_filter->>'filter_visits')::boolean,false) OR EXISTS(SELECT 1 FROM public.phc_visits v LEFT JOIN public.online_bookings b ON b.id=v.booking_id WHERE v.patient_id=p.id AND v.visit_date BETWEEN f AND t AND (coalesce(p_filter->>'kind','')='' OR v.kind=p_filter->>'kind') AND (coalesce(p_filter->>'status','')='' OR v.state=p_filter->>'status' OR b.status=p_filter->>'status')))
 ORDER BY p.patient_code DESC LIMIT 31 OFFSET page_no*30)x;
 ELSIF p_section='patient' THEN
 SELECT jsonb_build_object('patient',to_jsonb(p)||jsonb_build_object('patient_id','PHC-'||lpad(p.patient_code::text,6,'0')),
 'visits',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT v.*,b.status payment_status,b.amount_paise,b.razorpay_order_id FROM public.phc_visits v LEFT JOIN public.online_bookings b ON b.id=v.booking_id WHERE v.patient_id=p.id ORDER BY visit_date DESC,visit_time DESC LIMIT 100 OFFSET page_no*100)x),'[]'::jsonb),
 'source_profiles',coalesce((SELECT jsonb_agg(jsonb_build_object('patient_id','PHC-'||lpad(a.patient_code::text,6,'0'),'notes',a.admin_notes)) FROM public.phc_patients a WHERE a.merged_into=p.id),'[]'::jsonb),
 'summary',(SELECT jsonb_build_object('completed',count(*) FILTER(WHERE state='completed'),'first',min(visit_date),'latest',max(visit_date),'upcoming',count(*) FILTER(WHERE state='planned' AND visit_date>=(now() AT TIME ZONE 'Asia/Kolkata')::date)) FROM public.phc_visits WHERE patient_id=p.id)) INTO result FROM public.phc_patients p WHERE p.id=pid;
 ELSIF p_section IN ('appointments','overview','calendar') THEN
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb),'page',page_no) INTO result FROM (
 SELECT b.id,b.slot_date,b.slot_time,b.mode,b.patient_name,b.mobile,b.status,b.amount_paise,b.paid_at,b.consultation_kind,b.slot_minutes,b.held_until,
 v.id visit_id,v.patient_id,v.state visit_state,v.version visit_version,
 (b.status='paid' OR b.status='held' AND (b.razorpay_order_id IS NOT NULL OR b.held_until>now())) reserved
 FROM public.online_bookings b LEFT JOIN public.phc_visits v ON v.booking_id=b.id
 WHERE b.slot_date BETWEEN f AND t AND (coalesce(p_filter->>'status','')='' OR b.status=p_filter->>'status' OR v.state=p_filter->>'status')
 AND (coalesce(p_filter->>'kind','')='' OR b.consultation_kind=p_filter->>'kind')
 ORDER BY b.slot_date,b.slot_time LIMIT 31 OFFSET page_no*30)x;
 IF p_section='calendar' THEN result:=result||jsonb_build_object('slots',(SELECT coalesce(jsonb_agg(slot_time),'[]'::jsonb) FROM public.phc_schedule_slots(f)), 'closures',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.phc_closures c WHERE slot_date=f)); END IF;
 ELSIF p_section='audit' THEN
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) INTO result FROM(SELECT action,entity_id,at FROM public.phc_audit_log ORDER BY id DESC LIMIT 31 OFFSET page_no*30)x;
 ELSE RAISE EXCEPTION 'Unknown section';END IF;
 INSERT INTO public.phc_audit_log(actor,action,entity_id) VALUES(p_actor,'read:'||p_section,pid::text);
 RETURN coalesce(result,'{}'::jsonb);
END $$;

CREATE FUNCTION public.phc_dashboard_write(p_actor uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_patient uuid; entity uuid; v public.phc_visits%rowtype; booking_record public.online_bookings%rowtype; c jsonb; d date; tm text; conflict boolean; result jsonb; changed integer;
BEGIN
 PERFORM public.phc_require_admin(p_actor);
 IF p_action='patient_merge' THEN
 entity:=(p_data->>'source_id')::uuid;
 IF p_data->>'identity_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirm patient identity first';END IF;
 SELECT id INTO STRICT target_patient FROM public.phc_patients WHERE 'PHC-'||lpad(patient_code::text,6,'0')=upper(p_data->>'target_code') AND merged_into IS NULL;
 IF target_patient=entity THEN RAISE EXCEPTION 'Choose a different profile';END IF;
 -- Deterministic row lock order prevents cross-merge deadlocks.
 PERFORM id FROM public.phc_patients WHERE id IN(entity,target_patient) ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.phc_patients WHERE id=entity AND merged_into IS NULL AND version=(p_data->>'version')::integer) OR EXISTS(SELECT 1 FROM public.phc_patients WHERE id=target_patient AND merged_into IS NOT NULL) THEN RAISE EXCEPTION 'Profile changed; reload';END IF;
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
 UPDATE public.phc_patients SET full_name=btrim(p_data->>'name'),mobile=p_data->>'mobile',admin_notes=coalesce(p_data->>'notes',''),updated_at=now(),version=version+1 WHERE id=entity AND merged_into IS NULL AND version=(p_data->>'version')::integer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record changed; reload before editing';END IF;
 END IF;
 ELSIF p_action='visit_save' THEN
 IF NOT EXISTS(SELECT 1 FROM public.phc_patients WHERE id=(p_data->>'patient_id')::uuid AND merged_into IS NULL) THEN RAISE EXCEPTION 'Use active patient profile';END IF;
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
 IF EXISTS(SELECT 1 FROM public.phc_visits WHERE booking_id=booking_record.id) THEN RAISE EXCEPTION 'PHC_IDENTITY_REVIEW';END IF;
 IF p_data->>'identity_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirm patient identity first';END IF;
 SELECT id INTO STRICT target_patient FROM public.phc_patients WHERE 'PHC-'||lpad(patient_code::text,6,'0')=upper(p_data->>'patient_code') AND merged_into IS NULL;
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
END $$;

CREATE FUNCTION public.phc_public_schedule(p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('slotMinutes',config->'slotMinutes','newFeePaise',config->'newFeePaise','followupFeePaise',config->'followupFeePaise','onlineEnabled',config->'onlineEnabled','slots',(SELECT coalesce(jsonb_agg(slot_time),'[]'::jsonb) FROM public.phc_schedule_slots(p_date))) FROM public.phc_clinic_settings WHERE id;
$$;
-- V2 reservation snapshots the authoritative fee and duration inside the DB lock.
CREATE FUNCTION public.phc_reserve_online_slot_v2(p_date date,p_time text,p_mode text,p_name text,p_mobile text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 UPDATE public.online_bookings SET status='expired' WHERE slot_date=p_date AND status='held' AND razorpay_order_id IS NULL AND held_until<=now();
 IF EXISTS(SELECT 1 FROM public.online_bookings b WHERE b.slot_date=p_date AND b.status IN('paid','held') AND (b.status='paid' OR b.razorpay_order_id IS NOT NULL OR b.held_until>now()) AND b.slot_time::time < p_time::time+duration*interval '1 minute' AND p_time::time < b.slot_time::time+b.slot_minutes*interval '1 minute') THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
 -- Never merge by name/phone. Each unverified booking gets its own provisional profile.
 INSERT INTO public.phc_patients(full_name,mobile) VALUES(btrim(p_name),p_mobile) RETURNING id INTO patient;
 INSERT INTO public.online_bookings(slot_date,slot_time,mode,patient_name,mobile,amount_paise,consultation_kind,slot_minutes) VALUES(p_date,p_time,p_mode,btrim(p_name),p_mobile,amount,p_kind,duration) RETURNING id INTO booking_id;
 INSERT INTO public.phc_visits(patient_id,booking_id,visit_date,visit_time,kind,mode) VALUES(patient,booking_id,p_date,p_time,p_kind,p_mode);
 RETURN jsonb_build_object('id',booking_id,'amount_paise',amount,'slot_minutes',duration);
END $$;
-- Confirmation uses immutable stored booking amount, never the current configured fee.
CREATE OR REPLACE FUNCTION public.phc_confirm_paid_slot(p_order text,p_payment text,p_amount integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE booked uuid;
BEGIN
 IF p_order IS NULL OR p_order !~ '^order_[A-Za-z0-9]+$' OR p_payment IS NULL OR p_payment !~ '^pay_[A-Za-z0-9]+$' OR p_amount IS NULL OR p_amount<=0 THEN RETURN false;END IF;
 UPDATE public.online_bookings SET status='paid',paid_at=coalesce(paid_at,now()),razorpay_payment_id=coalesce(razorpay_payment_id,p_payment) WHERE razorpay_order_id=p_order AND amount_paise=p_amount AND status='held' AND (razorpay_payment_id IS NULL OR razorpay_payment_id=p_payment) RETURNING id INTO booked;
 RETURN booked IS NOT NULL OR EXISTS(SELECT 1 FROM public.online_bookings WHERE razorpay_order_id=p_order AND razorpay_payment_id=p_payment AND amount_paise=p_amount AND status='paid');
END $$;
-- Stronger guard retains original protections and makes financial snapshots immutable.
CREATE OR REPLACE FUNCTION public.phc_protect_paid_or_ordered_booking()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
 IF OLD.status='paid' OR OLD.status='held' AND OLD.razorpay_order_id IS NOT NULL THEN RAISE EXCEPTION 'Protected booking';END IF;RETURN OLD;END IF;
 IF NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR NEW.consultation_kind IS DISTINCT FROM OLD.consultation_kind OR NEW.slot_minutes IS DISTINCT FROM OLD.slot_minutes THEN RAISE EXCEPTION 'Financial snapshots are immutable';END IF;
 IF OLD.razorpay_order_id IS NOT NULL AND (NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id OR NEW.slot_date IS DISTINCT FROM OLD.slot_date OR NEW.slot_time IS DISTINCT FROM OLD.slot_time) THEN RAISE EXCEPTION 'Order-linked booking cannot be moved or replaced';END IF;
 IF OLD.status='paid' AND (NEW.status IS DISTINCT FROM 'paid' OR NEW.slot_date IS DISTINCT FROM OLD.slot_date OR NEW.slot_time IS DISTINCT FROM OLD.slot_time OR NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN RAISE EXCEPTION 'Paid booking is immutable';END IF;
 IF OLD.status='held' AND OLD.razorpay_order_id IS NOT NULL AND NEW.status IN('cancelled','expired') THEN RAISE EXCEPTION 'Reconciliation required';END IF;
 IF NEW.status='paid' AND (NEW.razorpay_order_id IS NULL OR NEW.razorpay_payment_id IS NULL OR NEW.paid_at IS NULL) THEN RAISE EXCEPTION 'Payment references required';END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['phc_require_admin(uuid)','phc_schedule_slots(date,jsonb)','phc_validate_settings(jsonb)','phc_dashboard_read(uuid,text,jsonb)','phc_dashboard_write(uuid,text,jsonb)','phc_public_schedule(date)','phc_reserve_online_slot_v2(date,text,text,text,text,text)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO service_role';
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.phc_confirm_paid_slot(text,text,integer),public.phc_protect_paid_or_ordered_booking() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phc_confirm_paid_slot(text,text,integer) TO service_role;
COMMIT;
