import alerts from '../lib/booking-alerts.cjs';
// Netlify scheduled functions are not publicly URL-invokable.
export default async()=>{try{const result=await alerts.dispatch();console.info('PHC_BOOKING_ALERT_BATCH',JSON.stringify(result));}catch{console.error('PHC_BOOKING_ALERT_BATCH_FAILED');}};
export const config={schedule:'* * * * *'};
