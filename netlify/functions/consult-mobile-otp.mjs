import {createHash} from 'node:crypto';
import adapter from '../lib/request-adapter.cjs';
import otp from '../lib/booking-otp.cjs';
import deployContext from '../lib/deploy-context.cjs';
import common from './_common.js';

const {json, supa} = common;
const requirePreviewDiagnostics = () => deployContext.context === 'deploy-preview';

async function handler(event) {
  if (event.httpMethod === 'GET') {
    const settings = {required: otp.enabled(), channel: otp.whatsapp() ? 'whatsapp' : 'sms'};
    if (requirePreviewDiagnostics() && otp.whatsapp()) {
      settings.otpIdMatches = process.env.FAST2SMS_BOOKING_OTP_ID?.trim() === 'e0331fdea4';
    }
    return json(200, settings);
  }
  if (event.httpMethod !== 'POST') return json(405, {error: 'Method not allowed.'});
  const authToken = process.env.MESSAGE_CENTRAL_AUTH_TOKEN;
  const whatsapp = otp.whatsapp();
  const apiKey = process.env.FAST2SMS_API_KEY?.trim();
  const otpId = process.env.FAST2SMS_BOOKING_OTP_ID?.trim();
  if (!otp.enabled() || (whatsapp ? !apiKey || !otpId : !authToken)) return json(503, {error: 'Mobile verification is unavailable.'});

  let input;
  try { input = JSON.parse(event.body); } catch { return json(400, {error: 'Invalid request.'}); }
  const {action, mobile, challenge, code, proof} = input || {};
  if (typeof mobile !== 'string' || !/^[6-9][0-9]{9}$/.test(mobile)) {
    return json(400, {error: 'Enter a valid 10-digit Indian mobile number.'});
  }

  if (action === 'recover-registration') {
    if (!otp.read(proof, 'verified', mobile)) {
      return json(403, {error: 'Verify your registered mobile number first.'});
    }
    try {
      const query = new URLSearchParams({
        select: 'patient_code', mobile: 'eq.' + mobile, merged_into: 'is.null', registration_pending: 'eq.false',
        order: 'patient_code.asc', limit: '50'
      });
      const patients = await supa('phc_patients?' + query);
      return json(200, {registrations: patients.map(patient =>
        'PHC-' + String(patient.patient_code).padStart(6, '0'))});
    } catch {
      return json(503, {error: 'Could not find your registration number right now. Try again or contact the clinic.'});
    }
  }

  const send = action === 'send';
  const pending = send ? null : otp.read(challenge, 'challenge', mobile);
  if (!send && (action !== 'verify' || !pending || typeof code !== 'string' || !/^[0-9]{4,8}$/.test(code))) {
    return json(400, {error: 'Enter the latest verification code, or request a new one.'});
  }

  if (send) {
    try {
      const allowed = await supa('rpc/phc_record_booking_otp_send', 'POST', {
        p_mobile_hash: createHash('sha256').update(mobile).digest('hex')
      });
      if (allowed === false) return json(429, {error: 'Too many OTP requests. Wait before trying again.'});
      if (allowed !== true) throw Error('Unexpected OTP limit response');
    } catch {
      return json(503, {error: 'Mobile verification is temporarily unavailable. Please try again.'});
    }
  }

  if (whatsapp) {
    try {
      const response = await fetch('https://www.fast2sms.com/dev/otp/' + (send ? 'send' : 'verify'), {
        method: 'POST',
        headers: {Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify(send ? {mobile, otp_id: otpId, otp_expiry: 5, otp_length: 6} : {mobile, otp: code}),
        redirect: 'error',
        signal: AbortSignal.timeout(8000)
      });
      const requestId = response.headers.get('x-request-id');
      const result = await response.json().catch(() => null);
      if (requirePreviewDiagnostics() && !(response.ok && result?.return === true && Number(result.status_code) === 200)) {
        const message = [result?.message, result?.error].flat().filter(value => typeof value === 'string').join(' ');
        const reason = [
          [/invalid otp id/i, 'invalid_otp_id'],
          [/template.*not approved/i, 'template_not_approved'],
          [/please wait|resend limit/i, 'resend_limit'],
          [/insufficient.*balance/i, 'insufficient_balance'],
          [/not active|not connected/i, 'sender_unavailable'],
          [/authorization key/i, 'authorization_error'],
          [/variables_values|variable/i, 'template_variables']
        ].find(([pattern]) => pattern.test(message))?.[1] ?? 'unknown';
        console.warn('Fast2SMS OTP response', {
          reason,
          operation: send ? 'send' : 'verify',
          httpStatus: response.status,
          providerStatus: /^\d{3}$/.test(String(result?.status_code)) ? Number(result.status_code) : null,
          hasJsonBody: result !== null,
          hasRequestId: Boolean(requestId)
        });
      }
      if (response.ok && result?.return === true && Number(result.status_code) === 200) {
        return json(200, send ? {challenge: otp.sign('challenge', mobile)} : {proof: otp.sign('verified', mobile)});
      }
      if (response.status === 429 || Number(result?.status_code) === 429) {
        return json(429, {error: 'Too many OTP requests. Wait before trying again.'});
      }
      if (!send && [400, 404].includes(Number(result?.status_code ?? response.status))) {
        return json(400, {error: 'OTP could not be verified. Check the code or request a new one.'});
      }
    } catch (error) {
      if (requirePreviewDiagnostics()) {
        console.warn('Fast2SMS OTP request failed', {operation: send ? 'send' : 'verify', timedOut: error?.name === 'TimeoutError'});
      }
    }
    return json(503, {error: 'WhatsApp verification is temporarily unavailable. Please try again.'});
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
