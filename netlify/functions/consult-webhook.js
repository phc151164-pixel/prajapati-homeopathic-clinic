const {json,supa,crypto,fee} = require('./_common');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 const secret=process.env.RAZORPAY_WEBHOOK_SECRET;if(!secret)return json(503,{error:'Webhook not configured'});
 const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64'):Buffer.from(event.body||'','utf8');
 const signature=event.headers?.['x-razorpay-signature']||event.headers?.['X-Razorpay-Signature']||'';
 const digest=crypto.createHmac('sha256',secret).update(raw).digest('hex');
 if(signature.length!==digest.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(digest)))return json(401,{error:'Invalid webhook signature'});
 try{
  const webhook=JSON.parse(raw.toString('utf8'));
  if(['order.paid','payment.captured'].includes(webhook.event)){
   const order=webhook.payload?.order?.entity;const payment=webhook.payload?.payment?.entity;
   // order.paid contains both entities, payment.captured has payment only.
   const orderId=order?.id||payment?.order_id;
   if(orderId && payment?.status==='captured' && payment.amount===fee()){
     await supa('rpc/phc_confirm_paid_slot','POST',{p_order:orderId,p_payment:payment.id,p_amount:fee()});
   }
  }
  return json(200,{received:true});
 }catch(e){return json(500,{error:'Webhook processing failed; payment must be reconciled'})}
};
