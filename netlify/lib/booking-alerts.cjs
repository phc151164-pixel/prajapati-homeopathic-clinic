'use strict';
const {supa}=require('../functions/_common');
const EMAIL='phc151164@gmail.com',WHATSAPP='918962540212';
// Destinations are owner-approved clinic contacts, never patient/browser controlled.
function channels(env=process.env,deployContext=require('./deploy-context.cjs').context){
 if(env.PHC_BOOKING_ALERTS_ENABLED!=='true'||deployContext!=='production')return [];
 const ready=[];
 if(env.PHC_EMAIL_ALERTS_ENABLED==='true'&&env.RESEND_API_KEY&&env.PHC_ALERT_EMAIL_FROM)ready.push('email');
 const fast2smsReady=env.FAST2SMS_API_KEY&&/^\d+$/.test(env.FAST2SMS_PHONE_NUMBER_ID||'');
 if(env.PHC_WHATSAPP_ALERTS_ENABLED==='true'&&(fast2smsReady||env.WHATSAPP_ACCESS_TOKEN&&/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID||'')&&/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION||'')&&/^[a-z0-9_]+$/.test(env.WHATSAPP_ALERT_TEMPLATE||'')&&/^[a-z]{2}(_[A-Z]{2})?$/.test(env.WHATSAPP_TEMPLATE_LANGUAGE||'')))ready.push('whatsapp');
 return ready;
}
function details(p){
 if(!p||typeof p.name!=='string'||p.name.length>80||!/^\d{10}$/.test(p.mobile||'')||!/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')||!/^\d{2}:\d{2}$/.test(p.time||'')||!['audio','video'].includes(p.mode)||!['new','followup'].includes(p.kind)||!Number.isSafeInteger(p.amountPaise)||p.amountPaise<1||!['Paid online','Pay at Clinic - payment due'].includes(p.payment)||!/^[0-9a-f-]{36}$/i.test(p.bookingId||''))throw Error('Invalid alert payload');
 const clean=s=>s.replace(/[\r\n\t]/g,' ').trim();
 return [clean(p.name),p.mobile,p.date,p.time+' IST',p.kind+' / '+p.mode,'INR '+(p.amountPaise/100).toFixed(2),p.payment,p.bookingId];
}
function request(job,env=process.env){
 if(job.source==='setup_test'){if(job.channel!=='email')throw Error('Invalid test channel');return {url:'https://api.resend.com/emails',options:{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'phc-booking-alert/'+job.id},body:JSON.stringify({from:env.PHC_ALERT_EMAIL_FROM,to:[EMAIL],subject:'PHC: booking notification setup test',text:'This is a test of Prajapati Homeopathic Clinic booking email notifications. No real appointment or payment was created. Future confirmed booking alerts will include patient name/mobile, slot, consultation type and payment status. Doctor dashboard: https://prajapatihomeopathicclinic.netlify.app/admin'})}};}
 const v=details(job.payload);
 if(job.channel==='whatsapp'&&env.FAST2SMS_API_KEY&&/^\d+$/.test(env.FAST2SMS_PHONE_NUMBER_ID||'')){
  const values=[...v,job.payload.registrationNumber||'Not assigned'].map(value=>value.replace(/\|/g,' '));
  const query=new URLSearchParams({message_id:'45849',phone_number_id:env.FAST2SMS_PHONE_NUMBER_ID,numbers:WHATSAPP.slice(2),variables_values:values.join('|')});
  return {url:'https://www.fast2sms.com/dev/whatsapp?'+query,options:{method:'GET',headers:{Authorization:env.FAST2SMS_API_KEY}},provider:'fast2sms'};
 }
 if(job.channel==='email')return {url:'https://api.resend.com/emails',options:{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'phc-booking-alert/'+job.id},body:JSON.stringify({from:env.PHC_ALERT_EMAIL_FROM,to:[EMAIL],subject:'PHC: confirmed appointment · '+job.payload.date+' '+job.payload.time,text:'New confirmed appointment\n\n'+['Patient','Mobile','Date','Time','Consultation','Amount','Payment','Booking reference'].map((label,i)=>label+': '+v[i]).join('\n')+'\n\nDoctor dashboard: https://prajapatihomeopathicclinic.netlify.app/admin'})}};
 if(job.channel!=='whatsapp')throw Error('Invalid channel');
 return {url:`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,options:{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:WHATSAPP,type:'template',template:{name:env.WHATSAPP_ALERT_TEMPLATE,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE},components:[{type:'body',parameters:[...v,job.payload.registrationNumber||'Not assigned'].map(text=>({type:'text',text}))}]}})}};
}
async function deliver(job,env=process.env,send=fetch){
 let req;try{req=request(job,env);}catch{return {result:'rejected'};}
 try{
  const response=await send(req.url,{...req.options,signal:AbortSignal.timeout(8000)});
  let data;try{data=await response.json();}catch{return {result:job.channel==='email'?'retry':'ambiguous'};}
  if(response.ok){if(req.provider==='fast2sms'&&data.status===false)return {result:'rejected'};const id=job.channel==='email'?data.id:req.provider==='fast2sms'?(data.status===true?data.request_id:undefined):data.messages?.[0]?.id;return typeof id==='string'&&id.length<201?{result:'accepted',provider:id}:{result:job.channel==='email'?'retry':'ambiguous'};}
  if(response.status===429)return {result:'retry'};
  if(response.status>=500)return {result:job.channel==='email'?'retry':'ambiguous'};
  return {result:'rejected'};
 }catch{return {result:job.channel==='email'?'retry':'ambiguous'};}
}
async function addRegistrationNumber(job,db){
 if(job.channel!=='whatsapp'||!['online_paid','clinic_confirmed'].includes(job.source))return job;
 details(job.payload);
 const reference=job.source==='online_paid'?'booking_id':'clinic_request_id';
 const visits=await db('phc_visits?select=phc_patients!phc_visits_patient_id_fkey(patient_code)&'+reference+'=eq.'+job.payload.bookingId,'GET');
 const code=visits[0]?.phc_patients?.patient_code;
 const registrationNumber=/^\d{1,6}$/.test(String(code))?'PHC-'+String(code).padStart(6,'0'):null;
 return {...job,payload:{...job.payload,registrationNumber}};
}
async function dispatch(env=process.env,db=supa,send=fetch,deployContext){
 const ready=channels(env,deployContext);if(!ready.length)return {processed:0,configured:false};
 const jobs=await db('rpc/phc_claim_booking_alerts','POST',{p_channels:ready});
 const results=await Promise.all(jobs.map(async job=>{let enriched;
  try{enriched=await addRegistrationNumber(job,db);}catch{await db('rpc/phc_finish_booking_alert','POST',{p_id:job.id,p_lease:job.lease,p_result:'retry',p_provider:null});return 'retry';}
  const outcome=await deliver(enriched,env,send);await db('rpc/phc_finish_booking_alert','POST',{p_id:job.id,p_lease:job.lease,p_result:outcome.result,p_provider:outcome.provider||null});return outcome.result;}));
 return {processed:results.length,accepted:results.filter(x=>x==='accepted').length,configured:true};
}
module.exports={channels,details,request,deliver,dispatch};
