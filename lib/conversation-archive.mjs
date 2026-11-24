import { engineFor as defaultEngine } from './engine.mjs';
import { engineOf, onProfile } from './company-engine.mjs';

// An archived Conversation's session is marked archived in its Engine, and a restored one's unmarked (#674), through the
// engine contract on the profile of the Conversation's Agent. gtmworks's own archive is already done in the database
// (archive_conversations), so an Engine that is down only delays the mark: the worker carries each one the database
// lists (conversation_sessions_to_mark) whenever the Engine answers, and settles it once taken
// (conversation_session_marked). A session the Engine no longer keeps, or a Conversation whose Agent is gone, has
// nothing to mark and is settled as it is. An Engine that does not answer, or refuses its key, keeps its marks for the
// next pass and is not asked again in this one; another Company's Engine still is. `db` is a service-role client.
// Answers how many marks were settled.
/** @param {any} db @param {{hermes?:{address:string,key:string}|null,engines?:(company:string)=>Promise<{address:string,key:string}|null>,engineFor?:typeof defaultEngine}} options */
export async function markConversationSessions(db,{hermes=null,engines=engineOf,engineFor=defaultEngine}={}) {
 const {data:rows,error}=await db.rpc('conversation_sessions_to_mark',{});
 if(error) throw error;
 const held=new Set(); const found=new Map(); let settled=0;
 for(const row of /** @type {{conversation:string,company:string,profile:string|null,session:string,archived:boolean}[]} */ (rows||[])) {
  try {
   let answer='missing';
   if(row.profile) {
    if(held.has(row.company)) continue;
    if(!found.has(row.company)) found.set(row.company,hermes??await engines(row.company));
    const connection=onProfile(row.profile,row.company,found.get(row.company));
    const engine=connection&&engineFor(connection);
    answer=engine?.markSession?await engine.markSession(row.session,row.archived):'unreachable';
    if(answer!=='marked'&&answer!=='missing') { held.add(row.company); continue; }
   }
   const {error:unsettled}=await db.rpc('conversation_session_marked',{conversation:row.conversation,archived:row.archived});
   if(unsettled) throw unsettled;
   settled++;
  } catch(failure) { console.error('Conversation session not marked:',row.conversation,failure?.message||'unknown error'); }
 }
 return settled;
}
