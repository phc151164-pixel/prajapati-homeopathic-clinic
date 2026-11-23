import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import otpHandler from '../netlify/functions/consult-mobile-otp.mjs';

const hash = mobile => createHash('sha256').update(mobile).digest('hex');
const mobile = '9999999999';

test('OTP send RPC enforces both rolling limits and keeps only hashes', async () => {
 const db = await PGlite.create();
 try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(readFileSync(new URL('../supabase/migrations/20261123130000_booking_otp_send_limits.sql', import.meta.url), 'utf8'));
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query('SELECT public.phc_record_booking_otp_send($1)', [hash(mobile)]), /permission denied/);
  await assert.rejects(db.query('SELECT * FROM public.phc_booking_otp_sends'), /permission denied/);
  await db.exec('RESET ROLE');
  await db.query("INSERT INTO public.phc_booking_otp_sends VALUES (decode($1,'hex'), clock_timestamp() - interval '25 hours')", [hash(mobile)]);
  const record = async digest => (await db.query('SELECT public.phc_record_booking_otp_send($1) AS allowed', [digest])).rows[0].allowed;
  assert.equal(await record(hash(mobile)), true);
  assert.equal(await record(hash(mobile)), true);
  assert.equal(await record(hash(mobile)), false);
  assert.equal(await record(hash('8888888888')), true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.phc_booking_otp_sends WHERE sent_at < now() - interval '24 hours'")).rows[0].n, 0);
  await db.query("UPDATE public.phc_booking_otp_sends SET sent_at=now()-interval '10 minutes' WHERE mobile_hash=decode($1,'hex')", [hash(mobile)]);
  for (let i=0;i<3;i++) {
   assert.equal(await record(hash(mobile)), true);
   await db.query("UPDATE public.phc_booking_otp_sends SET sent_at=now()-interval '10 minutes' WHERE mobile_hash=decode($1,'hex')", [hash(mobile)]);
  }
  assert.equal(await record(hash(mobile)), false);
  await db.query("UPDATE public.phc_booking_otp_sends SET sent_at=now()-interval '61 minutes' WHERE mobile_hash=decode($1,'hex')", [hash(mobile)]);
  assert.equal(await record(hash(mobile)), true);
 } finally { await db.close(); }
});

test('OTP sends stop before provider access when the per-mobile limit or database blocks the request', async t => {
 const env = {...process.env}, originalFetch = global.fetch;
 t.after(() => {
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  global.fetch = originalFetch;
 });
 Object.assign(process.env, {PHC_BOOKING_OTP_REQUIRED:'true', PHC_BOOKING_OTP_PROVIDER:'fast2sms',
  FAST2SMS_API_KEY:'synthetic-provider-test', FAST2SMS_BOOKING_OTP_ID:'synthetic-template',
  PHC_OTP_SIGNING_SECRET:'synthetic-signing-secret-for-tests-only',
  SUPABASE_URL:'https://synthetic.supabase.co', PHC_SUPABASE_SERVER_KEY:'synthetic-server'});
 for (const [reply,status] of [[false,429],[null,503]]) {
  const calls = [];
  global.fetch = async (url,options) => {
   calls.push(String(url));
   assert.deepEqual(JSON.parse(options.body), {p_mobile_hash:hash(mobile)});
   return new Response(JSON.stringify(reply), {status:reply===null?500:200});
  };
  const response = await otpHandler(new Request('https://clinic.example.test/.netlify/functions/consult-mobile-otp',
   {method:'POST',body:JSON.stringify({action:'send',mobile})}));
  assert.equal(response.status,status);
  assert.deepEqual(calls,['https://synthetic.supabase.co/rest/v1/rpc/phc_record_booking_otp_send']);
 }
});

test('OTP tokens require a dedicated signing secret and stop validating after rotation', async t => {
 const {default:otp} = await import('../netlify/lib/booking-otp.cjs');
 const env = {...process.env};
 t.after(() => {
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
 });
 process.env.MESSAGE_CENTRAL_AUTH_TOKEN = 'synthetic-sms-provider-token-long-enough';
 process.env.FAST2SMS_API_KEY = 'synthetic-whatsapp-provider-key-long-enough';
 process.env.PHC_OTP_SIGNING_SECRET = 'synthetic-signing-secret-for-tests-only';
 const token = otp.sign('verified',mobile);
 assert.equal(otp.read(token,'verified',mobile)?.mobile,mobile);
 for (const provider of ['messagecentral','fast2sms']) {
  process.env.PHC_BOOKING_OTP_PROVIDER = provider;
  for (const secret of [undefined,'x'.repeat(31)]) {
   if (secret === undefined) delete process.env.PHC_OTP_SIGNING_SECRET;
   else process.env.PHC_OTP_SIGNING_SECRET = secret;
   assert.equal(otp.read(token,'verified',mobile),null);
   assert.throws(() => otp.sign('verified',mobile), /signing is unavailable/);
  }
 }
 process.env.PHC_BOOKING_OTP_PROVIDER = 'messagecentral';
 process.env.PHC_OTP_SIGNING_SECRET = 'synthetic-replacement-signing-secret';
 assert.equal(otp.read(token,'verified',mobile),null);
});
