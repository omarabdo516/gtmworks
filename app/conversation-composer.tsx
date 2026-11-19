'use client';
import { createContext, lazy, Suspense, useContext, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { onComposerFocus, takeComposerFocus } from '@/lib/composer-focus';
import { commandList, insertToken, tokenAtCaret } from '@/lib/composer-mentions.mjs';
import { useI18n } from '@/lib/i18n-client';
import { statusKeys } from '@/lib/agent-details.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { firstName } from '@/lib/channels';
import { AppTile } from '@/components/app-tile';
import { conversationFilesProblem, imageTypes, maxFiles } from '@/lib/attachments.mjs';
import { useComposerDictation, type DictationTarget } from './composer-mic';
import { toast } from './toast';

// Loaded when drawn, so a composer outside a Company's pages loads neither.
const NewChannel=lazy(()=>import('./new-channel-dialog'));
const ConnectApps=lazy(()=>import('./plus-menu-apps'));
// crypto.randomUUID needs a secure context; an install reached over plain http still gets a v4 id.
export const newId=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

// The reference's composer (design-reference: composerHTML): one rounded box with the "+" button, the text, the
// microphone and the send arrow. The microphone dictates (#160, app/composer-mic.tsx) for the Agent named by `voice`; a
// box drawn without one (outside a Company) keeps the button, marked "Soon".
// The "+" menu (#153; design-reference: plusMenuHTML): `call` names whom a channel's composer calls (its other Members,
// then its Agents); every other composer calls the Agents this Member sees, as the sidebar lists them
// (CallableAgentsProvider). New channel, Connect apps and Model (#158) read the page's Company and the reader's role
// (ComposerPlaceProvider, from the Shell); a composer drawn outside it has none of them. `model` names the Conversation
// whose Runs the Owner's pick applies to.
// Images go with a message (#155; design-reference: plusMenuHTML's attach, filesHTML, syncFiles): "Attach a file" in
// the "+" menu opens the picker, each chosen image is a chip above the field with a cross that takes it off and gives
// the focus back, and Send is on with a file and no text. `attach` names whether this composer may carry them. What may
// be attached is decided once for the composer and the route
// (lib/attachments.mjs, conversationFilesProblem), and a refused pick says why in one line under the box.
// One send key per typed message, so a double click or a retry runs once; a new text gets a new key.
// While the Agent works (design-reference: syncComposer), an empty box turns the send arrow into a stop square for a
// person allowed to stop the run (`stop`); typed text is still sent, and waits for the current reply.
// `focus` opens the box focused ("New agent" opens Lead's chat ready to type, #13). A new chat opened with "N" (app/new-chat-key)
// focuses the box once its page has landed.
// `ref` takes a sentence pressed in an empty chat (`insert`): it follows any text already typed, on its own line, and the
// box is focused at its end. While a message is on its way the box keeps that message and takes no sentence.
// Typing "@" or "/" at the start of the message or after a space opens the suggestion list (#154; design-reference:
// updatePop, mentionMenu): the Agents this Member sees, and in a channel its other Members before them; "/" offers the
// Commands. Its keys are the reference's: Arrow keys move and wrap, Enter or Tab picks in place of the token with one
// space after it, Escape closes and keeps the text, and Enter sends only when the list is closed. Opening the list
// closes the "+" menu and the other way round. A note field draws the same list without Commands (app/card-sheet.tsx).
export type MessageBoxHandle={insert:(sentence:string)=>void};
export type CallablePerson={id:string,name:string,role?:'owner'|'manager'|'contributor'|'viewer'};
export type CallableAgent={id:string,connection_id:string,name:string,speciality?:string|null,status?:keyof typeof statusKeys,role?:string|null};
export type Callable={people:CallablePerson[],agents:CallableAgent[]};
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
// The Commands "/" offers (design-reference: CMDS), the same list the "+" menu names: each job command whose Agent this
// Member sees, naming it, then "/agent" (#159; lib/composer-mentions.mjs commandList).
type Command={command:string,label:string,agent?:string};
export type Suggestion={kind:'people'|'agents'|'commands',insert:string,person?:CallablePerson,agent?:CallableAgent,command?:Command};
// design-reference: mentionMenu. A channel's "@" offers its other Members, then its Agents; a note's the same without
// Commands; a Conversation's the Agents the Member sees. Each name and command is narrowed by what follows the token.
export function mentionSuggestions(callable:Callable,token:{type:string,q:string},withCommands:boolean):Suggestion[] {
 const people=token.type==='@'?callable.people.filter(person=>firstName(person.name).toLowerCase().includes(token.q)||person.name.toLowerCase().includes(token.q)):[];
 const agents=token.type==='@'?callable.agents.filter(agent=>agent.name.toLowerCase().includes(token.q)):[];
 const matches=token.type==='/'&&withCommands?commandList(callable.agents).filter(item=>item.command.slice(1).toLowerCase().startsWith(token.q)):[];
 return [
  ...people.map(person=>({kind:'people' as const,insert:`@${firstName(person.name)} `,person})),
  ...agents.map(agent=>({kind:'agents' as const,insert:`@${agent.name} `,agent})),
  ...matches.map(command=>({kind:'commands' as const,insert:`${command.command} `,command})),
 ];
}
const sectionLabels={people:'mentionTeam',agents:'plusCallAgent',commands:'plusCommands'} as const;
const roleLabels={owner:'owner',manager:'manager',contributor:'contributor',viewer:'viewer'} as const;
// design-reference: updatePop's listbox. A label starts each section; the marked entry carries aria-selected, since the
// field keeps the keyboard and points at it with aria-activedescendant.
export function MentionPop({listId,label,items,index,pick}:{listId:string,label:string,items:Suggestion[],index:number,pick:(at:number)=>void}) {
 const {t}=useI18n();
 const rows:ReactNode[]=[]; let section:Suggestion['kind']|undefined;
 items.forEach((item,at)=>{
  if(item.kind!==section) rows.push(<div key={`label-${at}`} className="menu__label">{t(sectionLabels[item.kind])}</div>);
  section=item.kind;
  rows.push(<button key={`${item.kind}-${at}`} type="button" className="menu__item" role="option" id={`${listId}-${at}`} aria-selected={at===index} tabIndex={-1}
   onMouseDown={event=>event.preventDefault()} onClick={()=>pick(at)}>
   {item.person&&<><span className="me__av lg-av" style={{'--av':'22px'} as CSSProperties} aria-hidden="true">{Array.from(item.person.name.trim())[0]||'?'}</span>
    <span className="menu__t">{item.person.name}{item.person.role&&<span className="menu__d">{t(roleLabels[item.person.role])}{item.person.role==='viewer'&&` · ${t('mentionReadsOnly')}`}</span>}</span>
    <bdi className="menu__hint" dir="auto">@{firstName(item.person.name)}</bdi></>}
   {item.agent&&<><span aria-hidden="true"><CompanyAgentFace agent={item.agent} size={22}/></span>
    <span className="menu__t"><bdi>{item.agent.name}</bdi>{(item.agent.status||item.agent.speciality)&&<span className="menu__d">{item.agent.status&&t(statusKeys[item.agent.status])}{item.agent.status&&item.agent.speciality&&' · '}{item.agent.speciality&&<bdi>{item.agent.speciality}</bdi>}</span>}</span></>}
   {item.command&&<><ShellIcon name="slash"/><span className="menu__t">{t(item.command.label,item.command.agent)}</span><span className="menu__hint menu__code">{item.command.command}</span></>}
  </button>);
 });
 return <div className="menu" role="listbox" aria-label={label}>{rows}</div>;
}
type SuggestionList={token:{type:string,q:string,start:number,end:number},items:Suggestion[],index:number};
export type ModelTarget={company:string,conversation:string,agent:string};
// Why a chosen image, or a set of them, cannot go with this message: the one line under the box (design-reference has
// no such line, since it takes any file; the Engine reads images only).
const refusalOf=(problem:'type'|'count'|'size'|'request')=>problem==='type'?'attachTypeRefused':problem==='count'?'attachCountRefused':problem==='size'?'attachSizeRefused':'attachRequestRefused';
export function MessageBox({placeholder,label,send,stop,focus=false,call,model,refused,attach=true,voice,ref}:{placeholder:string,label?:string,send:(text:string,sendKey:string,files:File[])=>Promise<string|null>,stop?:{label:string,run:()=>Promise<string|null>},focus?:boolean,call?:Callable,model?:ModelTarget,refused?:{key:string,text:string},attach?:boolean,voice?:DictationTarget,ref?:Ref<MessageBoxHandle>}) {
 const {t}=useI18n(); const [text,setText]=useState(''); const [files,setFiles]=useState<File[]>([]); const [key,setKey]=useState(newId); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const seen=useContext(CallableAgents);
 // A channel's Agents carry no role of their own; the Agents this Member sees do, so each takes its role by id, and its
 // Commands are listed as in a Conversation.
 const callable=call?{people:call.people,agents:call.agents.map(agent=>({...agent,role:agent.role??seen.find(seenAgent=>seenAgent.id===agent.id)?.role??null}))}:{people:[],agents:seen};
 // The suggestion list's token, entries and marked entry (#154); the field keeps the keyboard and points at the entry.
 const [list,setList]=useState<SuggestionList|null>(null); const [listId]=useState(()=>`mention-${newId()}`); const [plusOpen,setPlusOpen]=useState(false);
 // Text typed into the server-drawn box before this code arrived is the person's own: it is kept, and Send sends it.
 const field=useRef<HTMLTextAreaElement>(null);
 // The reference's one picker (#file-input): opened from the menu, it appends to what is already chosen.
 const picker=useRef<HTMLInputElement>(null);
 const canSend=!!text.trim()||files.length>0;
 useEffect(()=>{ const typed=field.current?.value; if(typed) setText(current=>current||typed); },[]);
 const caret=useRef<number|null>(null);
 // A waiting message the Engine refused for its model comes back to an empty box with the model line, as a sent one stays.
 // It goes once that message is no longer the latest (another tab sent one); the box's text and any other line stay.
 const [shownRefusal,setShownRefusal]=useState<string>(); const [refusalLine,setRefusalLine]=useState(false);
 if(refused&&refused.key!==shownRefusal) { setShownRefusal(refused.key); setText(current=>current||refused.text); setError('conversationModelRefused'); setRefusalLine(true); }
 if(!refused&&shownRefusal) { setShownRefusal(undefined); setRefusalLine(false); if(refusalLine&&error==='conversationModelRefused') setError(''); }
 useImperativeHandle(ref,()=>({insert(sentence) {
  if(busy) return;
  const next=text.trim()?`${text.trimEnd()}\n${sentence}`:sentence;
  caret.current=next.length; setText(next); setKey(newId()); setList(null);
 }}),[busy,text]);
 // design-reference: insertAtCaret. While a message is on its way the box keeps it, so nothing is put in.
 function insertAtCaret(insert:string) {
  const box=field.current; if(!box) return;
  if(busy) { box.focus(); return; }
  const at=box.selectionStart??text.length; const before=text.slice(0,at);
  const added=(before&&!/\s$/.test(before)?' ':'')+insert;
  caret.current=at+added.length; setText(before+added+text.slice(at)); setKey(newId()); setList(null);
 }
 // design-reference: updatePop. The list follows the token under the caret; a space after it or a query nothing matches
 // closes it, and opening it closes the "+" menu.
 function updateList(value:string,at:number) {
  const token=tokenAtCaret(value,at);
  if(!token) { setList(null); return; }
  const items=mentionSuggestions(callable,token,true);
  if(!items.length) { setList(null); return; }
  setPlusOpen(false); setList({token,items,index:0});
 }
 // design-reference: pickPop. The chosen entry takes the token's place, one space after, and the list closes.
 function pickEntry(at:number) {
  if(!list) return;
  const chosen=list.items[at]; if(!chosen) return;
  const next=insertToken(text,list.token,chosen.insert);
  caret.current=next.caret; setText(next.value); setKey(newId()); setList(null);
 }
 function typeKeys(event:KeyboardEvent<HTMLTextAreaElement>) {
  if(list) {
   if(event.key==='ArrowDown') { event.preventDefault(); setList(current=>current&&{...current,index:(current.index+1)%current.items.length}); return; }
   if(event.key==='ArrowUp') { event.preventDefault(); setList(current=>current&&{...current,index:(current.index-1+current.items.length)%current.items.length}); return; }
   if(event.key==='Enter'||event.key==='Tab') { event.preventDefault(); pickEntry(list.index); return; }
   if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setList(null); return; }
  }
  if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
 }
 useEffect(()=>{ const box=field.current; if(caret.current===null||!box) return; box.focus(); box.setSelectionRange(caret.current,caret.current); caret.current=null; },[text]);
 // Recording takes the field's place, so the suggestion list and the "+" menu close as it starts (design-reference:
 // startMic calls closePlus and closePop).
 const dictation=useComposerDictation({target:voice,insert:insertAtCaret,field:()=>field.current?.focus(),onStart:()=>{ setList(null); setPlusOpen(false); }});
 const pathname=usePathname()??''; const search=useSearchParams()?.toString()??'';
 // design-reference: the file input's change handler, with the check the route makes again: nothing is added that could
 // not be sent, and the line says why.
 function chose(event:ChangeEvent<HTMLInputElement>) {
  const picked=Array.from(event.target.files??[]); event.target.value='';
  if(!picked.length) return;
  const next=[...files,...picked]; const problem=conversationFilesProblem(next,text);
  if(problem) setError(refusalOf(problem)); else { setError(''); setFiles(next); }
  field.current?.focus();
 }
 // design-reference: unattach. The cross takes one off and gives the focus back to the field.
 function remove(index:number) {
  setFiles(current=>current.filter((_,at)=>at!==index)); field.current?.focus();
 }
 // An inert box (behind the phone drawer) leaves the request to the frame, which focuses it once the drawer has closed.
 useEffect(()=>{ const take=()=>{ if(field.current&&!field.current.closest('[inert]')&&takeComposerFocus(search?`${pathname}?${search}`:pathname)) field.current.focus(); }; take(); return onComposerFocus(take); },[pathname,search]);
 async function submit() {
  if(dictation.recording) dictation.finish(false);
  if(!canSend||busy) return;
  const problem=conversationFilesProblem(files,text);
  if(problem) { setError(refusalOf(problem)); return; }
  setBusy(true); setError(''); setRefusalLine(false); setList(null);
  const failure=await send(text,key,files);
  setBusy(false);
  if(failure) setError(failure); else { setText(''); setFiles([]); setKey(newId()); }
 }
 async function halt({run}:{run:()=>Promise<string|null>}) {
  setBusy(true); setError(''); setRefusalLine(false);
  const failure=await run();
  setBusy(false);
  if(failure) setError(failure);
 }
 return <div className={`composer${dictation.recording?' is-rec':''}`}>
  {files.length>0&&<div className="composer__files">{files.map((file,index)=><span key={`${file.name}:${index}`} className="file-chip"><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi><button type="button" onClick={()=>remove(index)} aria-label={t('attachRemove',file.name)}><ShellIcon name="x"/></button></span>)}</div>}
  <input ref={picker} type="file" className="composer__file-input" accept={imageTypes.join(',')} multiple hidden tabIndex={-1} aria-hidden="true" onChange={chose}/>
  {list&&!dictation.recording&&<MentionPop listId={listId} label={t('mentionSuggestions')} items={list.items} index={list.index} pick={pickEntry}/>}
  <div className="composer__row">
   {dictation.recording?dictation.cancel:<PlusMenu open={plusOpen} setOpen={next=>{ if(next) setList(null); setPlusOpen(next); }} callable={callable} channel={!!call} model={model} attach={attach} pickFile={()=>picker.current?.click()} insert={insertAtCaret} field={()=>field.current?.focus()} fail={setError}/>}
   <textarea ref={field} className="composer__input" dir="auto" rows={1} autoFocus={focus} readOnly={busy} aria-busy={busy} aria-label={label??t('conversationMessage')} placeholder={dictation.writing?t('chatDictationWriting'):placeholder} value={text} aria-autocomplete="list" aria-expanded={!!list&&!dictation.recording} aria-activedescendant={list&&!dictation.recording?`${listId}-${list.index}`:undefined}
    onChange={event=>{ const value=event.target.value; setText(value); setKey(newId()); updateList(value,event.target.selectionStart??value.length); }} onKeyDown={typeKeys}/>
   {dictation.recording&&dictation.wave}
   {dictation.recording&&dictation.clock}
   {voice?dictation.button:<button type="button" className="composer__btn composer__mic" aria-disabled="true" aria-label={`${t('chatDictation')} · ${t('soon')}`} title={t('soon')}><ShellIcon name="mic"/></button>}
   {stop&&!canSend?<button type="button" className="composer__send is-stop" aria-label={stop.label} title={stop.label} disabled={busy} onClick={()=>void halt(stop)}><svg className="gw-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg></button>
   :<button type="button" className="composer__send" aria-label={t('conversationSend')} disabled={!canSend||busy} onClick={()=>void submit()}><ShellIcon name="send"/></button>}
  </div>
  {error&&<p role="alert" className="composer-error">{t(error,maxFiles)}</p>}
  {dictation.error&&<p role="alert" className="composer-error">{t(dictation.error)}</p>}
 </div>;
}

