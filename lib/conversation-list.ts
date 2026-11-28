import 'server-only';
import type { supabase } from './supabase';
import type { SessionListed } from './engine.mjs';
import { companyEngine, seenAgents } from './engine/handle.mjs';
import { conversationTitle } from './conversation-title.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
type Translate=(key:string,...values:unknown[])=>string;
type Row={id:string,agent_id:string|null,agent_name:string,hermes_session_id:string|null,good_morning_day:string|null,created_at:string};

// One of the person's Conversations as the sidebar and All conversations list it (#881): its row joined with its
// session in the Engine's list. The title is the session's title, else its preview (the opening words of its first
// message), else the Agent's name for a Conversation whose session the Engine has not made yet; `line` is the preview
// under a title. `at` is the session's last activity, `archived` its own archived mark. `session` and `profile` stay on
// the server: they name where a rename or an archive is written.
export type PersonConversation={id:string,agent:string,agentName:string,title:string,line:string,at:string,archived:boolean,session:string|null,profile:string|null};

// The last good read of each Agent's sessions, by Company and profile, in the server's memory only: moving between pages
// draws the lists from it and never waits on the Engine (ADR 0030). A read is fresh for 15 seconds; after that the next
// list is drawn from it while it is read again, and an Engine that does not answer leaves it as it was. Only the
// sessions some person's own rows name are kept, never the rest of the profile's list, and a person is given only the
// sessions their own rows name (the database reads them as that person). Kept on globalThis so the pages and the route
// handlers, which Next bundles apart, share one memory.
// `gone`: the Engine no longer knows the profile (its Agent deleted there). `noted`: what was written here since a read
// began, laid over that read when it lands so it never brings back an older title or mark.
// `wanted`: each session asked for, by when it was first asked; `began`: when the read held now began, so a session it
// was never asked for is not taken for gone.
type Kept={at:number,began:number,tried:number,sessions:Map<string,SessionListed>,complete:boolean,gone:boolean,wanted:Map<string,number>,reading:Promise<void>|null,noted:Map<string,{at:number,change:Partial<SessionListed>}>};
const memory=((globalThis as {[key:symbol]:unknown})[Symbol.for('gtmworks.sessionLists')]??=new Map<string,Kept>()) as Map<string,Kept>;
const freshFor=15000;
// A list waits for a first read of an Agent this long, and for a read that may hold a Conversation just started (one
// its last read does not hold) this long, then draws what it has: the read goes on and the next list has it.
const firstWait=1500, newWait=500;
// shortcut: an Agent's list is read 100 sessions a page, ten pages at most, and stops once every session asked for is
// found; a session older than its 1,000 newest is drawn from its row, by its Agent's name. Upgrade if a profile keeps
// more sessions than that.
const listPages=10, listPage=100;
// A session the Engine's list does not hold is a Conversation not started yet while its row is this young, and gone
// after (its Agent deleted on the Engine): the slow drift check then forgets its row (lib/conversation-drift.mjs).
const youngFor=10*60*1000;

const keyOf=(company:string,profile:string)=>`${company}:${profile}`;
type Profile=NonNullable<Awaited<ReturnType<typeof companyEngine>>> extends {on:(profile:string)=>infer P}?NonNullable<P>:never;

async function readList(kept:Kept,on:Profile) {
 const sessions=new Map<string,SessionListed>(); let complete=false, gone=false; const began=Date.now();
 for(let page=0;page<listPages;page++) {
  const read=await on.sessions.list({offset:page*listPage,limit:listPage});
  // A profile the Engine does not know holds no session: its Agent was deleted there.
  if(read.state==='missing') { complete=true; gone=true; break; }
  if(read.state!=='found') return;
  for(const session of read.sessions) if(kept.wanted.has(session.id)) sessions.set(session.id,session);
  if(read.sessions.length<listPage||(page+1)*listPage>=read.total) { complete=true; break; }
  if([...kept.wanted.keys()].every(id=>sessions.has(id))) break;
 }
 for(const [id,{at,change}] of kept.noted) { if(at<began) kept.noted.delete(id); else { const held=sessions.get(id); if(held) Object.assign(held,change); } }
 Object.assign(kept,{at:Date.now(),began,sessions,complete,gone});
}

