import { temperaments, type Temperament, type TemperamentNumbers } from '@/lib/agent-look';

// The life of every Agent face of 24px or more (components/agent-face), one module for the whole page
// (design-reference-orb/agent-orb-v2.html: mount, the scheduler, lookFrame, play, MOM, birth, stillFrames). It is set up
// once, by the first face drawn, and draws nothing: one IntersectionObserver keeps the faces on screen, one timer blinks
// them and makes them glance as their temperament does, the eyes and the highlight lean toward the pointer (never for a
// touch), and a pressed face hops, as does the same Agent's face drawn again on the page the press opened (#529).
// Nothing runs in a hidden tab, for a face off screen, or with reduced motion, where a moment shows as still frames and
// the expressions still change. Its moments are Web Animations of transform and opacity, each under 1.2s.
// Its state lives in the module, not in a component, so it outlives the frame a press was made in.
export type FaceState='idle'|'listening'|'thinking'|'working'|'done'|'waiting'|'stuck'|'asleep';
export type Moment='press'|'done'|'greet'|'perk'|'nod'|'birth';

type Keyframes=Keyframe[];
type Face=HTMLElement&{_nb?:number,_ng?:number,_busy?:boolean,_lx?:string,_ly?:string,_tm?:number[],_gt?:number,_bt?:number,_an?:Animation[],_rig?:Rig};
const momentsOf:Record<Exclude<Moment,'birth'>,{dur:number,easing:string,act:Keyframes,shadow?:Keyframes,spark?:boolean,cls:[string,number,number][]}>={
 press:{dur:620,easing:'cubic-bezier(.3,0,.3,1)',
  act:[{transform:'none'},{transform:'translateY(6%) scale(1.14,.84)',offset:.16},{transform:'translateY(-16%) scale(.92,1.1)',offset:.46},{transform:'translateY(0) scale(1.08,.92)',offset:.7},{transform:'translateY(0) scale(.98,1.02)',offset:.86},{transform:'none'}],
  shadow:[{transform:'scale(1)',opacity:1},{transform:'scale(1.12)',opacity:1,offset:.16},{transform:'scale(.66)',opacity:.45,offset:.46},{transform:'scale(1.06)',opacity:1,offset:.7},{transform:'scale(1)',opacity:1}],
  cls:[['is-squint',0,460],['is-look',380,1700],['is-wide',460,1400]]},
 done:{dur:560,easing:'cubic-bezier(.3,0,.3,1)',
  act:[{transform:'none'},{transform:'translateY(4%) scale(1.1,.88)',offset:.16},{transform:'translateY(-13%) scale(.94,1.08)',offset:.46},{transform:'translateY(0) scale(1.06,.94)',offset:.72},{transform:'none'}],
  shadow:[{transform:'scale(1)',opacity:1},{transform:'scale(.72)',opacity:.5,offset:.46},{transform:'scale(1)',opacity:1}],
  spark:true,cls:[]},
 greet:{dur:760,easing:'ease-in-out',
  act:[{transform:'none'},{transform:'translateY(-10%) rotate(-5deg) scale(1.02,1.05)',offset:.28},{transform:'translateY(0) rotate(3deg) scale(1.04,.96)',offset:.55},{transform:'translateY(-3%) rotate(-1.5deg)',offset:.78},{transform:'none'}],
  shadow:[{transform:'scale(1)',opacity:1},{transform:'scale(.78)',opacity:.6,offset:.28},{transform:'scale(1)',opacity:1,offset:.55},{transform:'scale(.92)',opacity:.9,offset:.78},{transform:'scale(1)',opacity:1}],
  cls:[['is-look',0,1600],['is-up',0,560],['is-wide',0,1000]]},
 perk:{dur:600,easing:'cubic-bezier(.2,0,0,1)',
  act:[{transform:'none'},{transform:'translateY(-12%) scale(1.1)',offset:.3},{transform:'translateY(-2%) scale(.97,1.04)',offset:.62},{transform:'none'}],
  shadow:[{transform:'scale(1)',opacity:1},{transform:'scale(.74)',opacity:.55,offset:.3},{transform:'scale(1)',opacity:1}],
  cls:[['is-wide',0,1100],['is-look',0,1200]]},
 nod:{dur:1100,easing:'ease-in-out',
  act:[{transform:'none'},{transform:'translateY(4%) scale(1,.98)',offset:.25},{transform:'none',offset:.5},{transform:'translateY(3%) scale(1,.985)',offset:.74},{transform:'none'}],
  cls:[]},
};
// Reduced motion: the same feelings as still frames.
const stillFramesOf:Partial<Record<Moment,[string,number,number][]>>={
 press:[['is-squint',0,450],['is-look',450,1600]], birth:[['is-shut',0,600],['is-look',600,1800]],
 greet:[['is-look',0,1200],['is-up',0,600]], perk:[['is-wide',0,1000]],
};
// Each state's pace for the breath (the approved orb's second number; its colour drift is held still, #697): a change
// of rate keeps the place, so nothing jumps.
const rates:Record<FaceState,number>={idle:1,listening:1.2,thinking:1,working:1.25,done:1.1,waiting:1,stuck:.75,asleep:.45};
const blinks=new Set<string>(['idle','listening','thinking','working','waiting','stuck']);
const rand=(from:number,to:number)=>from+Math.random()*(to-from);
const pressHop=450, pressWaits=10000;

