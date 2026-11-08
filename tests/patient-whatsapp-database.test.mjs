import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
const sql=path=>readFileSync(new URL('../setup/'+path,import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111';
test('patient WhatsApp is consent-gated, atomic, mode-specific and not backfilled',async t=>{
 const db=await PGlite.create({extensions:{pg_trgm}});
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE SCHEMA extensions;`);
 await db.exec(sql('booking_database.sql').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`CREATE TABLE public.phc_closures(slot_date date NOT NULL,slot_time text,reason text DEFAULT 'Doctor unavailable',created_at timestamptz DEFAULT now());CREATE UNIQUE INDEX phc_closures_unique_slot ON public.phc_closures(slot_date,(coalesce(slot_time,'ALL_DAY')));CREATE FUNCTION public.phc_change_closure(p_date date,p_time text,p_closed boolean,p_reason text DEFAULT 'Doctor unavailable') RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;`);
 await db.exec(sql('PHC_PRODUCTION_REVIEW_ONLY.sql'));
 await db.exec(sql('PHC_DASHBOARD_V2_REVIEW_FIRST.sql'));
 await db.exec(`INSERT INTO auth.users VALUES('${admin}');INSERT INTO public.phc_admin_accounts(user_id)VALUES('${admin}');`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261107211757_pay_at_clinic_doctor_approval.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261107221809_booking_alert_outbox.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261107223438_booking_alert_email_setup_test.sql',import.meta.url),'utf8'));
 const old=(await db.query(`SELECT public.phc_reserve_online_slot_v2(((now() AT TIME ZONE 'Asia/Kolkata')::date+2),'11:00','audio','Old synthetic','0000000000','new') r`)).rows[0].r;
 const before=(await db.query('SELECT id,amount_paise,status,patient_name,mobile FROM public.online_bookings')).rows;
 await db.exec(readFileSync(new URL('../supabase/migrations/20261108164649_patient_whatsapp_confirmation.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('SELECT id,amount_paise,status,patient_name,mobile FROM public.online_bookings')).rows,before);
 assert.equal((await db.query('SELECT whatsapp_updates_opt_in FROM public.online_bookings WHERE id=$1',[old.id])).rows[0].whatsapp_updates_opt_in,false);
 const date=(await db.query(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date+3)::text d`)).rows[0].d;
 const reserve=async(time,mode,consent)=>(await db.query(`SELECT public.phc_reserve_online_slot_v3($1,$2,$3,'Synthetic patient','0000000000','new',$4) r`,[date,time,mode,consent])).rows[0].r;
 const paid=async(b,suffix)=>{await db.query('SELECT public.phc_attach_order($1,$2)',[b.id,'order_'+suffix]);return (await db.query('SELECT public.phc_confirm_paid_slot($1,$2,$3) ok',['order_'+suffix,'pay_'+suffix,b.amount_paise])).rows[0].ok;};
 const optedOut=await reserve('11:00','audio',false);assert.equal(await paid(optedOut,'OptedOut'),true);
 assert.equal((await db.query(`SELECT count(*)::int n FROM public.phc_booking_alerts WHERE channel='patient_whatsapp'`)).rows[0].n,0);
 const video=await reserve('11:30','video',true);assert.equal((await db.query('SELECT count(*)::int n FROM public.phc_booking_alerts WHERE booking_id=$1',[video.id])).rows[0].n,0);
 await db.query('SELECT public.phc_attach_order($1,$2)',[video.id,'order_Video']);
 assert.equal((await db.query(`SELECT public.phc_confirm_paid_slot('order_Video','pay_Video',1) ok`)).rows[0].ok,false);
 assert.equal((await db.query('SELECT count(*)::int n FROM public.phc_booking_alerts WHERE booking_id=$1',[video.id])).rows[0].n,0);
 await db.query(`SELECT public.phc_confirm_paid_slot('order_Video','pay_Video',$1)`,[video.amount_paise]);await db.query(`SELECT public.phc_confirm_paid_slot('order_Video','pay_Video',$1)`,[video.amount_paise]);
 const jobs=(await db.query('SELECT * FROM public.phc_booking_alerts WHERE booking_id=$1',[video.id])).rows;assert.equal(jobs.length,3);
 const job=jobs.find(x=>x.channel==='patient_whatsapp');assert.equal(job.payload.mode,'video');assert.equal(job.payload.consentVersion,'booking-whatsapp-v1');assert.equal('notes' in job.payload,false);
 const audio=await reserve('12:00','audio',true);await paid(audio,'Audio');assert.equal((await db.query(`SELECT payload->>'mode' mode FROM public.phc_booking_alerts WHERE booking_id=$1 AND channel='patient_whatsapp'`,[audio.id])).rows[0].mode,'audio');
 await db.exec(`UPDATE public.phc_clinic_settings SET config=jsonb_set(config,'{payAtClinic}','true')`);
 const key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const clinic=async consent=>(await db.query(`SELECT public.phc_request_clinic_booking_v2($1,$2,'12:30','video','Synthetic clinic','0000000000','new',$3) r`,[key,date,consent])).rows[0].r;
 const req=await clinic(true);assert.equal((await clinic(true)).requestId,req.requestId);await assert.rejects(clinic(false));
 assert.equal((await db.query('SELECT count(*)::int n FROM public.phc_booking_alerts WHERE booking_id=$1',[req.requestId])).rows[0].n,0);
 await db.query(`SELECT public.phc_clinic_admin_write($1,'approve',$2)`,[admin,JSON.stringify({id:req.requestId,version:1,identity_confirmed:true})]);assert.equal((await db.query('SELECT count(*)::int n FROM public.phc_booking_alerts WHERE booking_id=$1',[req.requestId])).rows[0].n,3);
 const taken=(await db.query(`SELECT * FROM public.phc_claim_booking_alerts(ARRAY['patient_whatsapp'])`)).rows;assert.ok(taken.length>0);await db.exec(`UPDATE public.phc_booking_alerts SET lease_until=now()-interval '1 second' WHERE channel='patient_whatsapp' AND state='sending'`);await db.query(`SELECT * FROM public.phc_claim_booking_alerts(ARRAY['patient_whatsapp'])`);for(const j of taken)assert.equal((await db.query('SELECT state FROM public.phc_booking_alerts WHERE id=$1',[j.id])).rows[0].state,'review');
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(reserve('13:00','audio',true));await db.exec('RESET ROLE');}
 }finally{await db.close();}
});
