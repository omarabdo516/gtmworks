'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { useI18n } from '@/lib/i18n-client';
import { leave } from '@/lib/motion';
import { toast } from '@/app/toast';
import type { AgentScreen as Screen } from '@/lib/agent-screen.mjs';
import { useScreenLive } from '@/app/screen-live';

// The "Agent's screen" card at the top of an Agent's details' Activity tab, and its large view (#712; design-reference:
// screenSecHTML, scrStatusHTML, scrLine, scrScreenHTML, renderViewer, openViewer, scrWake, closeDlg, the viewer's close
// handler). The card is just the Screen: its state beside the heading (Awake, Asleep, Waking up), a small picture while
// it is awake, and on pointing or focus its one action: Watch while awake, Wake it while asleep. Wake it is for a Member
// who is not a Viewer (the reference's canWrite); a Viewer sees the asleep Screen with no action. Watch opens the large
// view, whose picture keeps refreshing, with the keyboard on its first action; the close button, Escape or a press on
// the backdrop runs the reference's 190 ms leave and hands the keyboard back to the card.
//
// Everything is read through gtmworks after the panel is drawn, so no page waits on the Engine: the state from
// /api/agent-screen, the picture from /api/agent-screen/picture (ADR 0011). Waking up is this page's own state while
// its start is on its way: the Engine has none. A refused start says why in one line and leaves the Screen asleep.
// Not built, because the Engine reports no steps of a Screen: the reference's step list, "Done today", the view's sub
// line and the card's current step line.
//
// While the view is open on an awake Screen its picture is the live stream (#713, app/screen-live.ts), which replaces
// the refreshing one. A Member who is not a Viewer takes control there for this session (renderViewer, the scr-take,
// scr-take-cancel, scr-take-go and scr-giveback cases): "Take control" asks first, with the keyboard on "Allow for this
// session"; then the chip, the foot, the frame's outline and the card's line say they have control, and their mouse and
// keyboard work the Screen. "Done" gives it back; closing the view, leaving the page or losing the connection gives it
// back too, the first with the reference's toast. Anyone else watching meanwhile sees "Watching only" with who has
// control, and no picture of what is typed.
type Read=Screen|'unreadable'|null|undefined;
const leaveMs=190;
// The picture refreshes at least every two seconds; the state is read again every ten, to see the Screen wake by itself.
const pictureEvery=1500, stateEvery=10000;
const refusalKeys={busy:'screenWakeBusy',missing:'screenWakeMissing',failed:'screenWakeFailed'} as const;

