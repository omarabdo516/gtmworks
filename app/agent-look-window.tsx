'use client';
import './agent-look.css';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as KeyEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { AgentFace } from '@/components/agent-face';
import { playMoment, sampleFace } from '@/components/face-life';
import { ShellIcon } from '@/components/shell-icon';
import { LooksProvider, useKeptLook, useLookChanger } from '@/lib/agent-looks-client';
import { changeLook, lookPicked, shownLook, type LookPart } from '@/lib/agent-look-saves';
import { lookChoices, lookPartKey, lookValueKey, temperamentNameKey, temperamentSayKey } from '@/lib/agent-look-words.mjs';
import type { AgentLook } from '@/lib/agent-look';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { rememberOpener } from '@/app/settings-opener';
import { useLeave, prefersReducedMotion } from '@/lib/motion';
import { toast } from '@/app/toast';

type Agent={id:string,name:string};
// The title's sentence with the Agent's name isolated in its own direction.
const slot='\u0001';
function Named({text,name}:{text:string,name:string}) {
 const [before,after]=text.split(slot);
 return <>{before}<bdi>{name}</bdi>{after}</>;
}

// The window that changes an Agent's look (decision 0067, ADR 0027; design-reference-orb/agent-look.html: panelHTML,
// openDlg, pick, resetLook): the Agent's face large, then its shape, colour and temperament, each a group of choices
// drawn as the Agent would look with it. Every press saves at once and shows at once in every face behind the window
// (lib/agent-look-saves); one that is not saved goes back, with one short toast. "Reset to automatic" gives back the
// look the Agent was given, and waits while nothing is picked. "All of the Agent's settings" leads to its page in
// Settings, or, opened there, closes the window onto it. Escape, the close button and a press outside close it; the
// keyboard goes back to the opener. Only the Owner opens it (useLookChanger).
function AgentLookWindow({agent,inSettings=false,onClose}:{agent:Agent,inSettings?:boolean,onClose:()=>void}) {
 const {t,language}=useI18n();
 const changer=useLookChanger();
 const kept=useKeptLook(agent.id);
 const box=useRef<HTMLDialogElement>(null), preview=useRef<HTMLButtonElement>(null);
 const leaving=useLeave();
 const id=useId(), title=`${id}-title`;
 useLayoutEffect(()=>{
  const dialog=box.current; if(!dialog) return;
  if(!dialog.open) dialog.showModal();
  // The keyboard starts on the chosen shape.
  dialog.querySelector<HTMLInputElement>('input[data-part="shape"]:checked')?.focus();
 },[]);
 const close=()=>leaving.close(()=>{ box.current?.close(); onClose(); });
 if(!changer||!kept) return null;
 const look=shownLook(kept);
 const reset=!lookPicked(kept);
 // A press saves its part; an answer that put it back says so, and the keyboard follows the choice that is checked now.
 const settle=(saved:boolean)=>{
  if(saved) return;
  toast(t('lookSaveFailed'),{icon:'x'});
  requestAnimationFrame(()=>{
   const active=document.activeElement;
   if(active instanceof HTMLInputElement&&active.type==='radio'&&!active.checked) box.current?.querySelector<HTMLInputElement>(`input[name="${active.name}"]:checked`)?.focus();
  });
 };
 const hop=()=>playMoment(preview.current?.querySelector<HTMLElement>('.face'),'press');
 const pick=(part:LookPart,choice:string)=>{
  if(look[part]===choice) return;
  hop();
  void changeLook(agent.id,kept,{part,choice},()=>changer.save(changer.company,agent.id,part,choice)).then(settle);
 };
 const resetLook=()=>{
  if(reset) return;
  hop();
  void changeLook(agent.id,kept,'reset',()=>changer.reset(changer.company,agent.id)).then(settle);
  box.current?.querySelector<HTMLInputElement>('input[data-part="shape"]:checked')?.focus();
 };
 // Arrow keys walk one group the same way in both directions of reading, and Home and End go to its ends; Tab moves to
 // the next group.
 const walk=(event:KeyEvent<HTMLDivElement>)=>{
  const input=event.target as HTMLInputElement;
  if(input.type!=='radio'||!input.dataset.part) return;
  const list=[...(box.current?.querySelectorAll<HTMLInputElement>(`input[name="${input.name}"]`)??[])], from=list.indexOf(input), rtl=language==='ar';
  const step=({ArrowDown:1,ArrowUp:-1,ArrowRight:rtl?-1:1,ArrowLeft:rtl?1:-1} as Record<string,number>)[event.key];
  const to=step?(from+step+list.length)%list.length:event.key==='Home'?0:event.key==='End'?list.length-1:null;
  if(to==null) return;
  event.preventDefault();
  list[to].focus();
  if(!list[to].checked) pick(input.dataset.part as LookPart,list[to].value);
 };
 const variant=(change:Partial<AgentLook>,size:number)=><LooksProvider looks={{agents:{[agent.id]:{...look,...change}},requests:{}}}><AgentFace agent={agent.id} size={size}/></LooksProvider>;
 const radio=(part:LookPart,value:string)=>({type:'radio' as const,name:`${id}-${part}`,value,'data-part':part,checked:look[part]===value,onChange:()=>pick(part,value)});
 const tile=(part:LookPart,value:string,face:ReactNode,label:string)=><label key={value} className="lk-tile"
  onPointerOver={part==='temperament'?event=>{ if(event.pointerType!=='touch'&&!event.currentTarget.contains(event.relatedTarget as Node|null)) sampleFace(event.currentTarget.querySelector<HTMLElement>('.face')); }:undefined}>
  {face}<input {...radio(part,value)} onFocus={part==='temperament'?event=>sampleFace(event.currentTarget.parentElement?.querySelector<HTMLElement>('.face')):undefined}/>
  <span className="lk-tile__t">{label}</span><span className="lk-ck" aria-hidden="true"><ShellIcon name="check"/></span></label>;
 const settings=inSettings
  ?<button type="button" className="link-btn lk-all" onClick={close}>{t('lookAllSettings')}<ShellIcon name="chevron" className="lk-fwd"/></button>
  :<Link className="link-btn lk-all" href={overlayHref(changer.slug,'agents',{agent:agent.id})} onClick={()=>{ rememberOpener(); box.current?.close(); onClose(); }}>{t('lookAllSettings')}<ShellIcon name="chevron" className="lk-fwd"/></Link>;
 return <dialog ref={box} className={`lk-dlg${leaving.closing?' is-closing':''}`} aria-labelledby={title}
  // Its keys and presses are its own: Escape closes this window alone, not the panel or the Settings behind it.
  onKeyDown={event=>{ event.stopPropagation(); if(event.key==='Escape'&&!event.nativeEvent.isComposing) { event.preventDefault(); close(); } }}
  onCancel={event=>{ event.preventDefault(); close(); }}
  onClick={event=>{ event.stopPropagation(); if(event.target===event.currentTarget) close(); }}>
  <div className="lk">
   <div className="lk-head"><h2 className="lk-title" id={title}><Named text={t('lookTitle',slot)} name={agent.name}/></h2>
    <button type="button" className="circle-btn lk-x" aria-label={t('lookClose')} onClick={close}><ShellIcon name="x"/></button></div>
   <div className="lk-stage"><button ref={preview} type="button" className="face-btn lk-prev" aria-label={t('lookPress',agent.name)}><AgentFace agent={agent.id} size={120}/></button></div>
   <div className="lk-body" onKeyDown={walk}>
    <fieldset className="lk-grp"><legend className="lk-lg">{t(lookPartKey('shape',false))}</legend>
     <div className="lk-tiles">{lookChoices.shape.map(shape=>tile('shape',shape,variant({shape:shape as AgentLook['shape']},28),t(lookValueKey('shape',shape))))}</div></fieldset>
    <fieldset className="lk-grp"><legend className="lk-lg">{t(lookPartKey('colour',false))}<span className="lk-lg__v">{t(lookValueKey('colour',look.colour))}</span></legend>
     <div className="lk-sws">{lookChoices.colour.map(colour=><label key={colour} className="lk-sw"><span className="lk-sw__o">{variant({colour:colour as AgentLook['colour']},22)}</span>
      <input {...radio('colour',colour)}/><span className="sr-only">{t(lookValueKey('colour',colour))}</span></label>)}</div></fieldset>
    <fieldset className="lk-grp"><legend className="lk-lg">{t(lookPartKey('temperament',false))}</legend>
     <div className="lk-tiles lk-tiles--t">{lookChoices.temperament.map(temperament=>tile('temperament',temperament,variant({temperament:temperament as AgentLook['temperament']},32),t(temperamentNameKey(temperament))))}</div>
     <p className="lk-say" aria-live="polite">{t(temperamentSayKey(look.temperament))}</p></fieldset>
   </div>
   <div className="lk-foot">
    <button type="button" className="link-btn" disabled={reset} onClick={resetLook}>{t('lookReset')}</button>
    <span className="od-fill"/>
    {settings}
   </div>
  </div>
 </dialog>;
}

