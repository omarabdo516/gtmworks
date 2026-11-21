'use client';
import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { useCardText } from '@/app/agent-card';
import { ChangeCard, useChangeShared, type ChangeField } from '@/app/change-card';
import { useChangeWords, modelParts, type ModelChoice } from '@/app/change-words';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/paperclip/ui/dialog';
import { useI18n } from '@/lib/i18n-client';
import { settingLabelKey } from '@/lib/engine-setting-labels.mjs';
import type { WaitingItem } from '@/lib/approval-queue';
import type { ChangeProposalView } from '@/lib/conversations';
import { answerAgentChange } from './skill-actions';

// While an answer is on its way every control of its form is held, so a second press sends nothing.
function Held({children}:{children:(sending:boolean)=>ReactNode}) { return children(useFormStatus().pending); }
const kinds=['model','instructions','toolset','setting'] as const;
const modelOf=(choice:ModelChoice)=>`${choice.provider}/${choice.model}`;

// The arrow keys move through a radio group as the reference's segmented fields do: right or down forward in English,
// left or down forward in Arabic; the ends stop the arrow.
function step(event:KeyboardEvent,rtl:boolean) {
 const key=event.key;
 if(key!=='ArrowLeft'&&key!=='ArrowRight'&&key!=='ArrowUp'&&key!=='ArrowDown') return 0;
 event.preventDefault();
 return key==='ArrowDown'?1:key==='ArrowUp'?-1:(key==='ArrowLeft')===rtl?1:-1;
}

// One editor per kind of change (#484; design-reference: chgHTML's edit form): the models the Agent's profile's Engine
// lists, the instructions field, the sub-agents switch, or the listed setting's own field as Settings draws it (a
// switch, its choices, a whole number from its least, or text). `draft` is the value the Owner approves instead.
function ChangeEditor({change,field,draft,setDraft,invalid,ids}:{change:ChangeProposalView,field:ChangeField,draft:unknown,setDraft:(value:unknown)=>void,invalid:boolean,ids:{label:string,error:string}}) {
 const {c}=useCardText(); const {t,language}=useI18n(); const rtl=language==='ar';
 const described={'aria-describedby':ids.error,'aria-invalid':invalid||undefined};
 const toggle=(label:ReactNode)=><div className="set-field chg-switch-field"><span className="set-label" id={ids.label}>{label}</span>
  <button type="button" className="switch" role="switch" aria-checked={draft===true} aria-labelledby={ids.label} autoFocus onClick={()=>setDraft(draft!==true)}/>
  <span className="set-hint" aria-hidden="true">{draft===true?c('changeOn'):c('changeOff')}</span></div>;
 if(field.kind==='model') {
  // The proposed model stays a choice even when the Engine no longer lists it, so the Owner can keep it.
  const proposed=String(change.value);
  const choices=field.options.some(choice=>modelOf(choice)===proposed)?field.options:[...field.options,{...modelParts(proposed),providerName:modelParts(proposed).provider}];
  const at=Math.max(0,choices.findIndex(choice=>modelOf(choice)===draft));
  const id=(index:number)=>`chg-mdl-${change.id}-${index}`;
  return <div className="set-field"><span className="set-label" id={ids.label}>{c('changeEditModel')}</span>
   <div className="segmented segmented--field chg-models" role="radiogroup" aria-labelledby={ids.label}>{choices.map((choice,index)=>{ const on=index===at;
    return <button type="button" role="radio" key={modelOf(choice)} id={id(index)} aria-checked={on} tabIndex={on?0:-1} autoFocus={on} title={choice.providerName}
     onClick={()=>setDraft(modelOf(choice))} onKeyDown={event=>{ const move=step(event,rtl); if(!move) return; const next=Math.max(0,Math.min(choices.length-1,at+move));
      setDraft(modelOf(choices[next])); document.getElementById(id(next))?.focus(); }}><bdi>{choice.model}</bdi></button>; })}</div></div>;
 }
 if(field.kind==='instructions') return <div className="set-field"><label className="set-label" id={ids.label} htmlFor={`${ids.label}-input`}>{c('changeEditInstructions')}</label>
  <textarea className="set-input set-textarea chg-text-input" id={`${ids.label}-input`} rows={8} maxLength={field.limit} dir="auto" autoFocus value={String(draft??'')}
   onChange={event=>setDraft(event.target.value)} {...described}/></div>;
 if(field.kind==='switch') return toggle(c('changeSubagents'));
 const label=t(settingLabelKey(change.setting));
 if(field.type==='boolean') return toggle(label);
 const input={className:'set-input',id:`${ids.label}-input`,autoFocus:true,...described};
 return <div className="set-field"><label className="set-label" id={ids.label} htmlFor={input.id}>{label}</label>
  {field.type==='select'&&field.choices?.length?<select {...input} value={String(draft??'')} onChange={event=>setDraft(event.target.value)}>
    {[...new Set([...field.choices,...(typeof change.value==='string'&&!field.choices.includes(change.value)?[change.value]:[])])].map(choice=><option key={choice} value={choice}>{choice}</option>)}
   </select>
   :field.type==='number'?<input {...input} type="number" inputMode={field.limits?.integer?'numeric':'decimal'} min={field.limits?.min} max={field.limits?.max} step={field.limits?.integer?1:'any'}
    value={draft===''||draft===null||draft===undefined?'':String(draft)} onChange={event=>setDraft(event.target.value===''?'':Number(event.target.value))}/>
   :<input {...input} type="text" maxLength={500} dir="auto" value={String(draft??'')} onChange={event=>setDraft(event.target.value)}/>}
  {field.type==='number'&&field.limits?.integer&&field.limits.min!==undefined&&<span className="set-hint">{c('changeEditRange',field.limits.min)}</span>}
 </div>;
}

