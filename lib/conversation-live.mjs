import { answerOf } from './run-answers.mjs';

// The open Run of a Conversation whose messages are the Engine's, as its person's browser reads it (#876, #878): the
// lines of its event stream (lib/live-steps.mjs liveLines: its Steps, its reply as it is written and its end), and
// between them what the Run waits on its person for, which the pinned release names only on the Run's own record (a
// question in pending_controls, a request to act in `approval`): the record is read at once, again whenever the stream
// has been quiet for `every` milliseconds, and at once after a new event while a card is open, since a Run that goes on
// no longer waits.
// `{asking}` is the question or the request it waits on now, the request with the choices the Engine offered that this
// person's Role may send (`may`). `{settled}` closes it once the Engine no longer waits on it: with the answer or choice
// this server delivered for it (lib/run-answers.mjs, from any of the person's tabs), else, the Engine having stopped
// waiting with no answer, a question as closed and a request as not allowed, never as allowed. A question with no words,
// or a request with neither a description nor a command, is not drawn: nobody could answer it, and the Engine's time
// limit refuses it. Nothing of it is kept.

/** @typedef {import('./engine.mjs').PermissionChoice} PermissionChoice */
/** @typedef {{kind:'question',run:string,id:string,text:string,choices:string[],multiple:boolean}|{kind:'permission',run:string,id:string,description:string,command:string,choices:PermissionChoice[]}} LiveAsking */
/** @typedef {{kind:'question',id:string,answer:string|string[]}|{kind:'question',id:string,closed:true}|{kind:'permission',id:string,choice:PermissionChoice,expired?:true}} LiveSettled */
/** @typedef {{asking:LiveAsking}|{settled:LiveSettled}} LiveAskingLine */

// The choices a question's card draws, as the old record's card keeps them (lib/run-parts.mjs askedOf): none when
// they cannot all be drawn (more than four, or one longer than 1000 characters), so the person answers in words. A pick
// names one of these by its place, here and on the answer's route (lib/conversation-steer.ts).
/** @param {import('./engine.mjs').RunQuestion} question */
export const drawnChoices=question=>question.choices.length<=4&&question.choices.every(choice=>choice.trim()&&choice.length<=1000)?question.choices:[];

/** @param {string} run @param {{state:string,question?:import('./engine.mjs').RunQuestion|null,permission?:import('./engine.mjs').RunPermission|null}} state @param {PermissionChoice[]} may @returns {LiveAsking|null} */
function askingOf(run,state,may) {
 if(state.state!=='running') return null;
 if(state.question) return state.question.text.trim()?{kind:'question',run,id:state.question.id,text:state.question.text,choices:drawnChoices(state.question),multiple:state.question.multiple}:null;
 const asked=state.permission;
 if(!asked||!asked.description.trim()&&!asked.command.trim()) return null;
 return {kind:'permission',run,id:asked.id,description:asked.description,command:asked.command,choices:asked.choices.filter(choice=>may.includes(choice))};
}

// Null while an answer to it is still on its way to the Engine: the card stays open until that delivery's outcome. At
// the Run's end (`last`) it settles all the same, as none: the Run no longer takes anything.
/** @param {string} run @param {LiveAsking} open @param {boolean} last @returns {LiveSettled|null} */
function settledOf(run,open,last) {
 const kept=answerOf(run,open.id);
 if(kept==='claimed'&&!last) return null;
 const answer=kept==='claimed'?null:kept;
 if(open.kind==='question') return answer&&'answer' in answer?{kind:'question',id:open.id,answer:answer.answer}:{kind:'question',id:open.id,closed:true};
 return answer&&'choice' in answer?{kind:'permission',id:open.id,choice:answer.choice}:{kind:'permission',id:open.id,choice:'deny',expired:true};
}

