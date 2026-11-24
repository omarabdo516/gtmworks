'use client';
// While an Agent works, its reader sees what it is doing, step by step (#646; design-reference: syncActivityKey, the live
// activity line, and stepsHTML): the line under the transcript names the Agent and the step it is on now, and the steps
// it finished in this Run fill the turn's steps list (app/run-steps.tsx) before the reply lands. Both come from the open
// Run's tool calls as the Engine streams them (app/api/run-steps). A Conversation and a channel draw them alike, each
// with the words of its own catalogue. When the stream cannot be read, the page keeps its "is working on a reply" line.
import { useEffect, useState } from 'react';
import { AgentFace } from '@/components/agent-face';
import { useAgentState } from '@/app/sidebar-live';
import { StepsList, type StepsBidiText, type StepsText } from '@/app/run-steps';
import type { LiveLine, LiveView } from '@/lib/live-steps.mjs';

// Read again this long after a read ends while the Agent still works: the next Run of a queued turn, or a read cut short.
const againAfter=1500;

// The Run's view while the place it works in waits on it (`working`), null while there is none to draw: nothing works,
// no Run has reached the Engine yet, or the stream could not be read. A view stays drawn once its Run's events end
// (`ended`), until the reply lands and the place no longer waits.
export type LiveRun=LiveView&{ended?:true};
export function useLiveSteps(place:{company:string,conversation?:string,channel?:string},working:boolean):LiveRun|null {
 const [view,setView]=useState<LiveRun|null>(null);
 const {company,conversation,channel}=place;
 useEffect(()=>{
  if(!working) return;
  const stopped=new AbortController(); let timer:ReturnType<typeof setTimeout>|undefined;
  const query=new URLSearchParams({company,...(conversation?{conversation}:{}),...(channel?{channel}:{})});
  const read=async()=>{
   let end:string|null=null;
   try {
    const response=await fetch(`/api/run-steps?${query}`,{cache:'no-store',signal:stopped.signal});
    if(!response.ok||!response.body) throw new Error('unread');
    const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer='';
    for(;;) {
     const {done,value}=await reader.read();
     if(done) break;
     buffer+=value;
     for(let at=buffer.indexOf('\n');at>=0;at=buffer.indexOf('\n')) {
      const line=JSON.parse(buffer.slice(0,at)) as LiveLine; buffer=buffer.slice(at+1);
      if('end' in line) end=line.end; else setView(line);
     }
    }
   } catch { if(stopped.signal.aborted) return; end='unreachable'; }
   if(stopped.signal.aborted) return;
   // A Run that ended keeps its last view until the reply lands; with no Run to read, the plain line comes back.
   if(end==='ended') setView(current=>current&&{...current,ended:true});
   else if(end!=='closed') setView(null);
   timer=setTimeout(read,againAfter);
  };
  void read();
  // Once the place no longer waits, the view goes with it.
  return ()=>{ stopped.abort(); clearTimeout(timer); setView(null); };
 },[working,company,conversation,channel]);
 return view;
}

// The reply that lands after live steps were drawn takes their place (#646): the turn it is drawn in does not rise in
// again, and its list is drawn open if the person opened the live one. `newest` is the newest reply now. A Run whose
// events ended is over once a newer reply lands, so its view is no longer drawn, though the place may still wait on a
// next Run (a queued turn, or the next Agent a message called) that is not read yet; a Run still streaming is never
// taken for over, whatever else the place draws meanwhile. Whether the live list is open is kept here, per Run, so a
// read again of the same Run draws it as it was. Kept as state from the render before, as React keeps it.
export function useLanding<Id>({working,live,newest}:{working:boolean,live:LiveRun|null,newest:Id|null}) {
 const [shown,setShown]=useState<string|null>(null); const [landed,setLanded]=useState<{id:Id|null,open:boolean}>({id:null,open:false});
 const [openRun,setOpenRun]=useState<string|null>(null);
 const [ended,setEnded]=useState<{run:string,newest:Id|null}|null>(null);
 if(live?.ended&&ended?.run!==live.run) setEnded({run:live.run,newest});
 const over=!!live?.ended&&ended?.run===live.run&&ended.newest!==newest;
 if(working&&!over&&!!live?.steps.length&&shown!==live.run) setShown(live.run);
 if((!working||over)&&shown!==null) { setShown(null); setLanded({id:newest,open:openRun===shown}); }
 const run=live?.run??null;
 return {view:over?null:live,open:run!==null&&openRun===run,toggled:(open:boolean)=>setOpenRun(open?run:null),
  landed:(id:Id)=>landed.id!==null&&id===landed.id,opened:(id:Id)=>landed.id!==null&&id===landed.id&&landed.open};
}

// The live line (design-reference: .activity): the working dot, the Agent's face and name, then its step now: the tool
// and the Engine's preview as the steps list reads them, "Writing the reply" between calls and after the last one, and
// "Thinking" before the first. Each new step rises in and breathes (`is-swap`); the first does not rise.
export function ActivityLine({view,agent,face,c,cb}:{view:LiveView,agent:string,face:string,c:StepsText,cb:StepsBidiText}) {
 const now=view.now;
 const said=now?(now.preview?cb('stepLine',now.tool,now.preview):[<bdi key="tool">{now.tool}</bdi>]):[c(view.steps.length?'activityWriting':'activityThinking')];
 const key=now?`${view.steps.length}:${now.tool}:${now.preview??''}`:`${view.steps.length}:none`;
 const [first]=useState(key);
 return <p className="activity convo-status" role="status" aria-live="polite" data-live>
  <span className="dot dot--working" aria-hidden="true"/><span aria-hidden="true"><AgentFace agent={face} size={16}/></span>
  <bdi className="activity__who">{agent}</bdi><span key={key} className={`activity__t shimmer${key!==first?' is-swap':''}`}>{said}…</span>
 </p>;
}

// The Agent's turn while it works: its sender line and the steps it finished so far, in the list the reply will carry,
// open as the person left it for this Run (`open`, `toggled`).
export function LiveTurn({view,agent,face,c,cb,open,toggled}:{view:LiveView,agent:string,face:string,c:StepsText,cb:StepsBidiText,open:boolean,toggled:(open:boolean)=>void}) {
 // Its face is 24px and alive, in the state the chat's head and the sidebar show (#700); past replies are 20px and still.
 const state=useAgentState(face,'working');
 if(!view.steps.length) return null;
 return <li className="turn turn--agent msg" data-author="agent" data-live>
  <div className="sender"><span aria-hidden="true"><AgentFace agent={face} size={24} state={state} live/></span><bdi>{agent}</bdi></div>
  <StepsList steps={{list:view.steps,seconds:null}} c={c} cb={cb} opened={open} toggled={toggled}/>
 </li>;
}
