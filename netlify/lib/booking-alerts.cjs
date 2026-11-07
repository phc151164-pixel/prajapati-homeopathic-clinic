'use strict';
const {supa}=require('../functions/_common');
const EMAIL='phc151164@gmail.com',WHATSAPP='918103684642';
// Destinations are owner-approved clinic contacts, never patient/browser controlled.
function channels(env=process.env){
 if(env.PHC_BOOKING_ALERTS_ENABLED!=='true'||env.CONTEXT!=='production')return [];
 const ready=[];
 if(env.PHC_EMAIL_ALERTS_ENABLED==='true'&&env.RESEND_API_KEY&&env.PHC_ALERT_EMAIL_FROM)ready.push('email');
 if(env.PHC_WHATSAPP_ALERTS_ENABLED==='true'&&env.WHATSAPP_ACCESS_TOKEN&&/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID||'')&&/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION||'')&&/^[a-z0-9_]+$/.test(env.WHATSAPP_ALERT_TEMPLATE||'')&&/^[a-z]{2}(_[A-Z]{2})?$/.test(env.WHATSAPP_TEMPLATE_LANGUAGE||''))ready.push('whatsapp');
 return ready;
}
function details(p){
 if(!p||typeof p.name!=='string'||p.name.length>80||!/^\d{10}$/.test(p.mobile||'')||!/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')||!/^\d{2}:\d{2}$/.test(p.time||'')||!['audio','video'].includes(p.mode)||!['new','followup'].includes(p.kind)||!Number.isSafeInteger(p.amountPaise)||p.amountPaise<1||!['Paid online','Pay at Clinic - payment due'].includes(p.payment)||!/^[0-9a-f-]{36}$/i.test(p.bookingId||''))throw Error('Invalid alert payload');
 const clean=s=>s.replace(/[\r\n\t]/g,' ').trim();
 return [clean(p.name),p.mobile,p.date,p.time+' IST',p.kind+' / '+p.mode,'INR '+(p.amountPaise/100).toFixed(2),p.payment,p.bookingId];
}
function request(job,env=process.env){
 const v=details(job.payload);
 if(job.channel==='email')return {url:'https://api.resend.com/emails',options:{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'phc-booking-alert/'+job.id},body:JSON.stringify({from:env.PHC_ALERT_EMAIL_FROM,to:[EMAIL],subject:'PHC: confirmed appointment · '+job.payload.date+' '+job.payload.time,text:'New confirmed appointment\n\n'+['Patient','Mobile','Date','Time','Consultation','Amount','Payment','Booking reference'].map((label,i)=>label+': '+v[i]).join('\n')+'\n\nDoctor dashboard: https://prajapatihomeopathicclinic.netlify.app/admin'})}};
 if(job.channel!=='whatsapp')throw Error('Invalid channel');
 return {url:`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,options:{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:WHATSAPP,type:'template',template:{name:env.WHATSAPP_ALERT_TEMPLATE,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE},components:[{type:'body',parameters:v.map(text=>({type:'text',text}))}]}})}};
}
async function deliver(job,env=process.env,send=fetch){
 let req;try{req=request(job,env);}catch{return {result:'rejected'};}
 try{
  const response=await send(req.url,{...req.options,signal:AbortSignal.timeout(8000)});
  let data;try{data=await response.json();}catch{return {result:job.channel==='email'?'retry':'ambiguous'};}
  if(response.ok){const id=job.channel==='email'?data.id:data.messages?.[0]?.id;return typeof id==='string'&&id.length<201?{result:'accepted',provider:id}:{result:job.channel==='email'?'retry':'ambiguous'};}
  if(response.status===429)return {result:'retry'};
  if(response.status>=500)return {result:job.channel==='email'?'retry':'ambiguous'};
  return {result:'rejected'};
 }catch{return {result:job.channel==='email'?'retry':'ambiguous'};}
}
async function dispatch(env=process.env,db=supa,send=fetch){
 const ready=channels(env);if(!ready.length)return {processed:0,configured:false};
 const jobs=await db('rpc/phc_claim_booking_alerts','POST',{p_channels:ready});
 const results=await Promise.all(jobs.map(async job=>{const outcome=await deliver(job,env,send);await db('rpc/phc_finish_booking_alert','POST',{p_id:job.id,p_lease:job.lease,p_result:outcome.result,p_provider:outcome.provider||null});return outcome.result;}));
 return {processed:results.length,accepted:results.filter(x=>x==='accepted').length,configured:true};
}
module.exports={channels,details,request,deliver,dispatch};
