// Doctor-only reconciliation of existing Razorpay orders. Never releases an unpaid slot.
const {json,supa,razorpay,fee,paymentConfigured,safeDate} = require('./_common');
const {authorized} = require('./_admin_auth');
const {identify,sameOrigin}=require('../lib/doctor-auth.cjs');
exports.handler=async(event)=>{
 const dashboardMode=process.env.PHC_DASHBOARD_ENABLED==='true';
 const permitted=dashboardMode?Boolean(await identify(event))&&(event.httpMethod==='GET'||sameOrigin(event)):authorized(event);
 if(!permitted)return json(401,{error:'Administrator access denied'});
 if(!['GET','POST'].includes(event.httpMethod))return json(405,{error:'Method not allowed'});
 if(!paymentConfigured())return json(503,{error:'Payment verification is not configured'});
 if((event.body||'').length>2048)return json(413,{error:'Request too large'});
 try{
  if(event.httpMethod==='GET'){
   const date=event.queryStringParameters?.date;
   if(!safeDate(date))return json(400,{error:'Select a valid date'});
   const rows=await supa('online_bookings?select=id,slot_time,razorpay_order_id,created_at&slot_date=eq.'+encodeURIComponent(date)+'&status=eq.held&razorpay_order_id=not.is.null&order=slot_time.asc&limit=100');
   // No patient names or phone numbers are returned to the calendar.
   return json(200,{date,pending:rows.map(b=>({bookingId:b.id,time:b.slot_time,orderId:b.razorpay_order_id,createdAt:b.created_at}))});
  }
  let b;try{b=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid request'});}
  if(typeof b.bookingId!=='string'||!/^[a-fA-F0-9-]{36}$/.test(b.bookingId))return json(400,{error:'Invalid booking ID'});
  const rows=await supa('online_bookings?select=id,status,razorpay_order_id,amount_paise&id=eq.'+encodeURIComponent(b.bookingId)+'&limit=1');
  if(rows.length!==1)return json(404,{error:'Booking not found'});
  if(rows[0].status==='paid')return json(200,{status:'already_confirmed'});
  if(rows[0].status!=='held'||!/^order_[A-Za-z0-9]+$/.test(rows[0].razorpay_order_id||''))return json(409,{error:'Booking is not an active payment hold'});
  const orderId=rows[0].razorpay_order_id,amount=rows[0].amount_paise;
  if(!Number.isSafeInteger(amount)||amount<1)return json(409,{error:"Invalid booking amount; keep slot reserved."});
  const [order,collection]=await Promise.all([razorpay('orders/'+encodeURIComponent(orderId)),razorpay('orders/'+encodeURIComponent(orderId)+'/payments')]);
  if(order.id!==orderId||order.status!=='paid'||order.amount!==amount||order.amount_paid!==amount||order.currency!=='INR'||rows[0].amount_paise!==amount)return json(200,{status:'not_confirmed',message:'No fully paid order verified. Keep this slot reserved until a safe resolution.'});
  const matches=Array.isArray(collection?.items)?collection.items.filter(p=>p.order_id===orderId&&p.status==='captured'&&p.amount===amount&&p.currency==='INR'&&/^pay_[A-Za-z0-9]+$/.test(p.id||'')):[];
  if(matches.length!==1)return json(200,{status:'needs_review',message:'Captured payment needs manual review. Do not reopen the slot.'});
  const confirmed=await supa('rpc/phc_confirm_paid_slot','POST',{p_order:orderId,p_payment:matches[0].id,p_amount:amount});
  return confirmed===true?json(200,{status:'confirmed',message:'Payment confirmed and appointment booked.'}):json(200,{status:'needs_review',message:'Payment captured but booking not updated. Contact clinic support.'});
 }catch(e){console.error('PHC RECONCILE ERROR:',e.provider||'unknown',e.status||'none',e.code||'none');return json(503,{error:'Could not complete this check. No booking was released.'});}
};
