import { getI18n } from '@/lib/i18n-server';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { sections, placeholders } from '@/lib/navigation';
import { EmptyState } from '@/components/paperclip/EmptyState';
import { Inbox } from 'lucide-react';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { canCreateCard } from '@/lib/card-permissions.mjs';
import { boardCardColumns } from '@/lib/board-columns.mjs';
import { currentNoteText, parseCard } from '@/lib/activity-log.mjs';
import { cardWindow } from '@/app/card-window-server';
import { orderAgents } from '@/lib/sidebar.mjs';
import Members from './members';
import Home from './home';
import AgentAccess from './agent-access';
import CompanyHermesAgents from './company-hermes-agents';
import Skills from './skills';
import { companySkillAgents } from '@/lib/company-skill-items';
import Work, { type Card, type OpenReview } from './work';
import { archiveCards, newCard, archivedCardList, placeMove, saveCard, saveDescription, tickTodo, uploadDescriptionPicture, workAction, undoMove } from './work-actions';
import { archivedCardCount, archivedCardPage } from '@/lib/archived-cards';
import Projects from './projects';
import Usage from './usage';
import { managedUsage } from '@/lib/company-app-items';
import { Approvals } from './approvals';
import { type WorkActivity, type WorkMember } from '@/lib/work-activity';

