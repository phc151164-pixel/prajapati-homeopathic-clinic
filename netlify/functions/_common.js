const crypto = require('node:crypto');
const json = (statusCode, obj) => ({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},body:JSON.stringify(obj)});
const configured = () => ['SUPABASE_URL','PHC_SUPABASE_SERVER_KEY','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET'].every(k=>Boolean(process.env[k]?.trim()));
// Public booking availability also requires the database; payment keys are checked separately.
const databaseConfigured = () => ['SUPABASE_URL','PHC_SUPABASE_SERVER_KEY'].every(k=>Boolean(process.env[k]?.trim()));
const supa = async (path, method='GET', body) => {
  // SUPABASE_URL must be the project origin, e.g. https://project.supabase.co
  const base=new URL(process.env.SUPABASE_URL.trim());
  if(base.protocol!=='https:'||base.pathname!=='/'||base.search||base.hash)throw Object.assign(new Error('Invalid SUPABASE_URL; project origin required'),{provider:'configuration'});
  const url=base.origin+'/rest/v1/'+path;
  const res=await fetch(url,{method,headers:{apikey:process.env.PHC_SUPABASE_SERVER_KEY,Authorization:'Bearer '+process.env.PHC_SUPABASE_SERVER_KEY,'Content-Type':'application/json','Prefer':'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  const txt=await res.text();let data;try{data=txt?JSON.parse(txt):null}catch{data={message:'Unexpected database response'}}
  if(!res.ok){const e=new Error(data.message||data.details||'Database request failed');e.status=res.status; e.code=data.code; e.provider='supabase';throw e;}return data;
};
const razorpay=async(path,method='GET',body)=>{
  const auth=Buffer.from(process.env.RAZORPAY_KEY_ID+':'+process.env.RAZORPAY_KEY_SECRET).toString('base64');
  const res=await fetch('https://api.razorpay.com/v1/'+path,{method,headers:{Authorization:'Basic '+auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();if(!res.ok){const err=new Error(data?.error?.description||'Payment gateway error');err.status=res.status;err.code=data?.error?.code;err.provider='razorpay';throw err;}return data;
};
const safeDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d||'') && !Number.isNaN(new Date(d+'T12:00:00Z').getTime());
const slotTimes = d => {
  const day=new Date(d+'T12:00:00Z').getUTCDay(),ranges=day===0?[[660,840]]:[[660,840],[1020,1200]];
  return ranges.flatMap(([start,end])=>Array.from({length:(end-start)/30},(_,i)=>{const t=start+i*30;return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')}));
};
const istNow = () => {
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const parts=Object.fromEntries(formatter.formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
};
const validSlot=(d,t)=>{
  if(!safeDate(d)||!/^\d{2}:\d{2}$/.test(t||''))return false;
  const now=istNow(), diff=(new Date(d+'T12:00:00Z')-new Date(now.date+'T12:00:00Z'))/864e5;
  return diff>=0&&diff<=90&&(diff>0||t>now.time)&&slotTimes(d).includes(t);
};
// Fixed clinic fee, charged identically for audio and video consultations.
// Razorpay expects the amount in paise: 300 INR = 30000 paise.
const fee=()=>30000;
module.exports={json,configured,databaseConfigured,supa,razorpay,safeDate,slotTimes,istNow,validSlot,fee,crypto};
