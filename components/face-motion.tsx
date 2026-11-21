'use client';
import { useEffect } from 'react';

// The life of every Agent face of 24px or more (CompanyAgentFace's .face--look), mounted once by app/frame
// (design-reference/app.js: lookFrame, lookReset, the blink interval, hopFace and its click handler). It draws nothing.
// Its features turn toward the pointer, one face that is not working blinks now and then, and a pressed face hops,
// as does the same Agent's face drawn again on the page the press opened. Never with reduced motion.
// The reference carries the hop 450ms from the press, because its pages are drawn at once; here a page the press opens
// takes as long as the server and the machine take, so the 450ms count from that page's first face of the Agent, and
// a press waits up to 10s for its page (#529).
const blinkEvery=1300, blinkFor=140, hopFor=520, hopCarries=450, hopWaits=10000;
const faces=()=>Array.from(document.querySelectorAll<SVGSVGElement>('.face--look'));
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// The press outlives the frame it was made in: a page with a frame of its own mounts this part again, and that page's
// faces still hop. The faces that already hopped are kept with it, so none hops twice for one press. `from` is the
// address the press was made on while the page it opens is not drawn yet, and null once it is or when it opens none.
let hop:{face:string,from:string|null,until:number,hopped:WeakSet<Element>}|null=null;
const address=()=>location.pathname+location.search;
// The address a press opens in this tab, or null: a link elsewhere in this app, pressed plainly.
const opens=(host:Element|null|undefined,event:MouseEvent)=>{
 if(!(host instanceof HTMLAnchorElement)||!host.href||(host.target&&host.target!=='_self')||host.hasAttribute('download')) return null;
 if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return null;
 const url=new URL(host.href,location.href);
 return url.origin===location.origin&&url.pathname+url.search!==address()?url.pathname+url.search:null;
};

export function FaceMotion() {
 useEffect(()=>{
  let pointer:{x:number,y:number}|null=null, frame=0, ends=0;
  // Every face's place is read first, then every face's shift written, so one frame lays the page out once.
  const look=()=>{
   frame=0;
   const height=window.innerHeight, list=faces();
   if(!pointer) { for(const face of list) { face.style.removeProperty('--fx'); face.style.removeProperty('--fy'); } return; }
   const at=pointer;
   const shifts=list.map(face=>{
    const box=face.getBoundingClientRect();
    if(!box.width||box.bottom<0||box.top>height) return null;
    const dx=at.x-(box.left+box.width/2), dy=at.y-(box.top+box.height/2);
    const distance=Math.hypot(dx,dy)||1, k=Math.min(1,distance/220);
    return [`${(dx/distance*1.6*k).toFixed(2)}px`,`${(dy/distance*1.3*k).toFixed(2)}px`];
   });
   list.forEach((face,index)=>{ const shift=shifts[index]; if(shift) { face.style.setProperty('--fx',shift[0]); face.style.setProperty('--fy',shift[1]); } });
  };
  const schedule=()=>{ if(!frame) frame=requestAnimationFrame(look); };
  const move=(event:PointerEvent)=>{ if(event.pointerType==='touch'||reduced()) return; pointer={x:event.clientX,y:event.clientY}; schedule(); };
  const reset=()=>{ pointer=null; schedule(); };
  const blink=window.setInterval(()=>{
   if(reduced()||document.hidden) return;
   const height=window.innerHeight;
   const list=faces().filter(face=>{ if(face.classList.contains('is-thinking')||!face.querySelector('.face__eye')) return false; const box=face.getBoundingClientRect(); return box.width>0&&box.bottom>=0&&box.top<=height; });
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
  // The same Agent's face drawn after the press (the page it opened, the panel drawn again) hops once, while the press
  // is fresh: within 450ms of the press, or of the opened page's first such face.
  const again=()=>{
   if(!hop) return;
   if(hop.until<=Date.now()) { hop=null; drawn.disconnect(); return; }
   if(hop.from!==null&&hop.from===address()) return;
   const fresh=Array.from(document.querySelectorAll(`.face--look[data-face="${hop.face}"]`)).filter(face=>!hop!.hopped.has(face)&&face.getBoundingClientRect().width);
   if(!fresh.length) return;
   if(hop.from!==null) { hop.from=null; hop.until=Date.now()+hopCarries; endAt(); }
   for(const face of fresh) jump(face);
  };
  const drawn=new MutationObserver(again);
  const endAt=()=>{ window.clearTimeout(ends); if(hop) ends=window.setTimeout(()=>{ hop=null; drawn.disconnect(); },Math.max(0,hop.until-Date.now())); };
  const watch=()=>{
   if(!hop) return;
   drawn.disconnect(); drawn.observe(document.body,{childList:true,subtree:true});
   endAt();
  };
  const press=(event:MouseEvent)=>{
   const target=event.target instanceof Element?event.target:null;
   const host=target?.closest('button, a[href], [data-action]');
   const face=target?.closest('.face--look[data-face]')??host?.querySelector('.face--look[data-face]');
   if(!face) return;
   const page=opens(host,event);
   hop={face:face.getAttribute('data-face')!,from:page?address():null,until:Date.now()+(page?hopWaits:hopCarries),hopped:new WeakSet()};
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
