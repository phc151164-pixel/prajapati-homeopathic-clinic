-- REVIEW FIRST: doctor-approved Pay at Clinic requests. Default payment setting stays OFF.
-- Staging first. No existing booking, patient, visit, receipt or settings row is rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.phc_require_admin(uuid)') IS NULL OR to_regprocedure('public.phc_reserve_online_slot_v2(date,text,text,text,text,text)') IS NULL THEN RAISE EXCEPTION 'Dashboard V2 is required';END IF;
END $$;
CREATE TABLE public.phc_clinic_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 slot_date date NOT NULL,slot_time text NOT NULL CHECK(slot_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 patient_name text NOT NULL CHECK(length(btrim(patient_name)) BETWEEN 2 AND 80),
 mobile text NOT NULL CHECK(mobile ~ '^[0-9]{10}$'),
 mode text NOT NULL CHECK(mode IN('audio','video')),
 consultation_kind text NOT NULL CHECK(consultation_kind IN('new','followup')),
 amount_paise integer NOT NULL CHECK(amount_paise BETWEEN 100 AND 10000000),
 slot_minutes integer NOT NULL CHECK(slot_minutes BETWEEN 5 AND 180),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','confirmed','declined','cancelled')),
 patient_id uuid REFERENCES public.phc_patients(id),
 approved_by uuid REFERENCES public.phc_admin_accounts(user_id),
 approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1,
 CHECK(status NOT IN('confirmed','cancelled') OR (patient_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX phc_clinic_requests_date_status ON public.phc_clinic_requests(slot_date,status,slot_time);
CREATE INDEX phc_clinic_requests_mobile_pending ON public.phc_clinic_requests(mobile,created_at) WHERE status='requested';
CREATE UNIQUE INDEX phc_clinic_confirmed_slot ON public.phc_clinic_requests(slot_date,slot_time) WHERE status='confirmed';
CREATE TABLE public.phc_cash_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receipt_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 clinic_request_id uuid NOT NULL UNIQUE REFERENCES public.phc_clinic_requests(id),
 amount_paise integer NOT NULL CHECK(amount_paise>0),
 received_by uuid NOT NULL REFERENCES public.phc_admin_accounts(user_id),received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.phc_visits ADD COLUMN clinic_request_id uuid UNIQUE REFERENCES public.phc_clinic_requests(id);
ALTER TABLE public.phc_visits ADD CONSTRAINT phc_visit_one_payment_source CHECK(booking_id IS NULL OR clinic_request_id IS NULL);
ALTER TABLE public.phc_clinic_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phc_cash_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phc_clinic_requests,public.phc_cash_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.phc_clinic_requests TO service_role;
GRANT SELECT,INSERT ON public.phc_cash_receipts TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.phc_cash_receipts_receipt_number_seq TO service_role;

-- Reuse the existing date lock for every booking method, including legacy reservation calls.
CREATE FUNCTION public.phc_clinic_slot_free(p_date date,p_time text,p_minutes integer,p_ignore uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.online_bookings b WHERE b.slot_date=p_date AND (b.status='paid' OR b.status='held' AND (b.razorpay_order_id IS NOT NULL OR b.held_until>now()))
 AND b.slot_time::time<p_time::time+p_minutes*interval '1 minute' AND p_time::time<b.slot_time::time+b.slot_minutes*interval '1 minute')
 AND NOT EXISTS(SELECT 1 FROM public.phc_clinic_requests c WHERE c.slot_date=p_date AND c.status='confirmed' AND c.id IS DISTINCT FROM p_ignore
 AND c.slot_time::time<p_time::time+p_minutes*interval '1 minute' AND p_time::time<c.slot_time::time+c.slot_minutes*interval '1 minute');
$$;
CREATE FUNCTION public.phc_protect_clinic_records() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='phc_cash_receipts' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cash receipts are immutable';END IF;
  PERFORM 1 FROM public.phc_clinic_requests WHERE id=NEW.clinic_request_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.phc_clinic_requests WHERE id=NEW.clinic_request_id AND status='confirmed' AND amount_paise=NEW.amount_paise) THEN RAISE EXCEPTION 'Cash receipt requires a confirmed clinic appointment and exact saved fee';END IF;
  PERFORM public.phc_require_admin(NEW.received_by);RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND NEW.status<>'requested' THEN RAISE EXCEPTION 'Clinic requests start unconfirmed';END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clinic request history cannot be deleted';END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.slot_date,NEW.slot_time,NEW.amount_paise,NEW.slot_minutes,NEW.patient_name,NEW.mobile,NEW.mode,NEW.consultation_kind,NEW.request_key) IS DISTINCT FROM ROW(OLD.slot_date,OLD.slot_time,OLD.amount_paise,OLD.slot_minutes,OLD.patient_name,OLD.mobile,OLD.mode,OLD.consultation_kind,OLD.request_key) THEN RAISE EXCEPTION 'Clinic booking snapshots are immutable';END IF;
  IF OLD.status IN('declined','cancelled') OR OLD.status='confirmed' AND NEW.status NOT IN('confirmed','cancelled') OR OLD.status='requested' AND NEW.status NOT IN('requested','confirmed','declined') THEN RAISE EXCEPTION 'Invalid clinic request transition';END IF;
  IF OLD.status='confirmed' AND (NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN RAISE EXCEPTION 'Approved clinic references are immutable';END IF;
 END IF;
 IF NEW.status='confirmed' THEN
  PERFORM 1 FROM public.phc_clinic_settings WHERE id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||NEW.slot_date::text,0));
  IF NOT public.phc_clinic_slot_free(NEW.slot_date,NEW.slot_time,NEW.slot_minutes,NEW.id) THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
 END IF;
 IF NEW.status='cancelled' AND EXISTS(SELECT 1 FROM public.phc_cash_receipts WHERE clinic_request_id=NEW.id) THEN RAISE EXCEPTION 'Cash-paid appointments need a separate refund/rescheduling workflow';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phc_guard_clinic_requests BEFORE INSERT OR UPDATE OR DELETE ON public.phc_clinic_requests FOR EACH ROW EXECUTE FUNCTION public.phc_protect_clinic_records();
CREATE TRIGGER phc_guard_cash_receipts BEFORE INSERT OR UPDATE OR DELETE ON public.phc_cash_receipts FOR EACH ROW EXECUTE FUNCTION public.phc_protect_clinic_records();
CREATE FUNCTION public.phc_protect_clinic_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='online_bookings' THEN
  PERFORM 1 FROM public.phc_clinic_settings WHERE id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||NEW.slot_date::text,0));
  IF NEW.status IN('held','paid') AND EXISTS(SELECT 1 FROM public.phc_clinic_requests c WHERE c.slot_date=NEW.slot_date AND c.status='confirmed' AND c.slot_time::time<NEW.slot_time::time+NEW.slot_minutes*interval '1 minute' AND NEW.slot_time::time<c.slot_time::time+c.slot_minutes*interval '1 minute') THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
 ELSIF TG_TABLE_NAME='phc_closures' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||NEW.slot_date::text,0));
  IF EXISTS(SELECT 1 FROM public.phc_clinic_requests WHERE slot_date=NEW.slot_date AND status='confirmed' AND (NEW.slot_time IS NULL OR slot_time=NEW.slot_time)) THEN RAISE EXCEPTION 'PHC_SCHEDULE_CONFLICT';END IF;
 ELSIF TG_TABLE_NAME='phc_clinic_settings' THEN
  IF EXISTS(SELECT 1 FROM public.phc_clinic_requests c WHERE c.status='confirmed' AND c.slot_date>=(now() AT TIME ZONE 'Asia/Kolkata')::date AND (c.slot_minutes<>(NEW.config->>'slotMinutes')::integer OR NOT EXISTS(SELECT 1 FROM public.phc_schedule_slots(c.slot_date,NEW.config) s WHERE s.slot_time=c.slot_time))) THEN RAISE EXCEPTION 'PHC_SCHEDULE_CONFLICT';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phc_guard_online_clinic_capacity BEFORE INSERT OR UPDATE ON public.online_bookings FOR EACH ROW EXECUTE FUNCTION public.phc_protect_clinic_capacity();
