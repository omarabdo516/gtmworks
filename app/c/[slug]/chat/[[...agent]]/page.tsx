import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { uuid } from '@/lib/conversations';
import { isNewFor } from '@/lib/sidebar.mjs';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { readyRoles, roleStart } from '@/lib/ready-roles';
import { worksWith } from '@/lib/agent-details.mjs';
import { agentDetails } from '@/app/agent-details-server';
import AgentChat from './agent-chat';
import type { EmptyChat } from '@/app/agent-empty-chat';

// Opening an Agent: its empty Conversation (design-reference: emptyChatHTML). Without an id it is the main Agent, Lead.
// The first message starts the Conversation and the page moves to it. "New agent" opens it as ?new=agent (#13): for
// the Owner, Lead's chat ready to type, with a hint line; no form. "Ask for an agent" opens the same for a Manager or a
// Contributor (#17). ?new=ready opens the ready-made gallery over it (#14), for the Owner only: anyone else gets the
// plain chat, with no gallery drawn. ?tab=<key> opens the details on that tab.
export default async function AgentChatPage({params,searchParams}:{params:Promise<{slug:string,agent?:string[]}>,searchParams:Promise<{new?:string,tab?:string}>}) {
 const {t,language}=await getI18n(); const {slug,agent:parts}=await params; const {new:mode,tab}=await searchParams;
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
 const {items:waitingItems}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const owner=membership?.role==='owner';
 const newAgent=(mode==='agent'||(mode==='ready'&&owner))&&!!agent?.is_default&&!!writer;
 const alone=company.work_mode==='alone';
 // Which empty chat the Agent shows this reader (#170). An Agent other than the main one is new to a reader with no
 // Conversation with it (RLS shows only the reader's own). The active Owners are read once, and only for a reader who is
 // told whom a request goes to: asking for an Agent (#17), or the main Agent's empty chat in a team. Whether an Owner is
 // the only one who sees an Agent needs the active Members and the Agent's access rows. A failed read fails the page
 // rather than leave a sentence without its names.
 const main=!!agent?.is_default, fresh=main&&agents?.length===1;
 const asks=!owner&&(newAgent||(fresh&&!!writer));
 const owners=!owner&&(asks||(main&&!fresh&&!alone))?await ownerNames(db,company.id):[];
 const askOf=asks?owners:null;
 const sole=!!agent&&!main&&!alone&&owner;
 const [written,members,access]=agent&&!main?await Promise.all([
  db.from('conversations').select('id',{count:'exact',head:true}).eq('company_id',company.id).eq('agent_id',agent.id).eq('person_id',user.id).then(({count})=>count??1),
  sole?db.from('members').select('person_id,role').eq('company_id',company.id).is('removed_at',null).then(({data,error})=>{ if(error) throw error; return data||[]; }):[],
  sole?db.from('member_agent_access').select('person_id').eq('company_id',company.id).eq('agent_id',agent.id).then(({data,error})=>{ if(error) throw error; return (data||[]).map(row=>row.person_id); }):[],
 ]):[0,[],[]];
 const empty:EmptyChat=!agent||!main&&written?{state:'known'}:fresh?{state:'fresh'}
  :main?{state:'main',reader:alone?'alone':owner?'owner':'member',owners}
  :{state:'new',works:worksWith({alone,me:user.id,members,access}),...roleStart(language,alone,agent.template),made:madeOf(agent,user.id,slug)};
 const gallery=mode==='ready'&&newAgent?{company:company.name,alone,roles:readyRoles(language,alone)}:null;
 const details=agent?await agentDetails(db,{company:company.id,agent:agent.id,slug,me:user.id,role:membership?.role||'',tab}):null;
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 return <Shell company={company} companies={companies||[]} personId={user.id} section="chat" title={t('chats')} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingItems.length} agentId={agent?.id}>
  <main className="convo-page h-full"><AgentChat slug={slug} company={company.id} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default,made:madeOf(agent,user.id,slug)}:null} details={details} writer={!!writer} team={company.work_mode==='team'} empty={empty} newAgent={newAgent} askOf={askOf} gallery={gallery} isNew={!!agent&&isNewFor(agent,user.id)}/></main>
 </Shell>;
}

// The names of a Company's active Owners, in order. A read the database refuses is an error, never an empty list.
async function ownerNames(db:Awaited<ReturnType<typeof supabase>>,company:string) {
 const {data,error}=await db.from('members').select('people(name)').eq('company_id',company).eq('role','owner').is('removed_at',null);
 if(error) throw error;
 return ((data||[]) as unknown as {people:{name:string}|null}[]).flatMap(row=>row.people?[row.people.name]:[]).sort();
}