// The control that opens the window, for the Owner alone: the window is open until it closes, and then the keyboard
// goes back to the control. `wait` lets a pressed face hop before the window covers it.
function LookOpener({agent,inSettings=false,wait=false,className,id,children}:{agent:Agent,inSettings?:boolean,wait?:boolean,className:string,id?:string,children:ReactNode}) {
 const {t}=useI18n();
 const changer=useLookChanger();
 const [open,setOpen]=useState(false);
 const opener=useRef<HTMLButtonElement>(null);
 const back=useRef(false);
 useEffect(()=>{ if(!open&&back.current) { back.current=false; opener.current?.focus(); } },[open]);
 if(!changer) return null;
 return <><button ref={opener} type="button" className={className} id={id} aria-haspopup="dialog" aria-label={t('lookTitle',agent.name)}
  onClick={()=>{ if(wait&&!prefersReducedMotion()) window.setTimeout(()=>setOpen(true),160); else setOpen(true); }}>{children}</button>
  {open&&<AgentLookWindow agent={agent} inSettings={inSettings} onClose={()=>{ back.current=true; setOpen(false); }}/>}</>;
}

// The big face in the Agent's details (agent-look.html: dpHTML): for the Owner a button with the pencil that hops and
// then opens the window; for every other Role the face alone, which only hops when pressed.
export function DetailsFace({agent,children}:{agent:Agent,children:ReactNode}) {
 if(!useLookChanger()) return <>{children}</>;
 return <LookOpener agent={agent} wait className="face-btn dp-face" id="dp-look">{children}<span className="lk-pen" aria-hidden="true"><ShellIcon name="pencil"/></span></LookOpener>;
}

