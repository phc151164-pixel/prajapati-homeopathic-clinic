const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const root='../netlify/functions/';
const common=require(root+'_common');
const availability=require(root+'consult-availability').handler;
const createOrder=require(root+'consult-create-order').handler;
const verify=require(root+'consult-verify').handler;
const webhook=require(root+'consult-webhook').handler;
const admin=require(root+'phc-admin').handler;
const reconcile=require(root+'phc-reconcile').handler;
const originalFetch=global.fetch;
const originalEnv={...process.env};
const baseEnv={SUPABASE_URL:'https://phc-test.supabase.co',PHC_SUPABASE_SERVER_KEY:'fake-testing-only',RAZORPAY_KEY_ID:'rzp_live_fake_test_key',RAZORPAY_KEY_SECRET:'fake-signature-test-secret',RAZORPAY_WEBHOOK_SECRET:'fake-test-webhook-secret',PHC_LIVE_PAYMENTS_ENABLED:'false',PHC_ENVIRONMENT:'staging',CONTEXT:'deploy-preview',PHC_ADMIN_TOKEN:'very-long-private-test-token-only-1234567890'};
const orderId='order_ABCD123456', paymentId='pay_ABCD123456', holdId='8f14e45f-ea31-4f67-9f37-409e2d0b8910';
const order={id:orderId,status:'paid',amount:30000,amount_paid:30000,currency:'INR'};
const payment={id:paymentId,order_id:orderId,status:'captured',amount:30000,currency:'INR'};
function response(v,status=200){return {ok:status<400,status,async json(){return v},async text(){return JSON.stringify(v)}}}
function setup(handler){Object.assign(process.env,baseEnv);let seen=[];global.fetch=async(url,opts)=>{const u=String(url);seen.push({url:u,opts});return handler(u,opts);};return seen;}
function signedWebhook(payload,secret=baseEnv.RAZORPAY_WEBHOOK_SECRET){const body=JSON.stringify(payload);return {httpMethod:'POST',headers:{'x-razorpay-signature':crypto.createHmac('sha256',secret).update(body).digest('hex')},body};}
function signedVerify(){return {httpMethod:'POST',body:JSON.stringify({orderId,paymentId,signature:crypto.createHmac('sha256',baseEnv.RAZORPAY_KEY_SECRET).update(orderId+'|'+paymentId).digest('hex')})};}
function defaultRoutes(url){
 if(url.includes('/v1/orders/'+orderId+'/payments'))return response({items:[payment]});
 if(url.includes('/v1/orders/'+orderId))return response(order);
 if(url.includes('/v1/payments/'+paymentId))return response(payment);
 if(url.includes('rpc/phc_confirm_paid_slot'))return response(true);
 if(url.includes('online_bookings?'))return response([{id:holdId,status:'held',amount_paise:30000,razorpay_order_id:orderId,slot_time:'11:00',created_at:'2026-11-07T00:00:00Z'}]);
 if(url.includes('phc_closures?'))return response([]);
 throw new Error('Unexpected network request '+url);
}
test('date validator rejects invalid dates without rolling February over',()=>{
 assert.equal(common.safeDate('2026-02-31'),false);
 assert.equal(common.safeDate('2026-11-07'),true);
 assert.equal(common.safeDate('2028-02-29'),true);
 assert.equal(common.safeDate('2026-02-29'),false);
 assert.equal(common.safeDate('2026-13-01'),false);
 assert.equal(common.safeDate({date:'2026-11-07'}),false);
});
test('Live switch false blocks NEW live orders (no database or Razorpay calls)',async()=>{
 const seen=setup(defaultRoutes);
 const result=await createOrder({httpMethod:'POST',body:'{}'});
 assert.equal(result.statusCode,503); assert.equal(seen.length,0);
 assert.equal(common.configured(),false);
});
test('availability reports live payments disabled, while showing slots',async()=>{
 const seen=setup(defaultRoutes);
 const result=await availability({httpMethod:'GET',queryStringParameters:{date:'2026-11-20'}});
 assert.equal(result.statusCode,200);
 assert.equal(JSON.parse(result.body).paymentsEnabled,false);
 assert.equal(JSON.parse(result.body).ready,true);
 assert.equal(JSON.parse(result.body).slots.length,12);
 assert.ok(seen.every(x=>x.url.includes('supabase.co')));
});
test('verification rejects forged Razorpay callback before any API call',async()=>{
 const seen=setup(defaultRoutes);
 const request=signedVerify(); request.body=JSON.stringify({...JSON.parse(request.body),signature:'0'.repeat(64)});
 const result=await verify(request);
 assert.equal(result.statusCode,400); assert.equal(seen.length,0);
});
test('verification can finish a paid order even while creation of live orders is OFF',async()=>{
 const seen=setup(defaultRoutes);
 const result=await verify(signedVerify());
 assert.equal(result.statusCode,200); assert.equal(JSON.parse(result.body).status,'confirmed');
 assert.ok(seen.some(x=>x.url.includes('rpc/phc_confirm_paid_slot')));
});
test('verification cannot confirm partially paid order',async()=>{
 const seen=setup(url=>url.includes('/v1/orders/'+orderId)?response({...order,amount_paid:10000}):defaultRoutes(url));
 const result=await verify(signedVerify());
 assert.equal(result.statusCode,202);
 assert.ok(!seen.some(x=>x.url.includes('rpc/phc_confirm_paid_slot')));
});
test('webhook rejects wrong signature before using any API',async()=>{
 const seen=setup(defaultRoutes);
 const req=signedWebhook({event:'order.paid',payload:{order:{entity:{id:orderId}}}});
 req.headers['x-razorpay-signature']='0'.repeat(64);
 const result=await webhook(req);
 assert.equal(result.statusCode,401);assert.equal(seen.length,0);
});
test('valid order.paid webhook with order-only payload verifies and books',async()=>{
 const seen=setup(defaultRoutes);
 const req=signedWebhook({event:'order.paid',payload:{order:{entity:{id:orderId}}}});
 const result=await webhook(req);
 assert.equal(result.statusCode,200);assert.ok(seen.some(x=>x.url.includes('/payments')));
 assert.ok(seen.some(x=>x.url.includes('rpc/phc_confirm_paid_slot')));
});
test('webhook refuses a payment capture if order not fully paid',async()=>{
 const seen=setup(url=>url.includes('/v1/orders/'+orderId)&&!url.includes('/payments')?response({...order,status:'attempted',amount_paid:0}):defaultRoutes(url));
 const req=signedWebhook({event:'payment.captured',payload:{payment:{entity:{order_id:orderId,id:paymentId}}}});
 const result=await webhook(req);
 assert.equal(result.statusCode,503);assert.ok(!seen.some(x=>x.url.includes('rpc/phc_confirm_paid_slot')));
});
test('webhook rejects mismatching order references',async()=>{
 const seen=setup(defaultRoutes);
 const req=signedWebhook({event:'order.paid',payload:{order:{entity:{id:orderId}},payment:{entity:{order_id:'order_FAKE'}}}});
 const result=await webhook(req);
 assert.equal(result.statusCode,400);assert.equal(seen.length,0);
});
test('unauthorized doctor cannot read bookings or reconcile',async()=>{
 const seen=setup(defaultRoutes);
 assert.equal((await admin({httpMethod:'GET',queryStringParameters:{date:'2026-11-20'},headers:{}})).statusCode,401);
 assert.equal((await reconcile({httpMethod:'GET',queryStringParameters:{date:'2026-11-20'},headers:{}})).statusCode,401);
 assert.equal(seen.length,0);
});
test('doctor reconciliation reads pending orders without exposing patient details',async()=>{
 const seen=setup(defaultRoutes);
 const result=await reconcile({httpMethod:'GET',queryStringParameters:{date:'2026-11-20'},headers:{authorization:'Bearer '+baseEnv.PHC_ADMIN_TOKEN}});
 assert.equal(result.statusCode,200);
 assert.equal(JSON.parse(result.body).pending.length,1);
 assert.ok(!JSON.stringify(JSON.parse(result.body)).includes('mobile'));
 assert.ok(!seen.some(x=>x.url.includes('razorpay.com')));
});
test('doctor reconciliation confirms verified captured payment; it never releases a slot',async()=>{
 const seen=setup(defaultRoutes);
 const result=await reconcile({httpMethod:'POST',headers:{authorization:'Bearer '+baseEnv.PHC_ADMIN_TOKEN},body:JSON.stringify({bookingId:holdId})});
 assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).status,'confirmed');
 assert.ok(seen.some(x=>x.url.includes('rpc/phc_confirm_paid_slot')));
 assert.ok(!seen.some(x=>x.url.includes('rpc/phc_cancel_held_slot')));
});
test('doctor reconciliation keeps unpaid Razorpay orders held for review',async()=>{
 const seen=setup(url=>url.includes('/v1/orders/'+orderId)&&!url.includes('/payments')?response({...order,status:'created',amount_paid:0}):defaultRoutes(url));
 const result=await reconcile({httpMethod:'POST',headers:{authorization:'Bearer '+baseEnv.PHC_ADMIN_TOKEN},body:JSON.stringify({bookingId:holdId})});
 assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).status,'not_confirmed');
 assert.ok(!seen.some(x=>x.url.includes('rpc/phc_confirm_paid_slot')||x.url.includes('rpc/phc_cancel_held_slot')));
});
test('test-mode new order attaches to a database hold without enabling live payments',async()=>{
 const when=new Date(common.istNow().date+'T12:00:00Z');when.setUTCDate(when.getUTCDate()+4);
 const date=when.toISOString().slice(0,10);
 const old={...baseEnv};old.RAZORPAY_KEY_ID='rzp_test_fake_test_key';
 const seen=setup((url)=>{
  if(url.includes('rpc/phc_reserve_online_slot'))return response(holdId);
  if(url.endsWith('/v1/orders'))return response({...order,status:'created',amount_paid:0});
  if(url.includes('rpc/phc_attach_order'))return response(null);
  throw Error('Unexpected request '+url);
 });
 process.env.RAZORPAY_KEY_ID=old.RAZORPAY_KEY_ID;
 const body={date,time:'11:00',mode:'video',name:'Test Patient',mobile:'9999999999'};
 const result=await createOrder({httpMethod:'POST',body:JSON.stringify(body)});
 assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).orderId,orderId);
 assert.ok(seen.some(x=>x.url.includes('rpc/phc_attach_order')));
});
test('Razorpay authentication failure cancels a temporary hold with no linked order',async()=>{
 const when=new Date(common.istNow().date+'T12:00:00Z');when.setUTCDate(when.getUTCDate()+4);
 const seen=setup(url=>{
  if(url.includes('rpc/phc_reserve_online_slot'))return response(holdId);
  if(url.endsWith('/v1/orders'))return response({error:{description:'Unauthorised request',code:'BAD_REQUEST_ERROR'}},401);
  if(url.includes('rpc/phc_cancel_held_slot'))return response(null);
  throw Error('Unexpected '+url);
 });
 process.env.RAZORPAY_KEY_ID='rzp_test_fake_test_key';
 const result=await createOrder({httpMethod:'POST',body:JSON.stringify({date:when.toISOString().slice(0,10),time:'11:00',mode:'audio',name:'Test Patient',mobile:'9999999999'})});
 assert.equal(result.statusCode,503);assert.ok(seen.some(x=>x.url.includes('rpc/phc_cancel_held_slot')));
});
test('doctor calendar can close a time slot only with a valid admin token',async()=>{
 const seen=setup(url=>{
  if(url.includes('rpc/phc_change_closure'))return response(null);
  if(url.includes('phc_closures?'))return response([]);
  if(url.includes('online_bookings?'))return response([]);
  throw Error('Unexpected '+url);
 });
 const result=await admin({httpMethod:'POST',headers:{authorization:'Bearer '+baseEnv.PHC_ADMIN_TOKEN},body:JSON.stringify({date:'2026-11-20',time:'11:00',closed:true})});
 assert.equal(result.statusCode,200);assert.ok(seen.some(x=>x.url.includes('rpc/phc_change_closure')));
});
test.after(()=>{global.fetch=originalFetch;Object.keys(process.env).filter(k=>!(k in originalEnv)).forEach(k=>delete process.env[k]);Object.assign(process.env,originalEnv);});