// A value the Owner may approve: instructions that say something, a number within the setting's own limits.
function editProblem(field:ChangeField,draft:unknown) {
 if(field.kind==='instructions') return typeof draft!=='string'||!draft.trim();
 if(field.kind!=='setting'||field.type!=='number') return false;
 const limits=field.limits??{};
 return typeof draft!=='number'||!Number.isFinite(draft)||(limits.integer&&!Number.isInteger(draft))||(limits.min!==undefined&&draft<limits.min)||(limits.max!==undefined&&draft>limits.max);
}

// design-reference: chgHTML for the Owner, chg-approve, chg-edit, chg-reject-open and chg-reject. «Decline» opens the
// reason, which a Company of one person may leave empty and a team writes, so the agent and the person who asked know
// why. «Edit, then approve» opens the field for this kind of change with the proposed value in it, and «Approve with
// changes» sends the Owner's value with the approval (#484). `back` is where a done answer returns: "Waiting on you", or
// the chat it was proposed in.
export function ChangeAnswer({slug,company,change,alone=false,back}:{slug:string,company:string,change:ChangeProposalView,alone?:boolean,back?:string}) {
 const {c}=useCardText(); const {read,editing,setEditing}=useChangeShared();
 const [declining,setDeclining]=useState(false); const [missing,setMissing]=useState(false);
 const [draft,setDraft]=useState<unknown>(change.value); const [invalid,setInvalid]=useState(false);
 const why=useRef<HTMLTextAreaElement>(null); const no=useRef<HTMLButtonElement>(null); const edit=useRef<HTMLButtonElement>(null);
 const ids={why:`chg-why-${change.id}`,error:`chg-why-err-${change.id}`,hint:`chg-why-hint-${change.id}`,edit:`chg-edit-l-${change.id}`,editError:`chg-edit-err-${change.id}`};
 const field=read&&read!=='loading'?read.edit:null;
 const fields=<><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="proposal" value={change.id}/>{back&&<input type="hidden" name="back" value={back}/>}</>;
 const leave=(focus:()=>HTMLElement|null)=>requestAnimationFrame(()=>focus()?.focus());
 if(editing&&field) return <form action={answerAgentChange} noValidate onSubmit={event=>{ if(!editProblem(field,draft)) return; event.preventDefault(); setInvalid(true); }}>
  {fields}<input type="hidden" name="intent" value="approve"/><input type="hidden" name="edited" value={JSON.stringify(draft)}/><Held>{sending=><>
  <fieldset className="pp-form" disabled={sending}><ChangeEditor change={change} field={field} draft={draft} setDraft={value=>{ setDraft(value); setInvalid(false); }} invalid={invalid} ids={{label:ids.edit,error:ids.editError}}/>
   <span className="set-err" id={ids.editError} role="alert" hidden={!invalid}>{c(field.kind==='setting'&&field.type==='number'?'changeEditNumberInvalid':'changeEditMissing')}</span></fieldset>
  <div className="card__actions"><button type="button" className="btn btn--secondary" disabled={sending} onClick={()=>{ setEditing(false); setDraft(change.value); setInvalid(false); leave(()=>edit.current); }}>{c('changeCancel')}</button>
   <button className="btn btn--primary" disabled={sending} aria-busy={sending||undefined}>{c('changeApproveEdited')}</button></div>
 </>}</Held></form>;
 if(declining) return <form action={answerAgentChange} noValidate onSubmit={event=>{ if(alone||why.current?.value.trim()) return; event.preventDefault(); setMissing(true); why.current?.focus(); }}>
  {fields}<input type="hidden" name="intent" value="decline"/><Held>{sending=><>
  <div className="pp-form"><div className="set-field"><label className="set-label" htmlFor={ids.why}>{c(alone?'changeWhyLabelOptional':'changeWhyLabel')}</label>
   <textarea ref={why} className="set-input set-textarea" id={ids.why} name="reason" rows={3} maxLength={1000} dir="auto" required={!alone} autoFocus readOnly={sending} placeholder={c('changeWhyExample')}
    aria-describedby={`${ids.error} ${ids.hint}`} aria-invalid={missing||undefined} onInput={()=>setMissing(false)}/>
   <span className="set-err" id={ids.error} hidden={!missing}>{c('changeWhyMissing')}</span>
   <span className="set-hint" id={ids.hint}>{c('changeWhyHint')}</span></div></div>
  <div className="card__actions"><button type="button" className="btn btn--secondary" disabled={sending} onClick={()=>{ setDeclining(false); setMissing(false); leave(()=>no.current); }}>{c('changeCancel')}</button>
   <button className="btn btn--primary" disabled={sending} aria-busy={sending||undefined}>{c('changeDecline')}</button></div>
 </>}</Held></form>;
 // «Edit, then approve» waits for the Agent's settings to be read, and is left out when there is no field to edit in.
 // An unconfirmed approval being finished is approved again as it was, never edited.
 const editable=change.approved===undefined&&(read==='loading'||!!field);
 return <form action={answerAgentChange} className="card__actions">{fields}<Held>{sending=><>
  <button ref={no} type="button" className="btn btn--secondary" disabled={sending} onClick={()=>setDeclining(true)}>{c('changeDecline')}</button>
  {editable&&<button ref={edit} type="button" className="btn btn--secondary" disabled={sending} aria-disabled={!field||undefined} aria-busy={!field||undefined}
   aria-describedby={field?undefined:`chg-edit-wait-${change.id}`} onClick={()=>{ if(!field) return; setDraft(change.value); setEditing(true); }}>{c('changeEdit')}</button>}
  {editable&&!field&&<span className="sr-only" id={`chg-edit-wait-${change.id}`}>{c('changeEditLoading')}</span>}
  <button className="btn btn--primary" name="intent" value="approve" disabled={sending} aria-busy={sending||undefined}>{c('changeApprove')}</button>
 </>}</Held></form>;
}

