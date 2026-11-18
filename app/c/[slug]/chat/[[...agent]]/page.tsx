import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { uuid } from '@/lib/conversations';
import { isNewFor } from '@/lib/sidebar.mjs';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { readyRoles, roleStart } from '@/lib/ready-roles';
import { emptyChatFacts } from '@/lib/empty-chat.mjs';
import { agentDetails } from '@/app/agent-details-server';
import AgentChat from './agent-chat';
import type { EmptyChat } from '@/app/agent-empty-chat';

// Opening an Agent: its empty Conversation (design-reference: emptyChatHTML). Without an id it is the main Agent, Lead.
// The first message starts the Conversation and the page moves to it. "New agent" opens it as ?new=agent (#13): for
// the Owner, Lead's chat ready to type, with a hint line; no form. "Ask for an agent" opens the same for a Manager or a
// Contributor (#17). ?new=ready opens the ready-made gallery over it (#14), for every Member who may write (#189): a
// Viewer gets the plain chat, with no gallery drawn. The server decides it, as the database decides who may write.
// ?tab=<key> opens the details on that tab.
export default async function AgentChatPage({params,searchParams}:{params:Promise<{slug:string,agent?:string[]}>,searchParams:Promise<{new?:string,tab?:string,first?:string}>}) {
 const {t,language}=await getI18n(); const {slug,agent:parts}=await params; const {new:mode,tab,first}=await searchParams;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/chat${parts?.length?`/${parts.join('/')}`:''}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name,work_mode').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company||(parts&&(parts.length!==1||!uuid.test(parts[0])))) notFound();
 const {data:agents}=await db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,template,${madeColumns}`).eq('company_id',company.id);
 const agent=parts?agents?.find(a=>a.id===parts[0]):agents?.find(a=>a.is_default)||agents?.[0];
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
 // Which empty chat the Agent shows this reader (#170; lib/empty-chat.mjs reads it): the active Owners are read once, for
 // a Member asking for an Agent (#17) or reading the main Agent's empty chat, and a refused read fails the page.
 const main=!!agent?.is_default, fresh=main&&agents?.length===1;
 const asks=!owner&&(newAgent||(fresh&&!!writer));
 const facts=agent?await emptyChatFacts(db,{company:company.id,agent:agent.id,me:user.id,main,fresh,alone,owner,asks}):null;
 const askOf=asks?facts?.owners??[]:null;
 const empty:EmptyChat=!agent||!facts||facts.state==='known'?{state:'known'}:facts.state==='fresh'?{state:'fresh'}
  :facts.state==='main'?{state:'main',reader:facts.reader,owners:facts.owners}
  :{state:'new',works:facts.works,...roleStart(language,alone,agent.template),made:madeOf(agent,user.id,slug)};
 const gallery=mode==='ready'&&newAgent?{company:company.name,alone,roles:readyRoles(language,alone),owner,owners:facts?.owners??[]}:null;
 const details=agent?await agentDetails(db,{company:company.id,agent:agent.id,name:agent.name,slug,me:user.id,role:membership?.role||'',tab}):null;
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 return <Shell company={company} companies={companies||[]} personId={user.id} section="chat" title={t('chats')} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingCount} agentId={agent?.id}>
  <main className="convo-page h-full"><AgentChat slug={slug} company={company.id} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default,made:madeOf(agent,user.id,slug)}:null} details={details} writer={!!writer} team={company.work_mode==='team'} empty={empty} newAgent={newAgent} askOf={askOf} gallery={gallery} isNew={!!agent&&isNewFor(agent,user.id)} first={first==='alone'||first==='team'?first:undefined}/></main>
 </Shell>;
}

