'use strict';
const {supa,slotTimes,fee,validSlot,istNow,safeDate}=require('../functions/_common');
const enabled=()=>process.env.PHC_DASHBOARD_ENABLED==='true';
async function schedule(date){
 if(!enabled())return {slots:slotTimes(date),slotMinutes:30,newFeePaise:fee(),followupFeePaise:fee(),onlineEnabled:true};
 const c=await supa('rpc/phc_public_schedule','POST',{p_date:date});
 if(!c||!Array.isArray(c.slots)||!Number.isInteger(c.newFeePaise)||!Number.isInteger(c.followupFeePaise)||!Number.isInteger(c.slotMinutes))throw Error('Invalid clinic configuration');
 return c;
}
function future(date,time){
 if(!safeDate(date)||typeof time!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))return false;
 const now=istNow(),diff=(Date.parse(date+'T12:00:00Z')-Date.parse(now.date+'T12:00:00Z'))/864e5;
 return diff>=0&&diff<=90&&(diff>0||time>now.time);
}
async function bookingAmount(orderId){
 const rows=await supa('online_bookings?select=amount_paise&razorpay_order_id=eq.'+encodeURIComponent(orderId)+'&limit=2');
 if(rows.length!==1||!Number.isSafeInteger(rows[0].amount_paise)||rows[0].amount_paise<1)throw Error('Booking amount unavailable');
 return rows[0].amount_paise;
}
module.exports={enabled,schedule,future,bookingAmount};
