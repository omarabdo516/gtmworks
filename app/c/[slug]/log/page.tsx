import '../../../log.css';
import { notFound, redirect } from 'next/navigation';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { logCursor, logPageSize, parseBefore, parseCard, parseWho, type LogRow } from '@/lib/activity-log.mjs';
import { LogDays, LogFilters } from './log-client';
import { LogEntry, logColumns, logPeople } from './entries';
import { PageIcon } from './icons';

// A page shows logPageSize rows, newest first; "Older entries" opens the next page. The count names every row that matches.
const shown=logPageSize;

// The Company's Activity log (#11, design-reference: renderLogPage): every change, newest first, filtered by who did
// it and by Card. Read with the signed-in person's session, so the database shows only their own Company's rows.
export default async function ActivityLogPage({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<{who?:string,card?:string,before?:string}>}) {
 const {t,language}=await getI18n(); const {slug}=await params; const query=await searchParams;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 // Signing in comes back to the same filters.
 const filters=new URLSearchParams(Object.entries(query).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/log${filters.size?`?${filters}`:''}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company) notFound();
 const who=parseWho(query.who); const card=parseCard(query.card); const before=parseBefore(query.before);
 const matching=(head:boolean)=>{
  let rows=db.from('company_log').select(logColumns,{count:'exact',head}).eq('company_id',company.id);
  if(who.kind==='system') rows=rows.eq('actor_kind','system');
  if(who.kind==='person') rows=rows.eq('actor_kind','person').eq('actor_id',who.id);
  if(who.kind==='agent') rows=rows.or(`and(actor_kind.eq.agent,actor_id.eq.${who.id}),agent_id.eq.${who.id}`);
  if(card!=null) rows=rows.eq('card_id',card);
  return rows;
 };
 // A page after the first starts below the cursor: an earlier moment, or the same moment and a smaller id.
 const page=before?matching(false).lte('created_at',before.at).or(`created_at.lt."${before.at}",id.lt.${before.id}`):matching(false);
 const [{data:person},{data:membership},{data:logRows,count:left},{count},{count:total},{data:cardRows}]=await Promise.all([
  db.from('people').select('name').eq('id',user.id).single(),
  db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle(),
  page.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(shown),
  before?matching(true):Promise.resolve({count:null}),
  db.from('company_log').select('id',{count:'exact',head:true}).eq('company_id',company.id),
  db.from('company_log').select('card_id').eq('company_id',company.id).not('card_id','is',null).limit(5000),
 ]);
 const entries=(logRows||[]) as LogRow[];
 const loggedCards=[...new Set((cardRows||[]).map(row=>row.card_id as number))];
 const people=await logPeople(db,company.id,[...loggedCards,...entries.flatMap(row=>row.card_id!=null?[row.card_id]:[])]);
 const {items:waitingItems}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const live=people.members.filter(member=>!member.removed_at);
 const peopleOptions=live.filter(member=>!member.agent_role).map(member=>({value:`p:${member.person_id}`,label:member.people?.name||t('logSomeone')}));
 const agentOptions=[...live.filter(member=>member.agent_role).map(member=>({value:`a:${member.person_id}`,label:people.identities.find(agent=>agent.id===member.person_id)?.name||member.people?.name||t('logSomeone')})),
  ...people.agents.map(agent=>({value:`a:${agent.id}`,label:agent.name}))];
 const cardOptions=loggedCards.filter(id=>people.cards.has(id)).map(id=>({value:String(id),label:people.cards.get(id)!}));
 const whoValue=who.kind==='system'?'s':who.kind==='all'?'all':`${who.kind==='person'?'p':'a'}:${who.id}`;
 // Every matching row is counted, whatever page is open; `left` counts this page and the rows older than it.
 const n=(before?count:left)??entries.length;
 const older=(left??0)>entries.length&&entries.length>0;
 const pageLink=(cursor:string|null)=>{ const next=new URLSearchParams(); if(whoValue!=='all') next.set('who',whoValue); if(card!=null) next.set('card',String(card)); if(cursor) next.set('before',cursor); return `/c/${slug}/log${next.size?`?${next}`:''}`; };
 return <Shell company={company} companies={companies||[]} section="log" title={t('activityLog')} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingItems.length}>
  <main className="log-page">
   <div className="lgp">
    <header className="page-head"><div className="od-field"><h1 className="page-title">{t('activityLog')}</h1><p className="page-sub"><bdi>{t('logSub',company.name)}</bdi></p></div></header>
    <LogFilters slug={slug} who={whoValue} card={card!=null?String(card):'all'} people={peopleOptions} agents={agentOptions} cards={cardOptions} count={n}/>
    <div className="lgp-body">
     {entries.length?<LogDays items={entries.map(row=>({id:row.id,at:row.created_at,node:<LogEntry row={row} people={people} me={user.id} slug={slug} t={t} language={language}/>}))}/>
      :<div className="panel-card lgp-empty"><p className="panel-empty">{total?t('logNoMatch'):t('logEmpty')}</p>{total?<a className="btn btn--secondary btn--sm" href={`/c/${slug}/log`}>{t('logShowAll')}</a>:null}</div>}
     {(older||before)&&<nav className="lg-pages" aria-label={t('logPages')}>
      <p className="lg-more">{t(before?'logShowingOlder':'logShowing',entries.length)}</p>
      {before&&<Link className="btn btn--secondary btn--sm" href={pageLink(null)}>{t('logNewest')}</Link>}
      {older&&<Link className="btn btn--secondary btn--sm lg-older" rel="next" href={pageLink(logCursor(entries[entries.length-1]))}>{t('logOlder')}</Link>}
     </nav>}
     <p className="lg-forever"><PageIcon name="lock"/><span>{t('logForever')}</span></p>
    </div>
   </div>
  </main>
 </Shell>;
}
