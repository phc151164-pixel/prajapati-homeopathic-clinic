'use strict';
const crypto=require('node:crypto');
const {recoveryCookieName,withRecoveryCookie,auth,member,identify,sameOrigin,cookies,withSession,cookieNames,json}=require('../lib/doctor-auth.cjs');
exports.handler=async event=>{
 if(process.env.PHC_DASHBOARD_ENABLED!=='true')return json(503,{error:'Doctor dashboard is not enabled on this deployment.'});
 if(event.httpMethod==='GET'){
  const user=await identify(event);return user?json(200,{user}):json(401,{error:'Please sign in with an authorized clinic account.'});
 }
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!sameOrigin(event))return json(403,{error:'Request origin not allowed'});
 if(Buffer.byteLength(event.body||'')>12000)return json(413,{error:'Request too large'});
 let b;try{b=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid request'});}
 try{
  if(b.action==='logout'){
   const token=cookies(event)[cookieNames[0]];
   if(token){try{await auth('logout','POST',{},token);}catch{}}
   return withRecoveryCookie(withSession(json(200,{ok:true}),null),null);
  }
  if(b.action==='recover'){
   if(typeof b.email!=='string'||b.email.length>254||!b.email.includes('@'))return json(400,{error:'Enter a valid email.'});
   // Default email template supports PKCE: the verifier remains in an HttpOnly cookie.
   const verifier=crypto.randomBytes(32).toString('base64url');
   const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
   const redirect=new URL('/admin',event.rawUrl).href;
   // Same neutral response for unknown, unauthorized and known accounts.
   try{await auth('recover?redirect_to='+encodeURIComponent(redirect),'POST',{email:b.email,code_challenge:challenge,code_challenge_method:'s256'});}catch(error){
    if(error.status===429)return json(429,{error:'Recovery email limit reached. Please wait before trying again.'});
   }
   return withRecoveryCookie(json(200,{message:'If the account exists and email delivery is permitted, a recovery email will arrive. Open its link in this same browser within 10 minutes.'}),verifier);
  }
  if(['login','refresh','verifyRecovery','exchangeRecoveryCode'].includes(b.action)){
   let session;
   if(b.action==='login'){
    if(typeof b.email!=='string'||b.email.length>254||typeof b.password!=='string'||b.password.length>256)return json(400,{error:'Enter your email and password.'});
    session=await auth('token?grant_type=password','POST',{email:b.email,password:b.password});
   }else if(b.action==='refresh'){
    const refresh=cookies(event)[cookieNames[1]];if(!refresh)return withSession(json(401,{error:'Please sign in again.'}),null);
    session=await auth('token?grant_type=refresh_token','POST',{refresh_token:refresh});
   }else if(b.action==='exchangeRecoveryCode'){
    const verifier=cookies(event)[recoveryCookieName];
    if(typeof b.code!=='string'||!/^[A-Za-z0-9._~-]{20,512}$/.test(b.code)||!verifier||!/^[A-Za-z0-9_-]{43}$/.test(verifier))return withRecoveryCookie(json(400,{error:'Recovery link expired or was opened in a different browser. Request a new link in this browser.'}),null);
    session=await auth('token?grant_type=pkce','POST',{auth_code:b.code,code_verifier:verifier});
   }else{
    if(typeof b.tokenHash!=='string'||!/^[a-f0-9]{32,128}$/i.test(b.tokenHash))return json(400,{error:'Recovery link is invalid.'});
    session=await auth('verify','POST',{token_hash:b.tokenHash,type:'recovery'});
   }
   const user=await member(session.access_token);
   if(!user){try{await auth('logout','POST',{},session.access_token);}catch{}return withSession(json(403,{error:'This account is not authorized for the clinic dashboard.'}),null);}
   const response=withSession(json(200,{user}),session);
   return ['verifyRecovery','exchangeRecoveryCode'].includes(b.action)?withRecoveryCookie(response,null):response;
  }
  if(b.action==='password'){
   const user=await identify(event);if(!user)return json(401,{error:'Sign in or open a valid recovery link first.'});
   if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)return json(400,{error:'Use a password with 12–128 characters.'});
   await auth('user','PUT',{password:b.password},cookies(event)[cookieNames[0]]);
   try{await auth('logout','POST',{},cookies(event)[cookieNames[0]]);}catch{}
   return withSession(json(200,{message:'Password changed. Please sign in again.'}),null);
  }
  return json(400,{error:'Unknown action'});
 }catch{return withRecoveryCookie(withSession(json(401,{error:'Sign-in failed or the session expired. Check your credentials or recovery link.'}),null),null);}
};
