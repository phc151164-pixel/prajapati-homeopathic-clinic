const {createHmac, timingSafeEqual} = require('node:crypto');

const fastConfigured = () => Boolean(process.env.FAST2SMS_API_KEY?.trim() && process.env.FAST2SMS_OTP_ID?.trim());
const signingKey = () => fastConfigured() ? process.env.FAST2SMS_API_KEY.trim() : process.env.MESSAGE_CENTRAL_AUTH_TOKEN;
const enabled = () => process.env.PHC_BOOKING_OTP_REQUIRED === 'true' ||
  (require('./deploy-context.cjs').context === 'deploy-preview' && Boolean(signingKey()));

function digest(value) {
  return createHmac('sha256', signingKey())
    .update('phc-booking-otp-v1:' + value).digest('base64url');
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

module.exports = {enabled, fastConfigured, sign, read};
