const {enabled,schedule,future}=require('../lib/clinic-config.cjs');
const {json,configured,supa,razorpay,validSlot,fee} = require('../functions/_common');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!configured())return json(503,{error:'Online booking setup is incomplete.'});
 if((event.body||'').length>4096)return json(413,{error:'Request too large'});
 let holdId, stage='input', orderCreated=false, amount;
 try{
  let b;
  try{b=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid booking information.'});}
  if(b.whatsappConsent!==undefined&&typeof b.whatsappConsent!=='boolean')return json(400,{error:'Select a valid WhatsApp preference.'});
  const date=b.date,time=b.time,mode=b.mode,name=String(b.name||'').trim(),mobile=String(b.mobile||'').trim();
  if(!future(date,time)||!['video','audio'].includes(mode)||!/^[0-9]{10}$/.test(mobile)||name.length<2||name.length>80)
   return json(400,{error:'Please provide a valid future slot, name and mobile number.'});

  const config=await schedule(date),kind=b.kind||'new';
  if(!['new','followup'].includes(kind)||!config.slots.includes(time)||!config.onlineEnabled)return json(400,{error:'Choose a valid consultation type and available slot.'});
  amount=kind==='followup'?config.followupFeePaise:config.newFeePaise;
  stage='reserve';
  const held=enabled()?await supa('rpc/phc_reserve_online_slot_v3','POST',{p_date:date,p_time:time,p_mode:mode,p_name:name,p_mobile:mobile,p_kind:kind,p_whatsapp:b.whatsappConsent===true}):await supa('rpc/phc_reserve_online_slot','POST',{p_date:date,p_time:time,p_mode:mode,p_name:name,p_mobile:mobile,p_fee:fee()});
  holdId=enabled()?held?.id:typeof held==='string'?held:held?.[0]?.phc_reserve_online_slot;
  if(enabled())amount=held?.amount_paise;
  if(!Number.isSafeInteger(amount)||amount<1)throw Error('Invalid authoritative amount');
  if(!holdId)throw Object.assign(new Error('Reservation did not return an ID'),{provider:'supabase'});

  stage='razorpay_order';
  const order=await razorpay('orders','POST',{amount,currency:'INR',receipt:holdId.slice(0,32),notes:{booking_id:holdId}});
  if(!/^order_[A-Za-z0-9]+$/.test(order?.id||'')||order.amount!==amount||order.currency!=='INR')throw Object.assign(new Error('Payment order ID missing'),{provider:'razorpay'});
  orderCreated=true;

  stage='attach_order';
  await supa('rpc/phc_attach_order','POST',{p_id:holdId,p_order:order.id});
  return json(200,{orderId:order.id,bookingId:holdId,key:process.env.RAZORPAY_KEY_ID,amount,currency:'INR',name,contact:mobile,mode,date,time});
 }catch(e){
  // Log only provider/stage/status; never log payment keys or patient data.
  console.error('PHC BOOKING ERROR:', 'stage:',stage,'provider:',e.provider||'unknown','status:',e.status||'none','code:',e.code||'none');
  // A generated Razorpay order may need manual reconciliation if attaching it fails.
  if(holdId && !orderCreated){
   try{await supa('rpc/phc_cancel_held_slot','POST',{p_id:holdId});}catch{}
  }
  if(e.message==='Consultations are closed for this date or time')return json(409,{error:'The doctor is unavailable at this time. Please choose another slot.'});
  if(e.code==='23505')return json(409,{error:'That slot is no longer available. Please choose another green slot.'});
  if(e.status===401 && stage==='razorpay_order')return json(503,{error:'Payment gateway authentication failed. Please contact the clinic.'});
  if(stage==='attach_order')return json(503,{error:'Booking setup could not finish. Please contact the clinic; do not attempt payment yet.'});
  return json(503,{error:'Could not start booking. Please try later or contact the clinic.'});
 }
};
