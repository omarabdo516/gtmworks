'use client';
import './first-run-choice.css';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { chooseWorkMode } from './work-mode-actions';

type Mode='alone'|'team';

// First run's one question (#9; design-reference: dialog#firstrun, frHTML step "mode"): alone or with a team, nothing
// else. It covers the whole window over the new workspace, which stays inert behind it, until the Owner answers; the
// answer is kept on the Company and the workspace opens on the Owner's Conversation with Lead.
export default function FirstRunChoice({slug,company,companyName,personName,lead,brand,mark}:{slug:string,company:string,companyName:string,personName:string,lead:{name:string,connection_id:string}|null,brand:ReactNode,mark:ReactNode}) {
 const {t}=useI18n();
 const [mode,setMode]=useState<Mode|null>(null);
 const [error,action,pending]=useActionState(chooseWorkMode,'');
 const box=useRef<HTMLDivElement>(null);
 const name=lead?.name||'Lead';
 // Opening moves focus into the question (the dialog itself, as the settings overlay does), so Tab starts at the
 // choices without either one looking picked before the Owner picks it.
 useEffect(()=>{ box.current?.focus({preventScroll:true}); },[]);
 const initial=(personName.trim()[0]||'·').toUpperCase();
 const art=(choice:Mode)=><span className="fr-art" aria-hidden="true">
  <span className="fr-ppl"><span className="me__av">{initial}</span>{choice==='team'&&<><span className="me__av fr-ppl__more"/><span className="me__av fr-ppl__more"/></>}</span>
  <span className="fr-art__plus"><ShellIcon name="plus"/></span>
  {lead?<CompanyAgentFace agent={lead} size={32}/>:<span className="me__av"/>}
 </span>;
 const choices:[Mode,string,string][]=[['alone',t('firstRunAlone'),t('firstRunAloneHint',name)],['team',t('firstRunTeam'),t('firstRunTeamHint',name)]];
 return <div className="gw fr-root"><div ref={box} className="fr" role="dialog" aria-modal="true" aria-labelledby="fr-title" tabIndex={-1}>
  <header className="fr__bar"><span className="ws">{mark}<bdi className="ws__name">{brand}</bdi></span></header>
  <div className="fr__body"><form className="fr__col" action={action}>
   <input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/>
   <div className="fr__head">
    <p className="fr__eyebrow">{t('firstRunWelcome')} <bdi>{brand}</bdi> · <bdi>{companyName}</bdi></p>
    <h1 className="fr__title" id="fr-title">{t('firstRunQuestion')}</h1>
    <p className="fr__sub">{t('firstRunQuestionSub',name)}</p>
   </div>
   <div className="fr__choices" role="radiogroup" aria-labelledby="fr-title">{choices.map(([value,title,hint])=><label key={value} className="cr-kind fr-choice">
    <input className="fr-choice__input" type="radio" name="mode" value={value} checked={mode===value} onChange={()=>setMode(value)} aria-labelledby={`fr-mode-${value}-t`} aria-describedby={`fr-mode-${value}-d`}/>
    {art(value)}<span className="cr-kind__t" id={`fr-mode-${value}-t`}>{title}</span><span className="cr-kind__d" id={`fr-mode-${value}-d`}>{hint}</span>
    {mode===value&&<span className="cr-kind__check" aria-hidden="true"><ShellIcon name="check"/></span>}
   </label>)}</div>
   {error&&<p className="fr__error" role="alert">{error}</p>}
   <div className="fr__actions"><span className="fr__hint" id="fr-go-hint">{mode?'':t('firstRunPick')}</span>
    <button type="submit" className="btn btn--primary" disabled={!mode||pending} aria-describedby="fr-go-hint">{t('firstRunOpen')}</button></div>
  </form></div>
 </div></div>;
}
