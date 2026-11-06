const {json,supa,razorpay,crypto,fee,paymentConfigured} = require('./_common');
// Always process authentic payments even if creation of NEW live orders is switched off.
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
 if(!secret||!paymentConfigured())return json(503,{error:'Webhook configuration incomplete'});
 if((event.body||'').length>131072)return json(413,{error:'Payload too large'});
 const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64'):Buffer.from(event.body||'','utf8');
 const signature=event.headers?.['x-razorpay-signature']||event.headers?.['X-Razorpay-Signature']||'';
 const digest=crypto.createHmac('sha256',secret).update(raw).digest('hex');
 if(typeof signature!=='string'||!(/^[a-fA-F0-9]{64}$/).test(signature)||!crypto.timingSafeEqual(Buffer.from(signature.toLowerCase()),Buffer.from(digest)))return json(401,{error:'Invalid webhook signature'});
 try{
  const webhook=JSON.parse(raw.toString('utf8'));
  if(!['order.paid','payment.captured'].includes(webhook.event))return json(200,{received:true});
  const fromOrder=webhook.payload?.order?.entity?.id;
  const fromPayment=webhook.payload?.payment?.entity?.order_id;
  if(fromOrder&&fromPayment&&fromOrder!==fromPayment)return json(400,{error:'Webhook order mismatch'});
  const orderId=fromOrder||fromPayment;
  if(typeof orderId!=='string'||!/^order_[A-Za-z0-9]+$/.test(orderId))return json(400,{error:'Invalid order reference'});
  const [order,collection]=await Promise.all([
   razorpay('orders/'+encodeURIComponent(orderId)),
   razorpay('orders/'+encodeURIComponent(orderId)+'/payments')
  ]);
  if(order.id!==orderId||order.status!=='paid'||order.amount!==fee()||order.amount_paid!==fee()||order.currency!=='INR'){
   // Retry later: a capture webhook may arrive before the whole order is marked paid.
   return json(503,{error:'Payment not fully settled yet'});
  }
  const matches=Array.isArray(collection?.items)?collection.items.filter(p=>p?.order_id===orderId&&p?.status==='captured'&&p?.amount===fee()&&p?.currency==='INR'&&/^pay_[A-Za-z0-9]+$/.test(p.id||'')):[];
  if(matches.length!==1)return json(503,{error:'Payment requires reconciliation'});
  const confirmed=await supa('rpc/phc_confirm_paid_slot','POST',{p_order:orderId,p_payment:matches[0].id,p_amount:fee()});
  if(confirmed!==true){console.error('PHC WEBHOOK: valid paid order not matched to a booking');return json(503,{error:'Payment requires clinic reconciliation'});}
  return json(200,{received:true});
 }catch(e){console.error('PHC WEBHOOK ERROR:',e.provider||'unknown',e.status||'none',e.code||'none');return json(503,{error:'Temporary payment verification problem'});}
};
