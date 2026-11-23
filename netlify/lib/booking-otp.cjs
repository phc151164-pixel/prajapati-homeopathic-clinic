const {createHmac, timingSafeEqual} = require('node:crypto');

const enabled = () => process.env.PHC_BOOKING_OTP_REQUIRED === 'true' ||
  (require('./deploy-context.cjs').context === 'deploy-preview' && Boolean(process.env.MESSAGE_CENTRAL_AUTH_TOKEN));

const whatsapp = () => process.env.PHC_BOOKING_OTP_PROVIDER === 'fast2sms';
function signingKey() {
  const secret = process.env.PHC_OTP_SIGNING_SECRET;
  return secret?.trim().length >= 32 ? secret : null;
}
const signingConfigured = () => signingKey() !== null;

function digest(value) {
  const key = signingKey();
  if (!key) throw Error('OTP signing is unavailable.');
  return createHmac('sha256', key)
    .update((whatsapp() ? 'phc-booking-whatsapp-otp-v1:' : 'phc-booking-otp-v1:') + value).digest('base64url');
}

function sign(purpose, mobile, id = '') {
  const value = Buffer.from(JSON.stringify({purpose, mobile, id, expires: Date.now() + 300000})).toString('base64url');
  return value + '.' + digest(value);
}

function read(token, purpose, mobile) {
  if (!signingKey() || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [value, signature] = parts;
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(digest(value));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url'));
    return payload.purpose === purpose && payload.mobile === mobile && payload.expires > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

module.exports = {enabled, whatsapp, signingConfigured, sign, read};
