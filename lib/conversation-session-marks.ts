import 'server-only';
import type { supabase } from './supabase';
import { agentEngine } from './engine/handle.mjs';
import { noteSession } from './conversation-list';

type Database=Awaited<ReturnType<typeof supabase>>;
type Found={id:string,agent_id:string|null,hermes_session_id:string|null,open_runs?:string[]|null};
export type SessionWrite='marked'|'missing'|'invalid'|'refused'|'unreachable';

// A Conversation's title and archived mark are its session's own (#881, spec #864): they are written on the Engine,
// through the Engine handle on the profile the reader sees its Agent on, and the lists' last read is told at once.
// The rows are read as the reader, so only their own Conversations are written; one with no session yet (its first Run
// not started) has no mark to write, and is `missing`.
async function rowsOf(db:Database,company:string,ids:string[]) {
 const {data,error}=await db.from('conversations').select('id,agent_id,hermes_session_id,open_runs').eq('company_id',company).in('id',ids);
 return error?null:(data||[]) as Found[];
}
async function write(db:Database,company:string,row:Found,change:{archived:boolean}|{title:string}):Promise<SessionWrite> {
 if(!row.agent_id||!row.hermes_session_id) return 'missing';
 const target=await agentEngine(db,{company,agent:row.agent_id});
 if(target.state==='missing'||target.state==='invalid') return 'missing';
 if(target.state!=='found') return 'unreachable';
 const session=row.hermes_session_id;
 const answer:SessionWrite='archived' in change?await target.engine.sessions.mark(session,change.archived) as SessionWrite:await target.engine.sessions.title(session,change.title);
 if(answer==='marked') noteSession(company,target.agent.profile,session,'archived' in change?{archived:change.archived}:{title:change.title.trim()});
 return answer;
}

/** Archives or restores each of the reader's own Conversations on its session: answers the ids marked, and those with
 * no session the Engine holds yet (`unstarted`), which their rows' own mark keeps until a Run makes the session; null
 * when the rows could not be read. */
export async function markConversations(db:Database,company:string,ids:string[],archived:boolean):Promise<{marked:string[],unstarted:string[]}|null> {
 const rows=await rowsOf(db,company,ids);
 if(!rows) return null;
 const answers=await Promise.all(rows.map(async row=>[row.id,await write(db,company,row,{archived}).catch(()=>'unreachable' as const)] as const));
 // Archiving stops the work its confirmation named (#674): each Run the row holds is stopped on its Agent's profile, and
 // the row lets it go once its end is seen, as any stopped Run. A Run the Engine cannot stop now goes on.
 if(archived) await Promise.all(rows.filter(row=>row.agent_id&&row.open_runs?.length&&answers.some(([id,answer])=>id===row.id&&answer==='marked')).map(async row=>{
  const target=await agentEngine(db,{company,agent:row.agent_id}).catch(()=>null);
  if(target?.state==='found') await Promise.all((row.open_runs??[]).map(run=>target.engine.runs.stop(run).catch(()=>false)));
 }));
 return {marked:answers.flatMap(([id,answer])=>answer==='marked'?[id]:[]),unstarted:answers.flatMap(([id,answer])=>answer==='missing'?[id]:[])};
}

/** Renames one of the reader's own Conversations on its session. */
export async function titleConversation(db:Database,company:string,id:string,title:string):Promise<SessionWrite> {
 const rows=await rowsOf(db,company,[id]);
 if(!rows) return 'unreachable';
 const row=rows[0];
 return row?await write(db,company,row,{title}).catch(()=>'unreachable' as const):'missing';
}

/** Writing in an archived Conversation brings it back (#881): its session's archived mark is cleared, always, since
 * another tab may have archived it since the lists' last read. Nothing is logged: the person wrote, they did not
 * restore. The rows are read as the reader now; the answer is the Engine's write, which the caller runs after its own
 * answer, so a send's acknowledgement never waits on the Engine. Null when there is nothing to clear. */
export async function unarchiveOnWrite(db:Database,company:string,id:string):Promise<(()=>Promise<void>)|null> {
 const rows=await rowsOf(db,company,[id]);
 const row=rows?.[0];
 if(!row?.agent_id||!row.hermes_session_id) return null;
 const target=await agentEngine(db,{company,agent:row.agent_id});
 if(target.state!=='found') return null;
 const {engine,agent}=target; const session=row.hermes_session_id;
 return async()=>{ if(await engine.sessions.mark(session,false)==='marked') noteSession(company,agent.profile,session,{archived:false}); };
}