test('test keys cannot create orders in production even with staging flag',async()=>{
 const seen=setup(defaultRoutes);
 process.env.RAZORPAY_KEY_ID='rzp_test_fake_test_key';process.env.CONTEXT='production';
 assert.equal((await createOrder({httpMethod:'POST',body:'{}'})).statusCode,503);
 assert.equal(seen.length,0);
});
test('test keys require an explicitly isolated staging environment',()=>{
 setup(defaultRoutes);process.env.RAZORPAY_KEY_ID='rzp_test_fake_test_key';
 delete process.env.PHC_ENVIRONMENT;assert.equal(common.configured(),false);
});
test('Unicode bearer tokens with different byte lengths fail without throwing',async()=>{
 setup(defaultRoutes);
 const result=await admin({httpMethod:'GET',headers:{authorization:'Bearer '+'é'.repeat(baseEnv.PHC_ADMIN_TOKEN.length)}});
 assert.equal(result.statusCode,401);
});
test('verification rejects provider entities with unexpected IDs',async()=>{
 const seen=setup(url=>url.includes('/v1/orders/'+orderId)?response({...order,id:'order_other'}):defaultRoutes(url));
 assert.equal((await verify(signedVerify())).statusCode,202);
 assert.ok(!seen.some(x=>x.url.includes('rpc/phc_confirm_paid_slot')));
});
test('valid uppercase hexadecimal callback signature verifies',async()=>{
 setup(defaultRoutes);const event=signedVerify();const body=JSON.parse(event.body);
 body.signature=body.signature.toUpperCase();event.body=JSON.stringify(body);
 assert.equal((await verify(event)).statusCode,200);
});
