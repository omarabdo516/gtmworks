'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { AgentMemory, type AgentMemoryProps } from '@/app/agent-memory';
import { StandingPermissions } from '@/app/standing-permissions';
import type { MemoryNote } from '@/lib/engine.mjs';
import type { StandingPermission } from '@/lib/standing-permissions.mjs';

// The parts of an Agent's details its Engine keeps (ADR 0030, #769): each is read from the browser when it is shown,
// so the details draw at once from what gtmworks stores and no part waits on another. The Memory tab shows the
// reference's skeleton while its notes are read (design-reference: .sk, .sk-line), its own line when they cannot be,
// and the rest of the details stay as they are.

type Read<T>={state:'loading'}|{state:'failed'}|{state:'found',value:T};
function usePart<T>(url:string,parse:(body:unknown)=>T|null):[Read<T>,()=>void] {
 const [read,setRead]=useState<Read<T>>({state:'loading'}); const [asked,setAsked]=useState(0);
 useEffect(()=>{
  const stopped=new AbortController();
  void fetch(url,{cache:'no-store',signal:stopped.signal}).then(async response=>{
   const body=response.ok?await response.json() as unknown:null; if(!response.ok) await response.arrayBuffer().catch(()=>{});
   const value=body===null?null:parse(body);
   setRead(value===null?{state:'failed'}:{state:'found',value});
  }).catch(()=>{ if(!stopped.signal.aborted) setRead({state:'failed'}); });
  return ()=>stopped.abort();
 },[url,asked]); // eslint-disable-line react-hooks/exhaustive-deps
 return [read,useCallback(()=>setAsked(value=>value+1),[])];
}

const notesOf=(body:unknown)=>{ const read=body as {notes?:unknown,main?:unknown}; return Array.isArray(read?.notes)?{notes:read.notes as MemoryNote[],main:read.main===true}:null; };
// Settings draws the same part on an Agent's Memory tab (#898), with its introduction as optional help.
export function AgentMemoryPart(props:Omit<AgentMemoryProps,'notes'|'main'|'reread'>&{introAsHelp?:boolean}) {
 const {t}=useI18n();
 const [read,reread]=usePart(`/api/agent-memory?company=${props.company}&agent=${props.agent.id}`,notesOf);
 if(read.state==='loading') {
  const line=(width:number)=><div className="sk sk-line" style={{width:`${width}%`}}/>;
  return <section className="dp-sec sk-hold" aria-busy="true"><span className="sr-only">{t('agentMemoryLoading')}</span>
   <div className="panel-card" aria-hidden="true">{[92,78,85].map((width,at)=><div key={at} className="panel-row"><div className="sk-msg" style={{width:'100%'}}>{line(width)}{line(width-30)}</div></div>)}</div></section>;
 }
 if(read.state==='failed') return <section className="dp-sec"><div className="panel-card"><p className="panel-empty">{t('agentMemoryUnread')}</p></div></section>;
 return <AgentMemory {...props} notes={read.value.notes} main={read.value.main} reread={reread}/>;
}

const permissionsOf=(body:unknown)=>{ const read=body as {permissions?:unknown}; return Array.isArray(read?.permissions)?read.permissions as StandingPermission[]:null; };
// The Agent's standing permissions (#166) close the Activity tab; while they are read, and when they cannot be, nothing
// is drawn there, as a profile with none draws nothing.
export function AgentPermissionsPart({company,agent,canRevoke}:{company:string,agent:string,canRevoke:boolean}) {
 const [read]=usePart(`/api/agent-permissions?company=${company}&agent=${agent}`,permissionsOf);
 if(read.state!=='found'||!read.value.length) return null;
 return <StandingPermissions company={company} agent={agent} permissions={read.value} canRevoke={canRevoke} returnTo="dp-settings"/>;
}
