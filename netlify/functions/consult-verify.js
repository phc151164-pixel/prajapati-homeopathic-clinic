const {bookingAmount}=require('../lib/clinic-config.cjs');
const {json,paymentConfigured,supa,razorpay,crypto,fee} = require('./_common');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!paymentConfigured())return json(503,{error:'Payment gateway not ready.'});
 if((event.body||'').length>2048)return json(413,{error:'Request too large'});
 try{
  const p=JSON.parse(event.body||'{}');
  if(!/^order_[A-Za-z0-9]+$/.test(p.orderId||'')||!/^pay_[A-Za-z0-9]+$/.test(p.paymentId||'')||!/^[a-fA-F0-9]{64}$/.test(p.signature||''))return json(400,{error:'Invalid payment details'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(p.orderId+'|'+p.paymentId).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(p.signature.toLowerCase())))return json(400,{error:'Invalid payment verification signature'});
  const amount=await bookingAmount(p.orderId);
  const [order,payment]=await Promise.all([razorpay('orders/'+encodeURIComponent(p.orderId)),razorpay('payments/'+encodeURIComponent(p.paymentId))]);
  if(order.id!==p.orderId||payment.id!==p.paymentId||order.status!=='paid'||order.amount_paid!==amount||payment.status!=='captured'||payment.order_id!==p.orderId||payment.amount!==amount||order.amount!==amount||order.currency!=='INR'||payment.currency!=='INR')return json(202,{status:'pending',message:'Payment is processing. Please contact the clinic if it was deducted but confirmation is delayed.'});
  const result=await supa('rpc/phc_confirm_paid_slot','POST',{p_order:p.orderId,p_payment:p.paymentId,p_amount:amount});
  if(result===true)return json(200,{status:'confirmed',message:'Payment verified. Your slot is booked.'});
  return json(202,{status:'pending',message:'Payment received, but slot confirmation requires clinic assistance. Please contact the clinic; do not pay again.'});
 }catch(e){console.error('PHC VERIFY ERROR:', 'provider:',e.provider||'unknown','status:',e.status||'none','code:',e.code||'none');return json(500,{error:'Unable to confirm payment automatically. Do not pay again if already charged; contact the clinic.'})}
};
