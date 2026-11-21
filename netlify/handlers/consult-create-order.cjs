const bookingOtp = require('../lib/booking-otp.cjs');
const {enabled,schedule,future}=require('../lib/clinic-config.cjs');
const {json,configured,supa,razorpay,validSlot,fee} = require('../functions/_common');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!configured())return json(503,{error:'Online booking setup is incomplete.'});
 if((event.body||'').length>4096)return json(413,{error:'Request too large'});
 let holdId, stage='input', orderCreated=false, amount, followupReservation=false;
 try{
  let b;
  try{b=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid booking information.'});}
  const date=b.date,time=b.time,mode=b.mode,mobile=String(b.mobile||'').trim();
  const kind=b.kind||'new';
  let registrationCode;
  const name=String(b.name||'').trim();
  if(!future(date,time)||!['video','audio'].includes(mode)||!/^[0-9]{10}$/.test(mobile)||(kind!=='followup'&&(name.length<2||name.length>80)))
   return json(400,{error:'Please provide a valid future slot, name and mobile number.'});

  if (kind !== 'followup' && bookingOtp.enabled() && !bookingOtp.read(b.mobileProof, 'verified', mobile)) {
   return json(403, {error: 'Verify your mobile number before continuing to payment.'});
  }

  const config=await schedule(date);
  if(!['new','followup'].includes(kind)||!config.slots.includes(time)||!config.onlineEnabled)return json(400,{error:'Choose a valid consultation type and available slot.'});
  if (kind === 'followup') {
   const registration = String(b.registration || '').trim().toUpperCase();
   const match = /^PHC-([0-9]{6})$/.exec(registration);
   const mismatch = () => json(400,{error:'Registration number and mobile do not match. Use the details given by the clinic.'});
   if (!match) return mismatch();
   followupReservation = true;
   registrationCode = Number(match[1]);
  }
  amount=kind==='followup'?config.followupFeePaise:config.newFeePaise;
  stage='reserve';
  const held=kind==='followup'?await supa('rpc/phc_reserve_registered_followup','POST',{p_date:date,p_time:time,p_mode:mode,p_mobile:mobile,p_registration:registrationCode}):enabled()?await supa('rpc/phc_reserve_online_slot_v2','POST',{p_date:date,p_time:time,p_mode:mode,p_name:name,p_mobile:mobile,p_kind:kind}):await supa('rpc/phc_reserve_online_slot','POST',{p_date:date,p_time:time,p_mode:mode,p_name:name,p_mobile:mobile,p_fee:fee()});
  holdId=(kind==='followup'||enabled())?held?.id:typeof held==='string'?held:held?.[0]?.phc_reserve_online_slot;
  if(kind==='followup'||enabled())amount=held?.amount_paise;
  if(!Number.isSafeInteger(amount)||amount<1)throw Error('Invalid authoritative amount');
  if(!holdId)throw Object.assign(new Error('Reservation did not return an ID'),{provider:'supabase'});

  if(b.whatsappUpdates===true){
   await supa('online_bookings?id=eq.'+encodeURIComponent(holdId)+'&status=eq.held','PATCH',{
    whatsapp_updates_opt_in:true,whatsapp_opt_in_at:new Date().toISOString(),whatsapp_consent_version:'booking-whatsapp-v1'
   });
  }
  stage='razorpay_order';
  const order=await razorpay('orders','POST',{amount,currency:'INR',receipt:holdId.slice(0,32),notes:{booking_id:holdId}});
  if(!/^order_[A-Za-z0-9]+$/.test(order?.id||'')||order.amount!==amount||order.currency!=='INR')throw Object.assign(new Error('Payment order ID missing'),{provider:'razorpay'});
  orderCreated=true;

  stage='attach_order';
  await supa('rpc/phc_attach_order','POST',{p_id:holdId,p_order:order.id});
  return json(200,{orderId:order.id,bookingId:holdId,key:process.env.RAZORPAY_KEY_ID,amount,currency:'INR',name:kind==='followup'?undefined:name,contact:mobile,mode,date,time});
 }catch(e){
  // Log only provider/stage/status; never log payment keys or patient data.
  console.error('PHC BOOKING ERROR:', 'stage:',stage,'provider:',e.provider||'unknown','status:',e.status||'none','code:',e.code||'none');
  // A generated Razorpay order may need manual reconciliation if attaching it fails.
  if(holdId && !orderCreated){
   try{await supa('rpc/phc_cancel_held_slot','POST',{p_id:holdId});}catch{}
  }
  if(e.message==='Consultations are closed for this date or time')return json(409,{error:'The doctor is unavailable at this time. Please choose another slot.'});
  if(e.code==='P0002' && followupReservation)return json(400,{error:'Registration number and mobile do not match. Use the details given by the clinic.'});
  if(e.code==='23505')return json(409,{error:'That slot is no longer available. Please choose another green slot.'});
  if(e.status===401 && stage==='razorpay_order')return json(503,{error:'Payment gateway authentication failed. Please contact the clinic.'});
  if(stage==='attach_order')return json(503,{error:'Booking setup could not finish. Please contact the clinic; do not attempt payment yet.'});
  return json(503,{error:'Could not start booking. Please try later or contact the clinic.'});
 }
};
