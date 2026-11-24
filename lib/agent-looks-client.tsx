'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { plainLook, shapePaths, type AgentLook } from './agent-look';
import { noLooks, type CompanyLooks } from './agent-looks';

const Looks=createContext<CompanyLooks>(noLooks);
const Drawn=createContext(false);

// The Company's looks for every face drawn under it (components/agent-face), with the outlines and the rim's light that
// every face's rim draws from (design-reference-orb: #face-shapes, #rimLight). Shell gives it the looks it read with the
// sidebar; Settings, drawn beside the page outside Shell, gives its own.
export function LooksProvider({looks,children}:{looks:CompanyLooks,children:ReactNode}) {
 // The outlines and the light are drawn once, by the outermost provider.
 const drawn=useContext(Drawn);
 return <Looks value={looks}><Drawn value>{!drawn&&<FaceDefs/>}{children}</Drawn></Looks>;
}

// The look of an Agent by its id: plain while none is in hand.
export function useAgentLook(agent:string|null|undefined):AgentLook {
 const looks=useContext(Looks);
 return (agent&&looks.agents[agent])||plainLook;
}
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