// A waiting proposal as "Waiting on you" reads it. One whose details could not be read is drawn from the list alone and
// cannot be answered, so the Owner never approves a change seen in part.
const viewOf=(item:WaitingItem):{view:ChangeProposalView,read:boolean}=>{
 const change=kinds.find(kind=>kind===item.body)??'setting';
 const read=item.change;
 return {read:!!read,view:read?{id:item.id,change,setting:read.setting,value:read.value,...(read.approved_value!==null&&read.approved_value!==undefined?{approved:read.approved_value}:{}),reason:read.reason,agent:read.agent,by:read.by,state:'waiting',owners:[]}
  :{id:item.id,change,setting:null,value:null,reason:'',agent:{id:'',connection_id:`agent-change-${item.id}`,name:item.title},by:{id:item.asked_by===item.title?'':'-',connection_id:'',name:item.asked_by},state:'waiting',owners:[]}};
};
export function OwnerChangeCard({slug,company,item,alone}:{slug:string,company:string,item:WaitingItem,alone?:boolean}) {
 const {c}=useCardText();
 const {view,read}=viewOf(item);
 if(!read) return <ChangeCard change={view} owner unread answer={<>
  <div className="card__outcome" role="note"><ShellIcon name="clock"/><span>{c('changeUnread')}</span></div>
  <div className="card__actions"><button type="button" className="btn btn--secondary" disabled>{c('changeDecline')}</button><button type="button" className="btn btn--primary" disabled>{c('changeApprove')}</button></div>
 </>}/>;
 return <ChangeCard change={view} company={company} owner answer={<ChangeAnswer slug={slug} company={company} change={view} alone={alone}/>}/>;
}