// The sessions of one Agent's profile that `wanted` names, from the last good read, read again when it is stale or does
// not hold a session asked for; null when there has never been a good read (its rows are then drawn from themselves).
async function profileSessions(company:string,profile:string,on:Profile|null,wanted:string[],now:number):Promise<Kept|null> {
 const key=keyOf(company,profile);
 let kept=memory.get(key);
 if(!kept) { kept={at:0,began:0,tried:0,sessions:new Map(),complete:false,gone:false,wanted:new Map(),reading:null,noted:new Map()}; memory.set(key,kept); }
 const unheld=wanted.filter(id=>!kept.wanted.has(id));
 for(const id of unheld) kept.wanted.set(id,now);
 const good=kept.at>0;
 const stale=now-kept.at>=freshFor||unheld.length>0;
 if(stale&&on&&!kept.reading&&(unheld.length>0||now-kept.tried>=freshFor)) {
  kept.tried=now;
  const reading=readList(kept,on).catch(()=>{}).finally(()=>{ kept.reading=null; });
  kept.reading=reading;
 }
 if(kept.reading&&(!good||unheld.length)) await Promise.race([kept.reading,new Promise(done=>setTimeout(done,good?newWait:firstWait))]);
 return kept.at>0?kept:null;
}

/** A session renamed or archived here is drawn so at once (#881), without waiting for the next read. */
export function noteSession(company:string,profile:string,session:string,change:Partial<Pick<SessionListed,'title'|'archived'|'at'>>) {
 const kept=memory.get(keyOf(company,profile)); if(!kept) return;
 const held=kept.sessions.get(session);
 if(held) Object.assign(held,change);
 kept.noted.set(session,{at:Date.now(),change:{...kept.noted.get(session)?.change,...change}});
}

/** A session of the Company's as the last good read holds it, or null when it holds none: a Conversation's own page
 * draws its title and archived mark from it, never waiting on the Engine (ADR 0030). */
export function heldSession(company:string,session:string):SessionListed|null {
 for(const [key,kept] of memory) if(key.startsWith(`${company}:`)&&kept.sessions.has(session)) return kept.sessions.get(session)!;
 return null;
}


// A Conversation the Engine's list does not hold yet, while sends still go through the old record (until #876 and #883
// switch it off), is named as the old record names it (lib/conversation-title.mjs: its first message, else the one still
// waiting for its Run), with its newest message under it, by that message's time and its own archived mark, as #875 left a Conversation the old
// record holds to that record. Null when that read failed.
type OldRow={id:string,last_message_at:string,archived_at:string|null,conversation_messages:{body:string,conversation_attachments:{name:string}[]}[],conversation_queued_turns:{message:string}[],newest:{body:string}[]};
async function oldRecord(db:Database,ids:string[]):Promise<Map<string,{title:string,line:string,at:string,archived:boolean}>|null> {
 if(!ids.length) return new Map();
 const {data,error}=await db.from('conversations').select('id,last_message_at,archived_at,conversation_messages(body,conversation_attachments(name)),conversation_queued_turns(message),newest:conversation_messages(body)').in('id',ids).eq('conversation_messages.author','person')
  .neq('newest.body','').is('newest.hand_card',null).order('id',{referencedTable:'newest',ascending:false}).limit(1,{referencedTable:'newest'})
  .order('id',{referencedTable:'conversation_messages'}).limit(1,{referencedTable:'conversation_messages'}).order('queued_at',{referencedTable:'conversation_queued_turns'}).limit(1,{referencedTable:'conversation_queued_turns'});
 if(error) return null;
 return new Map(((data||[]) as OldRow[]).map(row=>{ const first=row.conversation_messages?.[0];
  const title=(first?.body||row.conversation_queued_turns?.[0]?.message||'').split('\n')[0]||first?.conversation_attachments?.[0]?.name||'';
  return [row.id,{title,line:row.newest?.[0]?.body??'',at:row.last_message_at,archived:!!row.archived_at}]; }));
}