export default async function CompanyPage({params,searchParams}:{params:Promise<{slug:string,section?:string[]}>,searchParams:Promise<{message?:string,refused?:string,failed?:string,section?:string,agent?:string,period?:string,card?:string,show?:string,idea?:string,added?:string,decided?:string,item?:string,invited?:string}>}) { const {t,language}=await getI18n();
 const {slug,section:parts}=await params; const cardId=parts?.[0]==='work' && parts?.[1]==='board' && parts?.[2] ? Number(parts[2]) : undefined; const section=cardId?'work/board':parts?.join('/') || 'home'; const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 // Signing in returns to the page asked for, with the settings overlay's own state (section, agent, period), the Card
 // open over the board (card) and the Card a chat shows on the board (show) kept, so a link to Settings, Subscription
 // and models or to a Card opens there; other query values (one-time notices) are not carried.
 if(!user) { const asked=await searchParams; const kept=new URLSearchParams(Object.entries({section:asked.section,agent:asked.agent,period:asked.period,card:asked.card,show:asked.show}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString();
  redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/${parts?.join('/') || 'home'}${kept?`?${kept}`:''}`)}`); }
 const {data:companies}=await db.from('companies').select('id,slug,name,work_mode').order('name'); const company=companies?.find(c=>c.slug===slug); if(!company || !sections[section]) notFound(); const title=t(sections[section]);
 // A Company worked alone has no Member permissions to set (#10); its invitation form is in the settings overlay.
 if(section==='settings/members'&&company.work_mode==='alone') redirect(`/c/${slug}/settings?section=members`);
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 const canCreate=canCreateCard({role:membership?.role});
 const manage=['owner','manager'].includes(membership?.role || ''); const canOwner=membership?.role==='owner';
 // Usage is the Owner's and the Managers' (#32), checked here for the page as the database checks each read.
 if(section==='usage'&&!manage) notFound();
 const {data:members}=section==='settings/members'?await db.from('members').select('person_id,role,agent_role,grant_publishing,grant_money_figures,grant_customer_data,people(name)').eq('company_id',company.id).order('role'): {data:[]};
 const {data:companyHermesAgents}=section==='agents'?await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name'):{data:[]};
 const {data:accessAgents}=section==='agents'&&canOwner?await db.from('agents').select('id,role').order('role'):{data:[]};
 const {data:accessGrants}=section==='agents'&&canOwner?await db.from('agent_grants').select('agent_id,revoked_at').eq('company_id',company.id):{data:[]};
 const skillAgents=section==='skills'?await companySkillAgents(company.id):null;
 const {data:audit}=section==='settings/members'?await db.from('member_audit').select('id,actor_id,actor_name,person_id,person_name,action,created_at,before_data,after_data').eq('company_id',company.id).order('created_at',{ascending:false}):{data:[]};
 // Each managed Company's token use in the last 30 days, read from the bundled Engine (#347, #32).
 const usageRows=section==='usage'?await managedUsage(user.id,30):[];
 const query=await searchParams; const message=query.message;
 // The invitation just sent comes back by its id (#169, #185): the address keeps no email, and only a person who may
 // manage this team reads the invitation it names.
 const invitedId=section==='settings/members'&&manage&&/^[0-9a-f-]{36}$/i.test(query.invited||'')?String(query.invited):null;
 const {data:invitation}=invitedId?await db.from('member_invitations').select('id,email').eq('company_id',company.id).eq('id',invitedId).maybeSingle():{data:null};
 const invitedEmail=typeof invitation?.email==='string'?invitation.email:undefined;
 const waitingFailures:Record<string,string>={rule:'waitingRuleFailed',access:'waitingAccessFailed','request-engineNotReady':'waitingRequestNotReady','request-engineUnreachable':'waitingRequestUnreachable',
  'request-notMade':'waitingRequestNotMade','request-answered':'waitingRequestAnswered','request-notFound':'waitingRequestAnswered','request-reasonMissing':'waitingRequestReasonMissing',
  'change-notApplied':'waitingChangeNotApplied','change-answered':'waitingChangeAnswered','change-notFound':'waitingChangeAnswered','change-reasonLong':'waitingChangeReasonLong',
  'change-cannotApply':'waitingChangeCannotApply','change-applying':'waitingChangeApplying','change-busy':'waitingChangeBusy','change-writtenLate':'waitingChangeWrittenLate','change-reasonMissing':'waitingChangeReasonMissing','change-editInvalid':'waitingChangeEditInvalid'};
 const failed=query.failed||''; const waitingFailure=Object.hasOwn(waitingFailures,failed)?t(waitingFailures[failed]):failed.startsWith('request-')?t('waitingRequestFailed'):failed.startsWith('change-')?t('waitingChangeFailed'):message;
 const {cards:myCards,visible:myVisibleCards,items:waitingItems,assigned:assignedCards,count:waitingCount,available:approvalsAvailable}=await approvalQueue(db,company.id,user.id,membership?.role || '');
 const isWork=section.startsWith('work/');
 // The board, the board under a new Card (/work/new) and the board opened on Waiting on you (/approvals).
 const onBoard=section==='work/board'||section==='work/new'||section==='approvals';
 // An idea just added comes back on the board with its own address (#188): the Card flashes and the board toasts it.
 const ideaAdded=!onBoard?undefined:query.idea==='1'?'idea' as const:query.added==='1'?'card' as const:undefined;
 // A decided learning suggestion comes back to the board with its outcome and its Agent's name (#169): the address names
 // the waiting item, never the Agent, and the page reads its name here as the person reading the board.
 const decidedItem=section==='approvals'&&(query.decided==='approve'||query.decided==='reject')&&/^[1-9]\d{0,17}$/.test(query.item||'')?Number(query.item):null;
 const {data:decided}=decidedItem!=null?await db.from('waiting_items').select('body,agent_rules(hermes_agents(name))').eq('company_id',company.id).eq('id',decidedItem).maybeSingle():{data:null};
 // The suggestion's Agent, through its rule; the item's own line only when the rule names none (as #169 read it).
 const decidedRow=decided as {body?:string|null,agent_rules:{hermes_agents:{name:string}|null}|null}|null;
 const ruleDecision=decidedItem!=null?{approve:query.decided==='approve',agent:decidedRow?.agent_rules?.hermes_agents?.name||String(decidedRow?.body||'')}:undefined;
 // The board reads its Cards through board_cards (#190): no Card of an Agent hidden from the reader, each with the
 // Company Agents that worked on it (crew). Other places list Cards as before.
 // Typed as the table read it stands in for, whose rows the untyped client leaves open.
 const read=(t:string)=>db.from(t).select('*').eq('company_id',company.id);
 const cards=()=>db.from('work_cards').select(boardCardColumns).eq('company_id',company.id) as unknown as ReturnType<typeof read>;
 const boardCards=()=>db.rpc('board_cards',{c:company.id}).select(`${boardCardColumns},crew`) as unknown as ReturnType<typeof read>;
 // A Card's own Agent and the board's chips (#144, #190): the Company's Agents the reader sees, in the sidebar's order.
 // Home's Agent tiles read their in-progress Cards on their own, newest first, so the capped Card list never hides one (#460).
 // shortcut: one read for every Agent, so past the Data API's 1,000 rows one Agent's Cards could crowd out another's; read per Agent if a Company ever holds that many in progress.
 const [workData,{data:agentRows},homeAgentCards]=await Promise.all([
  (isWork||section==='home'||section==='approvals')?Promise.all(['work_cards','work_activity','work_creatives','work_versions','work_attachments'].map(t=>t==='work_cards'?onBoard?boardCards():cards():read(t))):[],
  onBoard?db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name'):{data:[]},
  section==='home'?db.from('work_cards').select('id,title,status,assignee_agent,created_at,wait:card_wait').eq('company_id',company.id).not('assignee_agent','is',null).eq('status','progress').order('created_at',{ascending:false}).order('id',{ascending:false}):{data:[],error:null},
 ]);
 const cardAgents=orderAgents((agentRows||[]) as {id:string,connection_id:string,name:string,speciality:string,is_default:boolean}[]);
 // The Card list is capped at the Data API's row limit; the reader's own pending approvals were read by id
 // (approvalQueue, company-scoped), so one past the cap still reaches Waiting on you and its board column.
 if(workData[0]?.data) { const known=new Set(workData[0].data.map((c:{id:number})=>c.id)); const missing=(onBoard?myVisibleCards:myCards).filter(c=>!known.has(c.id));
  if(onBoard&&missing.length) workData[0].data.push(...((await boardCards().in('id',missing.map(c=>c.id))).data||[])); else workData[0].data.push(...missing); }
 // A Card opens in its window over the board (#116, #678), named in the board's address (?card=) or by the address its
 // page had (/work/board/<id>, an old link, the log's, a morning's); one the reader's own board does not hold opens nothing.
 const sheetId=section==='work/board'?cardId??parseCard(query.card):null;
 // A chat's corner pill opens the board on its Card (#144).
 const shownId=section==='work/board'&&!cardId?parseCard(query.show)??undefined:undefined;
 // The Card list is capped, so a Card the address names (open over the board, or shown from a chat) is read by id (the
 // reader's own rights, this Company) when the list missed it.
 for(const named of [sheetId,shownId]) if(named!=null&&workData[0]?.data&&!workData[0].data.some(c=>c.id===named)) { const {data:asked}=await boardCards().eq('id',named).maybeSingle(); if(asked) workData[0].data.push(asked); }
 // The board's archive list (#670), read apart from current Cards, which leave archived ones out in the database. An
 // archived Card named in the address opens read-only over the board, from every link that leads to it: the board's
 // own (?card), its own page's address (an old link, the log's, a morning's), and the board link its Conversation or
 // channel gives (?show), which has no current Card to show.
 // The board's archive list (#670, #705), read apart from current Cards, which leave archived ones out in the database:
 // its first page, newest archived first, and how many there are; the board reads the next pages and its searches
 // through archivedCardList. An archived Card the address names and the page does not hold is read by id, under the
 // same rights and this Company, so it opens read-only over the board from every link that leads to it: the board's own
 // (?card), its own page's address (an old link, the log's, a morning's), and the board link its Conversation or
 // channel gives (?show), which has no current Card to show.
 const onArchiveBoard=section==='work/board';
 const [archivedFirst,archivedTotal]=onArchiveBoard?await Promise.all([archivedCardPage<Card>(db,company.id,{}),archivedCardCount(db,company.id)]):[null,null];
 const archivedNamed:Card[]=[];
 const archived=()=>[...(archivedFirst?.items||[]),...archivedNamed];
 for(const named of [shownId,sheetId]) if(onArchiveBoard&&named!=null&&!archived().some(c=>c.id===named)&&!workData[0]?.data?.some(c=>c.id===named)) {
  const {data:asked}=await db.rpc('archived_cards',{c:company.id}).select('*').eq('id',named).maybeSingle(); if(asked) archivedNamed.push(asked as Card); }
 const isArchived=(id:number|null|undefined)=>id!=null&&archived().some(c=>c.id===id)&&!workData[0]?.data?.some(c=>c.id===id);
 for(const named of [cardId,shownId]) if(isArchived(named)) redirect(`/c/${slug}/work/board?card=${named}`);
 const sheetArchived=isArchived(sheetId);
 const sheet=sheetId!=null&&(sheetArchived||workData[0]?.data?.some(c=>c.id===sheetId))?await cardWindow(db,{company:company.id,card:sheetId,slug,me:user.id,canWrite:canCreate&&!sheetArchived,t,language}):undefined;
 const {data:workMembers}=(isWork||section==='home'||section==='approvals')?await db.from('members').select('person_id,role,agent_role,people(name)').is('removed_at',null).eq('company_id',company.id):{data:[]};
 const {data:workAgents}=isWork?await db.rpc('company_agents',{c:company.id}):{data:[]};
 const {data:projects}=(isWork||section==='projects')?await db.from('work_projects').select('id,name,goal,status').eq('company_id',company.id).order('id'):{data:[]};
 const {data:filedCards}=section==='projects'?await db.from('work_cards').select('project_id').eq('company_id',company.id).not('project_id','is',null):{data:[]};
 const cardCounts:Record<number,number>={}; for(const c of filedCards||[]) cardCounts[c.project_id]=(cardCounts[c.project_id]||0)+1;
 const versionRows=workData[3]?.data || [];
 const signed=versionRows.length ? await db.storage.from('creatives').createSignedUrls(versionRows.map(v=>v.path),3600) : {data:[]};
 const versions=versionRows.map((v,i)=>({...v,url:signed.data?.[i]?.signedUrl || null}));
 // The open reviews (#681): each Card in review, the Version it is decided on and who asked.
 const {data:openReviews}=isWork||section==='approvals'?await db.from('work_reviews').select('card_id,version_id,asked_by,asked_at').eq('company_id',company.id).is('decision',null):{data:[]};
 // How many Cards each Card still waits for (#682), hidden ones counted: the number on its tile.
 const {data:openWaits}=isWork||section==='approvals'?await db.rpc('open_card_waits',{c:company.id}):{data:[]};
 const commentIds=(workData[1]?.data || []).filter(a=>a.action==='comment_added').map(a=>Number((a.details as {id?:unknown}|null)?.id)).filter(Number.isSafeInteger);
 const {data:currentComments}=commentIds.length?await db.from('work_comments').select('id,body').eq('company_id',company.id).in('id',[...new Set(commentIds)]):{data:[]};
 const activityRows=await Promise.all(currentNoteText(workData[1]?.data || [],(currentComments||[]) as {id:number,body:string}[]).map(async a=>{
  if(typeof a.evidence!=='string' || !a.evidence.startsWith('file:')) return a;
  const {data}=await db.storage.from('creatives').createSignedUrl(a.evidence.slice(5),3600);
  return {...a,evidence_url:data?.signedUrl || null};
 }));
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const settingsLeaf:Record<string,string>={'settings/members':'members'};
 const crumbs=settingsLeaf[section]?[{label:company.name,href:`/c/${slug}/home`},{label:t('settings'),href:`/c/${slug}/settings`},{label:t(settingsLeaf[section])}]:undefined;
 return <Shell company={company} companies={companies || []} personId={user.id} section={section} title={title} crumbs={crumbs} personName={person?.name || user.email || ''} role={roleNames[membership?.role || ''] || ''} owner={membership?.role==='owner'} approvalCount={waitingCount} cardId={sheet?.id}><main className="content">{isWork?<><Work key={`${company.id}:${section==='work/new'?'new':'work'}`} workAction={workAction} saveCard={saveCard} tickTodo={tickTodo} saveDescription={saveDescription} uploadPicture={uploadDescriptionPicture} reviews={(openReviews||[]) as OpenReview[]} openWaits={(openWaits||[]) as {card_id:number,waiting:number}[]} placeMove={placeMove} newCard={newCard} undoMove={undoMove} archiveCards={archiveCards} archived={onArchiveBoard?{first:archivedFirst,total:archivedTotal,named:archivedNamed}:undefined} readArchived={archivedCardList} me={user.id} initialCreating={section==='work/new'} canCreate={canCreate} alone={company.work_mode==='alone'} agents={(workAgents||[]) as {person_id:string,role:string,granted:boolean}[]} slug={slug} company={company.id} section={section==='work/new'?'work/board':section} cards={workData[0]?.data || []} activity={activityRows.sort((a,b)=>b.id-a.id)} creatives={workData[2]?.data || []} versions={versions} attachments={(workData[4]?.data || []).map(({id,card_id,comment_id,name,content_type})=>({id,card_id,comment_id,name,content_type}))} projects={projects || []} message={message} members={(workMembers || []) as unknown as Parameters<typeof Work>[0]['members']} approvableIds={myVisibleCards.map(c=>c.id)} waiting={waitingItems} assigned={assignedCards} opened={sheet} show={shownId} ideaAdded={ideaAdded} cardAgents={cardAgents || []}/></>:section==='projects'?<Projects slug={slug} company={company.id} projects={projects || []} counts={cardCounts} canEdit={canCreate} message={message}/>:section==='approvals'?<><Approvals key={`${company.id}:waiting`} reviews={(openReviews||[]) as OpenReview[]} openWaits={(openWaits||[]) as {card_id:number,waiting:number}[]} me={user.id} canCreate={canCreate} alone={company.work_mode==='alone'} cardAgents={cardAgents} agents={((await db.rpc('company_agents',{c:company.id})).data||[]) as {person_id:string,role:string,granted:boolean}[]} slug={slug} company={company.id} cards={workData[0]?.data || []} activity={activityRows.sort((a,b)=>b.id-a.id) as WorkActivity[]} creatives={workData[2]?.data || []} versions={versions} attachments={(workData[4]?.data || []).map(({id,card_id,comment_id,name,content_type})=>({id,card_id,comment_id,name,content_type}))} projects={(await db.from('work_projects').select('id,name').eq('company_id',company.id).order('id')).data || []} message={waitingFailure} members={(workMembers || []) as unknown as WorkMember[]} approvableIds={myVisibleCards.map(c=>c.id)} waiting={waitingItems} assigned={assignedCards} ruleDecision={ruleDecision}/></>:section==='skills'?<Skills company={company.id} slug={slug} agents={skillAgents} manage={manage} refused={query.refused} failed={!!query.failed}/>:section==='agents'?<div className="stack"><CompanyHermesAgents key={company.id} company={company.id} owner={canOwner} initial={companyHermesAgents || []}/>{canOwner&&<AgentAccess company={company.id} slug={slug} agents={accessAgents || []} grants={accessGrants || []} message={message}/>}</div>:section==='usage'?<Usage slug={slug} rows={usageRows}/>:section==='settings/members'?<Members members={(members || []) as unknown as Parameters<typeof Members>[0]['members']} audit={audit || []} slug={slug} company={company.id} manage={manage} canOwner={canOwner} message={message} invited={invitedEmail}/>:section==='home'?<Home slug={slug} companyId={company.id} agentCards={homeAgentCards.error?null:(homeAgentCards.data||[]) as unknown as NonNullable<Parameters<typeof Home>[0]['agentCards']>} cards={workData[0]?.error?null:workData[0]?.data || []} activity={workData[1]?.error?null:activityRows as WorkActivity[]} members={(workMembers || []) as unknown as Parameters<typeof Home>[0]['members']} approvalCount={approvalsAvailable?myVisibleCards.length:null}/>:<section className="panel"><h2>{title}</h2><EmptyState icon={Inbox} message={placeholders[section]?t(placeholders[section]):t('noDataToDisplayYet')}/></section>}</main></Shell>;
}