const reducedQuery='(prefers-reduced-motion: reduce)';
const reduced=()=>window.matchMedia(reducedQuery).matches;
const numbersOf=(face:Face):TemperamentNumbers=>temperaments[(face.dataset.temperament as Temperament)]??temperaments.calm;
const isLive=(face:Element)=>face.classList.contains('face--live');

// The faces on screen, and whether the module is set up.
const visible=new Set<Face>();
let observer:IntersectionObserver|null=null;

function clearMoment(face:Face) {
 (face._tm||[]).forEach(timer=>window.clearTimeout(timer)); face._tm=[];
 face.classList.remove('is-wide','is-look','is-up','is-squint','is-shut','is-birth');
 (face._an||[]).forEach(animation=>animation.cancel()); face._an=[];
 if(face._rig?.nod) rest(face._rig.nod);
 delete face.dataset.moment;
}
function timedClass(face:Face,name:string,from:number,to:number) {
 face._tm??=[];
 face._tm.push(window.setTimeout(()=>face.classList.add(name),from),window.setTimeout(()=>face.classList.remove(name),to));
}

/** @public The hook later moments are played from (greeting, mentioned, birth: #699 to #701). */
// A moment on one face: press, done, greet, perk, nod or birth. Under 24px nothing; with reduced motion its still
// frames. The face carries data-moment while it plays.
export function playMoment(face:HTMLElement|null|undefined,kind:Moment) {
 const target=face as Face|null|undefined;
 if(!target||!isLive(target)) return;
 // A moment looks at you, so a glance that plays ends; a nod is the caring glance's own.
 if(kind!=='nod') stopGlance(target,true);
 clearMoment(target);
 const frames=reduced()?(stillFramesOf[kind]||[]):null;
 let ends=0;
 if(frames) { frames.forEach(([name,from,to])=>{ timedClass(target,name,from,to); ends=Math.max(ends,to); }); }
 else {
  const animate=(element:Element|null,keyframes:Keyframes,options:KeyframeAnimationOptions)=>{ if(element) target._an!.push(element.animate(keyframes,options)); };
  if(kind==='birth') ends=birth(target,animate);
  else if(kind==='nod') ends=nod(target);
  else {
   const moment=momentsOf[kind];
   animate(target.querySelector('.f-act'),moment.act,{duration:moment.dur,easing:moment.easing});
   if(moment.shadow) animate(target.querySelector('.f-shadow'),moment.shadow,{duration:moment.dur,easing:moment.easing});
   moment.cls.forEach(([name,from,to])=>{ timedClass(target,name,from,to); ends=Math.max(ends,to); });
   if(moment.spark) target.querySelectorAll('.f-spark i').forEach((spark,index)=>animate(spark,[{transform:'scale(0) rotate(0deg)',opacity:0},{transform:'scale(1.15) rotate(45deg)',opacity:1,offset:.4},{transform:'scale(.5) rotate(90deg)',opacity:0}],{duration:640,delay:120+index*80,easing:'ease-out'}));
   ends=Math.max(ends,moment.dur);
  }
 }
 target.dataset.moment=kind;
 target._tm!.push(window.setTimeout(()=>{ if(target.dataset.moment===kind) delete target.dataset.moment; },Math.max(ends,1)));
}
// The caring glance's nod comes back by itself every few seconds, so it waits on the face as a blink does (the rig).
function nod(face:Face) {
 const rig=rigOf(face), nodding=rig&&nodOf(face,rig);
 if(!nodding) return 0;
 nodding.currentTime=0; nodding.play();
 const {dur}=momentsOf.nod;
 face._tm!.push(window.setTimeout(()=>rest(nodding),dur+50));
 return dur;
}
// Birth: light gathers, the orb fills out, then opens its eyes for the first time and looks at you.
function birth(face:Face,animate:(element:Element|null,keyframes:Keyframes,options:KeyframeAnimationOptions)=>void) {
 const D=1150;
 face.classList.add('is-birth'); face._tm!.push(window.setTimeout(()=>face.classList.remove('is-birth'),D+50));
 animate(face.querySelector('.f-act'),[{transform:'scale(.1)',opacity:0},{transform:'scale(.14)',opacity:.9,offset:.22},{transform:'scale(.18)',opacity:1,offset:.34,easing:'cubic-bezier(.3,0,.2,1)'},{transform:'scale(1.1)',opacity:1,offset:.62,easing:'ease-in-out'},{transform:'scale(.96,1.03)',opacity:1,offset:.76},{transform:'none',opacity:1}],{duration:D});
 animate(face.querySelector('.f-gather'),[{transform:'scale(1.5)',opacity:0},{transform:'scale(1.05)',opacity:.95,offset:.24},{transform:'scale(.5)',opacity:.6,offset:.38},{transform:'scale(.42)',opacity:0,offset:.5},{transform:'scale(.42)',opacity:0}],{duration:D,easing:'ease-in'});
 animate(face.querySelector('.f-shadow'),[{transform:'scale(.2)',opacity:0},{transform:'scale(.3)',opacity:.4,offset:.34},{transform:'scale(1.06)',opacity:1,offset:.62},{transform:'scale(1)',opacity:1}],{duration:D});
 face.querySelectorAll('.f-eye').forEach(eye=>animate(eye,[{transform:'scaleY(.06)'},{transform:'scaleY(.06)',offset:.7},{transform:'scaleY(1.18)',offset:.82},{transform:'scaleY(1)'}],{duration:D,easing:'ease-out'}));
 timedClass(face,'is-look',0,2200); timedClass(face,'is-wide',820,1900);
 return 2200;
}

