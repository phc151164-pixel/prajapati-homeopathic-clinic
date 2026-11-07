import test from 'node:test';
import assert from 'node:assert/strict';
import adapter from '../netlify/lib/request-adapter.cjs';
import createOrder from '../netlify/functions/consult-create-order.mjs';

test('adapter preserves JSON body, method, headers, query and response', async()=>{
 const request=new Request('https://example.invalid/api?date=2026-11-10',{method:'POST',headers:{'Content-Type':'application/json','X-Test':'present'},body:'{"name":"Test"}'});
 const response=await adapter.invoke(async event=>{
  assert.equal(event.httpMethod,'POST');assert.equal(event.headers['x-test'],'present');
  assert.equal(event.queryStringParameters.date,'2026-11-10');assert.deepEqual(JSON.parse(event.body),{name:'Test'});
  return {statusCode:409,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:'{"error":"occupied"}'};
 },request,4096);
 assert.equal(response.status,409);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),{error:'occupied'});
});
test('oversized streamed body is rejected before calling the booking handler',async()=>{
 let calls=0;
 const response=await adapter.invoke(async()=>{calls++;},new Request('https://example.invalid/api',{method:'POST',body:'x'.repeat(4097)}),4096);
 assert.equal(response.status,413);assert.equal(calls,0);
});
test('modern order endpoint rejects GET before any provider call',async()=>{
 assert.equal((await createOrder(new Request('https://example.invalid/api'))).status,405);
});
test('modern order endpoint keeps the live kill switch effective',async()=>{
 const before={...process.env};const fetchBefore=global.fetch;
 try {
  Object.assign(process.env,{SUPABASE_URL:'https://example.invalid',PHC_SUPABASE_SERVER_KEY:'fake',RAZORPAY_KEY_ID:'rzp_live_fake',RAZORPAY_KEY_SECRET:'fake',PHC_LIVE_PAYMENTS_ENABLED:'false'});
  global.fetch=()=>{throw Error('Provider must not be called');};
  assert.equal((await createOrder(new Request('https://example.invalid/api',{method:'POST',body:'{}'}))).status,503);
 } finally {global.fetch=fetchBefore;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});