// The proposal's card in the Waiting column of "Waiting on you" (#484; design-reference: the c-chg-* board cards,
// kcardHTML's waiting branch): the change as a question, "Waiting on you", who proposed it for whom, and the proposing
// Agent with "Settings". The reference opens the chat it was proposed in; an Owner cannot open another Member's private
// chat, so the card opens the whole proposal over the board, where the Owner answers it. An address that names the
// proposal (`#change-<id>`, as Settings' "Open the proposal" links, #178) opens it at once.
const onHash=(changed:()=>void)=>{ window.addEventListener('hashchange',changed); return ()=>window.removeEventListener('hashchange',changed); };
export function ChangeBoardCard({slug,company,item,alone}:{slug:string,company:string,item:WaitingItem,alone?:boolean}) {
 const {c,cb}=useCardText(); const {question}=useChangeWords();
 const opener=useRef<HTMLButtonElement>(null);
 const named=useSyncExternalStore(onHash,()=>window.location.hash===`#change-${item.id}`,()=>false);
 const [chosen,setChosen]=useState<boolean|null>(null);
 const open=chosen??named;
 const setOpen=(next:boolean)=>{ setChosen(next); if(!next&&named) history.replaceState(history.state,'',window.location.pathname+window.location.search); };
 const {view,read}=viewOf(item);
 const self=view.by.id===view.agent.id;
 const title=question({...view,agent:view.agent.name},!read);
 return <div className="kcard card chg-kcard" data-kind="agent_change" data-change-id={item.id}>
  <button ref={opener} type="button" className="kcard__title authored-title" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><strong>{title}</strong></button>
  <span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{c('changeBadgeYou')}</span>
  <span className="kcard__t">{self?c('changeBoardSelf'):cb('changeBoardFor',view.by.name,view.agent.name)}</span>
  <span className="kcard__foot"><span className="kcard__agent card-avatars">{read&&<span aria-hidden="true"><CompanyAgentFace agent={view.by} size={18}/></span>}<bdi className="od-truncate">{view.by.name}</bdi></span><span>· {c('changeBoardPlace')}</span></span>
  <Dialog open={open} onOpenChange={setOpen}>
   <DialogContent aria-describedby={undefined} className="gw modal chg-dialog" onCloseAutoFocus={event=>{ event.preventDefault(); opener.current?.focus(); }}>
    <DialogTitle className="sr-only">{c('changeTitle',view.agent.name)}</DialogTitle>
    <OwnerChangeCard slug={slug} company={company} item={item} alone={alone}/>
   </DialogContent>
  </Dialog>
 </div>;
}
