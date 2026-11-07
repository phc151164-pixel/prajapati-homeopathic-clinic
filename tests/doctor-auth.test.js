const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../netlify/handlers/doctor-auth.cjs').handler;
const dashboard=require('../netlify/handlers/doctor-dashboard.cjs').handler;
const {sameOrigin}=require('../netlify/lib/doctor-auth.cjs');
const {bookingAmount}=require('../netlify/lib/clinic-config.cjs');
const userId='11111111-1111-4111-8111-111111111111',origin='https://preview.example.test';
const env={...process.env},originalFetch=fetch;
let requests=[],allowed=true;
function setup(){
 Object.assign(process.env,{PHC_DASHBOARD_ENABLED:'true',PHC_SUPABASE_AUTH_KEY:'anon-synthetic',SUPABASE_URL:'https://synthetic.supabase.co',PHC_SUPABASE_SERVER_KEY:'server-synthetic',CONTEXT:'deploy-preview',DEPLOY_PRIME_URL:origin});allowed=true;requests=[];
 global.fetch=async(url,opts)=>{
  requests.push({url:String(url),opts});let data;
  if(url.includes('/auth/v1/token')||url.includes('/auth/v1/verify'))data={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600};
  else if(url.endsWith('/auth/v1/user'))data={id:userId,email:'synthetic@example.test'};
  else if(url.includes('phc_admin_accounts?'))data=allowed?[{user_id:userId}]:[];
  else if(url.includes('/auth/v1/'))data={};
  else if(url.includes('online_bookings?'))data=[{amount_paise:25000}];
  else data={items:[]};
  return {ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)};
 };
}
const post=(action,extra={})=>({httpMethod:'POST',rawUrl:origin+'/.netlify/functions/doctor-auth',headers:{origin,cookie:'__Host-phc_access=synthetic-access; __Host-phc_refresh=synthetic-refresh'},body:JSON.stringify({action,...extra})});
test.afterEach(()=>{global.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);});
test('login validates server-side allowlist and sets only secure HttpOnly session cookies',async()=>{
 setup();const r=await handler(post('login',{email:'synthetic@example.test',password:'synthetic-password'}));assert.equal(r.statusCode,200);
 const loginRequest=requests.find(x=>x.url.includes('/auth/v1/token'));assert.equal(loginRequest.opts.headers.Authorization,undefined);
 assert.equal(r.body.includes('synthetic-access'),false);assert.equal(r.body.includes('synthetic-refresh'),false);
 assert.equal(r.multiValueHeaders['Set-Cookie'].length,2);for(const c of r.multiValueHeaders['Set-Cookie']){assert.match(c,/HttpOnly; Secure; SameSite=Strict/);assert.match(c,/Path=\//);assert.doesNotMatch(c,/Domain=/);}
});
test('valid Supabase account without explicit admin membership is denied',async()=>{
 setup();allowed=false;const r=await handler(post('login',{email:'synthetic@example.test',password:'synthetic-password'}));assert.equal(r.statusCode,403);assert.ok(r.multiValueHeaders['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
});
test('forged cross-origin auth/dashboard POSTs are rejected before mutations',async()=>{
 setup();const p=post('login',{email:'synthetic@example.test',password:'synthetic-password'});p.headers.origin='https://attacker.test';assert.equal((await handler(p)).statusCode,403);assert.equal(requests.length,0);
 p.body=JSON.stringify({action:'settings_save',data:{}});assert.equal((await dashboard(p)).statusCode,403);assert.ok(!requests.some(x=>x.url.includes('phc_dashboard_write')));
});
test('dashboard ignores browser-provided actor and uses verified auth identity',async()=>{
 setup();const r=await dashboard(post('patient_save',{data:{name:'Synthetic',mobile:'0000000000'},p_actor:'attacker'}));assert.equal(r.statusCode,200);const req=requests.find(x=>x.url.includes('phc_dashboard_write'));assert.equal(JSON.parse(req.opts.body).p_actor,userId);
});
test('revoked membership immediately blocks protected dashboard operations',async()=>{
 setup();allowed=false;assert.equal((await dashboard(post('patient_save',{data:{}}))).statusCode,401);assert.ok(!requests.some(x=>x.url.includes('phc_dashboard_write')));
});
test('logout revokes Supabase session and clears both cookies',async()=>{
 setup();const r=await handler(post('logout'));assert.equal(r.statusCode,200);assert.ok(requests.some(x=>x.url.endsWith('/auth/v1/logout')));assert.ok(r.multiValueHeaders['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
});
test('refresh and recovery recheck admin membership before issuing cookies',async()=>{
 setup();allowed=false;assert.equal((await handler(post('refresh'))).statusCode,403);assert.equal((await handler(post('verifyRecovery',{tokenHash:'a'.repeat(64)}))).statusCode,403);
});
test('new dashboard deployment gate is closed by default',async()=>{
 setup();delete process.env.PHC_DASHBOARD_ENABLED;assert.equal((await handler(post('login'))).statusCode,503);assert.equal((await dashboard(post('patient_save'))).statusCode,503);assert.equal(requests.length,0);
});
test('payment verification reads the booking snapshot rather than new consultation fee',async()=>{
 setup();assert.equal(await bookingAmount('order_Synthetic'),25000);
 global.fetch=async()=>({ok:true,text:async()=>JSON.stringify([])});await assert.rejects(bookingAmount('order_Unknown'));
});

test('origin protection uses the actual request URL when deployment environment URL is absent or stale',()=>{
 setup();delete process.env.DEPLOY_PRIME_URL;delete process.env.URL;
 assert.equal(sameOrigin(post('login')),true);
 process.env.DEPLOY_PRIME_URL='https://old-preview.example.test';assert.equal(sameOrigin(post('login')),true);
 const p=post('login');p.headers.origin='https://attacker.test';p.headers['x-forwarded-host']='attacker.test';assert.equal(sameOrigin(p),false);
 p.headers.origin=origin;delete p.rawUrl;assert.equal(sameOrigin(p),false);
});
test('origin protection rejects opaque, malformed and insecure request origins',()=>{
 setup();for(const value of ['null',origin+'/',origin+'/fake','not-a-url']){const p=post('login');p.headers.origin=value;assert.equal(sameOrigin(p),false);}
 const p=post('login');p.rawUrl='http://preview.example.test/api';p.headers.origin='http://preview.example.test';assert.equal(sameOrigin(p),false);
});