// The look parts live on the eyes and the highlight only, so a look never touches the body's animations.
const eyesOf=(face:Face)=>face.querySelector<HTMLElement>('.f-eyes');
const leanersOf=(face:Face)=>[eyesOf(face),face.querySelector<HTMLElement>('.f-specs')].filter(Boolean) as HTMLElement[];
// Each face keeps its blink and its glance as Web Animations that wait, paused where they change nothing, and play
// from their start when the face blinks or glances (#697). A blink or a glance that made an animation of its own would
// add one and take it away again, and each time the browser lays out the layers of the whole page anew: sixteen faces
// blinking and glancing did that on most frames, which kept a CPU slowed four times under 50 frames a second
// (tests/face-frames.spec.ts). A waiting animation lasts a minute, so a late timer never plays it twice.
type Rig={blink:Animation[],look:Animation,nod?:Animation,looking:string,ease:string,eyeMs:number};
const rigMs=60000, blinkMs=150;
const at=(ms:number)=>ms/rigMs;
const blinkFrames:Keyframes=[{transform:'scaleY(1)',easing:'ease-in'},{transform:'scaleY(.08)',offset:at(blinkMs*.45),easing:'ease-out'},{transform:'scaleY(1)',offset:at(blinkMs)},{transform:'scaleY(1)'}];
const waiting=(element:Element,keyframes:Keyframes)=>{ const animation=element.animate(keyframes,{duration:rigMs,iterations:Infinity}); animation.pause(); animation.currentTime=0; return animation; };
const rest=(animation:Animation)=>{ animation.pause(); animation.currentTime=0; };
const targetOf=(animation:Animation)=>(animation.effect as KeyframeEffect|null)?.target;
function dropRig(face:Face) { face._rig?.blink.forEach(animation=>animation.cancel()); face._rig?.look.cancel(); face._rig?.nod?.cancel(); face._rig=undefined; }
function rigOf(face:Face):Rig|null {
 const eyes=[...face.querySelectorAll('.f-eye')], look=face.querySelector('.f-look'), kept=face._rig;
 if(kept&&targetOf(kept.look)===look&&kept.blink.length===eyes.length&&kept.blink.every((animation,index)=>targetOf(animation)===eyes[index])) return kept;
 dropRig(face);
 if(!look) return null;
 const style=getComputedStyle(face);
 const rig:Rig={blink:eyes.map(eye=>waiting(eye,blinkFrames)),look:waiting(look,[{transform:'none'},{transform:'none'}]),looking:'',ease:style.getPropertyValue('--gw-ease-out').trim()||'ease-out',eyeMs:0};
 if(numbersOf(face).glance.style==='nod') nodOf(face,rig);
 face._rig=rig;
 return rig;
}
function nodOf(face:Face,rig:Rig) {
 const act=face.querySelector('.f-act'), {act:frames,dur,easing}=momentsOf.nod;
 if(rig.nod&&targetOf(rig.nod)!==act) { rig.nod.cancel(); rig.nod=undefined; }
 if(act) rig.nod??=waiting(act,[...frames.map((frame,index)=>({...frame,offset:at((frame.offset??(index?1:0))*dur),easing})),{transform:'none'}]);
 return rig.nod;
}
function blink(face:Face) {
 const rig=rigOf(face); if(!rig) return;
 rig.blink.forEach(animation=>{ animation.currentTime=0; animation.play(); });
 window.clearTimeout(face._bt); face._bt=window.setTimeout(()=>rig.blink.forEach(rest),blinkMs+50);
}
const blinkGap=(numbers:TemperamentNumbers)=>numbers.glance.style==='precise'?4000:numbers.glance.style==='dart'?rand(1600,3400):numbers.glance.style==='steady'?rand(4200,7000):rand(2600,5600);
// A glance: each look moves the eyes over the temperament's eye time, holds, and the last comes back the same way, as
// the approved orb's gaze does. The eyes move by a share of the face's size (agent-orb-v2: .065 across, .06 down).
function glance(face:Face,numbers:TemperamentNumbers) {
 const side=Math.random()<.5?-1:1;
 const steps:[number,number,number][]={
  steady:[[side*.55,.05,1700]], dart:[[side*.8,-.15,320],[-side*.8,.1,300]], soft:[[side*.5,.3,1300]],
  up:[[side*.35,-.95,2000]], precise:[[side*.6,0,700],[-side*.6,0,700]], nod:[[0,.45,1100]],
 }[numbers.glance.style] as [number,number,number][];
 if(numbers.glance.style==='nod') playMoment(face,'nod');
 const rig=(face.dataset.state||'idle')==='idle'?rigOf(face):null; if(!rig) return;
 const size=parseFloat(face.style.getPropertyValue('--s'))||face.offsetWidth, eyeMs=numbers.glance.eyeMs;
 const place=([x,y]:[number,number,number]|[number,number])=>`translate(${(x*size*.065).toFixed(2)}px, ${(y*size*.06).toFixed(2)}px)`;
 const keyframes:Keyframes=[]; let from='none', ms=0;
 for(const step of steps) {
  keyframes.push({transform:from,offset:at(ms),easing:rig.ease},{transform:from=place(step),offset:at(ms+eyeMs)});
  ms+=step[2]+eyeMs;
 }
 keyframes.push({transform:from,offset:at(ms),easing:rig.ease},{transform:'none',offset:at(ms+eyeMs)},{transform:'none',offset:1});
 const looking=JSON.stringify(keyframes);
 if(rig.looking!==looking) { (rig.look.effect as KeyframeEffect).setKeyframes(keyframes); rig.looking=looking; }
 rig.eyeMs=eyeMs; rig.look.currentTime=0; rig.look.play();
 face._busy=true;
 window.clearTimeout(face._gt); face._gt=window.setTimeout(()=>stopGlance(face),ms+eyeMs+50);
}
// A glance ends, played out or stopped (the face's state changed, a moment that looks at you, reduced motion turned
// on, the face gone): its looks to come never do. `back` brings the eyes back over the eye time from where they are.
function stopGlance(face:Face,back=false) {
 window.clearTimeout(face._gt); face._busy=false;
 const look=face._rig?.look; if(!look||look.playState!=='running') return;
 const element=targetOf(look) as HTMLElement|null|undefined, from=back&&!reduced()&&element?getComputedStyle(element).transform:'none';
 rest(look);
 if(element&&from!=='none') element.animate([{transform:from},{transform:'none'}],{duration:face._rig!.eyeMs,easing:face._rig!.ease});
}
function tick() {
 if(reduced()||document.hidden) return;
 const now=performance.now();
 for(const face of visible) {
  if(!face.isConnected) { visible.delete(face); continue; }
  const numbers=numbersOf(face), state=face.dataset.state||'idle';
  // Its rig is made as it first shows, with the other faces shown with it: one change of the page's layers for them all.
  if(!face._rig) rigOf(face);
  face._nb||=now+rand(600,4000);
  face._ng||=now+rand(1200,numbers.glance.seconds*1000);
  if(blinks.has(state)&&now>=face._nb) {
   blink(face); face._nb=now+blinkGap(numbers);
   // Warm: now and then a friendly double blink.
   if(numbers.glance.style==='soft'&&Math.random()<.3) (face._tm??=[]).push(window.setTimeout(()=>{ if(!reduced()) blink(face); },260));
  }
  if(state==='idle'&&!face._busy&&now>=face._ng) { glance(face,numbers); face._ng=now+numbers.glance.seconds*1000*rand(.7,1.4); }
 }
}

