import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
const sql=path=>readFileSync(new URL('../setup/'+path,import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111';
test('dashboard migration and clinical operations preserve payment and access protections',async t=>{
 const db=await PGlite.create({extensions:{pg_trgm}});
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE SCHEMA extensions;`);
 await db.exec(sql('booking_database.sql').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`CREATE TABLE public.phc_closures(slot_date date NOT NULL,slot_time text,reason text DEFAULT 'Doctor unavailable',created_at timestamptz DEFAULT now());CREATE UNIQUE INDEX phc_closures_unique_slot ON public.phc_closures(slot_date,(coalesce(slot_time,'ALL_DAY')));`);
 await db.exec(`CREATE FUNCTION public.phc_change_closure(p_date date,p_time text,p_closed boolean,p_reason text DEFAULT 'Doctor unavailable') RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;`);
 // The production-reviewed guard is installed before V2, matching deployment prerequisites.
 await db.exec(sql('PHC_PRODUCTION_REVIEW_ONLY.sql'));
 await db.exec(`INSERT INTO auth.users VALUES('${admin}');INSERT INTO public.online_bookings(slot_date,slot_time,mode,patient_name,mobile,amount_paise,status,razorpay_order_id,razorpay_payment_id,paid_at)VALUES('2099-01-01','11:00','video','Synthetic only','0000000000',30000,'paid','order_Baseline','pay_Baseline',now());`);
 const before=(await db.query('SELECT id,amount_paise,status,razorpay_order_id,paid_at FROM public.online_bookings')).rows;
 await db.exec(sql('PHC_DASHBOARD_V2_REVIEW_FIRST.sql'));
 assert.deepEqual((await db.query('SELECT id,amount_paise,status,razorpay_order_id,paid_at FROM public.online_bookings')).rows,before);
 await db.exec(`INSERT INTO public.phc_admin_accounts(user_id)VALUES('${admin}')`);
 const write=async(action,data)=> (await db.query('SELECT public.phc_dashboard_write($1,$2,$3) result',[admin,action,JSON.stringify(data)])).rows[0].result;
 const read=async(section,filter={})=>(await db.query('SELECT public.phc_dashboard_read($1,$2,$3) result',[admin,section,JSON.stringify(filter)])).rows[0].result;
 await t.test('unauthorized database roles cannot execute RPC or read records',async()=>{
 for(const role of ['anon','authenticated']){
 await db.exec('SET ROLE '+role);await assert.rejects(db.query('SELECT * FROM public.phc_patients'));await assert.rejects(db.query(`SELECT public.phc_dashboard_read('${admin}','patients','{}')`));await db.exec('RESET ROLE');
 }
 await assert.rejects(db.query(`SELECT public.phc_dashboard_read('22222222-2222-4222-8222-222222222222','patients','{}')`));
 });
 const p=await write('patient_save',{name:'Synthetic patient',mobile:'0000000000',notes:'Private synthetic note'});
 await t.test('patient editing is versioned; visits preserve chronological separate history',async()=>{
 await write('patient_save',{id:p.id,version:1,name:'Synthetic corrected',mobile:'0000000000',notes:'Private note'});
 await assert.rejects(write('patient_save',{id:p.id,version:1,name:'Stale synthetic',mobile:'0000000000'}));
 const visit=await write('visit_save',{patient_id:p.id,date:'2020-01-01',time:'11:00',kind:'new',mode:'walkin',notes:'Synthetic visit'});
 await write('visit_status',{id:visit.id,version:1,state:'completed'});
 await write('visit_save',{patient_id:p.id,date:'2020-02-01',time:'11:00',kind:'followup',mode:'walkin'});
 const profile=await read('patient',{patient_id:p.id});assert.equal(profile.visits.length,2);assert.equal(profile.summary.completed,1);
 assert.equal((await read('patients',{search:'correct'})).items.length,1);
 assert.equal((await read('patients',{search:'PHC-000001'})).items.length,1);
 });
 const date=(await db.query(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date+2)::text d`)).rows[0].d;
 let settings=await read('settings');
 // Baseline old booking in 2099 is intentionally reserved; no schedule edits can invalidate it.
 await t.test('settings and fees preserve existing booking snapshots',async()=>{
 await write('settings_save',{version:settings.version,config:{...settings.config,newFeePaise:45000,followupFeePaise:25000}});
 settings=await read('settings');
 assert.equal((await db.query(`SELECT amount_paise FROM public.online_bookings WHERE razorpay_order_id='order_Baseline'`)).rows[0].amount_paise,30000);
 await assert.rejects(write('settings_save',{version:settings.version,config:{...settings.config,slotMinutes:15}}),/PHC_SCHEDULE_CONFLICT/);
 });
 let held;
 await t.test('atomic reserve uses saved follow-up fee, duplicate reservation fails',async()=>{
 held=(await db.query(`SELECT public.phc_reserve_online_slot_v2($1,'11:00','video','Synthetic booking','0000000000','followup') r`,[date])).rows[0].r;
 assert.equal(held.amount_paise,25000);
 await assert.rejects(db.query(`SELECT public.phc_reserve_online_slot_v2($1,'11:00','video','Synthetic booking','0000000000','new')`,[date]));
 assert.equal((await db.query('SELECT count(*)::integer n FROM public.phc_visits WHERE booking_id=$1',[held.id])).rows[0].n,1);
 });
 await t.test('closures and schedule changes cannot erase a reserved slot',async()=>{
 await assert.rejects(write('closure',{date,time:'11:00',closed:true}),/PHC_SCHEDULE_CONFLICT/);
 await assert.rejects(write('settings_save',{version:settings.version,config:{...settings.config,overrides:{[date]:[]}}}),/PHC_SCHEDULE_CONFLICT/);
 await write('closure',{date,time:'12:00',closed:true});
 await assert.rejects(db.query(`SELECT public.phc_reserve_online_slot_v2($1,'12:00','audio','Synthetic','0000000000','new')`,[date]));
 await write('closure',{date,time:'12:00',closed:false});
 });
 await t.test('old fee change cannot affect confirmation; financial editing and release rejected',async()=>{
 await db.query(`SELECT public.phc_attach_order($1,'order_Synthetic')`,[held.id]);
 await write('settings_save',{version:settings.version,config:{...settings.config,followupFeePaise:28000}});
 assert.equal((await db.query(`SELECT public.phc_confirm_paid_slot('order_Synthetic','pay_Synthetic',28000) ok`)).rows[0].ok,false);
 assert.equal((await db.query(`SELECT public.phc_confirm_paid_slot('order_Synthetic','pay_Synthetic',25000) ok`)).rows[0].ok,true);
 await assert.rejects(db.query(`UPDATE public.online_bookings SET amount_paise=1 WHERE id=$1`,[held.id]));
 await assert.rejects(db.query(`DELETE FROM public.online_bookings WHERE id=$1`,[held.id]));
 await assert.rejects(db.query(`UPDATE public.online_bookings SET razorpay_payment_id='pay_Changed' WHERE id=$1`,[held.id]));
 });
 await t.test('explicit verified profile consolidation preserves separate visits and notes',async()=>{
 const source=await write('patient_save',{name:'Synthetic returning',mobile:'0000000000',notes:'Retained source note'});
 await write('visit_save',{patient_id:source.id,date:'2020-03-01',time:'11:00',kind:'followup',mode:'walkin'});
 const target=await read('patient',{patient_id:p.id});
 await assert.rejects(write('patient_merge',{source_id:source.id,version:1,target_code:target.patient.patient_id,identity_confirmed:false}));
 await write('patient_merge',{source_id:source.id,version:1,target_code:target.patient.patient_id,identity_confirmed:true});
 const merged=await read('patient',{patient_id:p.id});assert.equal(merged.visits.length,3);assert.equal(merged.source_profiles[0].notes,'Retained source note');assert.equal(merged.summary.completed,1);
 });
 await t.test('null settings and future completion cannot bypass validation',async()=>{
 const cfg=await read('settings');await assert.rejects(write('settings_save',{version:cfg.version,config:{...cfg.config,newFeePaise:null}}));
 const v=await write('visit_save',{patient_id:p.id,date:'2099-01-01',time:'11:00',kind:'followup',mode:'walkin'});await assert.rejects(write('visit_status',{id:v.id,version:1,state:'completed'}));
 });
 await t.test('legacy booking links through verified permanent Patient ID without editing payment',async()=>{
 const legacy=(await db.query("SELECT id FROM public.online_bookings WHERE razorpay_order_id='order_Baseline'")).rows[0];
 const target=await read('patient',{patient_id:p.id});
 await assert.rejects(write('link_booking',{booking_id:legacy.id,patient_code:target.patient.patient_id,identity_confirmed:false}));
 await write('link_booking',{booking_id:legacy.id,patient_code:target.patient.patient_id,identity_confirmed:true});
 assert.equal((await db.query('SELECT status,amount_paise FROM public.online_bookings WHERE id=$1',[legacy.id])).rows[0].amount_paise,30000);
 assert.equal((await db.query('SELECT count(*)::integer n FROM public.phc_visits WHERE booking_id=$1',[legacy.id])).rows[0].n,1);
 });
 await t.test('audit entries exclude confidential notes and patient mobile',async()=>{
 const rows=(await db.query('SELECT * FROM public.phc_audit_log')).rows;assert.ok(rows.length>0);assert.equal(JSON.stringify(rows).includes('Private note'),false);assert.equal(JSON.stringify(rows).includes('0000000000'),false);
 });
 }finally{await db.close();}
});
