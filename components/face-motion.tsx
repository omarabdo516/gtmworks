'use client';
import { useEffect } from 'react';

// The life of every Agent face of 24px or more (CompanyAgentFace's .face--look), mounted once by app/frame
// (design-reference/app.js: lookFrame, lookReset, the blink interval, hopFace and its click handler). It draws nothing.
// Its features turn toward the pointer, one face that is not working blinks now and then, and a pressed face hops,
// as does the same Agent's face drawn again within 450ms (the page the press opened). Never with reduced motion.
const blinkEvery=1300, blinkFor=140, hopFor=520, hopCarries=450;
const faces=()=>Array.from(document.querySelectorAll<SVGSVGElement>('.face--look'));
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// The press outlives the frame it was made in: a page with a frame of its own mounts this part again, and that page's
// faces still hop. The faces that already hopped are kept with it, so none hops twice for one press.
let hop:{face:string,until:number,hopped:WeakSet<Element>}|null=null;

export function FaceMotion() {
 useEffect(()=>{
  let pointer:{x:number,y:number}|null=null, frame=0, ends=0;
  const look=()=>{
   frame=0;
   const height=window.innerHeight;
   for(const face of faces()) {
    if(!pointer) { face.style.removeProperty('--fx'); face.style.removeProperty('--fy'); continue; }
    const box=face.getBoundingClientRect();
    if(!box.width||box.bottom<0||box.top>height) continue;
    const dx=pointer.x-(box.left+box.width/2), dy=pointer.y-(box.top+box.height/2);
    const distance=Math.hypot(dx,dy)||1, k=Math.min(1,distance/220);
    face.style.setProperty('--fx',`${(dx/distance*1.6*k).toFixed(2)}px`);
    face.style.setProperty('--fy',`${(dy/distance*1.3*k).toFixed(2)}px`);
   }
  };
  const schedule=()=>{ if(!frame) frame=requestAnimationFrame(look); };
  const move=(event:PointerEvent)=>{ if(event.pointerType==='touch'||reduced()) return; pointer={x:event.clientX,y:event.clientY}; schedule(); };
  const reset=()=>{ pointer=null; schedule(); };
  const blink=window.setInterval(()=>{
   if(reduced()||document.hidden) return;
   const list=faces().filter(face=>!face.classList.contains('is-thinking')&&face.querySelector('.face__eye')&&face.getBoundingClientRect().width);
   if(!list.length) return;
   const face=list[Math.floor(Math.random()*list.length)];
   face.classList.add('is-blink'); window.setTimeout(()=>face.classList.remove('is-blink'),blinkFor);
  },blinkEvery);
  const jump=(face:Element)=>{
   if(reduced()) return;
   hop?.hopped.add(face);
   face.classList.remove('is-happy'); void face.getBoundingClientRect(); face.classList.add('is-happy');
   window.setTimeout(()=>face.classList.remove('is-happy'),hopFor);
  };
  // The same Agent's face drawn after the press (a new page, the panel drawn again) hops once, while the press is fresh.
  const again=()=>{
   if(!hop) return;
   if(hop.until<=Date.now()) { hop=null; drawn.disconnect(); return; }
   for(const face of document.querySelectorAll(`.face--look[data-face="${hop.face}"]`)) if(!hop.hopped.has(face)&&face.getBoundingClientRect().width) jump(face);
  };
  const drawn=new MutationObserver(again);
  const watch=()=>{
   if(!hop) return;
   drawn.disconnect(); drawn.observe(document.body,{childList:true,subtree:true});
   window.clearTimeout(ends); ends=window.setTimeout(()=>{ hop=null; drawn.disconnect(); },Math.max(0,hop.until-Date.now()));
  };
  const press=(event:MouseEvent)=>{
   const target=event.target instanceof Element?event.target:null;
   const host=target?.closest('button, a[href], [data-action]');
   const face=target?.closest('.face--look[data-face]')??host?.querySelector('.face--look[data-face]');
   if(!face) return;
   hop={face:face.getAttribute('data-face')!,until:Date.now()+hopCarries,hopped:new WeakSet()};
   jump(face);
   watch();
  };
  // Mounted again by the page the press opened: its faces may already be drawn.
  again(); watch();
  document.addEventListener('pointermove',move,{passive:true});
  document.documentElement.addEventListener('pointerleave',reset);
  window.addEventListener('blur',reset);
  window.addEventListener('click',press,true);
  return ()=>{
   cancelAnimationFrame(frame); window.clearInterval(blink); window.clearTimeout(ends); drawn.disconnect();
   document.removeEventListener('pointermove',move);
   document.documentElement.removeEventListener('pointerleave',reset);
   window.removeEventListener('blur',reset);
   window.removeEventListener('click',press,true);
  };
 },[]);
 return null;
}
