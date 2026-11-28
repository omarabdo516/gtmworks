import 'server-only';
import type { supabase } from './supabase';
import { agentEngine } from './engine/handle.mjs';
import { answerOf, forgetAnswer, keepAnswer } from './run-answers.mjs';
import type { PermissionChoice } from './engine.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
type Refused={error:string,status:number};
// A person steers the open Run of their Conversation whose messages are the Engine's (#878, spec #864): stops it, answers
// its question, or allows or refuses the action it asks to take, each through the Run's own route on the Engine. Checked
// here first: the person may write in the Company (an active Member, not a Viewer), the Conversation is theirs (the row
// is read with their session, which only its person reads), and the Run is one the row holds, so no browser names a Run
// of anyone else's. What the Run waits on is read from its own record on the Engine, never taken from the browser: a pick
// is the index of a choice the Engine offered, and "Always allow" is sent only by a Role that may send it
// (permission_choices: an Owner or a Manager). Nothing of it is stored; the answer delivered is kept in this server's
// memory for a short while only (lib/run-answers.mjs), so the person's other tab shows the card answered as it was. It is
// kept before it is delivered, since the Run goes on, and the other tab reads that it no longer waits, the moment the
// Engine takes it; the first answer kept is the one delivered, and a second tab's answer to the same card answers what
// the first sent. A kept answer is read only for a Run the person's own row holds.
async function openRun(db:Database,{company,conversation,run}:{company:string,conversation:string,run:string}):Promise<{engine:Extract<Awaited<ReturnType<typeof agentEngine>>,{state:'found'}>['engine']}|Refused> {
 const {data:writer}=await db.rpc('conversation_can_write',{c:company});
 if(!writer) return {error:'conversationNotAllowed',status:403};
 const {data:found}=await db.from('conversations').select('agent_id,open_runs').eq('id',conversation).eq('company_id',company).maybeSingle<{agent_id:string|null,open_runs:string[]|null}>();
 if(!found?.agent_id) return {error:'conversationNotFound',status:404};
 if(!found.open_runs?.includes(run)) return {error:'conversationNotRunning',status:409};
 const target=await agentEngine(db,{company,agent:found.agent_id});
 if(target.state==='missing') return {error:'conversationNotFound',status:404};
 if(target.state!=='found') return {error:'conversationEngineNotReached',status:502};
 return {engine:target.engine};
}

type Steer={company:string,conversation:string,run:string};

// Stop is the Run's own stop; its end then reaches the live read, which says the reply was stopped.
export async function stopEngineRun(db:Database,steer:Steer):Promise<{stopped:boolean}|Refused> {
 const open=await openRun(db,steer);
 if('error' in open) return open.error==='conversationNotRunning'?{stopped:false}:open;
 return await open.engine.runs.stop(steer.run)?{stopped:true}:{error:'conversationEngineNotReached',status:502};
}

// An answer to the question the Run waits on: a pick (a choice's index), several picks on a question that takes several,
// or the person's typed words. Another tab's answer, first, answers what that tab sent.
export async function answerEngineRun(db:Database,steer:Steer&{question:string,answer:{pick:number}|{picks:number[]}|{text:string}}):Promise<{state:'answered',answer:string|string[]}|Refused> {
 const open=await openRun(db,steer);
 if('error' in open) return open.error==='conversationNotRunning'?{error:'questionClosed',status:409}:open;
 const read=await open.engine.runs.read(steer.run);
 if(read.state==='unreachable') return {error:'conversationEngineNotReached',status:502};
 const asked=read.state==='running'?read.question:null;
 if(asked?.id!==steer.question) return earlier(steer)??{error:'questionClosed',status:409};
 const given=steer.answer;
 const text='text' in given?given.text:'pick' in given?asked.choices[given.pick]:asked.multiple?given.picks.map(index=>asked.choices[index]):undefined;
 if(text===undefined||(Array.isArray(text)&&(text.some(each=>each===undefined)||new Set(text).size!==text.length))) return {error:'conversationFailed',status:400};
 const first=earlier(steer); if(first) return first;
 keepAnswer(steer.run,steer.question,{answer:text});
 const delivered=await open.engine.runs.answer(steer.run,steer.question,text);
 if(delivered==='answered') return {state:'answered',answer:text};
 forgetAnswer(steer.run,steer.question);
 return delivered==='unreachable'?{error:'conversationEngineNotReached',status:502}:{error:'questionClosed',status:409};
}
const earlier=({run,question}:{run:string,question:string})=>{ const kept=answerOf(run,question); return kept&&'answer' in kept?{state:'answered' as const,answer:kept.answer}:null; };

// A choice on the request the Run waits on, one the Engine offered and the person's Role may send. A request the Engine
// no longer waits on answers the choice another tab made, or, with none, not allowed: the Engine refuses an action
// nobody allowed. One of a Run the row no longer holds is closed.
export type PermitOutcome={state:'decided',choice:PermissionChoice,at:string,first:boolean};
export async function permitEngineRun(db:Database,steer:Steer&{permission:string,choice:PermissionChoice}):Promise<PermitOutcome|Refused> {
 const {data:may}=await db.rpc('permission_choices',{c:steer.company});
 if(!((may as PermissionChoice[]|null)??[]).includes(steer.choice)) return {error:'conversationNotAllowed',status:403};
 const open=await openRun(db,steer);
 const at=new Date().toISOString();
 const lapsed=():PermitOutcome=>{ const kept=answerOf(steer.run,steer.permission); return {state:'decided',choice:kept&&'choice' in kept?kept.choice:'deny',at,first:false}; };
 if('error' in open) return open.error==='conversationNotRunning'?{error:'permissionClosed',status:409}:open;
 const read=await open.engine.runs.read(steer.run);
 if(read.state==='unreachable') return {error:'conversationEngineNotReached',status:502};
 const asked=read.state==='running'?read.permission:null;
 if(asked?.id!==steer.permission) return lapsed();
 if(!asked.choices.includes(steer.choice)) return {error:'conversationFailed',status:400};
 if(answerOf(steer.run,steer.permission)) return lapsed();
 keepAnswer(steer.run,steer.permission,{choice:steer.choice});
 const delivered=await open.engine.runs.permit(steer.run,steer.permission,steer.choice);
 if(delivered==='answered') return {state:'decided',choice:steer.choice,at,first:true};
 forgetAnswer(steer.run,steer.permission);
 return delivered==='unreachable'?{error:'conversationEngineNotReached',status:502}:lapsed();
}