CREATE TRIGGER phc_guard_closure_clinic_capacity BEFORE INSERT OR UPDATE ON public.phc_closures FOR EACH ROW EXECUTE FUNCTION public.phc_protect_clinic_capacity();
CREATE TRIGGER phc_guard_schedule_clinic_capacity BEFORE UPDATE ON public.phc_clinic_settings FOR EACH ROW EXECUTE FUNCTION public.phc_protect_clinic_capacity();
CREATE FUNCTION public.phc_protect_clinic_visit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.clinic_request_id IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clinic visit history is protected';END IF;
  IF ROW(NEW.clinic_request_id,NEW.booking_id,NEW.visit_date,NEW.visit_time,NEW.kind,NEW.mode) IS DISTINCT FROM ROW(OLD.clinic_request_id,OLD.booking_id,OLD.visit_date,OLD.visit_time,OLD.kind,OLD.mode) THEN RAISE EXCEPTION 'Clinic appointment snapshots are protected';END IF;
  IF NEW.state<>'cancelled' AND EXISTS(SELECT 1 FROM public.phc_clinic_requests WHERE id=OLD.clinic_request_id AND status='cancelled') THEN RAISE EXCEPTION 'Cancelled clinic visits cannot be reopened';END IF;
  IF NEW.state='completed' AND NOT EXISTS(SELECT 1 FROM public.phc_cash_receipts r JOIN public.phc_clinic_requests c ON c.id=r.clinic_request_id WHERE c.id=OLD.clinic_request_id AND c.status='confirmed' AND r.amount_paise=c.amount_paise) THEN RAISE EXCEPTION 'Record received cash before completing a clinic visit';END IF;
  IF NEW.state='cancelled' AND EXISTS(SELECT 1 FROM public.phc_clinic_requests WHERE id=OLD.clinic_request_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Cancel through clinic appointment management';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER phc_guard_clinic_visit BEFORE UPDATE OR DELETE ON public.phc_visits FOR EACH ROW EXECUTE FUNCTION public.phc_protect_clinic_visit();

CREATE FUNCTION public.phc_request_clinic_booking(p_key uuid,p_date date,p_time text,p_mode text,p_name text,p_mobile text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; existing public.phc_clinic_requests%rowtype; request_id uuid; amount integer; duration integer;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'Request reference required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_clinic_request:'||p_key::text,0));
 SELECT * INTO existing FROM public.phc_clinic_requests WHERE request_key=p_key;
 IF FOUND THEN
  IF ROW(existing.slot_date,existing.slot_time,existing.mode,existing.patient_name,existing.mobile,existing.consultation_kind) IS DISTINCT FROM ROW(p_date,p_time,p_mode,btrim(p_name),p_mobile,p_kind) THEN RAISE EXCEPTION 'Request reference already used';END IF;
  RETURN jsonb_build_object('requestId',existing.id,'amountPaise',existing.amount_paise,'status',existing.status,'slotReserved',existing.status='confirmed');
 END IF;
 SELECT config INTO c FROM public.phc_clinic_settings WHERE id FOR SHARE;
 IF c->>'payAtClinic' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Pay at Clinic is disabled';END IF;
 IF p_date IS NULL OR p_date<(now() AT TIME ZONE 'Asia/Kolkata')::date OR p_date>(now() AT TIME ZONE 'Asia/Kolkata')::date+90 OR p_time IS NULL OR NOT EXISTS(SELECT 1 FROM public.phc_schedule_slots(p_date,c) WHERE slot_time=p_time)
 OR (p_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND p_time::time<=(now() AT TIME ZONE 'Asia/Kolkata')::time)
 OR p_mode IS NULL OR p_mode NOT IN('audio','video') OR p_kind IS NULL OR p_kind NOT IN('new','followup') OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 80 OR p_mobile IS NULL OR p_mobile !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Invalid clinic request' USING ERRCODE='22023';END IF;
 amount:=(c->>CASE WHEN p_kind='followup' THEN 'followupFeePaise' ELSE 'newFeePaise' END)::integer;duration:=(c->>'slotMinutes')::integer;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||p_date::text,0));
 IF EXISTS(SELECT 1 FROM public.phc_closures WHERE slot_date=p_date AND (slot_time IS NULL OR slot_time=p_time)) OR NOT public.phc_clinic_slot_free(p_date,p_time,duration) THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phc_clinic_mobile:'||p_mobile,0));
 IF (SELECT count(*) FROM public.phc_clinic_requests WHERE mobile=p_mobile AND status='requested' AND created_at>now()-interval '24 hours')>=3 THEN RAISE EXCEPTION 'Too many pending clinic requests';END IF;
 INSERT INTO public.phc_clinic_requests(request_key,slot_date,slot_time,mode,patient_name,mobile,consultation_kind,amount_paise,slot_minutes) VALUES(p_key,p_date,p_time,p_mode,btrim(p_name),p_mobile,p_kind,amount,duration) RETURNING id INTO request_id;
 RETURN jsonb_build_object('requestId',request_id,'amountPaise',amount,'status','requested','slotReserved',false);
