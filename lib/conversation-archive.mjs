import { engineFor as defaultEngine } from './engine.mjs';
import { engineOf, onProfile } from './company-engine.mjs';

// An archived Conversation's session is marked archived in its Engine, and a restored one's unmarked (#674), through the
// engine contract on the profile of the Conversation's Agent. gtmworks's own archive is already done in the database
// (archive_conversations), so an Engine that is down only delays the mark: the worker carries each one the database
// lists (conversation_sessions_to_mark) whenever the Engine answers, and settles it once taken
// (conversation_session_marked). A session the Engine does not keep, or a Conversation whose Agent is gone, is told to
// the database (conversation_session_missing): a session a stopped Run named may not be written yet, so it is asked
// again a minute later, and let go as settled after a day, or at once when the Agent is gone. An Engine that does not
// answer, or refuses its key, keeps its marks for a pass 15 seconds later and is not asked again in this one; another
// Company's Engine still is, and its marks beyond the page reach the next pass. `db` is a service-role client.
// Answers how many marks were settled.
/** @param {any} db @param {{hermes?:{address:string,key:string}|null,engines?:(company:string)=>Promise<{address:string,key:string}|null>,engineFor?:typeof defaultEngine}} options */
export async function markConversationSessions(db,{hermes=null,engines=engineOf,engineFor=defaultEngine}={}) {
 const {data:rows,error}=await db.rpc('conversation_sessions_to_mark',{});
 if(error) throw error;
 const held=new Set(); const later=/** @type {string[]} */([]); const found=new Map(); let settled=0;
 for(const row of /** @type {{conversation:string,company:string,profile:string|null,session:string,archived:boolean}[]} */ (rows||[])) {
  try {
   let answer='missing';
   if(row.profile) {
    if(held.has(row.company)) { later.push(row.conversation); continue; }
    if(!found.has(row.company)) found.set(row.company,hermes??await engines(row.company));
    const connection=onProfile(row.profile,row.company,found.get(row.company));
    const engine=connection&&engineFor(connection);
    answer=engine?.markSession?await engine.markSession(row.session,row.archived):'unreachable';
    if(answer!=='marked'&&answer!=='missing') { held.add(row.company); later.push(row.conversation); continue; }
   }
   const {data:kept,error:unsettled}=await db.rpc(answer==='marked'?'conversation_session_marked':'conversation_session_missing',{conversation:row.conversation,archived:row.archived});
   if(unsettled) throw unsettled;
   if(answer==='marked'||kept) settled++;
  } catch(failure) { console.error('Conversation session not marked:',row.conversation,failure?.message||'unknown error'); }
 }
 // A held Engine's marks wait 15 seconds (three passes) before they are listed again (conversation_sessions_later),
 // so a full page of them never keeps another Company's marks out of the next pass.
 if(later.length) {
  const {error:deferred}=await db.rpc('conversation_sessions_later',{conversations:later});
  if(deferred) console.error('Conversation session marks not deferred:',deferred.message||'unknown error');
 }
 return settled;
}
