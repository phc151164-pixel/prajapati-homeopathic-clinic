'use strict';
const {json,supa,safeDate}=require('../functions/_common');
const {identify,sameOrigin}=require('../lib/doctor-auth.cjs');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
exports.handler=async event=>{
 if(process.env.PHC_DASHBOARD_ENABLED!=='true')return json(503,{error:'Doctor dashboard is not enabled on this deployment.'});
 const user=await identify(event);if(!user)return json(401,{error:'Please sign in with an authorized clinic account.'});
 if(!['GET','POST'].includes(event.httpMethod))return json(405,{error:'Method not allowed'});
 if(event.httpMethod==='POST'&&!sameOrigin(event))return json(403,{error:'Request origin not allowed'});
 if(Buffer.byteLength(event.body||'')>40000)return json(413,{error:'Request too large'});
 try{
  if(event.httpMethod==='POST'){
   let b;try{b=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid request'});}
   if(b.action==='alert_email_test'){if(!require('../lib/booking-alerts.cjs').channels().includes('email'))return json(409,{error:'Email alerts are not configured on this deployment.'});if(!uuid(b.data?.requestKey))return json(400,{error:'Invalid test reference'});const id=await supa('rpc/phc_queue_alert_email_test','POST',{p_actor:user.id,p_key:b.data.requestKey});return json(200,{result:{id}});}
   if(['clinic_approve','clinic_decline','clinic_cancel_unpaid','clinic_receive_cash'].includes(b.action)){const result=await supa('rpc/phc_clinic_admin_write','POST',{p_actor:user.id,p_action:b.action.slice(7),p_data:b.data||{}});return json(200,{result});}
   if(!['patient_save','patient_merge','visit_save','link_booking','visit_status','settings_save','closure'].includes(b.action))return json(400,{error:'Unknown action'});
   const result=await supa('rpc/phc_dashboard_write','POST',{p_actor:user.id,p_action:b.action,p_data:b.data||{}});
   return json(200,{result});
  }
  const q=event.queryStringParameters||{},page=Math.max(0,Math.min(100000,Number.parseInt(q.page,10)||0));
  if(q.section==='alerts')return json(200,await supa('rpc/phc_read_booking_alerts','POST',{p_actor:user.id,p_page:page}));
  if(q.section==='clinic_requests'){if(!safeDate(q.from)||!safeDate(q.to))return json(400,{error:'Select a date range'});return json(200,await supa('rpc/phc_clinic_admin_read','POST',{p_actor:user.id,p_from:q.from,p_to:q.to,p_page:page}));}
  const result=await supa('rpc/phc_dashboard_read','POST',{p_actor:user.id,p_section:q.section||'overview',p_filter:{search:String(q.search||'').slice(0,100),from:safeDate(q.from)?q.from:null,to:safeDate(q.to)?q.to:null,status:q.status||'',kind:q.kind||'',patient_id:uuid(q.patientId)?q.patientId:null,page,filter_visits:q.filterVisits==='true'}});
  return json(200,result);
 }catch(e){
  const bad=['22023','23505','P0001'].includes(e.code);
  // Whitelisted messages only: database diagnostics can include patient information.
  const messages={PHC_SCHEDULE_CONFLICT:'Schedule conflicts with an existing reserved appointment. Keep the current schedule and resolve that appointment first.',PHC_IDENTITY_REVIEW:'This booking is already linked. Review the existing patient profile.',PHC_PAYMENT_PROTECTED:'Payment records are protected. Use payment reconciliation.'};
  const message=messages[e.message]|| (bad?'Check the entered values. The change could not be saved.':'Dashboard setup is incomplete or temporarily unavailable.');
  return json(bad?409:503,{error:message});
 }
};