END $$;
CREATE FUNCTION public.phc_clinic_admin_read(p_actor uuid,p_from date,p_to date,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.phc_require_admin(p_actor);
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to>p_from+366 THEN RAISE EXCEPTION 'Select a valid date range';END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) INTO result FROM (
 SELECT c.*,r.receipt_number,r.amount_paise received_paise,r.received_at,v.id visit_id,v.state visit_state,v.version visit_version FROM public.phc_clinic_requests c LEFT JOIN public.phc_cash_receipts r ON r.clinic_request_id=c.id LEFT JOIN public.phc_visits v ON v.clinic_request_id=c.id WHERE c.slot_date BETWEEN p_from AND p_to ORDER BY c.slot_date,c.slot_time,c.created_at DESC LIMIT 31 OFFSET greatest(0,least(coalesce(p_page,0),100000))*30)x;
 INSERT INTO public.phc_audit_log(actor,action) VALUES(p_actor,'read:clinic_requests');RETURN result;
END $$;
CREATE FUNCTION public.phc_clinic_admin_write(p_actor uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request public.phc_clinic_requests%rowtype; c jsonb; patient uuid; receipt public.phc_cash_receipts%rowtype;
BEGIN
 PERFORM public.phc_require_admin(p_actor);
 SELECT * INTO STRICT request FROM public.phc_clinic_requests WHERE id=(p_data->>'id')::uuid FOR UPDATE;
 IF p_action='receive_cash' THEN
  IF p_data->>'cash_received' IS DISTINCT FROM 'true' OR request.status<>'confirmed' OR (p_data->>'amount_paise')::integer IS DISTINCT FROM request.amount_paise THEN RAISE EXCEPTION 'Confirm the exact cash received for this appointment';END IF;
  SELECT * INTO receipt FROM public.phc_cash_receipts WHERE clinic_request_id=request.id;
  IF FOUND THEN RETURN jsonb_build_object('receipt',receipt.receipt_number,'alreadyRecorded',true);END IF;
  INSERT INTO public.phc_cash_receipts(clinic_request_id,amount_paise,received_by) VALUES(request.id,request.amount_paise,p_actor) RETURNING * INTO receipt;
  INSERT INTO public.phc_audit_log(actor,action,entity_id)VALUES(p_actor,'clinic_cash_received',request.id::text);
  RETURN jsonb_build_object('receipt',receipt.receipt_number,'amountPaise',receipt.amount_paise);
 END IF;
 IF request.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Request changed; reload before editing';END IF;
 IF p_action='approve' THEN
  IF request.status<>'requested' OR p_data->>'identity_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Verify patient identity before approving';END IF;
  SELECT config INTO c FROM public.phc_clinic_settings WHERE id FOR SHARE;
  IF c->>'payAtClinic' IS DISTINCT FROM 'true' OR request.slot_date<(now() AT TIME ZONE 'Asia/Kolkata')::date OR (request.slot_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND request.slot_time::time<=(now() AT TIME ZONE 'Asia/Kolkata')::time)
  OR request.slot_minutes<>(c->>'slotMinutes')::integer OR NOT EXISTS(SELECT 1 FROM public.phc_schedule_slots(request.slot_date,c) WHERE slot_time=request.slot_time) THEN RAISE EXCEPTION 'Requested schedule is no longer available';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||request.slot_date::text,0));
  IF EXISTS(SELECT 1 FROM public.phc_closures WHERE slot_date=request.slot_date AND (slot_time IS NULL OR slot_time=request.slot_time)) OR NOT public.phc_clinic_slot_free(request.slot_date,request.slot_time,request.slot_minutes) THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23505';END IF;
  IF nullif(p_data->>'patient_code','') IS NOT NULL THEN
   SELECT id INTO STRICT patient FROM public.phc_patients WHERE 'PHC-'||lpad(patient_code::text,6,'0')=upper(p_data->>'patient_code') AND merged_into IS NULL;
  ELSE INSERT INTO public.phc_patients(full_name,mobile)VALUES(request.patient_name,request.mobile) RETURNING id INTO patient;END IF;
  UPDATE public.phc_clinic_requests SET status='confirmed',patient_id=patient,approved_by=p_actor,approved_at=now(),updated_at=now(),version=version+1 WHERE id=request.id;
  INSERT INTO public.phc_visits(patient_id,clinic_request_id,visit_date,visit_time,kind,mode)VALUES(patient,request.id,request.slot_date,request.slot_time,request.consultation_kind,request.mode);
 ELSIF p_action='decline' THEN
  IF request.status<>'requested' THEN RAISE EXCEPTION 'Only a pending request can be declined';END IF;
  UPDATE public.phc_clinic_requests SET status='declined',updated_at=now(),version=version+1 WHERE id=request.id;
 ELSIF p_action='cancel_unpaid' THEN
  IF request.status<>'confirmed' OR EXISTS(SELECT 1 FROM public.phc_cash_receipts WHERE clinic_request_id=request.id) THEN RAISE EXCEPTION 'Paid clinic appointments require a separate resolution';END IF;
  PERFORM 1 FROM public.phc_clinic_settings WHERE id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('phc_date:'||request.slot_date::text,0));
  UPDATE public.phc_clinic_requests SET status='cancelled',updated_at=now(),version=version+1 WHERE id=request.id;
  UPDATE public.phc_visits SET state='cancelled',version=version+1,updated_at=now() WHERE clinic_request_id=request.id;
 ELSE RAISE EXCEPTION 'Unknown clinic action';END IF;
 INSERT INTO public.phc_audit_log(actor,action,entity_id)VALUES(p_actor,'clinic_'||p_action,request.id::text);
 RETURN jsonb_build_object('saved',true,'requestId',request.id);
