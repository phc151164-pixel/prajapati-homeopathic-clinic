(()=>{'use strict';
const form=document.getElementById('paidConsultForm');if(!form)return;
const $=id=>document.getElementById(id),date=$('paidDate'),slotBox=$('paidSlots'),book=$('paidBookButton'),status=$('paidStatus'),fee=$('paidFee'),paymentMethods=$('paidPaymentMethods');
let clinicAttempt=null;
let chosen='',availability=null,refreshing=false,paymentInProgress=false;
const kindLabel=document.createElement('label');kindLabel.textContent='Consultation type';const kind=document.createElement('select');kind.id='paidKind';for(const [value,text]of [['new','New patient'],['followup','Follow-up']]){const o=document.createElement('option');o.value=value;o.textContent=text;kind.append(o);}kindLabel.append(kind);const choiceRow=document.createElement('div');choiceRow.className='paid-fields';choiceRow.append(kindLabel);form.prepend(choiceRow);
const methodLabel=document.createElement('label');methodLabel.textContent='Payment choice';const method=document.createElement('select');method.id='paidMethod';for(const [v,t]of [['online','Pay online'],['clinic','Pay at Clinic — doctor approval required']]){const o=document.createElement('option');o.value=v;o.textContent=t;method.append(o);}methodLabel.append(method);kindLabel.after(methodLabel);
function methodNote(){book.textContent=method.value==='clinic'?'Send appointment request':'Book & pay securely';if(chosen)note(method.value==='clinic'?'Request only: this slot is reserved after doctor approval. Payment remains due.':'Payment is needed to confirm this slot.');if(paymentMethods)paymentMethods.hidden=method.value==='clinic'||!chosen;}
method.addEventListener('change',methodNote);
const requestSummary=document.createElement('p');requestSummary.className='paid-msg';requestSummary.setAttribute('role','status');form.append(requestSummary);
const showFee=()=>{if(availability?.ready)fee.textContent='Consultation fee: ₹'+((kind.value==='followup'?availability.followupFeePaise:availability.feePaise)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});};kind.addEventListener('change',showFee);
const indiaNow=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
const format=t=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;};
const note=(txt,error=false)=>{status.textContent=txt;status.style.color=error?'#a33232':'#456e52';};
const localSlots=(d)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return [];const day=new Date(d+'T12:00:00+05:30').getDay();const periods=day===0?[[660,840]]:[[660,840],[1020,1200]];return periods.flatMap(([start,end])=>Array.from({length:(end-start)/30},(_,i)=>{const n=start+i*30;return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}));};
const renderUnverified=(message)=>{const now=new Date(),istTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);slotBox.replaceChildren();for(const t of (availability?.ready?availability.slots.map(x=>x.time):localSlots(date.value))){const b=document.createElement('button');b.type='button';b.className='paid-slot unverified';b.disabled=true;b.setAttribute('aria-label',format(t)+'—live availability not verified');const label=document.createElement('span');label.textContent=format(t);const small=document.createElement('small');small.textContent=date.value<indiaNow()||(date.value===indiaNow()&&t<=istTime)?'Past':'Not verified';b.append(label,small);slotBox.appendChild(b);}if(availability?.ready)showFee();else fee.textContent='Consultation fee available after live availability loads';note(message);};
date.min=indiaNow();date.value=indiaNow();
async function loadSlots(){
 chosen='';book.disabled=true;if(paymentMethods)paymentMethods.hidden=true;availability=null;slotBox.innerHTML='<p class="paid-msg">Loading slots…</p>';
 if(!date.value)return;
 try{
  const res=await fetch('/.netlify/functions/consult-availability?date='+encodeURIComponent(date.value),{cache:'no-store'});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Could not load availability');
  availability=data;
  if(!data.ready){renderUnverified('Scheduled consultation times are shown for information only. Booking and payment will be enabled after secure setup. Please contact the clinic on WhatsApp.');return;}
  method.options[0].disabled=!data.paymentsEnabled;method.options[1].disabled=!data.payAtClinicEnabled;if(method.selectedOptions[0].disabled)method.value=data.payAtClinicEnabled?'clinic':'online';methodNote();
  if(!data.paymentsEnabled&&!data.payAtClinicEnabled){renderUnverified('Online payment is temporarily OFF for safety checks. Please contact the clinic on WhatsApp.');return;}
  showFee();
  slotBox.replaceChildren();
  for(const item of data.slots){const button=document.createElement('button');button.type='button';button.className='paid-slot '+(item.status==='free'?'':item.status);button.dataset.time=item.time;button.disabled=item.status!=='free';
   const top=document.createElement('span');top.textContent=format(item.time);const bottom=document.createElement('small');bottom.textContent=({free:'Available',held:'Payment in progress',booked:'Booked',past:'Unavailable'})[item.status]||'Unavailable';button.append(top,bottom);
   if(item.status==='free')button.addEventListener('click',()=>{slotBox.querySelectorAll('.selected').forEach(el=>el.classList.remove('selected'));button.classList.add('selected');chosen=item.time;book.disabled=false;if(paymentMethods)paymentMethods.hidden=false;methodNote();});
   slotBox.appendChild(button);
  }
  if(!data.slots.length)slotBox.textContent='No slots for this date.';
 }catch(err){renderUnverified('Live booking is not available on this deployment. Times are shown for reference, not confirmed availability. Contact the clinic on WhatsApp.');}
}
function formatEnd(t){const [h,m]=t.split(':').map(Number);const total=h*60+m+(availability?.slotMinutes||30);return format(String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0'));}
async function confirmPayment(response){
  paymentInProgress=false;
  try{const res=await fetch('/.netlify/functions/consult-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:response.razorpay_order_id,paymentId:response.razorpay_payment_id,signature:response.razorpay_signature})});const result=await res.json();
   if(result.status==='confirmed')note('Payment verified! Your appointment is confirmed. The clinic will arrange your call.');else note(result.message||result.error||'Payment confirmation pending. Contact the clinic; do not pay twice.',true);
  }catch{note('Payment may have been received, but confirmation is delayed. Contact the clinic and do not pay again.',true)}
  await loadSlots();
}
form.addEventListener('submit',async(e)=>{
 e.preventDefault();if(refreshing||!chosen||!availability?.ready||(method.value==='clinic'?availability.payAtClinicEnabled!==true:availability.paymentsEnabled!==true))return;
 const name=$('paidName').value.trim(),mobile=$('paidMobile').value.trim();if(name.length<2||!/^[0-9]{10}$/.test(mobile)){note('Enter patient name and a valid 10-digit phone number.',true);return;}
 if(method.value==='clinic'){
  const payload={date:date.value,time:chosen,mode:$('paidMode').value,name,mobile,kind:kind.value};const fingerprint=JSON.stringify(payload);
  if(clinicAttempt?.fingerprint!==fingerprint)clinicAttempt={fingerprint,key:crypto.randomUUID()};
  refreshing=true;book.disabled=true;note('Sending appointment request…');
  try{const res=await fetch('/.netlify/functions/consult-clinic-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestKey:clinicAttempt.key})});const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');await loadSlots();requestSummary.textContent=data.slotReserved?'The doctor has approved this request. Cash payment is still due.':'Request received. Your slot is NOT reserved yet. Contact the clinic for doctor approval. Reference: '+data.requestId;note('Clinic request acknowledged. See the request reference below.');}
  catch(error){note(error.message,true);book.disabled=false;}finally{refreshing=false;}return;
 }
 if(!window.Razorpay){note('Payment gateway is still loading. Please try again.',true);return;}
 refreshing=true;book.disabled=true;note('Holding your time slot securely…');
 try{
  const res=await fetch('/.netlify/functions/consult-create-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:date.value,time:chosen,mode:$('paidMode').value,name,mobile,kind:kind.value})});const data=await res.json();if(!res.ok)throw Error(data.error||'Booking failed');
  paymentInProgress=true;
  const options={key:data.key,amount:data.amount,currency:'INR',name:'Prajapati Homeopathic Clinic',description:(data.mode==='video'?'Video':'Audio')+' consultation · '+data.date+' '+data.time,order_id:data.orderId,prefill:{name,contact:mobile},theme:{color:'#087344'},handler:confirmPayment,modal:{ondismiss:()=>{paymentInProgress=false;note('Payment window closed. Your time may remain reserved until payment is checked. If money was deducted, do not pay again; contact the clinic.');loadSlots();}}};
  new Razorpay(options).open();note('Complete payment in the secure Razorpay checkout.');
 }catch(err){note(err.message,true);await loadSlots()}finally{refreshing=false}
});
date.addEventListener('change',loadSlots);
loadSlots();
setInterval(()=>{if(document.visibilityState==='visible'&&!refreshing&&!chosen&&!paymentInProgress){loadSlots()}},60000);
})();
