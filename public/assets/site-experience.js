(()=>{'use strict';
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
document.querySelectorAll('.site-menu').forEach(menu=>{
 const trigger=menu.querySelector('summary');let timer=null;
 const close=focus=>{if(!menu.open)return;clearTimeout(timer);const finish=()=>{menu.open=false;menu.classList.remove('is-closing');if(focus)trigger.focus({preventScroll:true});};if(reduced.matches)finish();else{menu.classList.add('is-closing');timer=setTimeout(finish,140);}};
 trigger.addEventListener('click',event=>{event.preventDefault();if(menu.open)close(false);else{clearTimeout(timer);menu.classList.remove('is-closing');menu.open=true;}});
 menu.querySelector('nav').addEventListener('click',event=>{if(event.target.closest('a'))close(true);});
 document.addEventListener('click',event=>{if(menu.open&&!menu.contains(event.target))close(false);});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();close(true);}});
});
const track=document.querySelector('.page-scroll-track'),fill=track?.querySelector('.page-scroll-fill');
if(track&&fill){let scheduled=false;const update=()=>{scheduled=false;const max=document.documentElement.scrollHeight-window.innerHeight;const value=max>0?Math.min(100,Math.max(0,window.scrollY/max*100)):0;fill.style.transform='scaleX('+(value/100)+')';track.setAttribute('aria-valuenow',String(Math.round(value)));};const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(update);}};window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);window.addEventListener('load',schedule);window.addEventListener('pageshow',schedule);if(typeof ResizeObserver==='function')new ResizeObserver(schedule).observe(document.body);update();}
})();
