import adapter from '../lib/request-adapter.cjs';
import otp from '../lib/booking-otp.cjs';
import common from './_common.js';

const {json} = common;

async function handler(event) {
  if (event.httpMethod === 'GET') return json(200, {required: otp.enabled()});
  if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed.'});
  const authToken = process.env.MESSAGE_CENTRAL_AUTH_TOKEN;
  if (!otp.enabled() || !authToken) return json(503, {error: 'Mobile verification is unavailable.'});

  let input;
  try { input = JSON.parse(event.body); } catch { return json(400, {error: 'Invalid request.'}); }
  const {action, mobile, challenge, code} = input || {};
  if (typeof mobile !== 'string' || !/^[6-9][0-9]{9}$/.test(mobile)) {
    return json(400, {error: 'Enter a valid 10-digit Indian mobile number.'});
  }

  const send = action === 'send';
  const pending = send ? null : otp.read(challenge, 'challenge', mobile);
  if (!send && (action !== 'verify' || !pending || typeof code !== 'string' || !/^[0-9]{4,8}$/.test(code))) {
    return json(400, {error: 'Enter the OTP from your latest SMS, or request a new one.'});
  }

  const path = send ? 'send' : 'validateOtp';
  const params = send ? {countryCode: '91', flowType: 'SMS', mobileNumber: mobile} :
    {verificationId: pending.id, code};
  try {
    const response = await fetch('https://cpaas.messagecentral.com/verification/v3/' + path + '?' + new URLSearchParams(params), {
      method: send ? 'POST' : 'GET',
      headers: {authToken},
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    });
    const {responseCode, data} = await response.json();
    if (response.ok && responseCode === 200) {
      if (send && /^[0-9]{1,30}$/.test(String(data?.verificationId))) {
        return json(200, {challenge: otp.sign('challenge', mobile, String(data.verificationId))});
      }
      if (!send && data?.verificationStatus === 'VERIFICATION_COMPLETED' &&
          String(data.mobileNumber).replace(/^\+?91(?=\d{10}$)/, '') === mobile) {
        return json(200, {proof: otp.sign('verified', mobile)});
      }
    }
    if (!send && response.status < 500 && response.status !== 401 && response.status !== 403) {
      return json(400, {error: 'OTP could not be verified. Check the code or request a new one.'});
    }
  } catch {
    // Keep the OTP and provider credentials out of logs.
  }
  return json(503, {error: 'Mobile verification is temporarily unavailable. Please try again.'});
}

export default request => adapter.invoke(handler, request, 2048);

export const config = {
  path: '/.netlify/functions/consult-mobile-otp',
  rateLimit: {action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 8}
};