// "Change its look" on a made Agent's card (agent-look.html: chatHTML's ac-look), for the Owner.
export function ChangeLookLink({agent}:{agent:Agent}) {
 const {t}=useI18n();
 return <LookOpener agent={agent} className="link-btn ac-look">{t('lookChangeIts')}</LookOpener>;
}

// The Look row on the Agent's page in Settings (agent-look.html: setHTML's #sr-look): its face, whether its look is
// automatic or picked with its colour and temperament, and for the Owner "Change".
export function LookRow({agent}:{agent:Agent}) {
 const {t}=useI18n();
 const kept=useKeptLook(agent.id);
 const shown=kept&&shownLook(kept);
 const words=kept&&shown?t('lookWords',t(lookPicked(kept)?'lookCustom':'lookAutomatic'),t(lookValueKey('colour',shown.colour)),t(lookValueKey('temperament',shown.temperament))):null;
 return <li className="panel-row" id="set-look"><AgentFace agent={agent.id} size={32}/>
  <span className="panel-row__text"><span className="panel-row__t">{t('lookRow')}</span>{words&&<span className="panel-row__d" id="set-look-val">{words}</span>}</span>
  {kept&&<LookOpener agent={agent} inSettings className="btn btn--secondary btn--sm lk-hit">{t('lookChange')}</LookOpener>}
 </li>;
}