// The person's own Conversations in a Company (#881, spec #864): their rows, read as them, joined with one list read
// per Agent from the Engine, newest activity first. A Conversation of an Agent they no longer see, or whose Agent is
// gone, is none of theirs to list; one whose session the Engine's list no longer holds is gone. An Agent whose sessions
// have never been read (its Engine down since the server started) has its Conversations drawn from their rows. Null when
// the rows could not be read: the lists then keep what they show.
export async function personConversations(db:Database,company:string,t:Translate,language:string,{now=Date.now()}:{now?:number}={}):Promise<PersonConversation[]|null> {
 const [{data,error},seen,engine]=await Promise.all([
  db.from('conversations').select('id,agent_id,agent_name,hermes_session_id,good_morning_day,created_at').eq('company_id',company).not('agent_id','is',null).order('created_at',{ascending:false}).limit(2000),
  seenAgents(db,company),
  companyEngine(company).catch(()=>null),
 ]);
 if(error||!seen) return null;
 // Which Agents are the reader's to see is the rows' own read (row-level security); the Agents' profiles only say where
 // each one's sessions are listed. An Agent with no profile the Engine serves has its Conversations drawn from their rows.
 const profiles=new Map(seen.map(row=>[row.agent,row.profile]));
 const rows=((data||[]) as Row[]).filter(row=>row.agent_id);
 const byProfile=new Map<string,string[]>();
 for(const row of rows) if(row.hermes_session_id&&profiles.has(row.agent_id!)) {
  const profile=profiles.get(row.agent_id!)!;
  byProfile.set(profile,[...byProfile.get(profile)??[],row.hermes_session_id]);
 }
 const reads=new Map(await Promise.all([...byProfile].map(async([profile,sessions])=>[profile,await profileSessions(company,profile,engine?.on(profile)??null,sessions,now)] as const)));
 const keptOf=(row:Row)=>row.hermes_session_id&&profiles.has(row.agent_id!)?reads.get(profiles.get(row.agent_id!)!)??null:null;
 const sessionOf=(row:Row)=>row.hermes_session_id?keptOf(row)?.sessions.get(row.hermes_session_id):undefined;
 // A session is gone only by a whole read that began after it was asked for: its profile unknown to the Engine, or the
 // session missing from the list while its row is no longer young.
 const goneOf=(row:Row)=>{
  const kept=keptOf(row); if(!kept||!row.hermes_session_id||sessionOf(row)) return false;
  return kept.complete&&(kept.wanted.get(row.hermes_session_id)??Infinity)<=kept.began&&(kept.gone||now-Date.parse(row.created_at)>=youngFor);
 };
 const shown=rows.filter(row=>!goneOf(row));
 const old=await oldRecord(db,shown.filter(row=>!sessionOf(row)).map(row=>row.id));
 if(!old) return null;
 return shown.map((row):PersonConversation=>{
  const profile=profiles.get(row.agent_id!)??null;
  const session=sessionOf(row);
  const before=session?undefined:old.get(row.id);
  const named=session?session.title||session.preview:before?.title;
  // A morning's Conversation is named by its day until the person renames it.
  const title=session?.title||(row.good_morning_day?conversationTitle({morningDay:row.good_morning_day,agent:row.agent_name},t,language):named||row.agent_name);
  const at=session?.at??(before?.at&&Number.isFinite(Date.parse(before.at))?before.at:row.created_at);
  return {id:row.id,agent:row.agent_id!,agentName:row.agent_name,title,line:session?(session.title?session.preview:''):before?.line??'',at:new Date(at).toISOString(),
   archived:session?session.archived:!!before?.archived,session:row.hermes_session_id,profile};
 }).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
}
