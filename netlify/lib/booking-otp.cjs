const {createHmac, timingSafeEqual} = require('node:crypto');

const enabled = () => process.env.PHC_BOOKING_OTP_REQUIRED === 'true' ||
  (require('./deploy-context.cjs').context === 'deploy-preview' && Boolean(process.env.MESSAGE_CENTRAL_AUTH_TOKEN));

function digest(value) {
  return createHmac('sha256', process.env.MESSAGE_CENTRAL_AUTH_TOKEN)
    .update('phc-booking-otp-v1:' + value).digest('base64url');
}

function sign(purpose, mobile, id = '') {
  const value = Buffer.from(JSON.stringify({purpose, mobile, id, expires: Date.now() + 300000})).toString('base64url');
  return value + '.' + digest(value);
}

function read(token, purpose, mobile) {
  if (!process.env.MESSAGE_CENTRAL_AUTH_TOKEN || typeof token !== 'string') return null;
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

module.exports = {enabled, sign, read};
