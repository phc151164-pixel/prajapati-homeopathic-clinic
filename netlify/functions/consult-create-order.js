const {json,configured,supa,razorpay,validSlot,fee} = require('./_common');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!configured())return json(503,{error:'Online booking setup is incomplete.'});
 let holdId, stage='input', orderCreated=false;
 try{
  let b;
  try{b=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid booking information.'});}
  const date=b.date,time=b.time,mode=b.mode,name=String(b.name||'').trim(),mobile=String(b.mobile||'').trim();
  if(!validSlot(date,time)||!['video','audio'].includes(mode)||!/^[0-9]{10}$/.test(mobile)||name.length<2||name.length>80)
   return json(400,{error:'Please provide a valid future slot, name and mobile number.'});

  stage='reserve';
  const held=await supa('rpc/phc_reserve_online_slot','POST',{p_date:date,p_time:time,p_mode:mode,p_name:name,p_mobile:mobile,p_fee:fee()});
  holdId=typeof held==='string'?held:held?.[0]?.phc_reserve_online_slot;
  if(!holdId)throw Object.assign(new Error('Reservation did not return an ID'),{provider:'supabase'});

  stage='razorpay_order';
  const order=await razorpay('orders','POST',{amount:fee(),currency:'INR',receipt:holdId.slice(0,32),notes:{booking_id:holdId}});
  if(!order?.id)throw Object.assign(new Error('Payment order ID missing'),{provider:'razorpay'});
  orderCreated=true;

  stage='attach_order';
  await supa('rpc/phc_attach_order','POST',{p_id:holdId,p_order:order.id});
  return json(200,{orderId:order.id,bookingId:holdId,key:process.env.RAZORPAY_KEY_ID,amount:fee(),currency:'INR',name,contact:mobile,mode,date,time});
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