END $$;

CREATE OR REPLACE FUNCTION public.phc_validate_settings(c jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ranges jsonb; r jsonb; previous_end text; d text;
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR NOT(c ?& ARRAY['slotMinutes','newFeePaise','followupFeePaise','onlineEnabled','payAtClinic','weekly','overrides']) THEN RAISE EXCEPTION 'Missing settings';END IF;
 IF jsonb_typeof(c->'slotMinutes') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'newFeePaise') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'followupFeePaise') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'onlineEnabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c->'weekly') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'overrides') IS DISTINCT FROM 'object' OR jsonb_typeof(c->'payAtClinic') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid settings types';END IF;
 IF jsonb_typeof(c)<>'object' OR (c->>'slotMinutes')::integer NOT BETWEEN 5 AND 180
 OR (c->>'newFeePaise')::integer NOT BETWEEN 100 AND 10000000
 OR (c->>'followupFeePaise')::integer NOT BETWEEN 100 AND 10000000
 OR jsonb_typeof(c->'onlineEnabled')<>'boolean'
 OR jsonb_typeof(c->'payAtClinic')<>'boolean'
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
CREATE OR REPLACE FUNCTION public.phc_public_schedule(p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('slotMinutes',config->'slotMinutes','newFeePaise',config->'newFeePaise','followupFeePaise',config->'followupFeePaise','onlineEnabled',config->'onlineEnabled','payAtClinic',config->'payAtClinic','clinicReserved',(SELECT coalesce(jsonb_agg(slot_time),'[]'::jsonb) FROM public.phc_clinic_requests WHERE slot_date=p_date AND status='confirmed'),'slots',(SELECT coalesce(jsonb_agg(slot_time),'[]'::jsonb) FROM public.phc_schedule_slots(p_date))) FROM public.phc_clinic_settings WHERE id;
$$;
CREATE OR REPLACE FUNCTION public.phc_dashboard_read(p_actor uuid,p_section text,p_filter jsonb)
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
 'visits',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT v.*,CASE WHEN cr.id IS NULL THEN b.status WHEN cr.status='cancelled' THEN 'cancelled' WHEN cash.id IS NOT NULL THEN 'clinic_paid' ELSE 'clinic_due' END payment_status,coalesce(b.amount_paise,cr.amount_paise) amount_paise,b.razorpay_order_id,cash.receipt_number FROM public.phc_visits v LEFT JOIN public.online_bookings b ON b.id=v.booking_id LEFT JOIN public.phc_clinic_requests cr ON cr.id=v.clinic_request_id LEFT JOIN public.phc_cash_receipts cash ON cash.clinic_request_id=cr.id WHERE v.patient_id=p.id ORDER BY visit_date DESC,visit_time DESC LIMIT 100 OFFSET page_no*100)x),'[]'::jsonb),
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
 UNION ALL
 SELECT c.id,c.slot_date,c.slot_time,c.mode,c.patient_name,c.mobile,CASE WHEN r.id IS NULL THEN 'clinic_due' ELSE 'clinic_paid' END,c.amount_paise,r.received_at,c.consultation_kind,c.slot_minutes,NULL::timestamptz,v.id,v.patient_id,v.state,v.version,true
 FROM public.phc_clinic_requests c JOIN public.phc_visits v ON v.clinic_request_id=c.id LEFT JOIN public.phc_cash_receipts r ON r.clinic_request_id=c.id
 WHERE c.status='confirmed' AND c.slot_date BETWEEN f AND t AND (coalesce(p_filter->>'status','')='' OR (CASE WHEN r.id IS NULL THEN 'clinic_due' ELSE 'clinic_paid' END)=p_filter->>'status' OR v.state=p_filter->>'status') AND (coalesce(p_filter->>'kind','')='' OR c.consultation_kind=p_filter->>'kind')
 ORDER BY slot_date,slot_time LIMIT CASE WHEN p_section='calendar' THEN 1000 ELSE 31 END OFFSET CASE WHEN p_section='calendar' THEN 0 ELSE page_no*30 END)x;
 IF p_section='calendar' THEN result:=result||jsonb_build_object('slots',(SELECT coalesce(jsonb_agg(slot_time),'[]'::jsonb) FROM public.phc_schedule_slots(f)), 'closures',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.phc_closures c WHERE slot_date=f)); END IF;
 ELSIF p_section='audit' THEN
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) INTO result FROM(SELECT action,entity_id,at FROM public.phc_audit_log ORDER BY id DESC LIMIT 31 OFFSET page_no*30)x;
 ELSE RAISE EXCEPTION 'Unknown section';END IF;
 INSERT INTO public.phc_audit_log(actor,action,entity_id) VALUES(p_actor,'read:'||p_section,pid::text);
 RETURN coalesce(result,'{}'::jsonb);
END $$;
DO $$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['phc_clinic_slot_free(date,text,integer,uuid)','phc_protect_clinic_records()','phc_protect_clinic_capacity()','phc_protect_clinic_visit()','phc_request_clinic_booking(uuid,date,text,text,text,text,text)','phc_clinic_admin_read(uuid,date,date,integer)','phc_clinic_admin_write(uuid,text,jsonb)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO service_role';
 END LOOP;
END $$;
COMMIT;
