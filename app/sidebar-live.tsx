'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { faceStateWords, type AgentFaceState, type FailurePlace } from '@/lib/agent-face-states';
import type { ChannelSummary } from '@/lib/channels';
import { onWatchedRunEnded, shownState, useChatKnows } from '@/lib/live-runs';
import type { FaceState } from '@/components/face-life';
import { toast } from '@/app/toast';
import { onHandDone, stepOf, type ScreenHand } from '@/app/screen-hands';
import { useShellPlace } from '@/app/shell-place';
import type { SidebarChat } from '@/lib/sidebar-chats';

const pollEvery=5000;
// What the sidebar shows that changes while a page stays open: the reader's channels with their unread counts (#24),
// the state of each Agent they see (#699), by Agent id, and the steps handed to them on an Agent's Screen (#714); and,
// since the Shell is drawn once by the Company's layout and a page move no longer draws it again (#789), their recent
// chats (null when that read failed: the list shown stays) and how many things wait on them. The page's own draw leaves
// the last two to the Shell's props until the first poll answers.
export type SidebarNow={channels:ChannelSummary[],agents:Record<string,AgentFaceState>,handed:ScreenHand[],chats?:SidebarChat[]|null,approvals?:number};
type Live=SidebarNow;
// What the sidebar reads is a store, not a context value: a context whose value changes while a page still streams in
// (a poll answer landing during the first load) makes React draw that page's part in the browser beside its streamed
// copy (#172, #789). A store reaches only the parts that read it, once they are on the page.
type LiveStore={get:()=>Live,subscribe:(listener:()=>void)=>()=>void,set:(live:Live)=>void};
function liveStore(first:Live):LiveStore {
 let current=first; const listeners=new Set<()=>void>();
 return {get:()=>current,subscribe:listener=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; },
  set:live=>{ if(live===current) return; current=live; listeners.forEach(listener=>listener()); }};
}
const Now=createContext<{store:LiveStore,refresh:()=>void}|null>(null);
const unsubscribed=()=>()=>{};
// One part of what the sidebar last read, or `outside` beyond its reach (Settings, a test).
function useLive<T>(pick:(live:Live)=>T,outside:T):T {
 const store=useContext(Now)?.store;
 const read=()=>store?pick(store.get()):outside;
 return useSyncExternalStore(store?store.subscribe:unsubscribed,read,read);
}

// The sidebar's one poll (#699, spec #694): every 5 seconds while the tab is visible, and never while it is hidden, it
// asks /api/sidebar for the channels and the Agents' states together, so the faces follow within 5 seconds with no page
// move, also in a Company worked alone, which has no channels. A newer page brings its own `channels` and `states`; an
// answer asked for since then is kept only while it answers that page's. `refresh` asks at once, after the reader opened
// something that changes a face (OpenedHere).
const noHands:ScreenHand[]=[];
// A page whose read of the channels failed passes null (#776): the ones this tab showed last for this Company stay, a
// poll's among them. Kept in the browser only: the server draws a failed read as no channels, never a list from shared
// state, which could be another reader's. Keyed by the reader and the Company: another account signed in from another tab
// never gets this reader's list.
const channelsShown=new Map<string,ChannelSummary[]>();
// The page read last recorded for each Company: a page's own list is kept once, so drawing it again never undoes a newer poll.
const pageRead=new Map<string,ChannelSummary[]>();
const inBrowser=typeof window!=='undefined';
export function SidebarLive({company,person,slug,channels:read,states,handed=noHands,children}:{company:string,person:string,slug?:string,channels:ChannelSummary[]|null,states:Record<string,AgentFaceState>,handed?:ScreenHand[],children:ReactNode}) {
 const shownKey=`${person}:${company}`;
 if(read&&inBrowser&&pageRead.get(shownKey)!==read) { pageRead.set(shownKey,read); channelsShown.set(shownKey,read); }
 const channels=useMemo(()=>read??(inBrowser?channelsShown.get(shownKey):undefined)??[],[read,shownKey]);
 const [polled,setPolled]=useState<{basis:SidebarNow,now:SidebarNow}|null>(null);
 const basis=useMemo(()=>({channels,agents:states,handed}),[channels,states,handed]);
 const now=polled?.basis===basis?polled.now:basis;
 const ask=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   clearTimeout(timer);
   if(document.visibilityState==='visible') {
    try {
     // The poll names the reader it draws for: after another tab signed in as someone else, the route answers nothing.
     const response=await fetch(`/api/sidebar?company=${company}&person=${person}`,{cache:'no-store'});
     if(response.ok&&!stopped) { const answer=await response.json() as SidebarNow; if(!stopped) { channelsShown.set(shownKey,answer.channels); setPolled(was=>kept(was,basis,answer)); } }
    } catch {}
   }
   if(!stopped) { clearTimeout(timer); timer=setTimeout(poll,pollEvery); }
  };
  ask.current=()=>{ void poll(); };
  timer=setTimeout(poll,pollEvery);
  // A Run the open chat watched ended (lib/live-runs): its Agent's state is read again at once, so a failure or a
  // question shows its own state without waiting for the next poll.
  const ended=onWatchedRunEnded(()=>ask.current());
  return ()=>{stopped=true;clearTimeout(timer);ask.current=()=>{};ended();};
 },[company,person,basis,shownKey]);
 const refresh=useCallback(()=>ask.current(),[]);
 // A step "Done it" kept on this page leaves the Screen at once, and the poll is asked again (#714).
 const [done,setDone]=useState<ReadonlySet<number>>(()=>new Set());
 useEffect(()=>onHandDone(card=>{ setDone(was=>new Set(was).add(card)); ask.current(); }),[]);
 const open=useMemo(()=>done.size?now.handed.filter(hand=>!done.has(hand.card)):now.handed,[now.handed,done]);
 const live=useMemo(()=>({...now,handed:open}),[now,open]);
 const [store]=useState(()=>liveStore(live));
 useLayoutEffect(()=>{ store.set(live); },[store,live]);
 const value=useMemo(()=>({store,refresh}),[store,refresh]);
 return <Now value={value}>{slug&&<HandedToasts slug={slug} handed={now.handed}/>}{children}</Now>;
}