// design-reference: plusMenuHTML, togglePlus, closePlus, closeMenus and the menu's keys. Opening focuses its first entry;
// Escape and a second press give the focus back to "+"; Tab and a click outside only close it. The label names only
// what the menu holds for this Member (design-reference: plusLabel). Its open state is the composer's, so opening the
// suggestion list closes it (#154).
function PlusMenu({open,setOpen,callable,channel,model,attach,pickFile,insert,field,fail}:{open:boolean,setOpen:(open:boolean)=>void,callable:Callable,channel:boolean,model?:ModelTarget,attach:boolean,pickFile:()=>void,insert:(text:string)=>void,field:()=>void,fail:(error:string)=>void}) {
 const {t}=useI18n();
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
 },[open]); // eslint-disable-line react-hooks/exhaustive-deps -- focus its first entry once it opens, not on every draw
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
 const {people,agents}=callable; const anyone=people.length>0||agents.length>0; const commands=commandList(agents);
 // design-reference: plusLabel. It names only what the menu holds for this Member.
 const label=`${t('chatMore')}: ${[anyone&&t('plusPartCall'),team&&!channel&&t('plusPartChannel'),t('plusPartCommands'),attach&&t('plusPartAttach'),picks&&t('plusPartModel')].filter(Boolean).join(t('plusPartsJoin'))}`;
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
    <ShellIcon name="slash"/><span className="menu__t">{t(command.label,command.agent)}</span><span className="menu__hint menu__code">{command.command}</span></button>)}
   {/* design-reference: plusMenuHTML. One separator, then Attach a file and Connect apps together. */}
   {(attach||place)&&<div className="menu__sep" role="separator"/>}
   {attach&&<button type="button" className="menu__item" role="menuitem" onClick={()=>{ setOpen(false); pickFile(); }}>
    <ShellIcon name="clip"/><span className="menu__t">{t('plusAttach')}</span></button>}
   {place&&<Suspense fallback={null}><ConnectApps place={place} close={()=>setOpen(false)} opener={()=>button.current}/></Suspense>}
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

// A message that carries images goes as a form, the images themselves beside the fields a text-only send posts (#155):
// the route refuses what the Engine cannot read before anything is stored. Every other field is the same.
export async function postMessageWithFiles(fields:Record<string,unknown>,files:File[],path='/api/conversations') {
 const form=new FormData();
 for(const [key,value] of Object.entries(fields)) if(value!==undefined) form.append(key,String(value));
 for(const file of files) form.append('files',file);
 try {
  const response=await fetch(path,{method:'POST',body:form});
  return response.ok?null:((await response.json()).error as string)||'conversationFailed';
 } catch { return 'conversationFailed'; }
}
