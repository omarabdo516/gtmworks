'use client';
// An Agent's "Connected tools" in its details' Activity tab (#204; design-reference: activityHTML's toolsSec, noToolsText,
// the manage-tools, disconnect and connect cases, connectTool). The rows are the apps of this Agent's own Engine profile
// and the listed apps it was made to use and lacks, read by the server (lib/company-apps.mjs readAgentTools). The Owner
// has Manage, which turns each row that is there into Disconnect, and Connect on a row not connected: the same sign-in
// as Settings, Apps for this Agent only (app/app-sign-in.ts). /api/company-apps checks the Owner again and logs both.
import { useEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { useI18n } from '@/lib/i18n-client';
import { toast } from '@/app/toast';
import { signInToApp } from '@/app/app-sign-in';
import { appsChanged } from '@/app/company-apps-read';
import type { AgentTool } from '@/lib/company-apps.mjs';

export type AgentToolItem=AgentTool&{use:string};
type State=AgentToolItem['state']|'connecting';

export function ConnectedTools({company,agent,name,owner,tools}:{company:string,agent:string,name:string,owner:boolean,tools:AgentToolItem[]|null}) {
 const {t,language}=useI18n();
 const [managing,setManaging]=useState(false); const [states,setStates]=useState<Record<string,State>>({}); const [error,setError]=useState('');
 const manage=useRef<HTMLButtonElement>(null);
 // A sign-in still followed when the panel goes is cancelled and its window closed.
 const following=useRef(new Set<AbortController>());
 useEffect(()=>{ const open=following.current; return ()=>open.forEach(controller=>controller.abort()); },[]);
 const stateOf=(tool:AgentToolItem):State=>states[tool.key]??tool.state;
 const set=(key:string,state:State)=>setStates(now=>({...now,[key]:state}));

 const connect=async(tool:AgentToolItem)=>{
  if(stateOf(tool)!=='missing') return;
  setError(''); set(tool.key,'connecting');
  const controller=new AbortController(); following.current.add(controller);
  const result=await signInToApp({company,agent,app:tool.key,signal:controller.signal});
  following.current.delete(controller);
  if(controller.signal.aborted) return;
  if('state' in result) { set(tool.key,'connected'); toast(t('connectConnected',tool.name)); void appsChanged(company,language); }
  else { set(tool.key,'missing'); setError(result.error); }
 };
 const disconnect=async(tool:AgentToolItem)=>{
  setError('');
  const done=await fetch('/api/company-apps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,app:tool.key,action:'disconnect'})})
   .then(response=>response.ok).catch(()=>false);
  if(!done) { setError('agentToolsFailed'); return; }
  set(tool.key,'missing'); toast(t('agentToolDisconnected',tool.name),{icon:'x'}); void appsChanged(company,language);
  manage.current?.focus();
 };

 const end=(tool:AgentToolItem)=>{
  const state=stateOf(tool);
  if(state==='connecting') return <span className="panel-row__meta">{t('connectConnecting')}</span>;
  if(state==='missing') return owner?<button type="button" className="btn btn--primary btn--sm" onClick={()=>void connect(tool)}>{t('connectDo')}</button>
   :<span className="panel-row__meta">{t('agentToolMissing')}</span>;
  if(managing&&owner) return <button type="button" className="link-btn" onClick={()=>void disconnect(tool)}>{t('agentToolDisconnect')}</button>;
  if(state==='turnedOff') return <span className="panel-row__meta">{t('agentToolOff')}</span>;
  // A sign-in that stopped working, as Settings, Apps shows it (the reference has no such state).
  if(state==='attention') return <span className="panel-row__meta panel-row__meta--wait">{t('agentToolAttention')}</span>;
  return <span className="panel-row__meta"><ShellIcon name="check"/>{t('agentToolConnected')}</span>;
 };
 const [before,after]=t('agentNoTools','{0}').split('{0}');
 const body=tools===null?<div className="panel-card"><p className="panel-empty">{t('agentToolsUnreadable')}</p></div>
  :!tools.length?<div className="panel-card"><p className="panel-empty">{before}<bdi>{name}</bdi>{after}</p></div>
  :<ul className="panel-card">{tools.map(tool=><li key={tool.key} className="panel-row"><AppTile app={tool}/><span className="panel-row__text">
    <span className="panel-row__t"><bdi>{tool.name}</bdi></span>
    <span className="panel-row__d">{stateOf(tool)==='missing'?t('agentToolMissingLine',tool.use):tool.use}</span></span>{end(tool)}</li>)}</ul>;
 return <section className="dp-sec dp-tools"><h3 className="dp-label"><span>{t('agentTools')}</span>
  {owner&&!!tools?.length&&<button ref={manage} type="button" className="link-btn" aria-pressed={managing} onClick={()=>{ setManaging(on=>!on); manage.current?.focus(); }}>{t(managing?'agentToolsDone':'agentToolsManage')}</button>}</h3>
  {body}
  {error&&<p className="dp-tools__err" role="alert">{t(error)}</p>}
 </section>;
}
