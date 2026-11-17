'use client';
import { createContext, lazy, Suspense, useContext, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { onComposerFocus, takeComposerFocus } from '@/lib/composer-focus';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { firstName } from '@/lib/channels';
import { AppTile } from '@/components/app-tile';
import { toast } from './toast';

// Loaded when drawn, so a composer outside a Company's pages loads neither.
const NewChannel=lazy(()=>import('./new-channel-dialog'));
const ConnectApps=lazy(()=>import('./plus-menu-apps'));
// crypto.randomUUID needs a secure context; an install reached over plain http still gets a v4 id.
export const newId=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

// The reference's composer (design-reference: composerHTML): one rounded box with the "+" button, the text, the
// microphone and the send arrow. Dictation is not built yet, so its button is drawn but says "Soon".
// The "+" menu (#153; design-reference: plusMenuHTML): `call` names whom a channel's composer calls (its other Members,
// then its Agents); every other composer calls the Agents this Member sees, as the sidebar lists them
// (CallableAgentsProvider). New channel, Connect apps and Model (#158) read the page's Company and the reader's role
// (ComposerPlaceProvider, from the Shell); a composer drawn outside it has none of them. `model` names the Conversation
// whose Runs the Owner's pick applies to. Attach (#155) is not built yet.
// One send key per typed message, so a double click or a retry runs once; a new text gets a new key.
// While the Agent works (design-reference: syncComposer), an empty box turns the send arrow into a stop square for a
// person allowed to stop the run (`stop`); typed text is still sent, and waits for the current reply.
// `focus` opens the box focused ("New agent" opens Lead's chat ready to type, #13). A new chat opened with "N" (app/new-chat-key)
// focuses the box once its page has landed.
// `ref` takes a sentence pressed in an empty chat (`insert`): it follows any text already typed, on its own line, and the
// box is focused at its end. While a message is on its way the box keeps that message and takes no sentence.
export type MessageBoxHandle={insert:(sentence:string)=>void};
export type CallableAgent={id:string,connection_id:string,name:string};
export type Callable={people:{id:string,name:string}[],agents:CallableAgent[]};
const CallableAgents=createContext<CallableAgent[]>([]);
export function CallableAgentsProvider({agents,children}:{agents:CallableAgent[],children:ReactNode}) {
 return <CallableAgents value={agents}>{children}</CallableAgents>;
}
// Where the composer is: the Company, the reader, whether they are its Owner or may manage it, and whether it is worked alone.
export type ComposerPlace={slug:string,company:string,person:string,owner:boolean,manage:boolean,alone:boolean};
const Place=createContext<ComposerPlace|null>(null);
export function ComposerPlaceProvider({place,children}:{place:ComposerPlace|null,children:ReactNode}) {
 return <Place value={place}>{children}</Place>;
}
export type ModelTarget={company:string,conversation:string,agent:string};
export function MessageBox({placeholder,label,send,stop,focus=false,call,model,ref}:{placeholder:string,label?:string,send:(text:string,sendKey:string)=>Promise<string|null>,stop?:{label:string,run:()=>Promise<string|null>},focus?:boolean,call?:Callable,model?:ModelTarget,ref?:Ref<MessageBoxHandle>}) {
 const {t}=useI18n(); const [text,setText]=useState(''); const [key,setKey]=useState(newId); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const seen=useContext(CallableAgents); const callable=call??{people:[],agents:seen};
 // Text typed into the server-drawn box before this code arrived is the person's own: it is kept, and Send sends it.
 const field=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{ const typed=field.current?.value; if(typed) setText(current=>current||typed); },[]);
 const caret=useRef<number|null>(null);
 useImperativeHandle(ref,()=>({insert(sentence) {
  if(busy) return;
  const next=text.trim()?`${text.trimEnd()}\n${sentence}`:sentence;
  caret.current=next.length; setText(next); setKey(newId());
 }}),[busy,text]);
 // design-reference: insertAtCaret. While a message is on its way the box keeps it, so nothing is put in.
 function insertAtCaret(insert:string) {
  const box=field.current; if(!box) return;
  if(busy) { box.focus(); return; }
  const at=box.selectionStart??text.length; const before=text.slice(0,at);
  const added=(before&&!/\s$/.test(before)?' ':'')+insert;
  caret.current=at+added.length; setText(before+added+text.slice(at)); setKey(newId());
 }
 useEffect(()=>{ const box=field.current; if(caret.current===null||!box) return; box.focus(); box.setSelectionRange(caret.current,caret.current); caret.current=null; },[text]);
 const pathname=usePathname()??''; const search=useSearchParams()?.toString()??'';
 // An inert box (behind the phone drawer) leaves the request to the frame, which focuses it once the drawer has closed.
 useEffect(()=>{ const take=()=>{ if(field.current&&!field.current.closest('[inert]')&&takeComposerFocus(search?`${pathname}?${search}`:pathname)) field.current.focus(); }; take(); return onComposerFocus(take); },[pathname,search]);
 async function submit() {
  if(!text.trim()||busy) return;
  setBusy(true); setError('');
  const failure=await send(text,key);
  setBusy(false);
  if(failure) setError(failure); else { setText(''); setKey(newId()); }
 }
 async function halt({run}:{run:()=>Promise<string|null>}) {
  setBusy(true); setError('');
  const failure=await run();
  setBusy(false);
  if(failure) setError(failure);
 }
 return <div className="composer">
  <div className="composer__row">
   <PlusMenu callable={callable} channel={!!call} model={model} insert={insertAtCaret} field={()=>field.current?.focus()} fail={setError}/>
   <textarea ref={field} className="composer__input" dir="auto" rows={1} autoFocus={focus} readOnly={busy} aria-busy={busy} aria-label={label??t('conversationMessage')} placeholder={placeholder} value={text} onChange={event=>{setText(event.target.value);setKey(newId());}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/>
   <button type="button" className="composer__btn composer__mic" aria-disabled="true" aria-label={`${t('chatDictation')} · ${t('soon')}`} title={t('soon')}><ShellIcon name="mic"/></button>
   {stop&&!text.trim()?<button type="button" className="composer__send is-stop" aria-label={stop.label} title={stop.label} disabled={busy} onClick={()=>void halt(stop)}><svg className="gw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg></button>
   :<button type="button" className="composer__send" aria-label={t('conversationSend')} disabled={!text.trim()||busy} onClick={()=>void submit()}><ShellIcon name="send"/></button>}
  </div>
  {error&&<p role="alert" className="composer-error">{t(error)}</p>}
 </div>;
}

// design-reference: plusMenuHTML, togglePlus, closePlus, closeMenus and the menu's keys. Opening focuses its first entry;
// Escape and a second press give the focus back to "+"; Tab and a click outside only close it. The label names only
// what the menu holds for this Member (design-reference: plusLabel).
const commands=[{command:'/agent',label:'plusCommandAgent'}];
function PlusMenu({callable,channel,model,insert,field,fail}:{callable:Callable,channel:boolean,model?:ModelTarget,insert:(text:string)=>void,field:()=>void,fail:(error:string)=>void}) {
 const {t}=useI18n(); const [open,setOpen]=useState(false);
 const place=useContext(Place); const [making,setMaking]=useState(false);
 // design-reference: plusMenuHTML's canManage() && !isSolo(), and the Model part for the Owner alone (#158's safe default).
 const team=!!place&&place.manage&&!place.alone; const picks=!!place?.owner&&!!model;
 const models=useModels(open&&picks?model:undefined);
 const button=useRef<HTMLButtonElement>(null); const menu=useRef<HTMLDivElement>(null);
 const items=()=>[...menu.current?.querySelectorAll<HTMLButtonElement>('.menu__item')??[]];
 useEffect(()=>{
  if(!open) return;
  items()[0]?.focus();
  const outside=(event:MouseEvent)=>{ const target=event.target as Node; if(!menu.current?.contains(target)&&!button.current?.contains(target)) setOpen(false); };
  document.addEventListener('click',outside);
  return ()=>document.removeEventListener('click',outside);
 },[open]);
 const close=(focus:boolean)=>{ setOpen(false); if(focus) button.current?.focus(); };
 const pick=(text:string)=>{ setOpen(false); insert(text); };
 const keys=(event:KeyboardEvent)=>{
  const list=items(); const at=list.indexOf(document.activeElement as HTMLButtonElement);
  const move=(index:number)=>{ event.preventDefault(); list[index]?.focus(); };
  if(event.key==='ArrowDown') move((at+1)%list.length);
  else if(event.key==='ArrowUp') move((at-1+list.length)%list.length);
  else if(event.key==='Home') move(0);
  else if(event.key==='End') move(list.length-1);
  else if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  else if(event.key==='Tab') setOpen(false);
 };
 const {people,agents}=callable; const anyone=people.length>0||agents.length>0;
 // design-reference: plusLabel. Attach is not built, so it is not named.
 const label=`${t('chatMore')}: ${[anyone&&t('plusPartCall'),team&&!channel&&t('plusPartChannel'),t('plusPartCommands'),picks&&t('plusPartModel')].filter(Boolean).join(t('plusPartsJoin'))}`;
 // design-reference: plus-team, openTeamCreate(opener): closing the dialog gives the focus back to "+".
 const newChannel=()=>{ setOpen(false); setMaking(true); };
 // design-reference: pick-model. The choice is kept on the Conversation only; the Agent's own model is left as it is.
 async function pickModel(choice:{provider:string,model:string}) {
  if(!model) return;
  setOpen(false); field();
  const failure=await postMessage({company:model.company,conversation:model.conversation,intent:'model',choice});
  if(failure) { fail(failure); return; }
  fail('');
  toast(t('plusModelPicked',model.agent,choice.model));
 }
 return <>
  {open&&<div className="menu" role="menu" aria-label={t('chatMore')} ref={menu} onKeyDown={keys}>
   {people.length>0&&<><div className="menu__label">{t('plusCallPerson')}</div>
    {people.map(person=>{ const handle=`@${firstName(person.name)}`; return <button key={person.id} type="button" className="menu__item" role="menuitem" onClick={()=>pick(`${handle} `)}>
     <span className="me__av lg-av" style={{'--av':'20px'} as CSSProperties} aria-hidden="true">{Array.from(person.name.trim())[0]||'?'}</span><span className="menu__t">{person.name}</span><bdi className="menu__hint" dir="auto">{handle}</bdi></button>; })}</>}
   {agents.length>0&&<div className="menu__label">{t('plusCallAgent')}</div>}
   {agents.map(agent=><button key={agent.id} type="button" className="menu__item" role="menuitem" onClick={()=>pick(`@${agent.name} `)}>
    <span aria-hidden="true"><CompanyAgentFace agent={agent} size={20}/></span><bdi className="menu__t">{agent.name}</bdi><bdi className="menu__hint">@{agent.name}</bdi></button>)}
   {team&&<button type="button" className="menu__item" role="menuitem" onClick={newChannel}>
    <ShellIcon name="hash"/><span className="menu__t">{t('shellNewChannel')}<span className="menu__d">{t('plusNewChannelSub')}</span></span></button>}
   <div className="menu__sep" role="separator"/>
   <div className="menu__label">{t('plusCommands')}</div>
   {commands.map(command=><button key={command.command} type="button" className="menu__item" role="menuitem" onClick={()=>pick(`${command.command} `)}>
    <ShellIcon name="slash"/><span className="menu__t">{t(command.label)}</span><span className="menu__hint menu__code">{command.command}</span></button>)}
   {place&&<><div className="menu__sep" role="separator"/><Suspense fallback={null}><ConnectApps place={place} close={()=>setOpen(false)} opener={()=>button.current}/></Suspense></>}
   {picks&&models&&models.list.length>0&&<><div className="menu__sep" role="separator"/>
    <div className="menu__label">{t('plusModel')}</div>
    {models.list.map(row=>{ const on=row.provider===models.current?.provider&&row.model===models.current?.model;
     return <button key={`${row.provider}:${row.model}`} type="button" className="menu__item" role="menuitemradio" aria-checked={on} onClick={()=>void pickModel({provider:row.provider,model:row.model})}>
      <AppTile app={{key:modelMark(row),mark:Array.from(row.providerName.trim())[0]?.toUpperCase()||'·'}}/><span className="menu__t"><bdi>{row.model}</bdi><span className="menu__d"><bdi>{row.providerName}</bdi></span></span>
      {on&&<ShellIcon name="check" className="menu__check"/>}</button>; })}</>}
  </div>}
  {making&&place&&<Suspense fallback={null}><NewChannel slug={place.slug} company={place.company} person={place.person} close={()=>setMaking(false)} opener={()=>button.current}/></Suspense>}
  <button type="button" ref={button} className="composer__btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={()=>open?close(true):setOpen(true)}><ShellIcon name="plus"/></button>
 </>;
}

// The models the Agent's Engine offers for this Conversation and the one in use (#158), read each time the menu opens.
type ModelRow={provider:string,providerName:string,model:string};
type Models={list:ModelRow[],current:{provider:string,model:string}|null};
function useModels(target:ModelTarget|undefined) {
 const [models,setModels]=useState<Models|null>(null);
 const company=target?.company; const conversation=target?.conversation;
 useEffect(()=>{
  if(!company||!conversation) return;
  let live=true;
  void fetch(`/api/conversations?company=${company}&conversation=${conversation}&intent=models`,{cache:'no-store'}).then(response=>response.ok?response.json():null)
   .then(body=>{ if(live&&Array.isArray(body?.models)) setModels({list:body.models,current:body.current??null}); }).catch(()=>{});
  return ()=>{live=false;};
 },[company,conversation]);
 return target?models:null;
}
// The reference's mark for a model (design-reference: MODELS' logo): its maker's, also when another provider serves it.
const makers:[RegExp,string][]=[[/^(anthropic|claude)/,'claude'],[/^(openai|gpt|o\d)/,'openai'],[/^(google|gemini)/,'gemini']];
const modelMark=({provider,model}:ModelRow)=>makers.find(([pattern])=>pattern.test(provider)||pattern.test(model))?.[1]??provider;

export async function postMessage(body:object,path='/api/conversations') {
 try {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.ok?null:((await response.json()).error as string)||'conversationFailed';
 } catch { return 'conversationFailed'; }
}
