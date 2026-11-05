const {json,configured,supa,razorpay,validSlot,fee} = require('./_common');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!configured())return json(503,{error:'Paid booking is not enabled yet.'});
 let holdId;
 try{
  const b=JSON.parse(event.body||'{}');const date=b.date,time=b.time,mode=b.mode,name=String(b.name||'').trim(),mobile=String(b.mobile||'').trim();
  if(!validSlot(date,time)||!['video','audio'].includes(mode)||!/^\d{10}$/.test(mobile)||name.length<2||name.length>80)return json(400,{error:'Please provide a valid future slot, name and mobile number.'});
  // Atomic database RPC creates 15-minute reservation or rejects occupied slot.
  const held=await supa('rpc/phc_reserve_online_slot','POST',{p_date:date,p_time:time,p_mode:mode,p_name:name,p_mobile:mobile,p_fee:fee()});
  holdId=typeof held==='string'?held:held?.[0]?.phc_reserve_online_slot;
  if(!holdId)throw Error('Reservation failed');
  const order=await razorpay('orders','POST',{amount:fee(),currency:'INR',receipt:holdId.slice(0,32),notes:{booking_id:holdId}});
  await supa('rpc/phc_attach_order','POST',{p_id:holdId,p_order:order.id});
  return json(200,{orderId:order.id,bookingId:holdId,key:process.env.RAZORPAY_KEY_ID,amount:fee(),currency:'INR',name,contact:mobile,mode,date,time});
 }catch(e){
  if(holdId)try{await supa('rpc/phc_cancel_held_slot','POST',{p_id:holdId})}catch{}
  return json(e.code==='23505'?409:400,{error:e.code==='23505'?'That slot is no longer available. Choose another green slot.':'Could not start booking. Please refresh and try again.'});
 }
};
