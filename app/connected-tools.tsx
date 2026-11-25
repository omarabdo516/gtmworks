'use client';
// An Agent's "Connected tools" in its details' Activity tab (#204; design-reference: activityHTML's toolsSec, noToolsText,
// the manage-tools, disconnect and connect cases, connectTool). The rows are the apps of this Agent's own Engine profile
// and the listed apps it was made to use and lacks (lib/company-apps.mjs readAgentTools), read from GET /api/company-apps
// after the section is drawn, so no page waits on the Engine (#201). The Owner
// has Manage, which turns each row that is there into Disconnect, and Connect on a row not connected: the same sign-in
// as Settings, Apps for this Agent only (app/app-sign-in.ts). /api/company-apps checks the Owner again and logs both.
import { useEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { AppTile } from '@/components/app-tile';
import { useI18n } from '@/lib/i18n-client';
import { toast } from '@/app/toast';
import { signInToApp } from '@/app/app-sign-in';
import { appsChanged, useHeldApps } from '@/app/company-apps-read';
import { useAppsReader, useAppsSheet } from '@/app/apps-sheet-open';
import type { AgentTool } from '@/lib/company-apps.mjs';

export type AgentToolItem=AgentTool&{use:string};
// The last good list of each Agent's tools this browser read (#770), shown for a minute while a new read runs or fails.
const keptTools=new Map<string,{tools:AgentToolItem[],at:number}>();
const keptFor=60000;
const keptOf=(key:string)=>{ const kept=keptTools.get(key); return kept&&Date.now()-kept.at<keptFor?kept.tools:undefined; };
type State=AgentToolItem['state']|'connecting';

export function ConnectedTools({company,agent,name,owner,tools:given}:{company:string,agent:string,name:string,owner:boolean,tools?:AgentToolItem[]|null}) {
 const {t}=useI18n(); const openSheet=useAppsSheet(); const reader=useAppsReader(company);
 const [managing,setManaging]=useState(false); const [states,setStates]=useState<Record<string,State>>({}); const [error,setError]=useState('');
 const manage=useRef<HTMLButtonElement>(null);
 // A sign-in still followed when the panel goes is cancelled and its window closed.
 const following=useRef(new Set<AbortController>());
 useEffect(()=>{ const open=following.current; return ()=>open.forEach(controller=>controller.abort()); },[]);
 // Until the read lands the section is its heading alone, or the last good list this browser read for the Agent in the
 // last minute (#770); a failed read keeps that list and is tried again, more slowly each time, and with none to keep it
 // is the apps' "can't be read" line, still tried again.
 const [read,setRead]=useState<AgentToolItem[]|null|undefined>(()=>keptOf(`${company}:${agent}`)); const [reads,setReads]=useState(0);
 // The apps sheet's store changes after a connect there (#458: a tool that needs a token is connected on its page), so
 // the Agent's tools are read again, and a row left Not connected by that handoff shows what the read says.
 const held=useHeldApps(reader);
 useEffect(()=>{
  if(given!==undefined) return;
  let live=true; let timer:ReturnType<typeof setTimeout>|undefined; let failures=0;
  const ask=()=>{ void fetch(`/api/company-apps?company=${encodeURIComponent(company)}&agent=${encodeURIComponent(agent)}`,{cache:'no-store'})
   .then(response=>response.ok?response.json():null).then(body=>Array.isArray(body?.tools)?body.tools as AgentToolItem[]:null).catch(()=>null)
   .then(tools=>{
    if(!live) return;
    if(tools) { keptTools.set(`${company}:${agent}`,{tools,at:Date.now()}); setRead(tools); return; }
    setRead(now=>now??null);
    failures++; timer=setTimeout(ask,Math.min(2000*2**(failures-1),30000));
   }); };
  ask();
  return ()=>{ live=false; clearTimeout(timer); };
 },[given,company,agent,reads]);
 // Each connected app's own test (#770): its row reads "Checking…" until its answer, which no other row waits for.
 const [tested,setTested]=useState<Record<string,AgentToolItem['state']>>({});
 const checking=(read??[]).filter(tool=>tool.state==='checking').map(tool=>tool.key).join(',');
 useEffect(()=>{
  if(!checking) return;
  let live=true;
  for(const key of checking.split(',')) void fetch(`/api/company-apps?company=${encodeURIComponent(company)}&agent=${encodeURIComponent(agent)}&test=${encodeURIComponent(key)}`,{cache:'no-store'})
   .then(response=>response.ok?response.json():null).catch(()=>null)
   .then(body=>{ if(live&&(body?.state==='connected'||body?.state==='attention')) setTested(now=>({...now,[key]:body.state})); });
  return ()=>{ live=false; };
 },[checking,company,agent]);
 // Read again only after a handoff to the sheet, once the sheet's store changes; a change made here keeps its own row.
 const handedOff=useRef(false);
 useEffect(()=>{ if(handedOff.current&&held!==undefined) { handedOff.current=false; setReads(count=>count+1); } },[held]);
 const tools=given!==undefined?given:read;
 const stateOf=(tool:AgentToolItem):State=>states[tool.key]??(tool.state==='checking'?tested[tool.key]??'checking':tool.state);
 const set=(key:string,state:State)=>setStates(now=>({...now,[key]:state}));

 const connect=async(tool:AgentToolItem)=>{
  if(stateOf(tool)!=='missing') return;
  setError(''); set(tool.key,'connecting');
  const controller=new AbortController(); following.current.add(controller);
  const result=await signInToApp({company,agent,app:tool.key,signal:controller.signal,openApp:key=>openSheet?.(null,key,agent)});
  following.current.delete(controller);
  if(controller.signal.aborted) return;
  if('state' in result) { if(result.state==='manual') { handedOff.current=true; setStates(now=>{ const rest={...now}; delete rest[tool.key]; return rest; }); return; } set(tool.key,'connected'); toast(t('connectConnected',tool.name)); void appsChanged(reader); }
  else { set(tool.key,'missing'); setError(result.error); }
 };
 const disconnect=async(tool:AgentToolItem)=>{
  setError('');
  const done=await fetch('/api/company-apps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,app:tool.key,action:'disconnect'})})
   .then(response=>response.ok).catch(()=>false);
  if(!done) { setError('agentToolsFailed'); return; }
  set(tool.key,'missing'); toast(t('agentToolDisconnected',tool.name),{icon:'x'}); void appsChanged(reader);
  manage.current?.focus();
 };

 const end=(tool:AgentToolItem)=>{
  const state=stateOf(tool);
  if(state==='connecting') return <span className="panel-row__meta">{t('connectConnecting')}</span>;
  if(state==='missing') return owner?<button type="button" className="btn btn--primary btn--sm" onClick={()=>void connect(tool)}>{t('connectDo')}</button>
   :<span className="panel-row__meta">{t('agentToolMissing')}</span>;
  if(managing&&owner) return <button type="button" className="link-btn" onClick={()=>void disconnect(tool)}>{t('agentToolDisconnect')}</button>;
  // Its own test has not answered yet (#770), in the row's waiting style.
  if(state==='checking') return <span className="panel-row__meta panel-row__meta--wait">{t('agentToolChecking')}</span>;
  if(state==='turnedOff') return <span className="panel-row__meta">{t('agentToolOff')}</span>;
  // A sign-in that stopped working, as Settings, Apps shows it (the reference has no such state).
  if(state==='attention') return <span className="panel-row__meta panel-row__meta--wait">{t('agentToolAttention')}</span>;
  return <span className="panel-row__meta"><ShellIcon name="check"/>{t('agentToolConnected')}</span>;
 };
 const [before,after]=t('agentNoTools','{0}').split('{0}');
 const body=tools===undefined?null:tools===null?<div className="panel-card"><p className="panel-empty">{t('agentToolsUnreadable')}</p></div>
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
