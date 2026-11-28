'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { inviteRoles } from '@/lib/member-roles.mjs';
import { AgentFace } from '@/components/agent-face';
import { SettingsIcon } from './settings-icons';
import { toast } from './toast';

export type AddMember=(person:string,role:string,agents:string[])=>Promise<{error?:string}>;
type Person={person_id:string,name:string,company:string};
type LinkAgent={id:string,name:string};
type State={step:'closed'}|{step:'form',person:string,role:string,agents:string[],error:string,pending:boolean};
const fresh=(people:Person[]):State=>({step:'form',person:people[0]?.person_id||'',role:'contributor',agents:[],error:'',pending:false});

// "Add someone from another company" on the Team page (#952, ADR 0019), for an Administrator: the Members of their other
// Companies, each with the Company they come from, a Role that is never Administrator and the Agents they will see here,
// with no link. It takes its add as a prop, so its component test renders it with no server action.
export function AddMemberSection({people,agents,add}:{people:Person[],agents:LinkAgent[],add:AddMember}) {
 const {t}=useI18n(); const router=useRouter();
 const [state,setState]=useState<State>({step:'closed'});
 const focusNext=useRef<string|null>(null);
 useEffect(()=>{ if(focusNext.current) { document.getElementById(focusNext.current)?.focus(); focusNext.current=null; } });
 const go=(next:State,focus:string)=>{ focusNext.current=focus; setState(next); };
 if(!people.length) return null;
 const submit=async()=>{
  if(state.step!=='form'||state.pending) return;
  setState({...state,error:'',pending:true});
  // An add that never answers (the connection dropped) is a failed one, so the form can be used again.
  const answer=await add(state.person,state.role,state.agents).catch(()=>({error:'addMemberFailed'} as {error?:string}));
  if(answer.error) { go({...state,error:answer.error,pending:false},'addm-person'); return; }
  toast(t('addMemberAdded',people.find(person=>person.person_id===state.person)?.name||''));
  go({step:'closed'},'addm-toggle');
  router.refresh();
 };
 if(state.step==='closed') return <section className="inv-sec" aria-labelledby="addm-h"><h3 className="sr-only" id="addm-h">{t('addMemberFromCompany')}</h3>
  <button type="button" className="btn btn--secondary inv-open" id="addm-toggle" onClick={()=>go(fresh(people),'addm-person')}><SettingsIcon name="plus"/><span>{t('addMemberFromCompany')}</span></button></section>;
 const chosen=people.find(person=>person.person_id===state.person)||people[0];
 const roles=inviteRoles(t);
 const role=roles.find(item=>item.key===state.role)||roles[0];
 const toggle=(agent:string)=>setState({...state,agents:state.agents.includes(agent)?state.agents.filter(item=>item!==agent):[...state.agents,agent]});
 return <section className="inv-sec" aria-labelledby="addm-h"><h3 className="dp-label" id="addm-h"><span>{t('addMemberFromCompany')}</span><button type="button" className="link-btn" onClick={()=>go({step:'closed'},'addm-toggle')}>{t('cancel')}</button></h3>
  <form className="inv" noValidate onSubmit={event=>{event.preventDefault(); void submit();}}>
   <div className="inv-row">
    <div className="set-field"><label className="set-label" htmlFor="addm-person">{t('addMemberPerson')}</label>
     <select className="set-input" id="addm-person" dir="auto" value={state.person} onChange={event=>setState({...state,person:event.target.value,error:''})}>{people.map(person=><option key={person.person_id} value={person.person_id}>{person.name} · {person.company}</option>)}</select></div>
    <div className="set-field"><label className="set-label" htmlFor="addm-role">{t('settingsRole')}</label>
     <select className="set-input" id="addm-role" aria-describedby="addm-role-d" value={state.role} onChange={event=>setState({...state,role:event.target.value})}>{roles.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select></div>
    <button type="submit" className="btn btn--primary inv-go" disabled={state.pending}>{t('addMemberGo')}</button>
   </div>
   <p className="set-hint" id="addm-role-d">{role.name}: {role.description}</p>
   {state.error&&<span className="set-err" role="alert">{t(state.error)}</span>}
   {agents.length>0&&<fieldset className="inv-agents"><legend className="set-label">{t('inviteLinkAgents')}</legend>
    <ul className="panel-card">{agents.map(agent=>{ const on=state.agents.includes(agent.id); return <li className="panel-row" key={agent.id}><AgentFace agent={agent.id} size={24}/>
     <span className="panel-row__text"><span className="panel-row__t"><bdi>{agent.name}</bdi></span></span>
     <button type="button" className="switch" role="switch" aria-checked={on} aria-label={`${chosen?.name||''} · ${agent.name}`} onClick={()=>toggle(agent.id)}/></li>; })}</ul>
    <p className="set-hint">{t('inviteLinkMainAgent')}</p></fieldset>}
  </form></section>;
}
