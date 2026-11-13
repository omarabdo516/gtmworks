import Link from '@/lib/link';
import { AgentFace } from '@/components/agent-face';
import { agentIdentities } from '@/lib/agent-identities';
import { describeEntry, type LogRow, type LogValue } from '@/lib/activity-log.mjs';
import type { I18n, Language } from '@/lib/i18n.mjs';
import type { supabase } from '@/lib/supabase';
import { LogTime } from './log-client';
import { PageIcon, SystemMark } from './icons';

type Db=Awaited<ReturnType<typeof supabase>>;
export const logColumns='id,created_at,actor_kind,actor_id,actor_name,subject,card_id,person_id,agent_id,action,details,body';
export type Who={kind:'person'|'agent'|'system',id:string|null,name:string,role?:string};
export type LogPeople=Awaited<ReturnType<typeof logPeople>>;

// The names and faces a log line needs, read as the signed-in person: the Company's Members (people and role Agents),
// its Agents and the Cards the rows point at.
export async function logPeople(db:Db,company:string,cardIds:number[]) {
 const [{data:members},{data:agents},identities,{data:cards}]=await Promise.all([
  db.from('members').select('person_id,agent_role,removed_at,people(name)').eq('company_id',company),
  db.from('hermes_agents').select('id,name,connection_id,is_default').eq('company_id',company),
  agentIdentities(),
  cardIds.length?db.from('work_cards').select('id,title').eq('company_id',company).in('id',[...new Set(cardIds)]):Promise.resolve({data:[] as {id:number,title:string}[]}),
 ]);
 const rows=(members||[]) as unknown as {person_id:string,agent_role:string|null,removed_at:string|null,people:{name:string}|null}[];
 return {
  members:rows,
  agents:(agents||[]) as {id:string,name:string,connection_id:string,is_default:boolean}[],
  identities,
  cards:new Map(((cards||[]) as {id:number,title:string}[]).map(card=>[card.id,card.title])),
 };
}

export function whoOf(row:LogRow,people:LogPeople,t:I18n['t']):Who {
 if(row.actor_kind==='system'||!row.actor_id) return {kind:'system',id:null,name:t('logSystemName')};
 const member=people.members.find(member=>member.person_id===row.actor_id);
 const identity=people.identities.find(agent=>agent.id===row.actor_id);
 const name=identity?.name||member?.people?.name||row.actor_name||t('logSomeone');
 if(row.actor_kind==='agent') return {kind:'agent',id:row.actor_id,name,role:identity?.role||member?.agent_role||undefined};
 return {kind:'person',id:row.actor_id,name};
}

export function WhoFace({who,size=28}:{who:Who,size?:number}) {
 if(who.kind==='system') return <SystemMark size={size}/>;
 if(who.kind==='agent'&&who.role&&who.id) return <span className="lg-face" aria-hidden="true"><AgentFace id={who.id} role={who.role} name={who.name} size={size}/></span>;
 return <span className="lg-av" style={{'--av':`${size}px`} as React.CSSProperties} aria-hidden="true">{Array.from(who.name.trim())[0]||'?'}</span>;
}

// One line of the log (design-reference: entryHTML): who · what «object», the change from → to, a note, and when,
// with a link to its Card.
export function entryLine(row:LogRow,people:LogPeople,t:I18n['t'],language:Language) {
 const nameOf=(id:string)=>people.identities.find(agent=>agent.id===id)?.name||people.members.find(member=>member.person_id===id)?.people?.name;
 const agentName=(id:string)=>people.agents.find(agent=>agent.id===id)?.name;
 const line=describeEntry(row,{name:nameOf,agentName});
 const value=(v:LogValue)=>'text' in v?v.text:t(v.key);
 const [key,...args]=line.act;
 const act=t(key,...args.map(arg=>{const text=value(arg); return language==='en'&&'key' in arg?text.toLowerCase():text;}));
 return {...line,act,from:line.from&&value(line.from),to:line.to&&value(line.to)};
}

export function LogEntry({row,people,me,slug,t,language,cardLink=true}:{row:LogRow,people:LogPeople,me:string,slug:string,t:I18n['t'],language:Language,cardLink?:boolean}) {
 const who=whoOf(row,people,t);
 const line=entryLine(row,people,t,language);
 const quote=(text:string)=>language==='ar'?`«${text}»`:`“${text}”`;
 const cardTitle=row.card_id!=null?people.cards.get(row.card_id):undefined;
 return <>
  <WhoFace who={who}/>
  <div className="lg-body">
   <p className="lg-line"><b className="lg-name"><bdi>{who.name}</bdi></b>{who.id===me&&<> <span className="lg-you">{t('logYou')}</span></>} <span className="lg-act">{line.act}</span>{line.obj&&<> <span className="lg-obj"><bdi>{quote(line.obj)}</bdi></span></>}</p>
   {line.to!=null&&<p className="lg-change">{line.from!=null&&<><span className="sr-only">{t('logFrom')}</span><span className="lg-val lg-val--old" dir="auto">{line.from}</span><PageIcon name="arrow" className="lg-arrow"/><span className="sr-only">{t('logTo')}</span></>}<span className="lg-val" dir="auto">{line.to}</span></p>}
   {line.note!=null&&<p className="lg-note" dir="auto">{line.note}</p>}
   <p className="lg-meta"><LogTime value={row.created_at}/>{cardLink&&row.card_id!=null&&cardTitle!=null&&<><span className="lg-dot" aria-hidden="true">·</span><Link className="link-btn lg-card" href={`/c/${slug}/work/board/${row.card_id}`} aria-label={t('logOpenCard',cardTitle)}><PageIcon name="board"/><bdi className="od-truncate">{cardTitle}</bdi></Link></>}</p>
  </div>
 </>;
}
