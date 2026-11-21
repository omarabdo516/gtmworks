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
// faces still hop. Its faces drawn before the press and those that already hopped are kept with it (`passed`), so none
// hops that was not drawn again, and none twice for one press.
type Hop={
 face:string, pressed:number, until:number, passed:WeakSet<Element>,
 // A press that follows a link: the address it was made on, and the first address after it, while the page it opened
 // has drawn none of the Agent's faces yet. Null when the press opens no page, or once that page drew one.
 opening:{from:string,to:string|null}|null,
};
let hop:Hop|null=null;
const address=()=>location.pathname+location.search;
// Whether a press follows a link to another page of this app in this tab.
const followsLink=(host:Element|null|undefined,event:MouseEvent)=>{
 if(!(host instanceof HTMLAnchorElement)||!host.href||(host.target&&host.target!=='_self')||host.hasAttribute('download')) return false;
 if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return false;
 const url=new URL(host.href,location.href);
 return url.origin===location.origin&&url.pathname+url.search!==address();
};
const facesOf=(agent:string)=>Array.from(document.querySelectorAll(`.face--look[data-face="${agent}"]`));

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
   hop?.passed.add(face);
   face.classList.remove('is-happy'); void face.getBoundingClientRect(); face.classList.add('is-happy');
   window.setTimeout(()=>face.classList.remove('is-happy'),hopFor);
  };
  const end=()=>{ hop=null; drawn.disconnect(); };
  // The same Agent's face drawn after the press (the page it opened, the panel drawn again) hops once, while the press
  // is fresh: within 450ms of the press, or of the first such face on the page it opened.
  const again=()=>{
   if(!hop) return;
   const now=Date.now();
   if(hop.until<=now) return end();
   const fresh=facesOf(hop.face).filter(face=>!hop!.passed.has(face)&&face.getBoundingClientRect().width);
   const opening=hop.opening;
   if(opening) {
    const at=address();
    // Still the page the press was made on: its copies redrawn now hop as any press's do, within 450ms.
    if(at===opening.from) { if(now-hop.pressed>=hopCarries) return; }
    else {
     opening.to??=at;
     // Gone on from the opened page before it drew the Agent: no later page takes the hop.
     if(at!==opening.to) return end();
     if(!fresh.length) return;
     hop.opening=null; hop.until=now+hopCarries; endAt();
    }
   }
   for(const face of fresh) jump(face);
  };
  const drawn=new MutationObserver(again);
  // Each frame times the press it watches; a frame's timer ends that press only once its time is up.
  const endAt=()=>{
   window.clearTimeout(ends);
   const timed=hop;
   if(timed) ends=window.setTimeout(()=>{ if(hop===timed&&timed.until<=Date.now()) end(); },Math.max(0,timed.until-Date.now()));
  };
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
   const agent=face.getAttribute('data-face')!, now=Date.now(), opens=followsLink(host,event);
   hop={face:agent,pressed:now,until:now+(opens?hopWaits:hopCarries),passed:new WeakSet(facesOf(agent)),opening:opens?{from:address(),to:null}:null};
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
