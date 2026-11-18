import { getI18n } from '@/lib/i18n-server';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { sections, placeholders } from '@/lib/navigation';
import { EmptyState } from '@/components/paperclip/EmptyState';
import { Inbox } from 'lucide-react';
import Shell from '@/app/shell';
import SettingsOverlay from '@/app/settings-overlay';
import { approvalQueue } from '@/lib/approval-queue';
import { canCreateCard } from '@/lib/card-permissions.mjs';
import { boardCardColumns } from '@/lib/board-columns.mjs';
import { currentNoteText, drawnAt, parseCard } from '@/lib/activity-log.mjs';
import { cardSheet } from '@/app/card-sheet-server';
import { orderAgents } from '@/lib/sidebar.mjs';
import Members from './members';
import Home from './home';
import AgentAccess from './agent-access';
import CompanyHermesAgents from './company-hermes-agents';
import Skills from './skills';
import { companySkillAgents } from '@/lib/company-skill-items';
import Work from './work';
import { workAction, undoMove } from './work-actions';
import Projects from './projects';
import Usage from './usage';
import { ownedUsage } from '@/lib/company-app-items';
import { Approvals, ApprovalSettings } from './approvals';
import { type WorkActivity, type WorkMember } from '@/lib/work-activity';

export default async function CompanyPage({params,searchParams}:{params:Promise<{slug:string,section?:string[]}>,searchParams:Promise<{message?:string,refused?:string,failed?:string,section?:string,agent?:string,period?:string,card?:string,show?:string,idea?:string,decided?:string,invited?:string}>}) { const {t,language}=await getI18n();
 const {slug,section:parts}=await params; const cardId=parts?.[0]==='work' && parts?.[1]==='board' && parts?.[2] ? Number(parts[2]) : undefined; const section=cardId?'work/board':parts?.join('/') || 'home'; const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 // Signing in returns to the page asked for, with the settings overlay's own state (section, agent, period), the Card
 // open over the board (card) and the Card a chat shows on the board (show) kept, so a link to Settings, Subscription
 // and models or to a Card opens there; other query values (one-time notices) are not carried.
 if(!user) { const asked=await searchParams; const kept=new URLSearchParams(Object.entries({section:asked.section,agent:asked.agent,period:asked.period,card:asked.card,show:asked.show}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString();
  redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/${parts?.join('/') || 'home'}${kept?`?${kept}`:''}`)}`); }
 const {data:companies}=await db.from('companies').select('id,slug,name,work_mode').order('name'); const company=companies?.find(c=>c.slug===slug); if(!company || !sections[section]) notFound(); const title=t(sections[section]);
 // A Company worked alone has no Member permissions to set (#10); its invitation form is in the settings overlay.
 if(section==='settings/members'&&company.work_mode==='alone') redirect(`/c/${slug}/settings`);
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 const canCreate=canCreateCard({role:membership?.role});
 // Settings is the full-window overlay (#26, app/settings-overlay.tsx) over the company's frame, which stays behind it
 // inert, as the reference's dialog covers the workspace.
 if(section==='settings') { const roleName=(({owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')}) as Record<string,string>)[String(membership?.role || '')]||'';
  return <><div className="contents" inert><Shell company={company} companies={companies || []} personId={user.id} section={section} title={title} personName={person?.name || user.email || ''} role={roleName} owner={membership?.role==='owner'}><main className="content"/></Shell></div>
   <SettingsOverlay slug={slug} company={company} userId={user.id} role={membership?.role || ''} personName={person?.name || user.email || ''} workMode={company.work_mode} query={await searchParams}/></>; }
 const manage=['owner','manager'].includes(membership?.role || ''); const canOwner=membership?.role==='owner';
 const {data:members}=section==='settings/members'?await db.from('members').select('person_id,role,agent_role,grant_publishing,grant_money_figures,grant_customer_data,people(name)').eq('company_id',company.id).order('role'): {data:[]};
 const {data:companyHermesAgents}=section==='agents'?await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name'):{data:[]};
 const {data:accessAgents}=section==='agents'&&canOwner?await db.from('agents').select('id,role').order('role'):{data:[]};
 const {data:accessGrants}=section==='agents'&&canOwner?await db.from('agent_grants').select('agent_id,revoked_at').eq('company_id',company.id):{data:[]};
 const skillAgents=section==='skills'?await companySkillAgents(company.id):null;
 const {data:audit}=section==='settings/members'?await db.from('member_audit').select('id,actor_id,actor_name,person_id,person_name,action,created_at,before_data,after_data').eq('company_id',company.id).order('created_at',{ascending:false}):{data:[]};
 // Each owned Company's token use in the last 30 days, read from Hermes (#347).
 const usageRows=section==='usage'?await ownedUsage(user.id,30):[];
 const query=await searchParams; const message=query.message;
 const waitingFailures:Record<string,string>={rule:'waitingRuleFailed','request-engineNotReady':'waitingRequestNotReady','request-engineUnreachable':'waitingRequestUnreachable',
  'request-notMade':'waitingRequestNotMade','request-answered':'waitingRequestAnswered','request-notFound':'waitingRequestAnswered','request-reasonMissing':'waitingRequestReasonMissing'};
 const failed=query.failed||''; const waitingFailure=Object.hasOwn(waitingFailures,failed)?t(waitingFailures[failed]):failed.startsWith('request-')?t('waitingRequestFailed'):message;
 const {steps,cards:myCards,visible:myVisibleCards,items:waitingItems,count:waitingCount,available:approvalsAvailable}=await approvalQueue(db,company.id,user.id,membership?.role || '');
 const isWork=section.startsWith('work/')||section==='settings/work';
 // The board, the board under a new Card (/work/new) and the board opened on Waiting on you (/approvals).
 const onBoard=section==='work/board'||section==='work/new'||section==='approvals';
 // An idea just added comes back on the board with its own address (#188): the Card flashes and the board toasts it.
 const ideaAdded=onBoard&&query.idea==='1';
 // A decided learning suggestion comes back to the board with its outcome and its Agent's name (#169).
 const ruleDecision=section==='approvals'&&(query.decided==='approve'||query.decided==='reject')?{approve:query.decided==='approve',agent:query.agent||''}:undefined;
 // The board reads its Cards through board_cards (#190): no Card of an Agent hidden from the reader, each with the
 // Company Agents that worked on it (crew). Other places list Cards as before.
 // Typed as the table read it stands in for, whose rows the untyped client leaves open.
 const read=(t:string)=>db.from(t).select('*').eq('company_id',company.id);
 const cards=()=>db.from('work_cards').select(boardCardColumns).eq('company_id',company.id) as unknown as ReturnType<typeof read>;
 const boardCards=()=>db.rpc('board_cards',{c:company.id}).select(`${boardCardColumns},crew`) as unknown as ReturnType<typeof read>;
 // A Card's own Agent and the board's chips (#144, #190): the Company's Agents the reader sees, in the sidebar's order.
 const [workData,{data:agentRows}]=await Promise.all([
  (isWork||section==='home'||section==='approvals')?Promise.all(['work_stages','work_labels','work_cards','work_checklist','work_activity','work_creatives','work_versions','work_card_labels','work_assignees','work_attachments'].map(t=>t==='work_cards'?onBoard?boardCards():cards():read(t))):[],
  onBoard?db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name'):{data:[]},
 ]);
 const cardAgents=orderAgents((agentRows||[]) as {id:string,connection_id:string,name:string,speciality:string,is_default:boolean}[]);
 // The Card list is capped at the Data API's row limit; the reader's own pending approvals were read by id
 // (approvalQueue, company-scoped), so one past the cap still reaches Waiting on you and its board column.
 if(workData[2]?.data) { const known=new Set(workData[2].data.map((c:{id:number})=>c.id)); const missing=(onBoard?myVisibleCards:myCards).filter(c=>!known.has(c.id));
  if(onBoard&&missing.length) workData[2].data.push(...((await boardCards().in('id',missing.map(c=>c.id))).data||[])); else workData[2].data.push(...missing); }
 // A Card open over the board (#116) is named in the board's address; one the reader's own board does not hold opens nothing.
 const sheetId=section==='work/board'&&!cardId?parseCard(query.card):null;
 // A chat's corner pill opens the board on its Card (#144).
 const shownId=section==='work/board'&&!cardId?parseCard(query.show)??undefined:undefined;
 // The Card list is capped, so a Card the address names (open over the board, or shown from a chat) is read by id (the
 // reader's own rights, this Company) when the list missed it.
 for(const named of [sheetId,shownId]) if(named!=null&&workData[2]?.data&&!workData[2].data.some(c=>c.id===named)) { const {data:asked}=await boardCards().eq('id',named).maybeSingle(); if(asked) workData[2].data.push(asked); }
 const sheet=sheetId!=null&&workData[2]?.data?.some(c=>c.id===sheetId)?await cardSheet(db,{company:company.id,card:sheetId,slug,me:user.id,canWrite:canCreate,t,language}):undefined;
 const {data:workMembers}=(isWork||section==='home'||section==='approvals')?await db.from('members').select('person_id,role,agent_role,people(name)').is('removed_at',null).eq('company_id',company.id):{data:[]};
 const {data:workAgents}=isWork?await db.rpc('company_agents',{c:company.id}):{data:[]};
 const {data:projects}=(isWork||section==='projects')?await db.from('work_projects').select('id,name,goal,status').eq('company_id',company.id).order('id'):{data:[]};
 const {data:filedCards}=section==='projects'?await db.from('work_cards').select('project_id').eq('company_id',company.id).not('project_id','is',null):{data:[]};
 const cardCounts:Record<number,number>={}; for(const c of filedCards||[]) cardCounts[c.project_id]=(cardCounts[c.project_id]||0)+1;
 const versionRows=workData[6]?.data || [];
 const signed=versionRows.length ? await db.storage.from('creatives').createSignedUrls(versionRows.map(v=>v.path),3600) : {data:[]};
 const versions=versionRows.map((v,i)=>({...v,url:signed.data?.[i]?.signedUrl || null}));
 const commentIds=(workData[4]?.data || []).filter(a=>a.action==='comment_added').map(a=>Number((a.details as {id?:unknown}|null)?.id)).filter(Number.isSafeInteger);
 const {data:currentComments}=commentIds.length?await db.from('work_comments').select('id,body').eq('company_id',company.id).in('id',[...new Set(commentIds)]):{data:[]};
 const activityRows=await Promise.all(currentNoteText(workData[4]?.data || [],(currentComments||[]) as {id:number,body:string}[]).map(async a=>{
  if(typeof a.evidence!=='string' || !a.evidence.startsWith('file:')) return a;
  const {data}=await db.storage.from('creatives').createSignedUrl(a.evidence.slice(5),3600);
  return {...a,evidence_url:data?.signedUrl || null};
 }));
 // An open Card's notes (#22): their current text (an edit changes it), the Runs their Agent mentions started, and the
 // Agents' replies in the log. Read as the signed-in person, so an Agent hidden from them and its replies are left out.
 const cardNotes=isWork&&cardId?await Promise.all([
  db.from('work_comments').select('id,body,edited_at,author_id,created_at').eq('company_id',company.id).eq('card_id',cardId),
  db.from('note_runs').select('note_id,agent_id,agent_name,outcome').eq('company_id',company.id).eq('card_id',cardId),
  db.from('company_log').select('actor_id,actor_name,body,details,created_at').eq('company_id',company.id).eq('card_id',cardId).eq('action','note_reply'),
  db.from('hermes_agents').select('id,name,connection_id').eq('company_id',company.id),
 ]).then(([comments,runs,replies,agents])=>({me:user.id,drawnAt:drawnAt(),comments:comments.data||[],runs:runs.data||[],agents:agents.data||[],
  replies:(replies.data||[]).map(r=>({reply_to:Number(r.details?.reply_to),actor_id:r.actor_id,actor_name:r.actor_name,body:r.body||'',created_at:r.created_at}))})):undefined;
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const openCard=workData[2]?.data?.find(c=>c.id===cardId);
 const settingsLeaf:Record<string,string>={'settings/members':'members','settings/work':'workSettings'};
 const crumbs=openCard?[{label:t('work'),href:`/c/${slug}/work/board`},{label:openCard.title}]:settingsLeaf[section]?[{label:company.name,href:`/c/${slug}/home`},{label:t('settings'),href:`/c/${slug}/settings`},{label:t(settingsLeaf[section])}]:undefined;
 return <Shell company={company} companies={companies || []} personId={user.id} section={section} title={title} crumbs={crumbs} personName={person?.name || user.email || ''} role={roleNames[membership?.role || ''] || ''} owner={membership?.role==='owner'} approvalCount={waitingCount} cardId={workData[2]?.data?.some(c=>c.id===cardId)?cardId:sheet?.id}><main className="content">{isWork?<><Work key={`${company.id}:${section==='work/new'?'new':'work'}`} workAction={workAction} undoMove={undoMove} me={user.id} initialCreating={section==='work/new'} canCreate={canCreate} alone={company.work_mode==='alone'} notes={cardNotes} agents={(workAgents||[]) as {person_id:string,role:string,granted:boolean}[]} slug={slug} company={company.id} section={section==='work/new'?'work/board':section} cardId={cardId} stages={(workData[0]?.data || []).sort((a,b)=>a.position-b.position)} labels={workData[1]?.data || []} cards={workData[2]?.data || []} items={workData[3]?.data || []} activity={activityRows.sort((a,b)=>b.id-a.id)} creatives={workData[5]?.data || []} versions={versions} cardLabels={workData[7]?.data || []} assignees={workData[8]?.data || []} attachments={(workData[9]?.data || []).map(({id,card_id,comment_id,name,content_type})=>({id,card_id,comment_id,name,content_type}))} projects={projects || []} message={message} members={(workMembers || []) as unknown as Parameters<typeof Work>[0]['members']} approvableIds={myVisibleCards.map(c=>c.id)} waiting={waitingItems} sheet={sheet} show={shownId} ideaAdded={ideaAdded} cardAgents={cardAgents || []}/>{section==='settings/work'&&<ApprovalSettings slug={slug} company={company.id} steps={steps} members={(workMembers || []) as unknown as Parameters<typeof ApprovalSettings>[0]['members']} manage={manage}/>}</>:section==='projects'?<Projects slug={slug} company={company.id} projects={projects || []} counts={cardCounts} canEdit={canCreate} message={message}/>:section==='approvals'?<><Approvals key={`${company.id}:waiting`} me={user.id} canCreate={canCreate} cardAgents={cardAgents} agents={((await db.rpc('company_agents',{c:company.id})).data||[]) as {person_id:string,role:string,granted:boolean}[]} slug={slug} company={company.id} stages={(workData[0]?.data || []).sort((a,b)=>a.position-b.position)} labels={workData[1]?.data || []} cards={workData[2]?.data || []} items={workData[3]?.data || []} activity={activityRows.sort((a,b)=>b.id-a.id) as WorkActivity[]} creatives={workData[5]?.data || []} versions={versions} cardLabels={workData[7]?.data || []} assignees={workData[8]?.data || []} attachments={(workData[9]?.data || []).map(({id,card_id,comment_id,name,content_type})=>({id,card_id,comment_id,name,content_type}))} projects={(await db.from('work_projects').select('id,name').eq('company_id',company.id).order('id')).data || []} message={waitingFailure} members={(workMembers || []) as unknown as WorkMember[]} approvableIds={myVisibleCards.map(c=>c.id)} waiting={waitingItems} ruleDecision={ruleDecision}/></>:section==='skills'?<Skills company={company.id} slug={slug} agents={skillAgents} manage={manage} refused={query.refused} failed={!!query.failed}/>:section==='agents'?<div className="stack"><CompanyHermesAgents key={company.id} company={company.id} owner={canOwner} initial={companyHermesAgents || []}/>{canOwner&&<AgentAccess company={company.id} slug={slug} agents={accessAgents || []} grants={accessGrants || []} message={message}/>}</div>:section==='usage'?<Usage slug={slug} rows={usageRows}/>:section==='settings/members'?<Members members={(members || []) as unknown as Parameters<typeof Members>[0]['members']} audit={audit || []} slug={slug} company={company.id} manage={manage} canOwner={canOwner} message={message} invited={query.invited}/>:section==='home'?<Home slug={slug} cards={workData[2]?.error?null:workData[2]?.data || []} stages={workData[0]?.error?null:workData[0]?.data || []} activity={workData[4]?.error?null:activityRows as WorkActivity[]} members={(workMembers || []) as unknown as Parameters<typeof Home>[0]['members']} approvalCount={approvalsAvailable?myVisibleCards.length:null}/>:<section className="panel"><h2>{title}</h2><EmptyState icon={Inbox} message={placeholders[section]?t(placeholders[section]):t('noDataToDisplayYet')}/></section>}</main></Shell>;
}
