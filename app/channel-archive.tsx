'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { toast } from '@/app/toast';
import { named } from '@/lib/bidi';

type Say=(key:string,...values:unknown[])=>string;
type Stop={kind:'run'|'question'|'permission'|'hand',agent:string,title:string};
const stopKeys={run:'channelStopsRun',question:'channelStopsQuestion',permission:'channelStopsPermission',hand:'channelStopsHand'} as const;

async function ask(company:string,channel:string,intent:'stops'|'archive'|'restore'):Promise<Record<string,unknown>|null> {
 try {
  const response=await fetch('/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,channel,intent})});
  const body=await response.json() as Record<string,unknown>;
  return response.ok?body:null;
 } catch { return null; }
}

// "Archive the channel" in a team channel's details (#675; design-reference-card: renderTeamDetails' chArc, cwConfirm,
// cvArchive, cwUndo, cvRestore). Only an Owner or a Manager in it sees it; the general channel has none. When an Agent
// works there, or a question, a request or a handed step waits on people there, one confirmation names each, with
// Cancel focused first; archiving then stops and clears them. "Archived · Undo" restores it; nothing starts again.
export function ChannelArchive({company,channel,archived,agents,c,refresh}:{company:string,channel:string,archived:boolean,agents:{name:string,connection_id:string}[],c:Say,refresh:()=>Promise<void>}) {
 const router=useRouter();
 const [stops,setStops]=useState<Stop[]|null>(null);
 const [failed,setFailed]=useState<''|'channelArchiveFailed'|'channelRestoreFailed'>('');
 const box=useRef<HTMLDialogElement>(null); const cancel=useRef<HTMLButtonElement>(null);
 useEffect(()=>{ const dialog=box.current; if(stops&&dialog&&!dialog.open) { dialog.showModal(); cancel.current?.focus(); } },[stops]);
 const restore=async(quiet:boolean)=>{
  const done=await ask(company,channel,'restore');
  setFailed(done?'':'channelRestoreFailed');
  if(!done) return;
  // The sidebar's channel list is the server's: it reads it again, with the channel back in it.
  await refresh(); router.refresh();
  toast(c('channelRestoredToast'),{icon:'restore'});
  if(!quiet) document.getElementById('ch-arc-btn')?.focus();
 };
 const archive=async()=>{
  const dialog=box.current; if(dialog?.open) dialog.close();
  const done=await ask(company,channel,'archive');
  setFailed(done?'':'channelArchiveFailed');
  if(!done) return;
  await refresh(); router.refresh();
  toast(c('channelArchivedToast'),{icon:'archive',action:{label:c('channelUndo'),run:()=>void restore(true)}});
  document.getElementById('ch-arc-btn')?.focus();
 };
 const start=async()=>{
  const read=await ask(company,channel,'stops');
  const found=(read?.stops??[]) as Stop[];
  if(found.length) setStops(found); else await archive();
 };
 const face=(name:string)=>agents.find(agent=>agent.name===name)?.connection_id??name;
 return <section className="dp-sec" aria-labelledby="ch-h-arc">
  <h3 className="dp-label" id="ch-h-arc"><span>{c('channelArchiveSection')}</span></h3>
  <div className="panel-card ch-arc">
   <p className="set-hint">{c('channelArchiveHint')}</p>
   <button type="button" className="btn btn--secondary btn--sm" id="ch-arc-btn" onClick={()=>void (archived?restore(false):start())}>
    <ShellIcon name={archived?'restore':'archive'}/><span>{c(archived?'channelRestore':'channelArchive')}</span></button>
   {failed&&<p className="set-err" role="alert">{c(failed)}</p>}
  </div>
  {stops&&<dialog ref={box} className="gw modal ch-confirm" aria-labelledby="ch-cf-title" onClose={()=>{ setStops(null); document.getElementById('ch-arc-btn')?.focus(); }}>
   <div className="modal__inner">
    <div className="modal__head"><div className="modal__titles"><h2 className="modal__title" id="ch-cf-title">{c('channelArchiveConfirm')}</h2></div></div>
    <div className="modal__body"><ul className="cf-list">{stops.map((stop,index)=><li key={index} className="cf-row">
     <span aria-hidden="true"><CompanyAgentFace agent={{connection_id:face(stop.agent),name:stop.agent}} size={24}/></span>
     <span>{named(c,stopKeys[stop.kind],stop.agent,stop.title)}</span></li>)}</ul></div>
    <div className="modal__foot modal__foot--end">
     <button type="button" className="btn btn--secondary" ref={cancel} onClick={()=>box.current?.close()}>{c('channelArchiveCancel')}</button>
     <button type="button" className="btn btn--primary" onClick={()=>void archive()}>{c('channelArchiveAndStop')}</button>
    </div>
   </div>
  </dialog>}
 </section>;
}
