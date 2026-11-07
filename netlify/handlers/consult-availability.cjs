const {schedule,future}=require('../lib/clinic-config.cjs');
const {json,configured,databaseConfigured,supa,safeDate,slotTimes,validSlot,fee} = require('../functions/_common');
exports.handler=async(event)=>{
 try{
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed'});
  if(!databaseConfigured())return json(200,{ready:false,message:'Clinic online payment setup is pending. Slots shown after setup.',slots:[]});
  const date=event.queryStringParameters?.date;
  if(!safeDate(date))return json(400,{error:'Select a valid date'});
  const config=await schedule(date),times=config.slots;
  const [rows,closures]=await Promise.all([
   supa('online_bookings?select=slot_time,status,held_until,razorpay_order_id&slot_date=eq.'+encodeURIComponent(date)+'&status=in.(held,paid)'),
   supa('phc_closures?select=slot_time&slot_date=eq.'+encodeURIComponent(date))
  ]);
  const now=Date.now();const occupied=new Map(rows.filter(b=>b.status==='paid'||(b.status==='held'&&(Boolean(b.razorpay_order_id)||new Date(b.held_until).getTime()>now))).map(b=>[b.slot_time,b.status]));
  for(const time of config.clinicReserved||[])occupied.set(time,'paid');
  const allDayClosed=closures.some(c=>c.slot_time===null),blocked=new Set(closures.map(c=>c.slot_time).filter(Boolean));
  return json(200,{ready:true,payAtClinicEnabled:config.payAtClinic===true,paymentsEnabled:configured()&&config.onlineEnabled===true,feePaise:config.newFeePaise,followupFeePaise:config.followupFeePaise,slotMinutes:config.slotMinutes,currency:'INR',date,slots:times.map(time=>({time,status:!future(date,time)?'past':occupied.get(time)==='paid'?'booked':allDayClosed||blocked.has(time)?'closed':occupied.get(time)==='held'?'held':'free'}))});
 }catch(e){
   console.error('PHC DATABASE ERROR:', 'status:', e.status || 'none', 'code:', e.code || 'none', 'provider:', e.provider || 'unknown');
   return json(500,{error:'Could not load live availability. Please try again.'});
 }

};