// The pointer: the eyes and the highlight of every face on screen lean toward it. Every place is read first, then every
// lean written, about sixteen times a second (the eyes ease over 110 to 950ms anyway).
let pointer:{x:number,y:number}|null=null, looking=0;
function lookFrame() {
 looking=0;
 const faces=[...visible];
 if(!pointer||reduced()) { for(const face of faces) { face._lx=face._ly=undefined; leanersOf(face).forEach(part=>{ part.style.removeProperty('--lx'); part.style.removeProperty('--ly'); }); } return; }
 const at=pointer, boxes=faces.map(face=>face.getBoundingClientRect());
 faces.forEach((face,index)=>{
  const box=boxes[index]; if(!box.width) return;
  const dx=at.x-(box.left+box.width/2), dy=at.y-(box.top+box.height/2), distance=Math.hypot(dx,dy)||1, k=Math.min(1,distance/240);
  const lx=(dx/distance*k).toFixed(2), ly=(dy/distance*k).toFixed(2);
  if(face._lx===lx&&face._ly===ly) return;
  face._lx=lx; face._ly=ly;
  leanersOf(face).forEach(part=>{ part.style.setProperty('--lx',lx); part.style.setProperty('--ly',ly); });
 });
}
const queueLook=()=>{ if(looking) return; looking=-1; window.setTimeout(()=>{ looking=requestAnimationFrame(lookFrame); },60); };

