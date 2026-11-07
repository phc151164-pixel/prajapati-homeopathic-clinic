'use strict';
const {supa,json}=require('../functions/_common');
const cookieNames=['__Host-phc_access','__Host-phc_refresh'];
function cookies(event){return Object.fromEntries(String(event.headers?.cookie||'').split(';').map(x=>{const i=x.indexOf('=');return i<0?[]:[x.slice(0,i).trim(),x.slice(i+1)];}).filter(x=>x.length===2));}
function sameOrigin(event){
 const origin=event.headers?.origin;
 // Use the platform Request URL, not build-only environment values or forwarded headers.
 // Netlify's legacy handlers also provide rawUrl on their event.
 if(!origin||typeof event.rawUrl!=='string')return false;
 try{
  const destination=new URL(event.rawUrl),source=new URL(origin);
  return destination.protocol==='https:'&&source.origin===origin&&source.origin===destination.origin;
 }catch{return false;}
}
async function auth(path,method='GET',body,token){
 const base=new URL(process.env.SUPABASE_URL);
 if(base.protocol!=='https:'||base.pathname!=='/')throw Error('configuration');
 const key=process.env.PHC_SUPABASE_AUTH_KEY; // publishable or legacy anon key, kept on server
 if(!key)throw Error('configuration');
 const r=await fetch(base.origin+'/auth/v1/'+path,{method,headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 let data={};try{data=await r.json();}catch{}
 if(!r.ok)throw Object.assign(Error('Authentication failed'),{status:r.status});
 return data;
}
async function member(token){
 if(!token||token.length>8192)return null;
 const user=await auth('user','GET',undefined,token);
 if(!/^[a-f0-9-]{36}$/i.test(user.id||''))return null;
 const rows=await supa('phc_admin_accounts?select=user_id&user_id=eq.'+encodeURIComponent(user.id)+'&active=eq.true&limit=1');
 return rows.length===1?{id:user.id,email:user.email}:null;
}
async function identify(event){try{return await member(cookies(event)[cookieNames[0]]);}catch{return null;}}
function withSession(result,session){
 if(session&&(!session.access_token||!session.refresh_token||!Number.isFinite(session.expires_in)))throw Error('Invalid session');
 const values=session?[session.access_token,session.refresh_token]:['',''];
 result.multiValueHeaders={'Set-Cookie':cookieNames.map((name,i)=>`${name}=${values[i]}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${session?(i===0?Math.min(session.expires_in,3600):28800):0}`)};
 return result;
}
module.exports={auth,member,identify,sameOrigin,cookies,withSession,cookieNames,json};
