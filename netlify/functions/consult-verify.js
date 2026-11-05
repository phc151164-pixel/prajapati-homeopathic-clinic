const {json,configured,supa,razorpay,crypto,fee} = require('./_common');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(!configured())return json(503,{error:'Payment gateway not ready.'});
 try{
  const p=JSON.parse(event.body||'{}');
  if(!/^order_[A-Za-z0-9]+$/.test(p.orderId||'')||!/^pay_[A-Za-z0-9]+$/.test(p.paymentId||'')||!/^\w{64}$/.test(p.signature||''))return json(400,{error:'Invalid payment details'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(p.orderId+'|'+p.paymentId).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(p.signature)))return json(400,{error:'Invalid payment verification signature'});
  const [order,payment]=await Promise.all([razorpay('orders/'+encodeURIComponent(p.orderId)),razorpay('payments/'+encodeURIComponent(p.paymentId))]);
  if(order.status!=='paid'||payment.status!=='captured'||payment.order_id!==p.orderId||payment.amount!==fee()||order.amount!==fee())return json(202,{status:'pending',message:'Payment is processing. Please contact the clinic if it was deducted but confirmation is delayed.'});
  const result=await supa('rpc/phc_confirm_paid_slot','POST',{p_order:p.orderId,p_payment:p.paymentId,p_amount:fee()});
  if(result===true)return json(200,{status:'confirmed',message:'Payment verified. Your slot is booked.'});
  return json(202,{status:'pending',message:'Payment received, but slot confirmation requires clinic assistance. Please contact the clinic; do not pay again.'});
 }catch(e){return json(500,{error:'Unable to confirm payment automatically. Do not pay again if already charged; contact the clinic.'})}
};
