const {json,configured,supa,safeDate,slotTimes,validSlot,istNow,fee} = require('./_common');
exports.handler=async(event)=>{
 try{
console.log('PHC TEST VARIABLE:', process.env.PHC_SECRET_TEST ? 'FOUND' : 'MISSING');
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed'});
  if(!configured())return json(200,{ready:false,message:'Clinic online payment setup is pending. Slots shown after setup.',slots:[]});
  const date=event.queryStringParameters?.date;
  if(!safeDate(date))return json(400,{error:'Select a valid date'});
  const times=slotTimes(date);
  const rows=await supa('online_bookings?select=slot_time,status,held_until&slot_date=eq.'+encodeURIComponent(date)+'&status=in.(held,paid)');
  const now=Date.now();const occupied=new Map(rows.filter(b=>b.status==='paid'||(b.status==='held'&&new Date(b.held_until).getTime()>now)).map(b=>[b.slot_time,b.status]));
  return json(200,{ready:true,feePaise:fee(),currency:'INR',date,slots:times.map(time=>({time,status:!validSlot(date,time)?'past':occupied.get(time)==='paid'?'booked':occupied.get(time)==='held'?'held':'free'}))});
 }catch(e){return json(500,{error:'Could not load live availability. Please try again.'})}
};
