'use strict';
const {json,supa}=require('../functions/_common');
const {enabled,future}=require('../lib/clinic-config.cjs');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!enabled())return json(503,{error:'Clinic requests are unavailable.'});
 if(Buffer.byteLength(event.body||'')>4096)return json(413,{error:'Request too large'});
 let b;try{b=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid request'});}
 const name=String(b.name||'').trim(),mobile=String(b.mobile||'').trim();
 if(!future(b.date,b.time)||!['audio','video'].includes(b.mode)||!['new','followup'].includes(b.kind)||name.length<2||name.length>80||!/^\d{10}$/.test(mobile)||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestKey||''))return json(400,{error:'Enter a valid future slot, patient name and mobile number.'});
 try{
  const result=await supa('rpc/phc_request_clinic_booking','POST',{p_key:b.requestKey,p_date:b.date,p_time:b.time,p_mode:b.mode,p_name:name,p_mobile:mobile,p_kind:b.kind});
  return json(200,result);
 }catch(e){return json(e.code==='23505'?409:503,{error:e.code==='23505'?'This slot is unavailable. Choose another time.':'Request could not be submitted. Contact the clinic or retry using the same request.'});}
};
