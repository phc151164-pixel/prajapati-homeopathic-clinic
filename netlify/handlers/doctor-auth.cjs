'use strict';
const {auth,member,identify,sameOrigin,cookies,withSession,cookieNames,json}=require('../lib/doctor-auth.cjs');
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
   return withSession(json(200,{ok:true}),null);
  }
  if(b.action==='recover'){
   if(typeof b.email!=='string'||b.email.length>254||!b.email.includes('@'))return json(400,{error:'Enter a valid email.'});
   // Same neutral response for unknown, unauthorized and known accounts.
   try{await auth('recover','POST',{email:b.email});}catch{}
   return json(200,{message:'If the account exists, a recovery email will arrive. Open it in this browser.'});
  }
  if(['login','refresh','verifyRecovery'].includes(b.action)){
   let session;
   if(b.action==='login'){
    if(typeof b.email!=='string'||b.email.length>254||typeof b.password!=='string'||b.password.length>256)return json(400,{error:'Enter your email and password.'});
    session=await auth('token?grant_type=password','POST',{email:b.email,password:b.password});
   }else if(b.action==='refresh'){
    const refresh=cookies(event)[cookieNames[1]];if(!refresh)return withSession(json(401,{error:'Please sign in again.'}),null);
    session=await auth('token?grant_type=refresh_token','POST',{refresh_token:refresh});
   }else{
    if(typeof b.tokenHash!=='string'||!/^[a-f0-9]{32,128}$/i.test(b.tokenHash))return json(400,{error:'Recovery link is invalid.'});
    session=await auth('verify','POST',{token_hash:b.tokenHash,type:'recovery'});
   }
   const user=await member(session.access_token);
   if(!user){try{await auth('logout','POST',{},session.access_token);}catch{}return withSession(json(403,{error:'This account is not authorized for the clinic dashboard.'}),null);}
   return withSession(json(200,{user}),session);
  }
  if(b.action==='password'){
   const user=await identify(event);if(!user)return json(401,{error:'Sign in or open a valid recovery link first.'});
   if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)return json(400,{error:'Use a password with 12–128 characters.'});
   await auth('user','PUT',{password:b.password},cookies(event)[cookieNames[0]]);
   try{await auth('logout','POST',{},cookies(event)[cookieNames[0]]);}catch{}
   return withSession(json(200,{message:'Password changed. Please sign in again.'}),null);
  }
  return json(400,{error:'Unknown action'});
 }catch{return withSession(json(401,{error:'Sign-in failed or the session expired. Check your credentials or recovery link.'}),null);}
};
