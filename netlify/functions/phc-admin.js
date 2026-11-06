const {json,supa,safeDate,slotTimes,istNow,crypto} = require('./_common');
function authorized(event){
 const expected=(process.env.PHC_ADMIN_TOKEN||'').trim();
 if(expected.length<32)return false;
 const token=(event.headers?.authorization||event.headers?.Authorization||'').replace(/^Bearer\s+/i,'').trim();
 if(token.length!==expected.length)return false;
 return crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected));
}
exports.handler=async(event)=>{
 if(!authorized(event))return json(401,{error:'Administrator access denied. Check the admin token.'});
 if(!['GET','POST'].includes(event.httpMethod))return json(405,{error:'Method not allowed'});
 try{
  let date,body;
  if(event.httpMethod==='POST'){
   try{body=JSON.parse(event.body||'{}');}catch{return json(400,{error:'Invalid request'});}
   date=body.date;
   const time=body.time===null||body.time===''?null:body.time;
   if(!safeDate(date)||typeof body.closed!=='boolean'||(time!==null&&!slotTimes(date).includes(time)))return json(400,{error:'Choose a valid date and slot'});
   const now=istNow();if(date<now.date||date>new Date(Date.parse(now.date+'T12:00:00Z')+365*86400000).toISOString().slice(0,10))return json(400,{error:'Choose a date in the next 365 days'});
   await supa('rpc/phc_change_closure','POST',{p_date:date,p_time:time,p_closed:body.closed,p_reason:String(body.reason||'Doctor unavailable').slice(0,120)});
  }else date=event.queryStringParameters?.date;
  if(!safeDate(date))return json(400,{error:'Select a valid date'});
  const [closures,bookings]=await Promise.all([
   supa('phc_closures?select=slot_time,reason&slot_date=eq.'+encodeURIComponent(date)),
   supa('online_bookings?select=slot_time,status,razorpay_order_id,held_until&slot_date=eq.'+encodeURIComponent(date)+'&status=in.(paid,held)')
  ]);
  return json(200,{date,closures,bookings:bookings.filter(b=>b.status==='paid'||Boolean(b.razorpay_order_id)||new Date(b.held_until).getTime()>Date.now()).map(b=>({time:b.slot_time,status:b.status})),slots:slotTimes(date)});
 }catch(e){console.error('PHC ADMIN ERROR:',e.provider||'database',e.status||'none',e.code||'none');return json(503,{error:'Could not update clinic calendar. Ensure the SQL migration has been run.'});}
};
