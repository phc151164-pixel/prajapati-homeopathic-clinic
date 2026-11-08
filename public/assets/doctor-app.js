(()=>{'use strict';
// iOS compatibility: hide installation help when launched from the Home Screen.
if(window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches){
 document.querySelectorAll('.install-guide').forEach(guide=>{guide.hidden=true;});
}
const menu=document.getElementById('dashboardMenu');
if(menu){
 const trigger=menu.querySelector('summary');
 const close=restoreFocus=>{menu.open=false;if(restoreFocus)trigger.focus();};
 menu.querySelector('nav').addEventListener('click',event=>{if(event.target.closest('button'))close(true);});
 const logout=document.getElementById('logout');
 if(logout)logout.addEventListener('click',()=>close(false));
 document.addEventListener('click',event=>{if(menu.open&&!menu.contains(event.target))close(false);});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();close(true);}});
}
})();
