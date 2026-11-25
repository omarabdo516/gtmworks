import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { uuid } from '@/lib/conversations';
import { isNewFor, orderAgents } from '@/lib/sidebar.mjs';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { readyRoleLooks, readyRoles, roleSentence, roleStart } from '@/lib/ready-roles';
import { emptyChatFacts, type EmptyChatFacts } from '@/lib/empty-chat.mjs';
import { agentDetails } from '@/app/agent-details-server';
import { companyHasModel } from '@/lib/provider-keys.mjs';
import { openOnVisit } from '@/lib/lead-opening.mjs';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
import AgentChat from './agent-chat';
import type { EmptyChat } from '@/app/agent-empty-chat';

// One of the Company's Agents as this page reads it, the details' `made` columns included.
type AgentRow={id:string,connection_id:string,name:string,speciality:string,is_default:boolean,template:string|null,created_at?:string|null,requested_by?:string|null,requester?:unknown,lead_made_agents?:unknown};

// Opening an Agent: its empty Conversation (design-reference: emptyChatHTML). Without an id it is the main Agent, Lead.
// The first message starts the Conversation and the page moves to it. "New agent" opens it as ?new=agent (#13): for
// the Owner, Lead's chat ready to type, with a hint line; no form. "Ask for an agent" opens the same for a Manager or a
// Contributor (#17). ?new=ready opens the ready-made gallery over it (#14), for every Member who may write (#189): a
// Viewer gets the plain chat, with no gallery drawn. The server decides it, as the database decides who may write.
// ?tab=<key> opens the details on that tab.
export default async function AgentChatPage({params,searchParams}:{params:Promise<{slug:string,agent?:string[]}>,searchParams:Promise<{new?:string,tab?:string,first?:string,invites?:string}>}) {
 const {t,language}=await getI18n(); const {slug,agent:parts}=await params; const {new:mode,tab,first,invites}=await searchParams;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/chat${parts?.length?`/${parts.join('/')}`:''}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name,work_mode').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company||(parts&&(parts.length!==1||!uuid.test(parts[0])))) notFound();
 const {data:agents}=await db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,template,${madeColumns}`).eq('company_id',company.id).order('name');
 const visible=orderAgents((agents||[]) as AgentRow[]);
 const agent=parts?visible.find(a=>a.id===parts[0]):visible.find(a=>a.is_default)||visible[0];
 if(parts&&!agent) notFound();
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 // Any Member but a Viewer may write (#287); the database decides, as it does for every send.
 const {data:writer}=await db.rpc('conversation_can_write',{c:company.id});
 const {count:waitingCount}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const owner=membership?.role==='owner';
 // Every Member who may write opens the gallery: the Owner adds a role there, a Manager or a Contributor asks for one (#189).
 const newAgent=(mode==='agent'||mode==='ready')&&!!agent?.is_default&&!!writer;
 const alone=company.work_mode==='alone';
 // Which empty chat an Agent shows this reader (#170; lib/empty-chat.mjs reads it): the active Owners are read once, for
 // a Member asking for an Agent (#17) or reading the main Agent's empty chat, and a refused read fails the page.
 // The details are started beside it, since either may be drawn first.
 const main=!!agent?.is_default, fresh=main&&visible.length===1;
 const asks=!owner&&(newAgent||(fresh&&!!writer));
 const factsRead=agent?emptyChatFacts(db,{company:company.id,agent:agent.id,me:user.id,main,fresh,alone,owner,asks}):Promise.resolve(null);
 const detailsRead=agent?agentDetails(db,{company:company.id,agent:agent.id,name:agent.name,slug,me:user.id,role:membership?.role||'',tab}):Promise.resolve(null);
 // A Company with no model at all says so above the composer before anyone writes (#422); only a writer has a composer,
 // and only a read that tells "none" for certain draws the line.
 const modelRead=agent&&writer?companyHasModel(db,{company:company.id}).catch(()=>null):Promise.resolve(null);
 // #434: on a Company with a model and no Conversation yet, the Owner opening Lead finds the first Conversation, which
 // Lead opened with its questions (lib/lead-opening.mjs). The database opens it once per Company; any later visit draws
 // the empty chat. Without a model the #422 notice shows instead, and the opening waits for one. The Owner's empty
 // Conversation from first run is opened the same way (app/c/[slug]/conversations/[id]/page.tsx). Until anyone writes,
 // a visit goes back to the opening, so one written by a link's prefetch (which renders this page too) is still found.
 if(agent&&owner&&main&&!mode) {
  const opened=await openOnVisit(createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}),
   {model:modelRead,company:company.id,person:user.id,language,owner:person?.name||'',lead:agent.name,companyName:company.name});
  // The reads already on their way are not awaited once the page moves.
  if(opened) { factsRead.catch(()=>{}); detailsRead.catch(()=>{}); redirect(`/c/${slug}/conversations/${opened}${first?`?first=${encodeURIComponent(first)}${invites?`&invites=${encodeURIComponent(invites)}`:''}`:''}`); }
 }
 const facts=await factsRead;
 const askOf=asks?facts?.owners??[]:null;
 const emptyOf=(own:EmptyChatFacts,row:AgentRow):EmptyChat=>own.state==='known'?{state:'known',example:roleSentence(language,row.template)}
  :own.state==='fresh'?{state:'fresh'}
  :own.state==='main'?{state:'main',reader:own.reader,owners:own.owners}
  :{state:'new',works:own.works,...roleStart(language,alone,row.template),made:madeOf(row,user.id,slug)};
 const empty:EmptyChat=!agent||!facts?{state:'known',example:null}:emptyOf(facts,agent);
 // The picker offers every Agent this reader sees (#171; design-reference: visibleAgents), so an Agent's empty chat can
 // become any of theirs with no navigation: each one's state and details are read beside the opened Agent's and handed to
 // the client. Only an Agent this reader already writes to shows the picker, so the others are read only then.
 const pickers=empty.state==='known'?await Promise.all(visible.map(async row=>{
  const opened=row.id===agent?.id;
  const own=opened&&facts?facts:await emptyChatFacts(db,{company:company.id,agent:row.id,me:user.id,main:!!row.is_default,fresh:false,alone,owner,asks:false});
  return {agent:{id:row.id,connection_id:row.connection_id,name:row.name,speciality:row.speciality,main:row.is_default,made:madeOf(row,user.id,slug)},
   empty:opened?empty:emptyOf(own,row),details:opened?await detailsRead:await agentDetails(db,{company:company.id,agent:row.id,name:row.name,slug,me:user.id,role:membership?.role||'',tab})};
 })):null;
 const details=pickers?pickers.find(choice=>choice.agent.id===agent?.id)?.details??null:await detailsRead;
 const gallery=mode==='ready'&&newAgent?{company:company.name,alone,roles:readyRoles(language,alone,await readyRoleLooks(db,company.id)),owner,owners:facts?.owners??[]}:null;
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 return <Shell company={company} companies={companies||[]} personId={user.id} section="chat" title={t('chats')} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingCount} agentId={agent?.id}>
  <main className="convo-page h-full"><AgentChat slug={slug} company={company.id} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default,made:madeOf(agent,user.id,slug)}:null} details={details} writer={!!writer} team={company.work_mode==='team'} empty={empty} newAgent={newAgent} askOf={askOf} gallery={gallery} isNew={!!agent&&isNewFor(agent,user.id)} agents={pickers??[]} first={first==='alone'||first==='team'?first:undefined} invites={Number.parseInt(invites||'0',10)||0} noModel={await modelRead===false?{owner}:null}/></main>
 </Shell>;
}