// A press: the pressed face hops, and a face of the same Agent drawn again after it hops once too, while the press is
// fresh: within 450ms, or, when the press follows a link to another page of this tab, within 450ms of that page's first
// face of the Agent, however long the page takes (up to 10s). Faces drawn before the press, and a page after the opened
// one, take no hop.
type Hop={agent:string,pressed:number,until:number,passed:WeakSet<Element>,opening:{from:string,to:string|null,drawn:boolean}|null};
let hop:Hop|null=null, hopEnds=0;
const address=()=>location.pathname+location.search;
const facesOf=(agent:string)=>[...document.querySelectorAll<HTMLElement>('.face--live')].filter(face=>face.dataset.agent===agent);
const followsLink=(host:Element|null|undefined,event:MouseEvent)=>{
 if(!(host instanceof HTMLAnchorElement)||!host.href||(host.target&&host.target!=='_self')||host.hasAttribute('download')) return false;
 if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return false;
 const url=new URL(host.href,location.href);
 return url.origin===location.origin&&url.pathname+url.search!==address();
};
const drawn=typeof MutationObserver==='undefined'?null:new MutationObserver(()=>again());
function endHop() { hop=null; drawn?.disconnect(); }
function timeHop() {
 window.clearTimeout(hopEnds);
 const timed=hop;
 if(timed) hopEnds=window.setTimeout(()=>{ if(hop===timed&&timed.until<=Date.now()) endHop(); },Math.max(0,timed.until-Date.now()));
}
function hopOnce(face:HTMLElement) { hop?.passed.add(face); playMoment(face,'press'); }
function again() {
 if(!hop) return;
 const now=Date.now();
 if(hop.until<=now) return endHop();
 const current=hop, fresh=facesOf(current.agent).filter(face=>!current.passed.has(face)&&face.getBoundingClientRect().width);
 const opening=current.opening;
 if(opening) {
  const at=address();
  if(opening.to===null&&at===opening.from) { if(now-current.pressed>=pressHop) return; }
  else {
   opening.to??=at;
   if(at!==opening.to) return endHop();
   if(!opening.drawn) { if(!fresh.length) return; opening.drawn=true; current.until=now+pressHop; timeHop(); }
  }
 }
 fresh.forEach(hopOnce);
}
function press(event:MouseEvent) {
 const target=event.target instanceof Element?event.target:null;
 const host=target?.closest('button, a[href], [data-action]');
 const face=(target?.closest('.face--live')??host?.querySelector('.face--live')) as HTMLElement|null|undefined;
 const agent=face?.dataset.agent;
 if(!face||!agent) return;
 const now=Date.now(), opens=followsLink(host,event);
 hop={agent,pressed:now,until:now+(opens?pressWaits:pressHop),passed:new WeakSet(facesOf(agent)),opening:opens?{from:address(),to:null,drawn:false}:null};
 hopOnce(face);
 drawn?.disconnect(); drawn?.observe(document.body,{childList:true,subtree:true});
 timeHop();
}

