import Link from '@/lib/link';
import { AgentFace } from '@/components/agent-face';
import { NoteText } from '@/app/note-edit';
import { describeEntry, type LogRow, type LogValue } from '@/lib/activity-log.mjs';
import type { I18n, Language } from '@/lib/i18n.mjs';
import type { supabase } from '@/lib/supabase';
import { LogTime } from './log-client';
import { PageIcon, SystemMark } from './icons';

type Db=Awaited<ReturnType<typeof supabase>>;
export const logColumns='id,created_at,actor_kind,actor_id,actor_name,subject,card_id,person_id,agent_id,action,details,body,source,source_id';
// face: the id a Company Agent's face is asked for by (components/agent-face); its look outlives the Agent, so a removed
// Agent's line keeps its face. A person, and an old row a legacy role agent wrote (spec #695), show their name's first
// letter.
export type Who={kind:'person'|'agent'|'system',id:string|null,name:string,face?:string};
export type LogPeople=Awaited<ReturnType<typeof logPeople>>;

// The names and faces a log line needs, read as the signed-in person: the Company's Members, removed ones too (the
// legacy role agents' memberships among them), its Agents and the Cards the rows point at.
export async function logPeople(db:Db,company:string,cardIds:number[]) {
 const [{data:members},{data:former},{data:agents},{data:current},{data:archived}]=await Promise.all([
  db.from('members').select('person_id,removed_at,people(name)').eq('company_id',company),
  // A removed membership's row is hidden from its readers; its name still reads (spec #695).
  db.rpc('former_member_names',{c:company}),
  db.from('hermes_agents').select('id,name,connection_id,is_default').eq('company_id',company),
  cardIds.length?db.from('work_cards').select('id,title').eq('company_id',company).in('id',[...new Set(cardIds)]):Promise.resolve({data:[] as {id:number,title:string}[]}),
  // An archived Card (#670) keeps its title in the log: it is read apart, as current Cards leave it out.
  cardIds.length?db.rpc('archived_cards',{c:company}).select('id,title').in('id',[...new Set(cardIds)]):Promise.resolve({data:[] as {id:number,title:string}[]}),
 ]);
 const rows=[...(members||[]) as unknown as {person_id:string,removed_at:string|null,people:{name:string}|null}[],
  ...((former||[]) as {person_id:string,name:string}[]).map(({person_id,name})=>({person_id,removed_at:'removed',people:{name}}))];
 return {
  members:rows,
  agents:(agents||[]) as {id:string,name:string,connection_id:string,is_default:boolean}[],
  cards:new Map([...((current||[]) as {id:number,title:string}[]),...((archived||[]) as {id:number,title:string}[])].map(card=>[card.id,card.title])),
 };
}

export function whoOf(row:LogRow,people:LogPeople,t:I18n['t']):Who {
 if(row.actor_kind==='system'||!row.actor_id) return {kind:'system',id:null,name:t('logSystemName')};
 const member=people.members.find(member=>member.person_id===row.actor_id);
 const agent=people.agents.find(agent=>agent.id===row.actor_id);
 const name=member?.people?.name||agent?.name||row.actor_name||t('logSomeone');
 if(row.actor_kind==='agent') return {kind:'agent',id:row.actor_id,name,face:member?undefined:agent?.id??row.actor_id};
 return {kind:'person',id:row.actor_id,name};
}

export function WhoFace({who,size=28}:{who:Who,size?:number}) {
 if(who.kind==='system') return <SystemMark size={size}/>;
 if(who.face) return <span className="lg-face" aria-hidden="true"><AgentFace agent={who.face} name={who.name} size={size}/></span>;
 return <span className="lg-av" style={{'--av':`${size}px`} as React.CSSProperties} aria-hidden="true">{Array.from(who.name.trim())[0]||'?'}</span>;
}

