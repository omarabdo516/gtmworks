'use client';
import './first-run-choice.css';
import { createContext, useActionState, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { useLeave } from '@/lib/motion';
import { askComposerFocus } from '@/lib/composer-focus';
import { inviteRoles } from '@/lib/member-roles.mjs';
import { AgentFace } from '@/components/agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { SettingsIcon } from './settings-icons';
import { writeClipboard } from './settings-backup-copy';
import { toast } from './toast';
import type { FirstRunFinish, FirstRunLink } from '@/lib/first-run-choice';
export type { FirstRunState, FirstRunFinish } from '@/lib/first-run-choice';

type Mode='alone'|'team';
// A row keeps an id of its own, so removing a row above it never moves the focus to another person (#186).
type Row={id:number,label:string,role:string};
const freshRow=(id:number):Row=>({id,label:'',role:'contributor'});

// The workspace behind the question (app/shell.tsx): inert until the question is answered and has left. The Shell is
// drawn once by the Company's layout (#789) and the page the answer opens does not draw it again, so the answer itself
// takes the question away and gives the workspace back. It wraps the workspace whether or not the question is asked, so
// a refresh that no longer asks it keeps the workspace mounted as it was. Saving the answer can draw the layout again
// with no question; the question it was drawn with stays until it has left and opened the Owner's Conversation, or
// that drawing would take it away before its exit, and the page would never move.
const Answered=createContext<()=>void>(()=>{});
export function FirstRunGate({question,children}:{question:ReactNode|null,children:ReactNode}) {
 const [answered,setAnswered]=useState(false);
 const [asked,setAsked]=useState(question);
 if(question&&question!==asked) setAsked(question);
 const answer=useCallback(()=>setAnswered(true),[]);
 const shown=answered?null:asked;
 return <Answered value={answer}><div style={{display:'contents'}} inert={!!shown}>{children}</div>{shown}</Answered>;
}

// First run (#9, #186; design-reference: dialog#firstrun, frHTML): alone or with a team, then, for a team, who is on
// it. It covers the whole window over the new workspace, which stays inert behind it, until the Owner answers; the
// answer is kept on the Company only when the second step ends; once it is saved the question leaves with the dialog's
// exit and the workspace opens on the Owner's Conversation with the main Agent (#130; design-reference: closeDlg). A save
// that fails keeps the question with its error. The action comes as a prop, so its component test needs no server.
export default function FirstRunChoice({slug,company,companyName,personName,lead,brand,mark,finish}:{slug:string,company:string,companyName:string,personName:string,lead:{id:string,name:string}|null,brand:ReactNode,mark:ReactNode,finish:FirstRunFinish}) {
 const {t,language}=useI18n();
 const [mode,setMode]=useState<Mode|null>(null);
 const [step,setStep]=useState<'mode'|'invite'>('mode');
 // The first row is 0; each row added takes the next id.
 const nextRow=useRef(1);
 const [rows,setRows]=useState<Row[]>(()=>[freshRow(0)]);
 const [result,action,pending]=useActionState(finish,{});
 const [acknowledged,setAcknowledged]=useState(false);
 const [keptLinks,setKeptLinks]=useState<FirstRunLink[]>([]);
 const [copied,setCopied]=useState<number|null>(null);
 const router=useRouter(); const leaving=useLeave(); const {close}=leaving;
 const opened=result?.opened;
 // A team's step makes each Person's Invite link (#953) and shows them once to copy; the question leaves only when the
 // Owner has had their look.
 // A save that fails after the links were made returns them with the error; the retry keeps them on screen and only
 // saves the answer.
 const links=result?.links?.length?result.links:keptLinks;
 const showingLinks=links.length>0;
 // Lead's Conversation takes the keyboard once it is drawn (design-reference: #ta-main focused after closeDlg).
 const answered=useContext(Answered);
 useEffect(()=>{ if(opened&&(!showingLinks||acknowledged)) close(()=>{ answered(); askComposerFocus(opened); router.push(opened); }); },[opened,showingLinks,acknowledged,close,router,answered]);
 const box=useRef<HTMLDivElement>(null);
 const focusTo=useRef<string|null>(null);
 const name=lead?.name||'Lead';
 const roles=inviteRoles(t);
 // Opening moves focus into the question (the dialog itself, as the settings overlay does), so Tab starts at the
 // choices without either one looking picked before the Owner picks it.
 useEffect(()=>{ box.current?.focus({preventScroll:true}); },[]);
 // A choice picked on the server-drawn question before React took it over stays checked on the page, and picking it
 // again changes nothing: it is taken as the answer, as the composer keeps text typed early.
 useEffect(()=>{
  const picked=box.current?.querySelector<HTMLInputElement>('.fr-choice__input:checked')?.value;
  if(picked==='alone'||picked==='team') setMode(current=>current??picked);
 },[]);
 // A step that changes or a row added or removed says where the focus goes next.
 useEffect(()=>{ if(focusTo.current) { document.getElementById(focusTo.current)?.focus(); focusTo.current=null; } });
 const initial=(personName.trim()[0]||'·').toUpperCase();
 const art=(choice:Mode)=><span className="fr-art" aria-hidden="true">
  <span className="fr-ppl"><span className="me__av">{initial}</span>{choice==='team'&&<><span className="me__av fr-ppl__more"/><span className="me__av fr-ppl__more"/></>}</span>
  <span className="fr-art__plus"><ShellIcon name="plus"/></span>
  {lead?<AgentFace agent={lead.id} size={32}/>:<span className="me__av"/>}
 </span>;
 const choices:[Mode,string,string][]=[['alone',t('firstRunAlone'),t('firstRunAloneHint',name)],['team',t('firstRunTeam'),t('firstRunTeamHint',name)]];
 // While the Invite links are on their way the step stays: going back then would not stop the answer being saved (#186).
 const back=()=>{ if(pending||links.length) return; focusTo.current='fr-mode-team'; setStep('mode'); };
 const addRow=()=>{ const added=freshRow(nextRow.current++); focusTo.current=`fr-label-${added.id}`; setRows(current=>[...current,added]); };
 const removeRow=(index:number)=>{
  const remaining=rows.filter((_,i)=>i!==index);
  const next=remaining[Math.min(index,remaining.length-1)];
  focusTo.current=next?`fr-label-${next.id}`:'fr-add';
  setRows(remaining);
 };
 const setLabel=(id:number,label:string)=>setRows(current=>current.map(row=>row.id===id?{...row,label}:row));
 const setRole=(id:number,role:string)=>setRows(current=>current.map(row=>row.id===id?{...row,role}:row));
 const copy=async(index:number,link:string,label:string)=>{
  if(!await writeClipboard(link)) return;
  setCopied(index); toast(t('inviteLinkCopied',label),{icon:'link'});
 };
 // The step's buttons submit the whole form; its hidden field says which rows to make links for, each with the id its
 // focus comes back by. A row with no name is ignored.
 const data=JSON.stringify(rows.filter(row=>row.label.trim()).map(({id,label,role})=>({id,label:label.trim(),role})));
 return <div className="gw fr-root" hidden={leaving.gone}><div ref={box} className={`fr${leaving.closing?' is-closing':''}`} role="dialog" aria-modal="true" aria-labelledby="fr-title" tabIndex={-1} inert={!!opened&&!showingLinks?true:undefined} onKeyDown={event=>{ if(event.key==='Escape'&&step==='invite'&&!links.length) { event.preventDefault(); back(); } }}>
  <header className="fr__bar"><span className="ws">{mark}<bdi className="ws__name">{brand}</bdi></span></header>
  <div className="fr__body"><form className="fr__col" action={action} noValidate>
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
      ?<button type="button" className="btn btn--primary" id="fr-go" disabled={pending} aria-describedby="fr-go-hint" onClick={()=>{ focusTo.current=`fr-label-${rows[0].id}`; setStep('invite'); }}>{t('firstRunContinue')}</button>
      :<button type="submit" name="choice" value="alone" className="btn btn--primary" id="fr-go" disabled={!mode||pending} aria-describedby="fr-go-hint">{t('firstRunOpen')}</button>}
    </div>
   </>:showingLinks?<>
    <div className="fr__head">
     <p className="fr__eyebrow">{t('firstRunStepTwo')}</p>
     <h1 className="fr__title" id="fr-title">{t('firstRunLinksTitle')}</h1>
     <p className="fr__sub">{t('firstRunLinksSub')}</p>
    </div>
    <div className="fr-rows" role="group" aria-labelledby="fr-title">{links.map((link,index)=><div className="fr-row" key={`${link.label}-${index}`}>
     <div className="set-field"><label className="set-label" htmlFor={`fr-link-${index}`}>{t('inviteLinkFor',link.label)}</label>
      <div className="inv-row inv-row--link"><input className="set-input" id={`fr-link-${index}`} type="text" dir="ltr" readOnly value={link.link} aria-describedby="fr-links-d" onFocus={event=>event.currentTarget.select()}/>
       <button type="button" className="btn btn--primary inv-go inv-go--flush" onClick={()=>void copy(index,link.link,link.label)}><SettingsIcon name="copy"/><span aria-live="polite">{copied===index?t('settingsBackupCopied'):t('inviteLinkCopy')}</span></button></div>
     </div></div>)}</div>
    <p className="set-hint" id="fr-links-d">{t('inviteLinkOnce')}</p>
    {result?.error&&<p className="fr__error" role="alert">{t(result.error)}</p>}
    <div className="fr__actions">{opened
     ?<button type="button" className="btn btn--primary" id="fr-open-done" onClick={()=>setAcknowledged(true)}>{t('firstRunOpen')}</button>
      :<button type="submit" name="choice" value="save" className="btn btn--primary" id="fr-open-done" disabled={pending} onClick={()=>{ setKeptLinks(links); setAcknowledged(true); }}>{t('firstRunOpen')}</button>}</div>
   </>:<>
    <div className="fr__head">
     <button type="button" className="link-btn fr__back" id="fr-back" disabled={pending} onClick={back}><ShellIcon name={language==='ar'?'back':'forward'}/><span>{t('firstRunBack')}</span></button>
     <p className="fr__eyebrow">{t('firstRunStepTwo')}</p>
     <h1 className="fr__title" id="fr-title">{t('firstRunTeamTitle')}</h1>
     <p className="fr__sub">{t('firstRunTeamSub')}</p>
    </div>
    <div className="fr-rows" role="group" aria-labelledby="fr-title">{rows.map((row,index)=><div className="fr-row" key={row.id}>
     <div className="set-field"><label className="set-label" htmlFor={`fr-label-${row.id}`}>{t('inviteLinkLabel')} <span className="num">{index+1}</span></label>
      {/* Enter in a name opens the links: Skip, the form's first submit button, would otherwise be its default and save
          the answer with none made (#186). */}
      <input className="set-input" id={`fr-label-${row.id}`} type="text" dir="auto" autoComplete="off" maxLength={120} placeholder={t('inviteLinkLabelExample')} value={row.label}
       aria-required="true" onChange={event=>setLabel(row.id,event.target.value)}
       onKeyDown={event=>{ if(event.key==='Enter'&&!event.nativeEvent.isComposing) { event.preventDefault(); document.getElementById('fr-open')?.click(); } }}/>
     </div>
     <div className="set-field"><label className="set-label" htmlFor={`fr-role-${row.id}`}>{t('settingsRole')}</label>
      <select className="set-input" id={`fr-role-${row.id}`} value={row.role} onChange={event=>setRole(row.id,event.target.value)}>{roles.map(role=><option key={role.key} value={role.key}>{role.name}</option>)}</select></div>
     {rows.length>1?<button type="button" className="circle-btn fr-row__rm" aria-label={`${t('firstRunRemoveMember')} ${index+1}`} onClick={()=>removeRow(index)}><ShellIcon name="x"/></button>:<span className="fr-row__rm od-spacer" aria-hidden="true"/>}
    </div>)}</div>
    <div><button type="button" className="link-btn fr-add" id="fr-add" onClick={addRow}><ShellIcon name="plus"/><span>{t('firstRunAddMember')}</span></button></div>
    <dl className="fr-roles">{roles.map(role=><div className="fr-roles__r" key={role.key}><dt>{role.name}</dt><dd>{role.description}</dd></div>)}</dl>
    {result?.error&&<p className="fr__error" role="alert">{t(result.error)}</p>}
    <div className="fr__actions"><button type="submit" name="choice" value="skip" className="btn btn--secondary" disabled={pending}>{t('firstRunSkip')}</button>
     <button type="submit" name="choice" value="open" className="btn btn--primary" id="fr-open" disabled={pending}>{t('firstRunOpen')}</button></div>
   </>}
   <input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/>
   <input type="hidden" name="mode" value={mode??''}/><input type="hidden" name="rows" value={data}/><input type="hidden" name="made" value={String(links.length)}/>
  </form></div>
 </div></div>;
}
