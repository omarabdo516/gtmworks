'use client';
// While an Agent works, its reader sees what it is doing, step by step (#646; design-reference: syncActivityKey, the live
// activity line, and stepsHTML): the line under the transcript names the Agent and the step it is on now, and the steps
// it finished in this Run fill the turn's steps list (app/run-steps.tsx) before the reply lands. Both come from the open
// Run's tool calls as the Engine streams them (app/api/run-steps). A Conversation and a channel draw them alike, each
// with the words of its own catalogue. Before the Run's first view the line reads "Thinking" (#756), and it never falls
// back to another line (#763, vault decision 0071): a stream that ends, cannot be read or no longer knows the Run keeps
// what the line shows until the reply is drawn.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AgentFace } from '@/components/agent-face';
import { useAgentState } from '@/app/sidebar-live';
import { StepsList, type StepsBidiText, type StepsText } from '@/app/run-steps';
import type { LiveLine, LiveView } from '@/lib/live-steps.mjs';

// Read again this long after a read ends while the Agent still works: the next Run of a queued turn, or a read cut short.
const againAfter=1500;

// The Run's view while the place it works in waits on it (`working`), null while there is none to draw: nothing works,
// or no Run has reached the Engine yet, which the line reads as "Thinking" (#756). A view stays drawn once its Run's
// events end (`ended`), and also when the stream is cut, refused or never answers, until the reply lands and the place
// no longer waits (#763). When the Run's events end, `ended` is called, so the place reads its record at once instead of
// waiting for its next tick, and the reply is drawn within a second of its Run's end.
export type LiveRun=LiveView&{ended?:true};
export function useLiveSteps(place:{company:string,conversation?:string,channel?:string},working:boolean,ended?:()=>void):{view:LiveRun|null} {
 const [view,setView]=useState<LiveRun|null>(null);
 const {company,conversation,channel}=place;
 const onEnd=useRef(ended); onEnd.current=ended;
 useEffect(()=>{
  if(!working) return;
  const stopped=new AbortController(); let timer:ReturnType<typeof setTimeout>|undefined; let failures=0;
  const query=new URLSearchParams({company,...(conversation?{conversation}:{}),...(channel?{channel}:{})});
  const read=async()=>{
   let end:string|null=null;
   try {
    const response=await fetch(`/api/run-steps?${query}`,{cache:'no-store',signal:stopped.signal});
    // A signed-out reader reads nothing more here; the place's own read says so.
    if(response.status===401) return;
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
   // A Run that ended keeps its last view until the reply lands, and the place reads its record now. Any other end keeps
   // the line as it is: "Thinking" before the first view, the last view after it.
   if(end==='ended'||end==='gone') { setView(current=>current&&{...current,ended:true}); onEnd.current?.(); }
   failures=end==='unreachable'?failures+1:0;
   // A stream that cannot be read is asked again more slowly each time, up to fifteen seconds.
   timer=setTimeout(read,Math.min(againAfter*2**failures,15000));
  };
  void read();
  // Once the place no longer waits, the view goes with it.
  return ()=>{ stopped.abort(); clearTimeout(timer); setView(null); };
 },[working,company,conversation,channel]);
 return {view};
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

// The line under the transcript while an Agent works: the live line, "Thinking" while no Run's view is drawn yet (#756).
// One element across them, so the first view read does not rise in over "Thinking". A turn that waits behind another
// person's Run says whom the Agent works for (`working`), after the line.
const beforeTheRun:LiveView={run:'',steps:[],now:null};
export function WorkingLine({view,working,agent,face,c,cb}:{view:LiveView|null,working?:ReactNode,agent:string,face:string,c:StepsText,cb:StepsBidiText}) {
 return <ActivityLine view={view??beforeTheRun} working={working} agent={agent} face={face} c={c} cb={cb}/>;
}

// The live line (design-reference: .activity): the working dot, the Agent's face and name, then its step now: the tool
// and the Engine's preview as the steps list reads them, "Writing the reply" between calls and after the last one, and
// "Thinking" before the first. Each new step rises in and breathes (`is-swap`); the first does not rise.
function ActivityLine({view,working,agent,face,c,cb}:{view:LiveView,working?:ReactNode,agent:string,face:string,c:StepsText,cb:StepsBidiText}) {
 const now=view.now;
 const said=now?(now.preview?cb('stepLine',now.tool,now.preview):[<bdi key="tool">{now.tool}</bdi>]):[c(view.steps.length?'activityWriting':'activityThinking')];
 const key=now?`${view.steps.length}:${now.tool}:${now.preview??''}`:`${view.steps.length}:none`;
 const [first]=useState(key);
 return <p className="activity convo-status" role="status" aria-live="polite" data-live>
  <span className="dot dot--working" aria-hidden="true"/><span aria-hidden="true"><AgentFace agent={face} size={16}/></span>
  <bdi className="activity__who">{agent}</bdi><span key={key} className={`activity__t shimmer${key!==first?' is-swap':''}`}>{said}…</span>
  {working&&<span className="activity__for">{working}</span>}
 </p>;
}

// The Agent's turn while it works, from the moment the person sent (#694): its sender line, and once a step ended the
// steps it finished so far (`view`, null until the Run's live read answers), in the list the reply will carry, open as
// the person left it for this Run (`open`, `toggled`).
export function LiveTurn({view,agent,face,c,cb,open,toggled}:{view:LiveView|null,agent:string,face:string,c:StepsText,cb:StepsBidiText,open:boolean,toggled:(open:boolean)=>void}) {
 // Its face is 24px and alive, in the state the chat's head and the sidebar show (#700): thinking until the Run's first
 // step, working after it. Past replies are 20px and still.
 const state=useAgentState(face,'working');
 return <li className="turn turn--agent msg" data-author="agent" data-live>
  <div className="sender"><span aria-hidden="true"><AgentFace agent={face} size={24} state={state} live/></span><bdi>{agent}</bdi></div>
  {!!view?.steps.length&&<StepsList steps={{list:view.steps,seconds:null}} c={c} cb={cb} opened={open} toggled={toggled}/>}
 </li>;
}