// A step an Agent hands over on its Screen while its person has the product open (#714; design-reference: scrHandOver's
// toast): "{Agent} stopped at “{step}” and handed it to you", with "Open", which opens its Conversation at the card. The
// steps the page was drawn with are no arrival.
function HandedToasts({slug,handed}:{slug:string,handed:ScreenHand[]}) {
 const {t}=useI18n();
 const seen=useRef<Set<number>|null>(null);
 useEffect(()=>{
  if(!seen.current) { seen.current=new Set(handed.map(hand=>hand.card)); return; }
  const arrived=handed.filter(hand=>!seen.current!.has(hand.card));
  handed.forEach(hand=>seen.current!.add(hand.card));
  const hand=arrived[0]; if(!hand) return;
  // The Conversation lands on the card it opens at (`#hand-<card>`) when it is drawn. It is loaded afresh: a copy the
  // router fetched before the card arrived (the sidebar's link prefetches it) would not hold it.
  const path=`/c/${slug}/conversations/${hand.conversation}`;
  const open=()=>{ if(location.pathname===path) { history.replaceState(history.state,'',`${path}#hand-${hand.card}`); location.reload(); } else location.assign(`${path}#hand-${hand.card}`); };
  toast(t('screenHandToast',hand.agent_name,stepOf(hand)),{icon:'hand',action:{label:t('screenHandToastOpen'),run:open}});
 },[handed,slug,t]);
 return null;
}

// An answer of the poll keeps what did not change as it was, so a poll that changes nothing draws nothing again, and
// one Agent's new state leaves the channels as they were: sixteen faces drawn again every 5 seconds made a long task
// on a slow CPU (tests/face-frames.spec.ts, #697).
const same=(a:unknown,b:unknown)=>a===b||JSON.stringify(a)===JSON.stringify(b);
function kept(was:{basis:SidebarNow,now:SidebarNow}|null,basis:SidebarNow,answer:SidebarNow) {
 const prior=was?.basis===basis?was.now:basis;
 const handed=Array.isArray(answer.handed)?answer.handed:prior.handed;
 // A chats read that failed (null) keeps the list shown.
 const chats=Array.isArray(answer.chats)?answer.chats:prior.chats;
 const approvals=typeof answer.approvals==='number'?answer.approvals:prior.approvals;
 const now={channels:same(prior.channels,answer.channels)?prior.channels:answer.channels,agents:same(prior.agents,answer.agents)?prior.agents:answer.agents,
  handed:same(prior.handed,handed)?prior.handed:handed,chats:same(prior.chats,chats)?prior.chats:chats,approvals};
 if(now.channels===prior.channels&&now.agents===prior.agents&&now.handed===prior.handed&&now.chats===prior.chats&&now.approvals===prior.approvals) return was?.basis===basis?was:{basis,now:prior};
 return {basis,now};
}

