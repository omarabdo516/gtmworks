'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { ArchiveConfirm } from '@/app/archive-confirm';
import { archiveChannels } from '@/app/channel-archive-actions';
import type { ArchiveStop, ArchiveStopKind } from '@/lib/archive-stops';
import { toast } from '@/app/toast';

type Say=(key:string,...values:unknown[])=>string;
// The sentence of each line: {0} the Agent, {1} the words of what waits on people there.
const stopKeys:Record<ArchiveStopKind,string>={run:'channelStopsRun',question:'channelStopsQuestion',permission:'channelStopsPermission',hand:'channelStopsHand',approval:'channelStopsRun'};

// "Archive the channel" in a team channel's details (#675; design-reference-card: renderTeamDetails' chArc, cwConfirm,
// cvArchive, cwUndo, cvRestore). Only an Owner or a Manager in it sees it; the general channel has none. When an Agent
// works there, or a question, a request or a handed step waits on people there, the one confirmation Cards and
// Conversations use (ArchiveConfirm) names each; archiving then stops and clears them. "Archived · Undo" restores it;
// nothing starts again.
export function ChannelArchive({company,channel,archived,agents,c,refresh}:{company:string,channel:string,archived:boolean,agents:{id:string,name:string,connection_id:string}[],c:Say,refresh:()=>Promise<void>}) {
 const router=useRouter();
 const [stops,setStops]=useState<ArchiveStop[]|null>(null);
 const [failed,setFailed]=useState<''|'channelArchiveFailed'|'channelRestoreFailed'|'channelArchiveCheckFailed'>('');
 const ask=(intent:'stops'|'archive'|'restore')=>archiveChannels(company,intent,channel).catch(()=>null);
 const button=()=>document.getElementById('ch-arc-btn')?.focus();
 const restore=async(quiet:boolean)=>{
  const done=(await ask('restore'))?.state==='done';
  setFailed(done?'':'channelRestoreFailed');
  if(!done) return;
  // The sidebar's channel list is the server's: it reads it again, with the channel back in it.
  await refresh(); router.refresh();
  toast(c('channelRestoredToast'),{icon:'restore'});
  if(!quiet) button();
 };
 const archive=async()=>{
  const done=(await ask('archive'))?.state==='done';
  setFailed(done?'':'channelArchiveFailed');
  if(!done) return;
  await refresh(); router.refresh();
  toast(c('channelArchivedToast'),{icon:'archive',action:{label:c('channelUndo'),run:()=>void restore(true)}});
  button();
 };
 // Archived at once only when the database answered that nothing stops; an answer that did not come archives nothing.
 const start=async()=>{
  const read=await ask('stops');
  if(read?.state!=='stops') { setFailed('channelArchiveCheckFailed'); return; }
  setFailed('');
  if(read.stops.length) setStops(read.stops); else await archive();
 };
 const face=(agent:string|null)=>{ const found=agents.find(one=>one.id===agent); return found?<AgentFace agent={found.id} size={24}/>:null; };
 return <section className="dp-sec" aria-labelledby="ch-h-arc">
  <h3 className="dp-label" id="ch-h-arc"><span>{c('channelArchiveSection')}</span></h3>
  <div className="panel-card ch-arc">
   <p className="set-hint">{c('channelArchiveHint')}</p>
   <button type="button" className="btn btn--secondary btn--sm" id="ch-arc-btn" onClick={()=>void (archived?restore(false):start())}>
    <ShellIcon name={archived?'restore':'archive'}/><span>{c(archived?'channelRestore':'channelArchive')}</span></button>
   {failed&&<p className="set-err" role="alert">{c(failed)}</p>}
  </div>
  {stops&&<ArchiveConfirm stops={stops} heading={c('channelArchiveConfirm')} face={face} sentence={(stop,agent)=>c(stopKeys[stop.kind],agent,'{1}')}
   confirm={()=>{ setStops(null); void archive(); }} cancel={()=>{ setStops(null); button(); }}/>}
 </section>;
}
