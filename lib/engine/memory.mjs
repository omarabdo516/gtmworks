import { ownProfile } from './skills.mjs';
import { manage, query, reachable, refusal, stepState } from './wire.mjs';

// An Agent's memory (#350) belongs to its own profile (ADR 0016, ADR 0017) and to nothing else: the learning graph lists
// that profile's notes beside its skills (v0.23.0 GET /api/learning/graph?profile=, agent/learning_graph.py
// build_learning_graph), each note named `memory:<source>:<index>:<fingerprint>`, and one note's text is read on its own
// (GET /api/learning/node?id=&profile=, agent/learning_mutations.py node_detail). A skill is never read: only an id that
// starts with `memory:` is ever asked for, and an answer that is not a memory note is refused. gtmworks keeps no copy.
// shortcut: a memory is a few thousand characters in total, so 200 notes is more than a profile can hold; upgrade if
// the Engine ever lets one grow that long.
const memoryId=/^memory:(memory|profile):\d{1,9}(:[0-9a-f]{12})?$/;
const mostNotes=200;
const notesAtOnce=6;
// Each item's answer, in the items' order, with at most `limit` asked at once.
/** @template T,R @param {T[]} items @param {number} limit @param {(item:T)=>Promise<R>} ask @returns {Promise<R[]>} */
async function inBatches(items,limit,ask) {
 /** @type {R[]} */ const answers=new Array(items.length); let next=0;
 const lane=async()=>{ while(next<items.length) { const at=next++; answers[at]=await ask(items[at]); } };
 await Promise.all(Array.from({length:Math.min(limit,items.length)},lane));
 return answers;
}
/** @param {any} connection @returns {Promise<import('../engine.mjs').MemoryNotes>} */
export async function readMemoryNotes(connection) {
 const none=state=>({state,notes:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const graph=await manage(connection,`/api/learning/graph${query(connection.profile)}`);
  if(!graph.response.ok) return none(refusal(graph.response));
  if(!Array.isArray(graph.result?.nodes)) return none('failed');
  const ids=[...new Set(graph.result.nodes.filter(node=>node?.kind==='memory'&&typeof node.id==='string'&&memoryId.test(node.id)).map(node=>node.id))].slice(0,mostNotes);
  // The notes are read several at once (#769), at most `notesAtOnce`, so a memory of many notes is one wait and not one
  // per note; they keep the graph's order.
  const read=await inBatches(ids,notesAtOnce,id=>manage(connection,`/api/learning/node${query(connection.profile)}&id=${encodeURIComponent(id)}`));
  const notes=[];
  for(const [index,answer] of read.entries()) {
   const id=ids[index];
   // A note removed since the graph was drawn is no longer the memory's, and is left out.
   if(answer.response.status===404) continue;
   if(!answer.response.ok) return none(refusal(answer.response));
   // Only a memory note is taken: a skill's SKILL.md is never part of an Agent's memory, whatever its id.
   if(answer.result?.kind!=='memory'||answer.result.id!==id||typeof answer.result.content!=='string') return none('failed');
   notes.push({id,text:answer.result.content});
  }
  return {state:'found',notes};
 } catch { return none('unreachable'); }
}
// A reset deletes that one profile's MEMORY.md and USER.md (v0.23.0 POST /api/memory/reset, ops.py 535-553) and leaves
// its skills as they are. The Engine refuses a reset with no profile while its backend serves several, so the profile is
// always sent; the database keeps the person to an active Owner of the Agent's Company (log_memory_reset).
/** @param {any} connection @returns {Promise<import('../engine.mjs').MemoryReset>} */
export async function resetMemory(connection) {
 if(!ownProfile.test(connection.profile)) return {state:'failed',unsent:true};
 if(!reachable(connection)) return {state:'unreachable',unsent:true};
 try {
  const reset=await manage(connection,`/api/memory/reset${query(connection.profile)}`,{method:'POST',body:{target:'all'}});
  if(reset.response.status===400) return {state:'refused'};
  return {state:reset.response.ok&&reset.result?.ok===true?'reset':stepState(reset)};
 } catch { return {state:'unreachable'}; }
}

// The Engine's answer to a change of one note, as the contract's own words: a 400 that names a stale id is `stale`, any
// other 400 a refusal (an empty note, one over the memory's budget), and anything else read as any other step is.
/** @param {{response:Response,result:any}} answer @returns {'changed'|'stale'|'refused'|'failed'|'unreachable'} */
function noteChange(answer) {
 if(answer.response.ok&&answer.result?.ok===true) return 'changed';
 const detail=typeof answer.result?.detail==='string'?answer.result.detail:typeof answer.result?.message==='string'?answer.result.message:'';
 if(answer.response.status===400&&detail.includes('stale')) return 'stale';
 if(answer.response.status===400) return 'refused';
 return stepState(answer);
}

// An edit rewrites one note by the exact id the Engine gave it (v0.23.0 PUT /api/learning/node, status.py 791-795,
// agent/learning_mutations.py _edit_memory). The text is the whole note. An id that is not a memory note's is refused
// before the Engine is asked, so a skill is never named here; an empty note is refused as the Engine refuses it; and a
// note that changed since the graph was read answers 400 "memory node id is stale", which is `stale`, never guessed at.
/** @param {any} connection @param {{note:string,text:string}} change @returns {Promise<import('../engine.mjs').MemoryEdit>} */
export async function editMemoryNote(connection,{note,text}) {
 if(!ownProfile.test(connection.profile)||typeof note!=='string'||!memoryId.test(note)||typeof text!=='string') return {state:'failed',unsent:true};
 if(!text.trim()) return {state:'refused'};
 if(!reachable(connection)) return {state:'unreachable',unsent:true};
 try {
  const changed=noteChange(await manage(connection,`/api/learning/node${query(connection.profile)}`,{method:'PUT',body:{id:note,content:text}}));
  return {state:changed==='changed'?'edited':changed};
 } catch { return {state:'unreachable'}; }
}
// A removal deletes one note by the same id (v0.23.0 DELETE /api/learning/node, agent/learning_mutations.py
// _delete_memory). A memory is rewritten in its file; a skill would be archived, so any id that is not a memory note's
// is refused before the Engine is asked.
/** @param {any} connection @param {{note:string}} change @returns {Promise<import('../engine.mjs').MemoryForget>} */
export async function forgetMemoryNote(connection,{note}) {
 if(!ownProfile.test(connection.profile)||typeof note!=='string'||!memoryId.test(note)) return {state:'failed',unsent:true};
 if(!reachable(connection)) return {state:'unreachable',unsent:true};
 try {
  const changed=noteChange(await manage(connection,`/api/learning/node${query(connection.profile)}`,{method:'DELETE',body:{id:note}}));
  return {state:changed==='changed'?'forgotten':changed};
 } catch { return {state:'unreachable'}; }
}
