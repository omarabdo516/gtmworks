'use client';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { plainLook, shapePaths, type AgentLook } from './agent-look';
import { noLooks, type CompanyLooks } from './agent-looks';
import { keptLook, looksVersion, shownLook, subscribeLooks, type KeptLook, type LookPart } from './agent-look-saves';

// Who may change the looks under a provider, and how (#698): the Company and its slug, for its Owner only, with the
// saves the server gives (app/agent-look-actions), each answering the look as it is kept now, or null.
export type LookChanger={company:string,slug:string,
 save:(company:string,agent:string,part:LookPart,choice:string|null)=>Promise<KeptLook|null>,
 reset:(company:string,agent:string)=>Promise<KeptLook|null>};
const Looks=createContext<CompanyLooks>(noLooks);
const Changer=createContext<LookChanger|null>(null);
const Drawn=createContext(false);

// The Company's looks for every face drawn under it (components/agent-face), with the outlines and the rim's light that
// every face's rim draws from (design-reference-orb: #face-shapes, #rimLight). Shell gives it the looks it read with the
// sidebar; Settings, drawn beside the page outside Shell, gives its own. `change` is given for the Company's Owner, who
// changes a look in the window (app/agent-look-window); a provider inside another keeps the outer one's.
export function LooksProvider({looks,change,children}:{looks:CompanyLooks,change?:LookChanger|null,children:ReactNode}) {
 // The outlines and the light are drawn once, by the outermost provider.
 const drawn=useContext(Drawn), outer=useContext(Changer);
 return <Looks value={looks}><Changer value={change===undefined?outer:change}><Drawn value>{!drawn&&<FaceDefs/>}{children}</Drawn></Changer></Looks>;
}

// The look the database keeps for an Agent, with this tab's changes not yet read back (lib/agent-look-saves); null for
// an Agent with none in hand, or under a provider of sample faces.
export function useKeptLook(agent:string|null|undefined):KeptLook|null {
 const looks=useContext(Looks);
 useSyncExternalStore(subscribeLooks,looksVersion,looksVersion);
 const read=agent?looks.kept?.[agent]:undefined;
 return agent&&read?keptLook(agent,read):null;
}
// The look of an Agent by its id: plain while none is in hand.
export function useAgentLook(agent:string|null|undefined):AgentLook {
 const looks=useContext(Looks);
 const kept=useKeptLook(agent);
 return kept?shownLook(kept):(agent&&looks.agents[agent])||plainLook;
}
// The Company whose looks the reader may change, for its Owner; null for every other Role.
export const useLookChanger=()=>useContext(Changer);
// The Company's removed Agents, each by the name kept beside its look (#702), for a record that keeps only the id.
export function useRemovedAgents():Record<string,string> {
 return useContext(Looks).removed;
}
// The id the Agent a request asks for will have, so the request's card shows the made Agent's face.
export function useRequestAgent(request:number|string):string|null {
 return useContext(Looks).requests[String(request)]??null;
}

function FaceDefs() {
 return <svg className="face-defs" width="0" height="0" aria-hidden="true" focusable="false">
  <defs>
   <linearGradient id="gw-rim-light" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stopColor="#FFFFFF" stopOpacity=".6"/><stop offset=".5" stopColor="#FFFFFF" stopOpacity=".14"/><stop offset="1" stopColor="#FFFFFF" stopOpacity=".95"/>
   </linearGradient>
   {Object.entries(shapePaths).map(([shape,d])=><path key={shape} id={`gw-shape-${shape}`} d={d} vectorEffect="non-scaling-stroke"/>)}
  </defs>
 </svg>;
}