export function AgentScreen({company,agent,name,canWake}:{company:string,agent:string,name:string,canWake:boolean}) {
 const {t}=useI18n();
 const [read,setRead]=useState<Read>(undefined);
 const [waking,setWaking]=useState(false);
 const [refusal,setRefusal]=useState<{reason:keyof typeof refusalKeys,busy?:string}|null>(null);
 const [picture,setPicture]=useState<string|null>(null);
 const [withheld,setWithheld]=useState(false);
 const [open,setOpen]=useState(false);
 // What the open view says of the Screen: whether its live stream shows it, and whether this page holds control.
 const [streaming,setStreaming]=useState(false);
 const [holding,setHolding]=useState(false);
 const thumb=useRef<HTMLButtonElement>(null);
 const query=`company=${encodeURIComponent(company)}&agent=${encodeURIComponent(agent)}`;

 // The state is read once the card is drawn, again every ten seconds while the page is in view, and whenever something
 // here asks (`reads`): a refused wake, a picture that says the Screen fell asleep.
 const [reads,setReads]=useState(0);
 const readState=useCallback(()=>setReads(count=>count+1),[]);
 useEffect(()=>{
  let live=true;
  void fetch(`/api/agent-screen?${query}`,{cache:'no-store'}).then(response=>response.json().catch(()=>null)).catch(()=>null).then(body=>{
   if(!live) return;
   const screen=body?.screen as Screen|undefined;
   setRead(screen&&typeof screen.state==='string'?screen:body?.error==='agentScreenNotFound'?null:'unreadable');
  });
  return ()=>{ live=false; };
 },[query,reads]);
 useEffect(()=>{
  const every=setInterval(()=>{ if(document.visibilityState==='visible') readState(); },stateEvery);
  return ()=>clearInterval(every);
 },[readState]);

 const awake=typeof read==='object'&&read?.state==='awake';
 // While awake, the picture is fetched again and again, each a new grab; the one before is let go once the next is in.
 useEffect(()=>{
  if(!awake||streaming) return;
  let live=true; let shown:string|null=null; let timer:ReturnType<typeof setTimeout>|undefined;
  const grab=async()=>{
   const response=await fetch(`/api/agent-screen/picture?${query}`,{cache:'no-store'}).catch(()=>null);
   if(!live) return;
   if(response?.ok&&response.headers.get('content-type')?.startsWith('image/')) {
    const url=URL.createObjectURL(await response.blob());
    if(!live) { URL.revokeObjectURL(url); return; }
    if(shown) URL.revokeObjectURL(shown);
    shown=url; setPicture(url); setWithheld(false);
   } else if(response?.status===409) {
    const body=await response.json().catch(()=>null);
    if(!live) return;
    if(body?.picture==='withheld') setWithheld(true); else readState();
   }
   timer=setTimeout(()=>void grab(),pictureEvery);
  };
  void grab();
  return ()=>{ live=false; clearTimeout(timer); if(shown) URL.revokeObjectURL(shown); setPicture(null); setWithheld(false); };
 },[awake,streaming,query,readState]);

 const wake=async()=>{
  if(waking||!canWake) return;
  setWaking(true); setRefusal(null);
  const response=await fetch('/api/agent-screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent})}).catch(()=>null);
  const body=await response?.json().catch(()=>null);
  if(response?.ok&&body?.screen==='awake') {
   setRead(now=>({...(typeof now==='object'&&now?now:{control:'agent' as const}),state:'awake',refusal:null}));
   toast(t('screenAwakeToast',name),{icon:'monitor'});
  } else {
   setRefusal({reason:body?.reason==='busy'||body?.reason==='missing'?body.reason:'failed',...(typeof body?.busy==='string'?{busy:body.busy}:{})});
   readState();
  }
  setWaking(false);
 };

 const screen=typeof read==='object'&&read&&read.state!=='none'?read:null;
 const state=waking?'waking':screen?.state==='awake'?'awake':'asleep';
 const refused=refusal?<p className="scr-err" role="status">{t(refusalKeys[refusal.reason],refusal.busy??name)}</p>:null;

 // No Screen to show (none, not found, not read yet, or not readable): the reference's asleep frame, not a button.
 if(!screen) return <section className="dp-sec" aria-labelledby="scr-h"><h3 className="dp-label"><span id="scr-h">{t('agentScreen')}</span></h3>
  <div className="scr-card"><div className="scr-thumb is-static"><div className="scr is-off">
   <span className="scr__bar" aria-hidden="true"><span className="scr__dots"><i/><i/><i/></span><span className="scr__url" dir="ltr"/></span>
   <span className="scr__body"><span className="scr__off"><ShellIcon name="moon"/><span>{t(read==='unreadable'?'screenUnreadable':'agentScreenOff')}</span></span></span>
  </div></div></div></section>;

 const can=state!=='asleep'||canWake;
 const pill=state==='asleep'?<><ShellIcon name="sun"/><span>{t('screenWake')}</span></>:state==='waking'?<span>{t('screenWakingPill')}</span>:<><ShellIcon name="eye"/><span>{t('screenWatch')}</span></>;
 const line=state==='asleep'?t('screenAsleepLine'):state==='waking'?t('screenWakingLine'):holding?t('screenControlLine',name):null;
 const overlay=<span className="scr-ov" aria-hidden={can?'false':'true'}>
  {can?<span className="scr-ov__pill">{pill}</span>:null}
  {line?<span className="scr-ov__line">{line}</span>:null}
 </span>;
 const frame=<ScreenFrame state={state} picture={picture} withheld={withheld&&!holding} large={false} control={holding} t={t}/>;
 const watch=()=>setOpen(true);
 return <section className="dp-sec" aria-labelledby="scr-h">
  <h3 className="dp-label"><span id="scr-h">{t('agentScreen')}</span><ScreenStatus state={state} t={t}/></h3>
  <div className="scr-card">
   {can?<button ref={thumb} type="button" className="scr-thumb" aria-disabled={state==='waking'?'true':undefined} aria-haspopup={state==='awake'?'dialog':undefined}
    aria-label={state==='asleep'?t('screenWake'):state==='awake'?t('screenWatch'):t('screenWakingPill')}
    onClick={()=>{ if(state==='asleep') void wake(); else if(state==='awake') watch(); }}>{frame}{overlay}</button>
    :<div className="scr-thumb is-static">{frame}{overlay}</div>}
  </div>
  {refused}
  {open?<ScreenViewer company={company} agent={agent} name={name} state={state} picture={picture} withheld={withheld} canWake={canWake} refused={refused}
   onWake={()=>void wake()} onStale={readState} onLive={setStreaming} onControl={setHolding}
   onClosed={()=>{ setOpen(false); setStreaming(false); setHolding(false); readState(); thumb.current?.focus(); }}/>:null}
 </section>;
}

type T=ReturnType<typeof useI18n>['t'];
function ScreenStatus({state,t}:{state:'asleep'|'waking'|'awake',t:T}) {
 const dot=state==='asleep'?'dot--idle':state==='waking'?'dot--waking':'dot--working';
 return <span className="scr-st"><span className={`dot ${dot}`} aria-hidden="true"/>{t(state==='asleep'?'screenAsleep':state==='waking'?'screenWaking':'screenAwake')}</span>;
}

// The Screen drawn as the reference draws it (scrScreenHTML), at the card's size or the view's: its browser bar, and
// the Engine's own picture while awake, or the asleep and waking frames.
// In the view, `live` is the element the live stream is drawn in, over the last picture until the stream shows.
function ScreenFrame({state,picture,withheld,large,control=false,live,streaming=false,t}:{state:'asleep'|'waking'|'awake',picture:string|null,withheld:boolean,large:boolean,control?:boolean,live?:ReactNode,streaming?:boolean,t:T}) {
 let body;
 if(state==='asleep') body=<span className="scr__off"><ShellIcon name="moon"/><span>{t('screenOffBody')}</span></span>;
 else if(state==='waking') body=<span className="scr__off scr__off--waking"><span className="scr__wake"><i className="scr__ln" style={{'--w':'70%'} as CSSProperties}/><i className="scr__ln" style={{'--w':'48%'} as CSSProperties}/><i className="scr__ln" style={{'--w':'60%'} as CSSProperties}/></span><span>{t('screenWakingPill')}</span></span>;
 else if(withheld) body=<span className="scr__off"><ShellIcon name="hand"/><span>{t('screenWithheld')}</span></span>;
 else body=<>{live}{streaming?null:picture?<img className="scr__shot" src={picture} alt=""/>:<span className="scr__off"/>}</>;
 return <div className={`scr${large?' scr--lg':''}${state!=='awake'?' is-off':''}${control&&state==='awake'?' is-control':''}`} aria-hidden={live?undefined:'true'}>
  <span className="scr__bar"><span className="scr__dots"><i/><i/><i/></span><span className="scr__url" dir="ltr"/></span>
  <span className="scr__body">{body}</span>
 </div>;
}

function ScreenViewer({company,agent,name,state,picture,withheld,canWake,refused,onWake,onStale,onLive,onControl,onClosed}:{company:string,agent:string,name:string,state:'asleep'|'waking'|'awake',picture:string|null,withheld:boolean,canWake:boolean,refused:ReactNode,onWake:()=>void,onStale:()=>void,onLive:(live:boolean)=>void,onControl:(mine:boolean)=>void,onClosed:()=>void}) {
 const {t}=useI18n();
 const box=useRef<HTMLDialogElement>(null); const first=useRef<HTMLButtonElement|null>(null); const closeButton=useRef<HTMLButtonElement>(null);
 const takeButton=useRef<HTMLButtonElement|null>(null); const allowButton=useRef<HTMLButtonElement>(null); const doneButton=useRef<HTMLButtonElement>(null);
 const target=useRef<HTMLDivElement>(null);
 const [leaving,setLeaving]=useState(false); const stopLeaving=useRef(()=>{});
 const [asking,setAsking]=useState(false);
 const focusLater=(button:RefObject<HTMLButtonElement|null>)=>requestAnimationFrame(()=>(button.current??closeButton.current)?.focus());
 const screen=useScreenLive({company,agent,on:state==='awake',target,onStale},{
  taken:()=>{ setAsking(false); toast(t('screenControlToast'),{icon:'hand'}); focusLater(doneButton); },
  given:()=>{ toast(t('screenGaveBackToast',name),{icon:'hand'}); focusLater(takeButton); },
  refused:reason=>{ setAsking(false); if(reason!=='held') toast(t('screenTakeFailed'),{icon:'hand'}); focusLater(takeButton); },
  lost:()=>toast(t('screenLostToast',name),{icon:'hand'}),
 });
 const mine=screen.control==='mine'; const other=screen.control==='other';
 useEffect(()=>{ onLive(screen.live); },[screen.live,onLive]);
 useEffect(()=>{ onControl(mine); },[mine,onControl]);
 // The view is modal, so the page behind it is inert; the keyboard starts on its first action (openViewer): Take control
 // for a Member who may take it, Wake it on an asleep Screen for one who may wake it, else the close button.
 useLayoutEffect(()=>{
  if(box.current&&!box.current.open) box.current.showModal();
  (first.current??closeButton.current)?.focus();
  return ()=>stopLeaving.current();
 },[]);
 // Wake it leaves the view once the Screen wakes: the keyboard moves to its first action rather than out of the view.
 useEffect(()=>{ if(state!=='asleep'&&box.current&&!box.current.contains(document.activeElement)) (first.current??closeButton.current)?.focus(); },[state]);
 // Closing while in control gives it back (the socket closes with the view) and says so (the viewer's close handler).
 const heldAtClose=useRef(false);
 const close=()=>{
  const dialog=box.current; if(!dialog?.open||leaving) return;
  heldAtClose.current=screen.held();
  stopLeaving.current=leave(leaveMs,()=>setLeaving(true),()=>dialog.close());
 };
 const awake=state==='awake';
 const named=(key:string)=>t(key,'{0}').split('{0}').flatMap((part,at)=>at?[<bdi key={at}>{name}</bdi>,part]:[part]);
 let foot:ReactNode;
 if(!awake) foot=<div className="vw-mode"><b>{t('screenWatchingOnly')}</b><span>{state==='waking'?t('screenFootWaking'):t('agentScreenOff')}</span></div>;
 else if(other) foot=<div className="vw-mode"><b>{t('screenWatchingOnly')}</b><span>{screen.by?t('screenHeldBy',screen.by):t('screenHeldByOther')}</span></div>;
 else if(!canWake) foot=<div className="vw-mode"><b>{t('screenWatchingOnly')}</b><span>{t('screenFootViewer',name)}</span></div>;
 else if(mine) foot=<><div className="vw-mode"><b>{t('screenYouHaveControl')}</b><span>{t('screenFootControl',name)}</span></div>
  <span className="vw-foot__acts"><button ref={doneButton} type="button" className="btn btn--primary" onClick={()=>screen.giveBack()}>{t('screenDone')}</button></span></>;
 else if(asking) foot=<><div className="vw-mode" id="vw-confirm-t"><b>{named('screenTakeAsk')}</b><span>{t('screenTakeBody')}</span></div>
  <span className="vw-foot__acts"><button type="button" className="btn btn--secondary" onClick={()=>{ setAsking(false); focusLater(takeButton); }}>{t('cancel')}</button>
   <button ref={allowButton} type="button" className="btn btn--primary" aria-describedby="vw-confirm-t" onClick={()=>screen.take()}>{t('screenAllow')}</button></span></>;
 else foot=<><div className="vw-mode"><b>{t('screenWatchingOnly')}</b><span>{t('screenFootWatch',name)}</span></div>
  <span className="vw-foot__acts"><span className="vw-take__d" id="vw-take-d"><ShellIcon name="shield"/>{t('screenTakeNeeds')}</span>
   <button ref={node=>{ takeButton.current=node; first.current=node; }} type="button" className="btn btn--secondary" aria-describedby="vw-take-d"
    onClick={()=>{ setAsking(true); focusLater(allowButton); }}><ShellIcon name="hand"/><span>{t('screenTake')}</span></button></span></>;
 // The live stream's element, while it may show: never while another person holds control.
 const live=awake&&!other?<div ref={target} className={`scr__live${screen.live?'':' is-waiting'}`} dir="ltr"/>:undefined;
 return <dialog ref={box} className={`viewer${leaving?' is-closing':''}`} aria-labelledby="viewer-title"
  // Escape closes the view and must not reach the details panel's own Escape listener, which would close it too.
  onKeyDown={event=>{ if(event.key==='Escape') event.stopPropagation(); }}
  onCancel={event=>{ if(event.cancelable) { event.preventDefault(); close(); } }}
  onClose={()=>{ stopLeaving.current(); setLeaving(false); if(heldAtClose.current||screen.held()) toast(t('screenClosedToast',name),{icon:'hand'}); onClosed(); }}
  onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
  <div className="vw">
   <header className="vw__head"><AgentFace agent={agent} size={32}/>
    <div className="vw__titles"><h2 className="vw__title" id="viewer-title">{named('screenViewerTitle')}</h2></div>
    {mine?<span className="badge vw-chip vw-chip--ctrl"><ShellIcon name="hand"/>{t('screenYouHaveControl')}</span>:<span className="badge vw-chip"><ShellIcon name="eye"/>{t('screenWatching')}</span>}
    <button ref={closeButton} type="button" className="circle-btn" aria-label={t('screenClose')} onClick={close}><ShellIcon name="x"/></button>
   </header>
   <div className="vw__body"><div className="vw__stage">
    <div className="vw__screen"><ScreenFrame state={state} picture={picture} withheld={withheld&&!mine||other} large control={mine} live={live} streaming={screen.live} t={t}/></div>
    {state==='asleep'?<div className="vw-off"><p>{t('screenSleepNote',name)}</p>
     {canWake?<button ref={first} type="button" className="btn btn--primary" onClick={onWake}><ShellIcon name="sun"/><span>{t('screenWake')}</span></button>:null}
    </div>:null}
    {state==='asleep'?refused:null}
   </div></div>
   <footer className="vw__foot">{foot}</footer>
  </div>
 </dialog>;
}