// The reader's channels as the sidebar last read them.
const noChannels:ChannelSummary[]=[];
export const useSidebarChannels=()=>useLive(live=>live.channels,noChannels);
// The reader's recent chats and the count of what waits on them as the sidebar's poll last read them; undefined until
// it has answered, when the Shell's own read stands.
export const useSidebarChats=()=>useLive(live=>live.chats,undefined);
export const useSidebarApprovals=()=>useLive(live=>live.approvals,undefined);
// Asks the sidebar's poll at once.
export const useSidebarRefresh=()=>useContext(Now)?.refresh;
// The newest step this reader was handed on an Agent's Screen, as the sidebar last read it (#714), or null; outside the
// sidebar's reach none. `ask` reads it again at once.
const noAsk=()=>{};
export function useScreenHand(agent:string):{hand:ScreenHand|null,ask:()=>void} {
 const hand=useLive(live=>live.handed.find(item=>item.agent===agent)??null,null);
 const ask=useContext(Now)?.refresh??noAsk;
 return {hand,ask};
}
// An Agent's state for this reader as the sidebar last read it; `drawn` (the state the page was drawn with) outside the
// sidebar's reach, as in Settings, or for an Agent it does not list.
export function useAgentState(agent:string,drawn:AgentFaceState='idle'):AgentFaceState {
 return useLive(live=>live.agents[agent],undefined)??drawn;
}
// The one state an Agent's live face shows (lib/live-runs shownState): the sidebar's, with what the chat this person has
// open knows of it, so the tile, the chat's head and the reply being worked on agree, and the words say the same.
function useShownState(agent:string|null|undefined,drawn:AgentFaceState='idle'):FaceState {
 return shownState(useAgentState(agent??'',drawn),useChatKnows(agent));
}
export function useAgentStates():(agent:string)=>AgentFaceState|undefined {
 const agents=useLive(live=>live.agents,undefined);
 return useCallback((agent:string)=>agents?.[agent],[agents]);
}

// An Agent's tile in the sidebar (design-reference-orb: the sidebar tile): its 56px face with the state dot, and a name
// for assistive technology that ends with the state in words, both following the sidebar's poll. `named` is what comes
// before the state: the name, Main, New and the Agent's line.
export function AgentTile({agent,href,current:drawn,named,title,children}:{agent:string,href:string,current?:boolean,named:string[],title:string,children:ReactNode}) {
 // The tile of the Agent whose chat or Conversation is open is the current one (app/shell-place).
 const place=useShellPlace(); const current=drawn??(place.chat&&place.agent===agent);
 const {t}=useI18n(); const state=useAgentState(agent); const shown=useShownState(agent);
 return <Link className="agent-tile" data-agent={agent} data-birth href={href} aria-current={current?'true':undefined} aria-label={[...named,t(faceStateWords[shown])].join(' · ')} title={title}>
  <AgentFace agent={agent} size={56} state={state} dot live/>{children}
 </Link>;
}

// The reader opened a place where an Agent may have failed (a Conversation, a channel or a Card), or an Agent's chat
// (`agent`): the failure there is seen by them and the Agent wakes for them (#699). It is told once the page has mounted,
// never while the page is drawn on the server or prefetched, and the sidebar asks again at once so the face follows. It
// is the sidebar's to tell: a part drawn outside the Shell has no faces of the sidebar to change, and tells nothing.
// An Agent's live face outside the sidebar that shows what its tile does (#700): the state the sidebar last read, with
// what the chat this person has open knows of it, as an empty chat's big face draws it.
export function SharedFace({agent,size}:{agent:string|null|undefined,size:number}) {
 return <AgentFace agent={agent} size={size} state={useAgentState(agent??'')} live/>;
}

export function OpenedHere({company,agent,place}:{company:string,agent?:string|null,place?:FailurePlace|null}) {
 const refresh=useSidebarRefresh();
 const opened=agent||place?JSON.stringify({company,...(agent?{agent}:{}),...(place?{place}:{})}):null;
 useEffect(()=>{
  if(!opened||!refresh) return;
  void fetch('/api/agent-face',{method:'POST',headers:{'content-type':'application/json'},body:opened,cache:'no-store'})
   .then(response=>response.ok?response.json():null).then(result=>{ if(result?.changed) refresh(); }).catch(()=>{});
 },[opened,refresh]);
 return null;
}
