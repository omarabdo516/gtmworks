import { getI18n } from '@/lib/i18n-server';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { companyReader } from '@/lib/company-reader';
import { sections, placeholders } from '@/lib/navigation';
import { EmptyState } from '@/components/paperclip/EmptyState';
import { Inbox } from 'lucide-react';
import Page from '@/app/page-frame';
import { approvalQueue } from '@/lib/approval-queue';
import { canCreateCard } from '@/lib/card-permissions.mjs';
import { orderAgents } from '@/lib/sidebar.mjs';
import Members from './members';
import { pageAlert } from '@/lib/page-alert.mjs';
import Home from './home';
import CompanyHermesAgents from './company-hermes-agents';
import Skills from './skills';
import { companySkillAgents } from '@/lib/company-skill-items';
import Board from './board';
import BoardViews from './board-views';
import Waiting from './waiting';
import Projects from './projects';
import Usage from './usage';
import { managedUsage } from '@/lib/company-app-items';

export default async function CompanyPage({params,searchParams}:{params:Promise<{slug:string,section?:string[]}>,searchParams:Promise<{message?:string,refused?:string,failed?:string,section?:string,agent?:string,period?:string,card?:string,decided?:string,item?:string}>}) { const {t}=await getI18n();
 const {slug,section:parts}=await params; const oldCard=parts?.[0]==='work'&&parts?.[1]==='board'&&parts.length>2; const section=oldCard?'work/board':parts?.join('/') || 'home'; const db=await supabase(); const reader=await companyReader(slug);
 // Signing in returns to the page asked for, with the settings overlay's own state (section, agent, period), the Card
 // open over the board (card) kept, so a link to Settings, Subscription and models or to a Card opens there; other query
 // values (one-time notices) are not carried.
 if(!reader) { const asked=await searchParams; const kept=new URLSearchParams(Object.entries({section:asked.section,agent:asked.agent,period:asked.period,card:asked.card}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString();
  redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/${parts?.join('/') || 'home'}${kept?`?${kept}`:''}`)}`); }
 const {user,company,role}=reader; if(!company || !sections[section]) notFound(); const title=t(sections[section]);
 // A Company worked alone has no Member permissions to set (#10); its Invite link form is in the settings overlay.
 if(section==='settings/members'&&company.work_mode==='alone') redirect(`/c/${slug}/settings?section=members`);
 const canCreate=canCreateCard({role:role});
 const manage=['owner','manager'].includes(role); const canOwner=role==='owner';
 // Usage is the Owner's and the Managers' (#32), checked here for the page as the database checks each read.
 if(section==='usage'&&!manage) notFound();
 // The board (spec #831): the Company's Engine's own Kanban board. Its frame is drawn here from nothing the Engine keeps,
 // and the browser reads its Cards after (ADR 0030); a person who is no Member found no Company above. A Card opens over
 // it at ?card=<its id> in the Engine's Card window (#835), which the board draws and reads itself. New card (/work/new) is
 // the board with its New card open (#836); a Viewer gets the board alone. The old board is switched off (#846): an old
 // Card's own address (/work/board/<number>) leads to the board.
 if(oldCard) redirect(`/c/${slug}/work/board`);
 if(section==='work/new'||section==='work/board') return <Page title={title}><main className="content"><Board key={company.id} company={company.id} slug={slug} writer={canCreate} reviewer={manage} me={user.id} creating={section==='work/new'}/></main></Page>;
 // The list and the calendar read the same board (#845): their frame is drawn here and their Cards are the board's read.
 if(section==='work/list'||section==='work/calendar') return <Page title={title}><main className="content"><BoardViews key={`${company.id}:${section}`} company={company.id} slug={slug} view={section==='work/list'?'list':'calendar'} writer={canCreate}/></main></Page>;
 const {data:members}=section==='settings/members'?await db.from('members').select('person_id,role,grant_publishing,grant_money_figures,grant_customer_data,people(name)').eq('company_id',company.id).order('role'): {data:[]};
 // The Owner's Invite link form on the legacy Members page (#953): the Agents they may show beside the main one.
 const {data:inviteAgents}=section==='settings/members'&&canOwner?await db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',company.id).order('is_default',{ascending:false}).order('name'):{data:[]};
 const {data:companyHermesAgents}=section==='agents'?await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name'):{data:[]};
 const skillAgents=section==='skills'?await companySkillAgents(company.id):null;
 const {data:audit}=section==='settings/members'?await db.from('member_audit').select('id,actor_id,actor_name,person_id,person_name,action,created_at,before_data,after_data').eq('company_id',company.id).order('created_at',{ascending:false}):{data:[]};
 // Each managed Company's token use in the last 30 days, read from the bundled Engine (#347, #32).
 const usageRows=section==='usage'?await managedUsage(user.id,30):[];
 const query=await searchParams; const message=pageAlert(query.message,t);
 if(section==='approvals') {
  const waitingFailures:Record<string,string>={rule:'waitingRuleFailed',access:'waitingAccessFailed','request-engineNotReady':'waitingRequestNotReady','request-engineUnreachable':'waitingRequestUnreachable',
   'request-notMade':'waitingRequestNotMade','request-answered':'waitingRequestAnswered','request-notFound':'waitingRequestAnswered','request-reasonMissing':'waitingRequestReasonMissing',
   'change-notApplied':'waitingChangeNotApplied','change-answered':'waitingChangeAnswered','change-notFound':'waitingChangeAnswered','change-reasonLong':'waitingChangeReasonLong',
   'change-cannotApply':'waitingChangeCannotApply','change-applying':'waitingChangeApplying','change-busy':'waitingChangeBusy','change-writtenLate':'waitingChangeWrittenLate','change-reasonMissing':'waitingChangeReasonMissing','change-editInvalid':'waitingChangeEditInvalid'};
  const failed=query.failed||''; const waitingFailure=Object.hasOwn(waitingFailures,failed)?t(waitingFailures[failed]):failed.startsWith('request-')?t('waitingRequestFailed'):failed.startsWith('change-')?t('waitingChangeFailed'):message;
  // A decided learning suggestion comes back with its outcome and its Agent's name (#169): the address names the waiting
  // item, never the Agent, and the page reads its name here as the person reading the list.
  const decidedItem=(query.decided==='approve'||query.decided==='reject')&&/^[1-9]\d{0,17}$/.test(query.item||'')?Number(query.item):null;
  const [{items},{data:agentRows},{data:me},{data:decided}]=await Promise.all([
   approvalQueue(db,company.id,user.id,role),
   db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id).order('name'),
   db.from('people').select('name').eq('id',user.id).maybeSingle(),
   decidedItem!=null?db.from('waiting_items').select('body,agent_rules(hermes_agents(name))').eq('company_id',company.id).eq('id',decidedItem).maybeSingle():Promise.resolve({data:null}),
  ]);
  // The suggestion's Agent, through its rule; the item's own line only when the rule names none (as #169 read it).
  const decidedRow=decided as {body?:string|null,agent_rules:{hermes_agents:{name:string}|null}|null}|null;
  const ruleDecision=decidedItem!=null?{approve:query.decided==='approve',agent:decidedRow?.agent_rules?.hermes_agents?.name||String(decidedRow?.body||'')}:undefined;
  // The Company's main Agent comes first in the sidebar's order; a Member's Agent request names it (#17).
  const lead=orderAgents((agentRows||[]) as {id:string,connection_id:string,name:string,speciality:string,is_default:boolean}[])[0]?.name||'Lead';
  const mine=((me as {name?:string}|null)?.name||'').trim();
  return <Page title={title}><main className="content"><Waiting key={`${company.id}:waiting`} company={company.id} writer={canCreate} reviewer={manage} me={user.id} items={items} message={waitingFailure} ruleDecision={ruleDecision}
   people={{slug,company:company.id,lead,alone:company.work_mode==='alone',myNames:mine?[mine,mine.split(/\s+/)[0]]:[]}}/></main></Page>;
 }
 const {data:projects}=section==='projects'?await db.from('work_projects').select('id,name,goal,status').eq('company_id',company.id).order('id'):{data:[]};
 const waitingRows=section==='home'?await approvalQueue(db,company.id,user.id,role).then(({rows,available})=>available?rows:null):null;
 const settingsLeaf:Record<string,string>={'settings/members':'members'};
 const crumbs=settingsLeaf[section]?[{label:company.name,href:`/c/${slug}/home`},{label:t('settings'),href:`/c/${slug}/settings`},{label:t(settingsLeaf[section])}]:undefined;
 return <Page title={title} crumbs={crumbs}><main className="content">{section==='projects'?<Projects slug={slug} company={company.id} projects={projects || []} canEdit={canCreate} message={message}/>:section==='skills'?<Skills company={company.id} slug={slug} agents={skillAgents} manage={manage} refused={query.refused} failed={!!query.failed}/>:section==='agents'?<div className="stack"><CompanyHermesAgents key={company.id} company={company.id} owner={canOwner} initial={companyHermesAgents || []}/></div>:section==='usage'?<Usage slug={slug} rows={usageRows}/>:section==='settings/members'?<Members members={(members || []) as unknown as Parameters<typeof Members>[0]['members']} agents={(inviteAgents || []) as unknown as Parameters<typeof Members>[0]['agents']} audit={audit || []} slug={slug} company={company.id} manage={manage} canOwner={canOwner} me={user.id} message={message}/>:section==='home'?<Home slug={slug} companyId={company.id} waitingRows={waitingRows}/>:<section className="panel"><h2>{title}</h2><EmptyState icon={Inbox} message={placeholders[section]?t(placeholders[section]):t('noDataToDisplayYet')}/></section>}</main></Page>;
}
