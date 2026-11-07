const {crypto} = require('./_common');
const authorized = event => {
 const expected=(process.env.PHC_ADMIN_TOKEN||'').trim();
 if(expected.length<32)return false;
 const token=(event.headers?.authorization||event.headers?.Authorization||'').replace(/^Bearer\s+/i,'').trim();
 const supplied=Buffer.from(token),wanted=Buffer.from(expected);
 if(supplied.length!==wanted.length)return false;
 return crypto.timingSafeEqual(supplied,wanted);
};
module.exports={authorized};
