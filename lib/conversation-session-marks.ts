import 'server-only';
import type { supabase } from './supabase';
import { agentEngine } from './engine/handle.mjs';
import { heldArchived, noteSession } from './conversation-list';

type Database=Awaited<ReturnType<typeof supabase>>;
type Found={id:string,agent_id:string|null,hermes_session_id:string|null};
export type SessionWrite='marked'|'missing'|'invalid'|'refused'|'unreachable';

// A Conversation's title and archived mark are its session's own (#881, spec #864): they are written on the Engine,
// through the Engine handle on the profile the reader sees its Agent on, and the lists' last read is told at once.
// The rows are read as the reader, so only their own Conversations are written; one with no session yet (its first Run
// not started) has no mark to write, and is `missing`.
async function rowsOf(db:Database,company:string,ids:string[]) {
 const {data,error}=await db.from('conversations').select('id,agent_id,hermes_session_id').eq('company_id',company).in('id',ids);
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
 * no session the Engine holds yet (`unstarted`), which the old record's own mark keeps until #883 switches it off; null
 * when the rows could not be read. */
export async function markConversations(db:Database,company:string,ids:string[],archived:boolean):Promise<{marked:string[],unstarted:string[]}|null> {
 const rows=await rowsOf(db,company,ids);
 if(!rows) return null;
 const answers=await Promise.all(rows.map(async row=>[row.id,await write(db,company,row,{archived}).catch(()=>'unreachable' as const)] as const));
 return {marked:answers.flatMap(([id,answer])=>answer==='marked'?[id]:[]),unstarted:answers.flatMap(([id,answer])=>answer==='missing'?[id]:[])};
}

/** Renames one of the reader's own Conversations on its session. */
export async function titleConversation(db:Database,company:string,id:string,title:string):Promise<SessionWrite> {
 const rows=await rowsOf(db,company,[id]);
 if(!rows) return 'unreachable';
 const row=rows[0];
 return row?await write(db,company,row,{title}).catch(()=>'unreachable' as const):'missing';
}

/** Writing in an archived Conversation brings it back (#881): its session's mark is cleared before the send goes on,
 * unless the lists' last read holds it current (a read that holds nothing clears it all the same). Nothing is logged:
 * the person wrote, they did not restore. */
export async function unarchiveOnWrite(db:Database,company:string,id:string) {
 const rows=await rowsOf(db,company,[id]);
 const row=rows?.[0];
 if(!row?.agent_id||!row.hermes_session_id) return;
 const target=await agentEngine(db,{company,agent:row.agent_id});
 if(target.state!=='found') return;
 if(heldArchived(company,target.agent.profile,row.hermes_session_id)===false) return;
 if(await target.engine.sessions.mark(row.hermes_session_id,false)==='marked') noteSession(company,target.agent.profile,row.hermes_session_id,{archived:false});
}
