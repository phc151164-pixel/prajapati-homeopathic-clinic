(()=>{'use strict';
// iOS compatibility: hide installation help when launched from the Home Screen.
if(window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches){
 document.querySelectorAll('.install-guide').forEach(guide=>{guide.hidden=true;});
}
})();