/**
 * @template {{end:string}|object} Line
 * @param {string} run
 * @param {AsyncIterable<Line>} lines
 * @param {{read:()=>Promise<{state:string,question?:any,permission?:any}>,may:PermissionChoice[],every?:number,held?:{kind:'question'|'permission',id:string}|null,deliveryTime?:number}} options
 * @returns {AsyncGenerator<Line|LiveAskingLine>}
 */
// `held`: the open card a reader that comes back still draws (#878). The first record read settles it as any card open
// here would be, once the Engine no longer waits on it (answered in another tab, or its time limit passed while the
// reader was away); one it still waits on goes on as this read's own, drawn again by its `asking` line.
export async function* conversationLines(run,lines,{read,may,every=1000,held=null,deliveryTime=12000}) {
 const queue=/** @type {(Line|LiveAskingLine)[]} */([]);
 // The card it holds is drawn again once a read finds the Engine still waits on it, with that read's words.
 let redraw=!!held;
 let wake=/** @type {(()=>void)|null} */(null);
 let finished=false; let looking=false; let again=false;
 let open=/** @type {LiveAsking|null} */(held?/** @type {LiveAsking} */({...held,run}):null);
 let timer=/** @type {ReturnType<typeof setTimeout>|undefined} */(undefined);
 const put=(/** @type {Line|LiveAskingLine} */ line)=>{ queue.push(line); const woken=wake; wake=null; woken?.(); };
 // A Run that ended while an answer to its card is still on its way waits for that delivery's outcome (the Engine
 // answers a delivery within its own request time) before the card settles, so a choice the Engine took before the
 // Run ended never reads as not allowed.
 const delivered=async()=>{
  for(const until=Date.now()+deliveryTime;open&&answerOf(run,open.id)==='claimed'&&Date.now()<until;) await new Promise(resolve=>setTimeout(resolve,50));
 };
 const settle=(last=false)=>{
  if(!open) return;
  const settled=settledOf(run,open,last);
  if(settled) { put({settled}); open=null; }
 };
 const arm=()=>{ clearTimeout(timer); if(!finished) timer=setTimeout(()=>void look(),every); };
 const look=async()=>{
  if(finished) return;
  if(looking) { again=true; return; }
  looking=true; clearTimeout(timer);
  try {
   const state=await read();
   // An Engine not reached says nothing of the wait: the card stays as it is until a read answers.
   if(!finished&&state.state!=='unreachable') {
    const now=askingOf(run,state,may);
    if(open&&now?.id!==open.id) settle();
    else if(redraw&&now&&open?.id===now.id) { open=now; put({asking:now}); }
    redraw=false;
    if(now&&!open) { open=now; put({asking:now}); }
   }
  } catch { /* Read again on the next quiet stretch. */ }
  looking=false;
  if(again) { again=false; void look(); } else arm();
 };
 const events=lines[Symbol.asyncIterator]();
 const pump=(async()=>{
  try {
   for(;;) {
    const next=await events.next();
    if(finished) return;
    // Only a Run that ended, or one the Engine no longer knows, settles its card here: a stream cut short (closed,
    // unreachable) says nothing of the wait, so the card stays open for the reader's next read.
    if(next.done) { finished=true; put(/** @type {Line} */({end:'closed'})); return; }
    const line=next.value;
    if(line&&typeof line==='object'&&'end' in line) {
     finished=true; clearTimeout(timer);
     if(line.end==='ended'||line.end==='gone') { await delivered(); settle(true); }
     put(line); return;
    }
    put(line);
    if(open) void look(); else if(!looking) arm();
   }
  } catch { if(!finished) { finished=true; put(/** @type {Line} */({end:'unreachable'})); } }
 })();
 void look();
 try {
  for(;;) {
   const line=queue.shift();
   if(line===undefined) { await new Promise(resolve=>{ wake=()=>resolve(undefined); }); continue; }
   yield line;
   if(line&&typeof line==='object'&&'end' in line) return;
  }
 } finally {
  finished=true; clearTimeout(timer);
  await events.return?.(undefined);
  await pump.catch(()=>{});
 }
}
