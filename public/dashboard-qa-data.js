(()=>{'use strict';
const patients=Array.from({length:35},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),patient_id:'PHC-'+String(i+1).padStart(6,'0'),full_name:'Demo Patient '+(i+1),mobile:'0000000000',registered_at:'2026-11-09T00:00:00Z',completed_visits:i%3,version:1}));
const appointment={slot_date:'2026-11-09',slot_time:'11:00',patient_name:'Demo Patient',mobile:'0000000000',consultation_kind:'new',mode:'video',amount_paise:30000,status:'paid',visit_state:'planned',patient_id:patients[0].id};
window.fetch=async(input,options={})=>{let data={items:[]};const url=new URL(input,location.origin),section=url.searchParams.get('section');
 if(options.method==='POST')return new Response(JSON.stringify({error:'Static test preview: saving is disabled.'}),{status:403});
 if(url.pathname.endsWith('/doctor-auth'))data={user:{email:'demo@example.invalid'}};
 else if(url.pathname.endsWith('/doctor-dashboard')){
  if(section==='patients'){const page=Number(url.searchParams.get('page'))||0;data={items:patients.slice(page*30,page*30+31)};}
  else if(section==='patient')data={patient:patients[0],summary:{completed:2,upcoming:1,first:'2026-11-01',latest:'2026-11-09'},source_profiles:[],visits:[{id:'demo',visit_date:'2026-11-09',visit_time:'11:00',kind:'new',mode:'video',state:'planned',payment_status:'paid',notes:'Synthetic preview only.'}]};
  else if(section==='appointments')data={items:[appointment]};
  else if(section==='clinic_requests')data={items:[{...appointment,status:'requested',id:'demo',version:1}]};
  else if(section==='calendar')data={items:[],slots:['11:00','11:30','12:00','12:30','13:00','13:30'],closures:[]};
  else if(section==='settings')data={config:{weekly:Array.from({length:7},()=>[['11:00','14:00'],['17:00','20:00']]),overrides:{'2026-11-10':[]},slotMinutes:30,newFeePaise:30000,followupFeePaise:30000,onlineEnabled:true,payAtClinic:false},version:1};
 }
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
})();
