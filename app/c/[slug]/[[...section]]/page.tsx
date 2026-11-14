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
import Members from './members';
import Home from './home';
import Agents from './agents';
import HermesConnections, { type Connection } from './hermes-connections';
import AgentAccess from './agent-access';
import CompanyHermesAgents from './company-hermes-agents';
import Skills from './skills';
import SkillLessons from './lessons';
import Work from './work';
import Projects from './projects';
import Usage, { type UsageDay } from './usage';
import { Approvals, ApprovalSettings } from './approvals';
import { type WorkActivity, type WorkMember } from '@/lib/work-activity';

export default async function CompanyPage({params,searchParams}:{params:Promise<{slug:string,section?:string[]}>,searchParams:Promise<{message?:string,refused?:string,failed?:string,section?:string,agent?:string,period?:string}>}) { const {t}=await getI18n();
 const {slug,section:parts}=await params; const cardId=parts?.[0]==='work' && parts?.[1]==='board' && parts?.[2] ? Number(parts[2]) : undefined; const section=cardId?'work/board':parts?.join('/') || 'home'; const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 // Signing in returns to the page asked for, with the settings overlay's own state (section, agent, period) kept, so a
 // link to Settings, Subscription and models opens there; other query values (one-time notices) are not carried.
 if(!user) { const asked=await searchParams; const kept=new URLSearchParams(Object.entries({section:asked.section,agent:asked.agent,period:asked.period}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString();
  redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/${parts?.join('/') || 'home'}${kept?`?${kept}`:''}`)}`); }
 const {data:companies}=await db.from('companies').select('id,slug,name').order('name'); const company=companies?.find(c=>c.slug===slug); if(!company || !sections[section]) notFound(); const title=t(sections[section]);
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 const canCreate=canCreateCard({role:membership?.role});
 // Settings is the full-window overlay (#26, app/settings-overlay.tsx) over the company's frame, which stays behind it
 // inert, as the reference's dialog covers the workspace.
 if(section==='settings') { const roleName=(({owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')}) as Record<string,string>)[String(membership?.role || '')]||'';
  return <><div className="contents" inert><Shell company={company} companies={companies || []} section={section} title={title} personName={person?.name || user.email || ''} role={roleName} owner={membership?.role==='owner'}><main className="content"/></Shell></div>
   <SettingsOverlay slug={slug} company={company} userId={user.id} role={membership?.role || ''} personName={person?.name || user.email || ''} query={await searchParams}/></>; }
 const {data:hermesConnections}=section==='settings/agents'?await db.from('hermes_connections').select('id,address,profile,state,version,features,unreachable_since').eq('company_id',company.id):{data:[]};
 const manage=['owner','manager'].includes(membership?.role || ''); const canOwner=membership?.role==='owner';
 const {data:members}=section==='settings/members'?await db.from('members').select('person_id,role,agent_role,grant_publishing,grant_money_figures,grant_customer_data,people(name)').eq('company_id',company.id).order('role'): {data:[]};
 const {data:agentMembers}=section==='settings/agents'&&canOwner?await db.from('members').select('person_id,role,agent_role,removed_at,people(name)').eq('company_id',company.id):{data:[]};
 const {data:companyHermesAgents}=section==='agents'?await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name'):{data:[]};
 const {data:availableConnections}=section==='agents'&&canOwner?await db.from('hermes_connections').select('id,address,profile').eq('state','connected'):{data:[]};
 const {data:accessAgents}=section==='agents'&&canOwner?await db.from('agents').select('id,role').order('role'):{data:[]};
 const {data:accessGrants}=section==='agents'&&canOwner?await db.from('agent_grants').select('agent_id,revoked_at').eq('company_id',company.id):{data:[]};
 const {data:skillRows}=section==='skills'?await db.from('skills').select('id,slug,source,skill_versions(version,name,description,permissions)').eq('company_id',company.id).order('slug'):{data:[]};
 const {data:skillEnabled}=section==='skills'?await db.from('skill_enablements').select('skill_id,agent_id').eq('company_id',company.id):{data:[]};
 const {data:skillAgents}=section==='skills'?await db.rpc('skill_agents',{c:company.id}):{data:[]};
 const {data:lessonRows}=section==='approvals'&&manage?await db.from('skill_lessons').select('id,card_id,lesson,reason,skills(slug)').eq('company_id',company.id).eq('status','pending').order('id'):{data:[]};
 const {data:agentKeys}=section==='settings/agents'&&canOwner?await db.from('agent_keys').select('id,person_id,created_at,last_used_at,revoked_at').eq('company_id',company.id).order('created_at',{ascending:false}):{data:[]};
 const {data:webhook}=section==='settings/agents'&&canOwner?await db.from('agent_webhooks').select('url').eq('company_id',company.id).maybeSingle():{data:null};
 const {data:deliveries}=section==='settings/agents'&&canOwner?await db.from('webhook_deliveries').select('id,status,attempts,created_at,last_status,last_error').eq('company_id',company.id).order('created_at',{ascending:false}).limit(20):{data:[]};
 const {data:audit}=section==='settings/members'?await db.from('member_audit').select('id,actor_id,actor_name,person_id,person_name,action,created_at,before_data,after_data').eq('company_id',company.id).order('created_at',{ascending:false}):{data:[]};
 const {data:usageRows}=section==='usage'?await db.rpc('usage_by_day'):{data:[]};
 const query=await searchParams; const message=query.message;
 const {steps,cards:myCards,items:waitingItems,available:approvalsAvailable}=await approvalQueue(db,company.id,user.id,membership?.role || '');
 const isWork=section.startsWith('work/')||section==='settings/work';
 const workData=(isWork||section==='home'||section==='approvals')?await Promise.all(['work_stages','work_labels','work_cards','work_checklist','work_activity','work_creatives','work_versions','work_card_labels','work_assignees','work_attachments'].map(t=>db.from(t).select('*').eq('company_id',company.id))):[];
 const {data:workMembers}=(isWork||section==='home'||section==='approvals')?await db.from('members').select('person_id,role,agent_role,people(name)').is('removed_at',null).eq('company_id',company.id):{data:[]};
 const {data:workAgents}=isWork?await db.rpc('company_agents',{c:company.id}):{data:[]};
 const {data:projects}=(isWork||section==='projects')?await db.from('work_projects').select('id,name,goal,status').eq('company_id',company.id).order('id'):{data:[]};
 const {data:filedCards}=section==='projects'?await db.from('work_cards').select('project_id').eq('company_id',company.id).not('project_id','is',null):{data:[]};
 const cardCounts:Record<number,number>={}; for(const c of filedCards||[]) cardCounts[c.project_id]=(cardCounts[c.project_id]||0)+1;
 const versionRows=workData[6]?.data || [];
 const signed=versionRows.length ? await db.storage.from('creatives').createSignedUrls(versionRows.map(v=>v.path),3600) : {data:[]};
 const versions=versionRows.map((v,i)=>({...v,url:signed.data?.[i]?.signedUrl || null}));
 const activityRows=await Promise.all((workData[4]?.data || []).map(async a=>{
  if(typeof a.evidence!=='string' || !a.evidence.startsWith('file:')) return a;
  const {data}=await db.storage.from('creatives').createSignedUrl(a.evidence.slice(5),3600);
  return {...a,evidence_url:data?.signedUrl || null};
 }));
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const openCard=workData[2]?.data?.find(c=>c.id===cardId);
 const settingsLeaf:Record<string,string>={'settings/members':'members','settings/work':'workSettings','settings/agents':'agents'};
 const crumbs=openCard?[{label:t('work'),href:`/c/${slug}/work/board`},{label:openCard.title}]:settingsLeaf[section]?[{label:company.name,href:`/c/${slug}/home`},{label:t('settings'),href:`/c/${slug}/settings`},{label:t(settingsLeaf[section])}]:undefined;
 return <Shell company={company} companies={companies || []} section={section} title={title} crumbs={crumbs} personName={person?.name || user.email || ''} role={roleNames[membership?.role || ''] || ''} owner={membership?.role==='owner'} approvalCount={waitingItems.length} cardId={workData[2]?.data?.some(c=>c.id===cardId)?cardId:undefined}><main className="content">{isWork?<><Work key={`${company.id}:${section==='work/new'?'new':'work'}`} initialCreating={section==='work/new'} canCreate={canCreate} agents={(workAgents||[]) as {person_id:string,role:string,granted:boolean}[]} slug={slug} company={company.id} section={section==='work/new'?'work/board':section} cardId={cardId} stages={(workData[0]?.data || []).sort((a,b)=>a.position-b.position)} labels={workData[1]?.data || []} cards={workData[2]?.data || []} items={workData[3]?.data || []} activity={activityRows.sort((a,b)=>b.id-a.id)} creatives={workData[5]?.data || []} versions={versions} cardLabels={workData[7]?.data || []} assignees={workData[8]?.data || []} attachments={(workData[9]?.data || []).map(({id,card_id,comment_id,name,content_type})=>({id,card_id,comment_id,name,content_type}))} projects={projects || []} message={message} members={(workMembers || []) as unknown as Parameters<typeof Work>[0]['members']} approvableIds={myCards.map(c=>c.id)} waiting={(await approvalQueue(db,company.id,user.id,membership?.role || '')).items}/>{section==='settings/work'&&<ApprovalSettings slug={slug} company={company.id} steps={steps} members={(workMembers || []) as unknown as Parameters<typeof ApprovalSettings>[0]['members']} manage={manage}/>}</>:section==='projects'?<Projects slug={slug} company={company.id} projects={projects || []} counts={cardCounts} canEdit={canCreate} message={message}/>:section==='approvals'?<><Approvals key={`${company.id}:waiting`} canCreate={canCreate} agents={((await db.rpc('company_agents',{c:company.id})).data||[]) as {person_id:string,role:string,granted:boolean}[]} slug={slug} company={company.id} stages={(workData[0]?.data || []).sort((a,b)=>a.position-b.position)} labels={workData[1]?.data || []} cards={workData[2]?.data || []} items={workData[3]?.data || []} activity={activityRows.sort((a,b)=>b.id-a.id) as WorkActivity[]} creatives={workData[5]?.data || []} versions={versions} cardLabels={workData[7]?.data || []} assignees={workData[8]?.data || []} attachments={(workData[9]?.data || []).map(({id,card_id,comment_id,name,content_type})=>({id,card_id,comment_id,name,content_type}))} projects={(await db.from('work_projects').select('id,name').eq('company_id',company.id).order('id')).data || []} message={message} members={(workMembers || []) as unknown as WorkMember[]} approvableIds={myCards.map(c=>c.id)} waiting={(await approvalQueue(db,company.id,user.id,membership?.role || '')).items}/><SkillLessons company={company.id} slug={slug} lessons={(lessonRows || []) as unknown as Parameters<typeof SkillLessons>[0]['lessons']} cards={(workData[2]?.data || []).map(({id,title})=>({id,title}))} failed={!!query.failed}/></>:section==='skills'?<Skills company={company.id} slug={slug} skills={(skillRows || []) as unknown as Parameters<typeof Skills>[0]['skills']} enabled={skillEnabled || []} agents={(skillAgents || []) as Parameters<typeof Skills>[0]['agents']} refused={query.refused} failed={!!query.failed}/>:section==='agents'?<div className="stack"><CompanyHermesAgents key={company.id} company={company.id} slug={slug} owner={canOwner} initial={companyHermesAgents || []} connections={availableConnections || []}/>{canOwner&&<AgentAccess company={company.id} slug={slug} agents={accessAgents || []} grants={accessGrants || []} message={message}/>}</div>:section==='settings/agents'?<Agents message={message} company={company.id} slug={slug} owner={canOwner} webhookUrl={webhook?.url || ''} deliveries={deliveries || []} members={(agentMembers || []) as unknown as Parameters<typeof Agents>[0]['members']} keys={agentKeys || []}><HermesConnections company={company.id} owner={canOwner} initial={(hermesConnections||[]) as Connection[]}/></Agents>:section==='usage'?<Usage slug={slug} rows={(usageRows||[]) as UsageDay[]}/>:section==='settings/members'?<Members members={(members || []) as unknown as Parameters<typeof Members>[0]['members']} audit={audit || []} slug={slug} company={company.id} manage={manage} canOwner={canOwner} message={message}/>:section==='home'?<Home slug={slug} cards={workData[2]?.error?null:workData[2]?.data || []} stages={workData[0]?.error?null:workData[0]?.data || []} activity={workData[4]?.error?null:activityRows as WorkActivity[]} members={(workMembers || []) as unknown as Parameters<typeof Home>[0]['members']} approvalCount={approvalsAvailable?myCards.length:null}/>:<section className="panel"><h2>{title}</h2><EmptyState icon={Inbox} message={placeholders[section]?t(placeholders[section]):t('noDataToDisplayYet')}/></section>}</main></Shell>;
}
