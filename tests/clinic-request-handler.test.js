const test=require('node:test'),assert=require('node:assert/strict');
const {handler}=require('../netlify/handlers/consult-clinic-request.cjs');
const env={...process.env},originalFetch=global.fetch;
let calls=[];
function setup(){calls=[];Object.assign(process.env,{PHC_DASHBOARD_ENABLED:'true',SUPABASE_URL:'https://synthetic.supabase.co',PHC_SUPABASE_SERVER_KEY:'synthetic-server',PHC_LIVE_PAYMENTS_ENABLED:'false'});global.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return {ok:true,text:async()=>JSON.stringify({requestId:'synthetic',status:'requested',slotReserved:false,amountPaise:30000})};};}
function body(){const d=new Date(Date.now()+2*864e5).toISOString().slice(0,10);return {date:d,time:'11:00',mode:'video',kind:'new',name:'Synthetic patient',mobile:'0000000000',requestKey:'22222222-2222-4222-8222-222222222222',amountPaise:1};}
const event=b=>({httpMethod:'POST',body:JSON.stringify(b)});
test.afterEach(()=>{global.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);});
test('clinic request works independently of gateway activation and never trusts browser amount',async()=>{setup();const r=await handler(event(body()));assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).slotReserved,false);assert.equal(calls.length,1);assert.match(calls[0].url,/rpc\/phc_request_clinic_booking$/);assert.equal('amountPaise' in calls[0].body,false);});
test('invalid or oversized requests stop before database access',async()=>{setup();for(const change of [{requestKey:'guess'},{mobile:'1'},{mode:'walkin'},{kind:'paid'},{date:'2000-01-01'}])assert.equal((await handler(event({...body(),...change}))).statusCode,400);assert.equal((await handler({httpMethod:'POST',body:'x'.repeat(4097)})).statusCode,413);assert.equal(calls.length,0);});
test('clinic request endpoint fails closed when dashboard is disabled',async()=>{setup();delete process.env.PHC_DASHBOARD_ENABLED;assert.equal((await handler(event(body()))).statusCode,503);assert.equal(calls.length,0);});
