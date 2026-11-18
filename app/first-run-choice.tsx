'use client';
import './first-run-choice.css';
import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { inviteError } from '@/lib/invite.mjs';
import { inviteRoles } from '@/lib/member-roles.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import type { FirstRunFinish } from '@/lib/first-run-choice';
export type { FirstRunState, FirstRunFinish } from '@/lib/first-run-choice';

type Mode='alone'|'team';
type Row={email:string,role:string,error:string};
const freshRow=():Row=>({email:'',role:'contributor',error:''});

// "Invite a member" keeps an email inside the message one left-to-right run (design-reference: errH).
const isolateEmails=(text:string):ReactNode[]=>text.split(/([\w.+-]+@[\w.-]+)/).map((part,index)=>index%2?<bdi key={index} dir="ltr">{part}</bdi>:part);

// First run (#9, #186; design-reference: dialog#firstrun, frHTML): alone or with a team, then, for a team, who is on
// it. It covers the whole window over the new workspace, which stays inert behind it, until the Owner answers; the
// answer is kept on the Company only when the second step ends, and the workspace opens on the Owner's Conversation
// with the main Agent. The action comes as a prop, so its component test needs no server.
export default function FirstRunChoice({slug,company,companyName,personName,lead,brand,mark,finish}:{slug:string,company:string,companyName:string,personName:string,lead:{name:string,connection_id:string}|null,brand:ReactNode,mark:ReactNode,finish:FirstRunFinish}) {
 const {t,language}=useI18n();
 const [mode,setMode]=useState<Mode|null>(null);
 const [step,setStep]=useState<'mode'|'invite'>('mode');
 const [rows,setRows]=useState<Row[]>([freshRow()]);
 // A server refusal leaves its row once the person writes a good email there (design-reference: the fr-email handler).
 const [dismissed,setDismissed]=useState<Record<number,boolean>>({});
 const [result,action,pending]=useActionState(finish,{});
 const box=useRef<HTMLDivElement>(null);
 const focusTo=useRef<string|null>(null);
 const name=lead?.name||'Lead';
 const roles=inviteRoles(t);
 // Opening moves focus into the question (the dialog itself, as the settings overlay does), so Tab starts at the
 // choices without either one looking picked before the Owner picks it.
 useEffect(()=>{ box.current?.focus({preventScroll:true}); },[]);
 // A step that changes, a row added or removed and an error each say where the focus goes next.
 useEffect(()=>{ if(focusTo.current) { document.getElementById(focusTo.current)?.focus(); focusTo.current=null; } });
 // The action's first refused row takes the focus.
 useEffect(()=>{ if(result?.firstError!==undefined) document.getElementById(`fr-email-${result.firstError}`)?.focus(); },[result]);
 const errorOf=(index:number)=>rows[index].error||(dismissed[index]?'':result?.rowErrors?.[index]||'');
 const initial=(personName.trim()[0]||'·').toUpperCase();
 const art=(choice:Mode)=><span className="fr-art" aria-hidden="true">
  <span className="fr-ppl"><span className="me__av">{initial}</span>{choice==='team'&&<><span className="me__av fr-ppl__more"/><span className="me__av fr-ppl__more"/></>}</span>
  <span className="fr-art__plus"><ShellIcon name="plus"/></span>
  {lead?<CompanyAgentFace agent={lead} size={32}/>:<span className="me__av"/>}
 </span>;
 const choices:[Mode,string,string][]=[['alone',t('firstRunAlone'),t('firstRunAloneHint',name)],['team',t('firstRunTeam'),t('firstRunTeamHint',name)]];
 // While the invitations are on their way the step stays: going back then would not stop the answer being saved (#186).
 const back=()=>{ if(pending) return; focusTo.current='fr-mode-team'; setStep('mode'); };
 const addRow=()=>{ focusTo.current=`fr-email-${rows.length}`; setDismissed({}); setRows(current=>[...current,freshRow()]); };
 const removeRow=(index:number)=>{
  const left=rows.length-1;
  focusTo.current=left>0?`fr-email-${Math.min(index,left-1)}`:'fr-add';
  setDismissed({});
  setRows(current=>current.filter((_,i)=>i!==index));
 };
 const setEmail=(index:number,email:string)=>{
  if(!inviteError(email)) setDismissed(current=>current[index]?current:{...current,[index]:true});
  setRows(current=>current.map((row,i)=>i===index?{...row,email,error:row.error&&!inviteError(email)?'':row.error}:row));
 };
 const setRole=(index:number,role:string)=>setRows(current=>current.map((row,i)=>i===index?{...row,role}:row));
 // A row's own check runs here, as the reference's frValidate does, so a malformed or repeated email sends nothing.
 // Rows an earlier press already sent are left out of the check and the send; an empty row is ignored.
 const submit=(event:FormEvent<HTMLFormElement>)=>{
  const choice=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
  if(step!=='invite'||choice!=='open') return;
  setDismissed({});
  const sent=new Set((result?.sent??[]).map(email=>email.trim().toLowerCase()));
  const seen=new Set(sent);
  let first=-1;
  const checked=rows.map((row,index)=>{
   const email=row.email.trim();
   let error='';
   if(email&&!sent.has(email.toLowerCase())) {
    error=inviteError(email,[...seen]);
    if(!error) seen.add(email.toLowerCase());
   }
   if(error&&first<0) first=index;
   return {...row,error};
  });
  if(first>=0) {
   event.preventDefault();
   setRows(checked);
   focusTo.current=`fr-email-${first}`;
  }
 };
 // The step's buttons submit the whole form; its hidden fields say what to do with the rows.
 const data=JSON.stringify(rows.filter(row=>row.email.trim()).map(({email,role})=>({email:email.trim(),role})));
 const sent=JSON.stringify(result?.sent??[]);
 return <div className="gw fr-root"><div ref={box} className="fr" role="dialog" aria-modal="true" aria-labelledby="fr-title" tabIndex={-1} onKeyDown={event=>{ if(event.key==='Escape'&&step==='invite') { event.preventDefault(); back(); } }}>
  <header className="fr__bar"><span className="ws">{mark}<bdi className="ws__name">{brand}</bdi></span></header>
  <div className="fr__body"><form className="fr__col" action={action} noValidate onSubmit={submit}>
   {step==='mode'?<>
    <div className="fr__head">
     <p className="fr__eyebrow">{t('firstRunWelcome')} <bdi>{brand}</bdi> · <bdi>{companyName}</bdi></p>
     <h1 className="fr__title" id="fr-title">{t('firstRunQuestion')}</h1>
     <p className="fr__sub">{t('firstRunQuestionSub',name)}</p>
    </div>
    <div className="fr__choices" role="radiogroup" aria-labelledby="fr-title">{choices.map(([value,title,hint])=><label key={value} className="cr-kind fr-choice">
     <input className="fr-choice__input" id={`fr-mode-${value}`} type="radio" name="mode" value={value} checked={mode===value} onChange={()=>setMode(value)} aria-labelledby={`fr-mode-${value}-t`} aria-describedby={`fr-mode-${value}-d`}/>
     {art(value)}<span className="cr-kind__t" id={`fr-mode-${value}-t`}>{title}</span><span className="cr-kind__d" id={`fr-mode-${value}-d`}>{hint}</span>
     {mode===value&&<span className="cr-kind__check" aria-hidden="true"><ShellIcon name="check"/></span>}
    </label>)}</div>
    {result?.error&&<p className="fr__error" role="alert">{t(result.error)}</p>}
    <div className="fr__actions"><span className="fr__hint" id="fr-go-hint">{mode?'':t('firstRunPick')}</span>
     {mode==='team'
      ?<button type="button" className="btn btn--primary" id="fr-go" disabled={pending} aria-describedby="fr-go-hint" onClick={()=>{ focusTo.current='fr-email-0'; setStep('invite'); }}>{t('firstRunContinue')}</button>
      :<button type="submit" name="choice" value="alone" className="btn btn--primary" id="fr-go" disabled={!mode||pending} aria-describedby="fr-go-hint">{t('firstRunOpen')}</button>}
    </div>
   </>:<>
    <div className="fr__head">
     <button type="button" className="link-btn fr__back" id="fr-back" disabled={pending} onClick={back}><ShellIcon name={language==='ar'?'forward':'back'}/><span>{t('firstRunBack')}</span></button>
     <p className="fr__eyebrow">{t('firstRunStepTwo')}</p>
     <h1 className="fr__title" id="fr-title">{t('firstRunTeamTitle')}</h1>
     <p className="fr__sub">{t('firstRunTeamSub')}</p>
    </div>
    <div className="fr-rows" role="group" aria-labelledby="fr-title">{rows.map((row,index)=><div className="fr-row" key={index}>
     <div className="set-field"><label className="set-label" htmlFor={`fr-email-${index}`}>{t('settingsInviteEmail')} <span className="num">{index+1}</span></label>
      {/* Enter in an email opens the workspace with its invitations: Skip, the form's first submit button, would otherwise
          be its default and save the answer with none sent (#186). */}
      <input className="set-input" id={`fr-email-${index}`} type="email" dir="ltr" autoComplete="off" spellCheck={false} placeholder={t('settingsInviteEmailExample')} value={row.email}
       aria-required="true" aria-describedby={`fr-email-err-${index}`} aria-invalid={errorOf(index)?true:undefined} onChange={event=>setEmail(index,event.target.value)}
       onKeyDown={event=>{ if(event.key==='Enter'&&!event.nativeEvent.isComposing) { event.preventDefault(); document.getElementById('fr-open')?.click(); } }}/>
      <span className="set-err" id={`fr-email-err-${index}`} hidden={!errorOf(index)}>{errorOf(index)&&isolateEmails(t(errorOf(index)))}</span></div>
     <div className="set-field"><label className="set-label" htmlFor={`fr-role-${index}`}>{t('settingsRole')}</label>
      <select className="set-input" id={`fr-role-${index}`} value={row.role} onChange={event=>setRole(index,event.target.value)}>{roles.map(role=><option key={role.key} value={role.key}>{role.name}</option>)}</select></div>
     {rows.length>1?<button type="button" className="circle-btn fr-row__rm" aria-label={`${t('firstRunRemoveMember')} ${index+1}`} onClick={()=>removeRow(index)}><ShellIcon name="x"/></button>:<span className="fr-row__rm od-spacer" aria-hidden="true"/>}
    </div>)}</div>
    <div><button type="button" className="link-btn fr-add" id="fr-add" onClick={addRow}><ShellIcon name="plus"/><span>{t('firstRunAddMember')}</span></button></div>
    <dl className="fr-roles">{roles.map(role=><div className="fr-roles__r" key={role.key}><dt>{role.name}</dt><dd>{role.description}</dd></div>)}</dl>
    {result?.error&&<p className="fr__error" role="alert">{t(result.error)}</p>}
    <div className="fr__actions"><button type="submit" name="choice" value="skip" className="btn btn--secondary" disabled={pending}>{t('firstRunSkip')}</button>
     <button type="submit" name="choice" value="open" className="btn btn--primary" id="fr-open" disabled={pending}>{t('firstRunOpen')}</button></div>
   </>}
   <input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/>
   <input type="hidden" name="mode" value={mode??''}/><input type="hidden" name="rows" value={data}/><input type="hidden" name="sent" value={sent}/>
  </form></div>
 </div></div>;
}
