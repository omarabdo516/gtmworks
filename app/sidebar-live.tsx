'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { faceStateWords, type AgentFaceState, type FailurePlace } from '@/lib/agent-face-states';
import type { ChannelSummary } from '@/lib/channels';

const pollEvery=5000;
// What the sidebar shows that changes while a page stays open: the reader's channels with their unread counts (#24),
// and the state of each Agent they see (#699), by Agent id.
export type SidebarNow={channels:ChannelSummary[],agents:Record<string,AgentFaceState>};
type Live=SidebarNow&{refresh:()=>void};
const Now=createContext<Live|null>(null);

// The sidebar's one poll (#699, spec #694): every 5 seconds while the tab is visible, and never while it is hidden, it
// asks /api/sidebar for the channels and the Agents' states together, so the faces follow within 5 seconds with no page
// move, also in a Company worked alone, which has no channels. A newer page brings its own `channels` and `states`; an
// answer asked for since then is kept only while it answers that page's. `refresh` asks at once, after the reader opened
// something that changes a face (OpenedHere).
export function SidebarLive({company,channels,states,children}:{company:string,channels:ChannelSummary[],states:Record<string,AgentFaceState>,children:ReactNode}) {
 const [polled,setPolled]=useState<{basis:SidebarNow,now:SidebarNow}|null>(null);
 const basis=useMemo(()=>({channels,agents:states}),[channels,states]);
 const now=polled?.basis===basis?polled.now:basis;
 const ask=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   clearTimeout(timer);
   if(document.visibilityState==='visible') {
    try {
     const response=await fetch(`/api/sidebar?company=${company}`,{cache:'no-store'});
     if(response.ok&&!stopped) { const answer=await response.json() as SidebarNow; if(!stopped) setPolled({basis,now:answer}); }
    } catch {}
   }
   if(!stopped) { clearTimeout(timer); timer=setTimeout(poll,pollEvery); }
  };
  ask.current=()=>{ void poll(); };
  timer=setTimeout(poll,pollEvery);
  return ()=>{stopped=true;clearTimeout(timer);ask.current=()=>{};};
 },[company,basis]);
 const refresh=useCallback(()=>ask.current(),[]);
 const live=useMemo(()=>({...now,refresh}),[now,refresh]);
 return <Now value={live}>{children}</Now>;
}

// The reader's channels as the sidebar last read them.
export const useSidebarChannels=()=>useContext(Now)?.channels??[];
// An Agent's state for this reader as the sidebar last read it; `drawn` (the state the page was drawn with) outside the
// sidebar's reach, as in Settings, or for an Agent it does not list.
export function useAgentState(agent:string,drawn:AgentFaceState='idle'):AgentFaceState {
 return useContext(Now)?.agents[agent]??drawn;
}
export function useAgentStates():(agent:string)=>AgentFaceState|undefined {
 const agents=useContext(Now)?.agents;
 return useCallback((agent:string)=>agents?.[agent],[agents]);
}

// An Agent's tile in the sidebar (design-reference-orb: the sidebar tile): its 56px face with the state dot, and a name
// for assistive technology that ends with the state in words, both following the sidebar's poll. `named` is what comes
// before the state: the name, Main, New and the Agent's line.
export function AgentTile({agent,href,current,named,title,children}:{agent:string,href:string,current?:boolean,named:string[],title:string,children:ReactNode}) {
 const {t}=useI18n(); const state=useAgentState(agent);
 return <Link className="agent-tile" data-agent={agent} href={href} aria-current={current?'true':undefined} aria-label={[...named,t(faceStateWords[state])].join(' · ')} title={title}>
  <AgentFace agent={agent} size={56} state={state} dot live/>{children}
 </Link>;
}

// The reader opened a place where an Agent may have failed (a Conversation, a channel or a Card), or an Agent's chat
// (`agent`): the failure there is seen by them and the Agent wakes for them (#699). It is told once the page has mounted,
// never while the page is drawn on the server or prefetched, and the sidebar asks again at once so the face follows. It
// is the sidebar's to tell: a part drawn outside the Shell has no faces of the sidebar to change, and tells nothing.
export function OpenedHere({company,agent,place}:{company:string,agent?:string|null,place?:FailurePlace|null}) {
 const refresh=useContext(Now)?.refresh;
 const opened=agent||place?JSON.stringify({company,...(agent?{agent}:{}),...(place?{place}:{})}):null;
 useEffect(()=>{
  if(!opened||!refresh) return;
  void fetch('/api/agent-face',{method:'POST',headers:{'content-type':'application/json'},body:opened,cache:'no-store'})
   .then(response=>response.ok?response.json():null).then(result=>{ if(result?.changed) refresh(); }).catch(()=>{});
 },[opened,refresh]);
 return null;
}
