'use client';
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import '@/app/face.css';
import { lookStyle } from '@/lib/agent-look';
import { useAgentLook } from '@/lib/agent-looks-client';
import { shownState, useChatKnows } from '@/lib/live-runs';
import { faceStateChanged, watchFace, type FaceState } from './face-life';

// An Agent's face: the approved orb in the Agent's own look (decision 0067, ADR 0027; design-reference-orb faceHTML),
// asked for by the Agent's id from the Company's looks (lib/agent-looks-client), at the size its place takes. From 24px
// it is alive (components/face-life); under 24px it is a still orb with eyes. Its expression is `state`, the state the
// server last told; `live` adds what the chat this person has open knows (lib/live-runs: listening, thinking, working,
// done), so every live face of one Agent shows the same. `dot` adds the state dot. The face is silent for assistive technology: the name and the state in words beside
// it say who and how.
export function AgentFace({agent,size,state='idle',dot=false,live=false}:{agent:string|null|undefined,size:number,state?:FaceState,dot?:boolean,live?:boolean}) {
 const look=useAgentLook(agent);
 const chat=useChatKnows(live?agent:undefined);
 const shown=shownState(state,chat);
 const still=size<24, big=size>=48;
 const face=useRef<HTMLSpanElement>(null);
 useEffect(()=>still?undefined:watchFace(face.current!),[still]);
 const was=useRef<FaceState|undefined>(undefined);
 useLayoutEffect(()=>{ if(!still&&face.current) faceStateChanged(face.current,shown,was.current); was.current=shown; },[shown,still]);
 const style={'--s':`${size}px`,'--d':`${delay(agent)}s`,...lookStyle(look)} as CSSProperties;
 const eye=(side:'l'|'r')=><span className={`f-eye f-eye--${side}`}><i className="e-open"/><svg className="e-arc" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path className="e-happy" d="M3.5 13.5Q10 3 16.5 13.5"/><path className="e-sleep" d="M3.5 8.5Q10 16 16.5 8.5"/></svg></span>;
 return <span className={`fw${size>=72?' fw--lg':''}`} aria-hidden="true">
  <span ref={face} className={`face ${still?'face--still':'face--live'}${big?' face--big':''}`} data-agent={agent||undefined} data-shape={look.shape} data-colour={look.colour} data-temperament={look.temperament} data-state={shown} style={style}>
   {big&&<><i className="f-shadow"/><i className="f-gather"/></>}
   <span className="f-act"><span className="f-pose"><span className="f-breath">
    {!still&&<i className="f-glow"/>}
    <span className="f-body">
     <i className="l f-base"/>
     {!still&&<><i className="l f-flows"/><i className="l f-core"/></>}
     <i className="l f-shade"/>
     {!still&&<i className="l f-swirl"/>}
     <i className="l f-veil"/>
     <span className="f-specs"><i className="f-spec"/><i className="f-spec2"/></span>
     <svg className="f-rim" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><use href={`#gw-shape-${look.shape}`}/></svg>
    </span>
    <span className="f-eyes"><span className="f-gaze">{eye('l')}{eye('r')}</span></span>
   </span></span></span>
   {big&&<span className="f-spark"><i/><i/><i/></span>}
  </span>
  {dot&&<span className={`dot dot--${shown}`}/>}
 </span>;
}

// Where in its breath a face starts, so faces side by side do not breathe together. It reads the Agent's id only to
// spread the faces, never for its look, and is the same on the server and in the browser.
function delay(agent:string|null|undefined) {
 let hash=2166136261;
 for(const char of agent||'') { hash^=char.charCodeAt(0); hash=Math.imul(hash,16777619); }
 return -((hash>>>0)%1200)/100;
}