function setUp() {
 if(observer) return observer;
 observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
  const face=entry.target as Face;
  face.classList.toggle('is-vis',entry.isIntersecting);
  if(entry.isIntersecting) visible.add(face); else visible.delete(face);
 }),{rootMargin:'80px'});
 window.setInterval(tick,200);
 window.addEventListener('pointermove',event=>{ if(reduced()||event.pointerType==='touch') return; pointer={x:event.clientX,y:event.clientY}; queueLook(); },{passive:true});
 document.documentElement.addEventListener('pointerleave',()=>{ pointer=null; queueLook(); });
 window.addEventListener('blur',()=>{ pointer=null; queueLook(); });
 window.addEventListener('scroll',()=>{ if(pointer) queueLook(); },{passive:true,capture:true});
 window.addEventListener('click',press,true);
 // Back in view, the next blink and glance are counted again; turning reduced motion on stops what plays.
 document.addEventListener('visibilitychange',()=>{ if(!document.hidden) visible.forEach(face=>{ face._nb=0; face._ng=0; }); });
 window.matchMedia(reducedQuery).addEventListener('change',query=>{ if(!query.matches) return; document.querySelectorAll<Face>('.face--live').forEach(face=>{ clearMoment(face); stopGlance(face); window.clearTimeout(face._bt); dropRig(face); }); queueLook(); });
 return observer;
}

// A face drawn: watched while it is on the page. A face drawn again after a press may take its hop.
export function watchFace(face:HTMLElement) {
 const watching=setUp();
 watching.observe(face);
 if(hop) queueMicrotask(again);
 return ()=>{ const gone=face as Face; watching.unobserve(gone); visible.delete(gone); clearMoment(gone); stopGlance(gone); window.clearTimeout(gone._bt); dropRig(gone); };
}

// A temperament felt before it is picked (design-reference-orb/agent-look.html: sample): the face blinks and glances as
// that temperament does, unless it is busy, still or nothing may move.
export function sampleFace(face:HTMLElement|null|undefined) {
 const target=face as Face|null|undefined;
 if(!target||!isLive(target)||reduced()||target._busy) return;
 const numbers=numbersOf(target);
 blink(target); glance(target,numbers); target._ng=performance.now()+numbers.glance.seconds*1000;
}

// A face's state changed: its paces follow, its eyes come back from a glance, and a face that is done hops and sparkles.
export function faceStateChanged(face:HTMLElement,state:FaceState,from:FaceState|undefined) {
 const target=face as Face;
 const rate=rates[state]??rates.idle;
 for(const animation of target.getAnimations({subtree:true})) {
  const element=(animation.effect as KeyframeEffect|null)?.target as Element|null;
  if(element?.classList.contains('f-breath')&&animation.playbackRate!==rate) animation.updatePlaybackRate(rate);
 }
 if(state!=='idle') stopGlance(target,true);
 if(state==='done'&&from&&from!=='done') playMoment(target,'done');
}