// One line of the log (design-reference: entryHTML): who · what «object», the change from → to, a note, and when,
// with a link to its Card.
function entryLine(row:LogRow,people:LogPeople,t:I18n['t'],language:Language) {
 const nameOf=(id:string)=>people.members.find(member=>member.person_id===id)?.people?.name;
 const agentName=(id:string)=>people.agents.find(agent=>agent.id===id)?.name;
 const line=describeEntry(row,{name:nameOf,agentName});
 const value=(v:LogValue)=>'text' in v?v.text:t(v.key,...(v.values||[]));
 const [key,...args]=line.act;
 const act=t(key,...args.map(arg=>{const text=value(arg); return language==='en'&&'key' in arg?text.toLowerCase():text;}));
 return {...line,act,from:line.from&&value(line.from),to:line.to&&value(line.to)};
}

const quoteIn=(language:Language)=>(text:string)=>language==='ar'?`«${text}»`:`“${text}”`;

export function FeedText({row,people,t,language}:{row:LogRow,people:LogPeople,t:I18n['t'],language:Language}) {
 const who=whoOf(row,people,t); const line=entryLine(row,people,t,language);
 const object=line.obj||(row.card_id!=null?people.cards.get(row.card_id):undefined);
 return <><b><bdi>{who.name}</bdi></b> {line.act}{object&&<> <bdi>{quoteIn(language)(object)}</bdi></>}{line.to&&<>: <bdi>{line.to}</bdi></>}</>;
}

// A Member's note (#22) is drawn by NoteText, which adds "Edited", Edit while it is open to its writer, and "Locked".
export function LogEntry({row,people,me,slug,company,canWrite,drawnAt,t,language,cardLink=true,faceSize}:{row:LogRow,people:LogPeople,me:string,slug:string,company:string,canWrite:boolean,drawnAt:number,t:I18n['t'],language:Language,cardLink?:boolean,faceSize?:number}) {
 const who=whoOf(row,people,t);
 const line=entryLine(row,people,t,language);
 const quote=quoteIn(language);
 const cardTitle=row.card_id!=null?people.cards.get(row.card_id):undefined;
 const meta=<><LogTime value={row.created_at}/>{cardLink&&row.card_id!=null&&cardTitle!=null&&<><span className="lg-dot" aria-hidden="true">·</span><Link className="link-btn lg-card" href={`/c/${slug}/work/board/${row.card_id}`} aria-label={t('logOpenCard',cardTitle)}><PageIcon name="board"/><bdi className="od-truncate">{cardTitle}</bdi></Link></>}</>;
 const note=row.source==='work_comments'&&row.actor_kind==='person'&&row.source_id!=null;
 return <>
  <WhoFace who={who} size={faceSize}/>
  <div className="lg-body">
   <p className="lg-line"><b className="lg-name"><bdi>{who.name}</bdi></b>{who.id===me&&<> <span className="lg-you">{t('logYou')}</span></>} <span className="lg-act">{line.act}</span>{line.obj&&<> <span className="lg-obj"><bdi>{quote(line.obj)}</bdi></span></>}</p>
   {line.to!=null&&<p className="lg-change">{line.from!=null&&<><span className="sr-only">{t('logFrom')}</span><span className="lg-val lg-val--old" dir="auto">{line.from}</span><PageIcon name="arrow" className="lg-arrow"/><span className="sr-only">{t('logTo')}</span></>}<span className="lg-val" dir="auto">{line.to}</span></p>}
   {note?<NoteText note={{id:row.source_id!,body:row.body||'',created_at:row.created_at,edited_at:typeof row.details?.edited_at==='string'?row.details.edited_at:null,author_id:row.actor_id}}
     me={me} canWrite={canWrite} company={company} slug={slug} drawnAt={drawnAt} surface="log" meta={meta}/>
    :<>{line.note!=null&&<p className="lg-note" dir="auto">{line.note}</p>}<p className="lg-meta">{meta}</p></>}
  </div>
 </>;
}

// The anchor a mention in "Waiting on you" opens: a note's row is reached by its note's number.
export const logAnchor=(row:LogRow)=>row.source==='work_comments'&&row.source_id!=null?`note-${row.source_id}`:undefined;
