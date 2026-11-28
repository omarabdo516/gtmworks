'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { inviteRoles } from '@/lib/member-roles.mjs';
import { AgentFace } from '@/components/agent-face';
import { SettingsIcon } from './settings-icons';
import { writeClipboard } from './settings-backup-copy';
import { toast } from './toast';

export type MakeLink=(label:string,role:string,agents:string[])=>Promise<{link?:string,error?:string}>;
type LinkAgent={id:string,name:string};
type State={step:'closed'}|{step:'form',label:string,role:string,agents:string[],error:string,pending:boolean}|{step:'made',label:string,link:string};
const fresh:State={step:'form',label:'',role:'contributor',agents:[],error:'',pending:false};

// "Make an invite link" on the Team page (#950, ADR 0019), for an Administrator: the Person's name as its label, the
// Role it gives (never Administrator) and the Agents the Person will see beside the main Agent, which everyone sees.
// The made link is shown once, in full, with a copy button; nothing keeps it after this form closes, as the database
// holds only its hash. It takes its make as a prop, so its component test renders it with no server action.
export function InviteLinkSection({agents,make}:{agents:LinkAgent[],make:MakeLink}) {
 const {t}=useI18n();
 const [state,setState]=useState<State>({step:'closed'});
 const [copied,setCopied]=useState(false);
 const focusNext=useRef<string|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>>(undefined);
 useEffect(()=>{ if(focusNext.current) { document.getElementById(focusNext.current)?.focus(); focusNext.current=null; } });
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const go=(next:State,focus:string)=>{ focusNext.current=focus; setCopied(false); setState(next); };
 const roles=inviteRoles(t);
 const submit=async()=>{
  if(state.step!=='form'||state.pending) return;
  const label=state.label.trim();
  if(!label) { go({...state,error:'inviteLinkNameEmpty'},'lnk-label'); return; }
  setState({...state,error:'',pending:true});
  // A make that never answers (the connection dropped) is a failed one, so the form can be used again.
  const answer=await make(label,state.role,state.agents).catch(()=>({error:'inviteLinkFailed'} as {link?:string,error?:string}));
  if(!answer.link) { go({...state,error:answer.error||'inviteLinkFailed',pending:false},'lnk-label'); return; }
  go({step:'made',label,link:answer.link},'lnk-copy');
 };
 const copy=async()=>{
  if(state.step!=='made'||!await writeClipboard(state.link)) return;
  setCopied(true); clearTimeout(timer.current); timer.current=setTimeout(()=>setCopied(false),2000);
  toast(t('inviteLinkCopied',state.label),{icon:'link'});
 };
 if(state.step==='closed') return <section className="inv-sec" aria-labelledby="lnk-h"><h3 className="sr-only" id="lnk-h">{t('inviteLinkMake')}</h3>
  <button type="button" className="btn btn--secondary inv-open" id="lnk-toggle" onClick={()=>go(fresh,'lnk-label')}><SettingsIcon name="plus"/><span>{t('inviteLinkMake')}</span></button></section>;
 const head=<h3 className="dp-label" id="lnk-h"><span>{t('inviteLinkMake')}</span><button type="button" className="link-btn" onClick={()=>go({step:'closed'},'lnk-toggle')}>{state.step==='made'?t('teamDone'):t('cancel')}</button></h3>;
 if(state.step==='made') return <section className="inv-sec" aria-labelledby="lnk-h">{head}
  <div className="inv">
   <div className="set-field"><label className="set-label" htmlFor="lnk-link">{t('inviteLinkFor',state.label)}</label>
    <div className="inv-row inv-row--link"><input className="set-input" id="lnk-link" type="text" dir="ltr" readOnly value={state.link} aria-describedby="lnk-link-d" onFocus={event=>event.currentTarget.select()}/>
     <button type="button" className="btn btn--primary inv-go inv-go--flush" id="lnk-copy" onClick={()=>void copy()}><SettingsIcon name="copy"/><span aria-live="polite">{copied?t('settingsBackupCopied'):t('inviteLinkCopy')}</span></button></div></div>
   <p className="set-hint" id="lnk-link-d">{t('inviteLinkOnce')}</p>
  </div></section>;
 const chosen=roles.find(item=>item.key===state.role)||roles[0];
 const toggle=(agent:string)=>setState({...state,agents:state.agents.includes(agent)?state.agents.filter(item=>item!==agent):[...state.agents,agent]});
 return <section className="inv-sec" aria-labelledby="lnk-h">{head}
  <form className="inv" noValidate onSubmit={event=>{event.preventDefault(); void submit();}}>
   <div className="inv-row">
    <div className="set-field"><label className="set-label" htmlFor="lnk-label">{t('inviteLinkLabel')} <span aria-hidden="true">*</span></label>
     <input className="set-input" id="lnk-label" type="text" dir="auto" autoComplete="off" maxLength={120} value={state.label} aria-required="true" aria-describedby="lnk-label-err" aria-invalid={state.error?true:undefined}
      onChange={event=>setState({...state,label:event.target.value,error:state.error&&event.target.value.trim()?'':state.error})}/>
     <span className="set-err" id="lnk-label-err" hidden={!state.error}>{state.error&&t(state.error)}</span></div>
    <div className="set-field"><label className="set-label" htmlFor="lnk-role">{t('settingsRole')}</label>
     <select className="set-input" id="lnk-role" aria-describedby="lnk-role-d" value={state.role} onChange={event=>setState({...state,role:event.target.value})}>{roles.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select></div>
    <button type="submit" className="btn btn--primary inv-go" disabled={state.pending}>{t('inviteLinkGo')}</button>
   </div>
   <p className="set-hint" id="lnk-role-d">{chosen.name}: {chosen.description}</p>
   {agents.length>0&&<fieldset className="inv-agents"><legend className="set-label">{t('inviteLinkAgents')}</legend>
    <ul className="panel-card">{agents.map(agent=>{ const on=state.agents.includes(agent.id); return <li className="panel-row" key={agent.id}><AgentFace agent={agent.id} size={24}/>
     <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span></span>
     <button type="button" className="switch" role="switch" aria-checked={on} aria-label={agent.name} onClick={()=>toggle(agent.id)}/></li>; })}</ul>
    <p className="set-hint">{t('inviteLinkMainAgent')}</p></fieldset>}
  </form></section>;
}
