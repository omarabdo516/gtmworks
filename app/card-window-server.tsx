import { drawnAt, type LogRow } from '@/lib/activity-log.mjs';
import type { I18n, Language } from '@/lib/i18n.mjs';
import type { supabase } from '@/lib/supabase';
import { LogDays } from '@/app/c/[slug]/log/log-client';
import { LogEntry, logAnchor, logColumns, logPeople } from '@/app/c/[slug]/log/entries';
import { PageIcon } from '@/app/c/[slug]/log/icons';
import { ShellIcon } from '@/components/shell-icon';
import { ModelLine } from './model-line';
import { modelCauseOf, modelCauseOutcomes, modelOutcome } from '@/lib/model-causes';
import { isThumbnail } from '@/lib/attachments.mjs';
import type { CardMade, CardWindowData } from './card-window';

type Db=Awaited<ReturnType<typeof supabase>>;
// How many of a Card's log rows its window reads, comments and activity together; an older one is on the Log page.
const windowRows=500;
const comment=(row:LogRow)=>row.source==='work_comments'||row.action==='note_reply';

// An open Card's window (#678; design-reference-card: renderCardWin): its comments, drawn as the log draws a Member's
// note (with its files, its edit rule, and an Agent's reply under it), its Activity (every other row of its log, and the
// line that nothing in it is ever deleted), its Runs (each Agent called in a comment), its Versions under Result, its
// files, and who made it from where. Read as the signed-in person, so the database shows only what they may see: a
// Card made in another Member's private chat shows who made it and nothing that was said.
export async function cardWindow(db:Db,{company,card,slug,me,canWrite,t,language}:{company:string,card:number,slug:string,me:string,canWrite:boolean,t:I18n['t'],language:Language}):Promise<CardWindowData> {
 const [{data},{data:runRows},people,{data:fileRows},{data:creativeRows},{data:versionRows},made]=await Promise.all([
  db.from('company_log').select(logColumns).eq('company_id',company).eq('card_id',card).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(windowRows),
  db.from('note_runs').select('note_id,agent_id,agent_name,outcome,created_at,closed_at').eq('company_id',company).eq('card_id',card).order('created_at'),
  logPeople(db,company,[card]),
  db.from('work_attachments').select('id,comment_id,name,content_type,created_by,created_at').eq('company_id',company).eq('card_id',card).order('id'),
  db.from('work_creatives').select('id,name').eq('company_id',company).eq('card_id',card).order('id'),
  db.from('work_versions').select('id,creative_id,path,created_at').eq('company_id',company).eq('card_id',card).order('id'),
  madeOf(db,company,card,slug),
 ]);
 const rows=(data||[]) as LogRow[]; const drawn=drawnAt();
 const runs=((runRows||[]) as {note_id:number,agent_id:string,agent_name:string,outcome:string|null,created_at:string,closed_at:string|null}[]);
 const causes=new Map(runs.filter(run=>modelCauseOutcomes.includes(run.outcome as never)).flatMap(run=>{ const cause=modelCauseOf(run.outcome); return cause?[[`note-${run.note_id}` as string,{cause,agent:run.agent_name}] as const]:[]; }));
 const {data:owner}=causes.size?await db.rpc('is_company_owner',{c:company}):{data:false};
 const files=((fileRows||[]) as {id:number,comment_id:number|null,name:string,content_type:string,created_by:string,created_at:string}[]);
 const nameOf=(id:string)=>people.members.find(member=>member.person_id===id)?.people?.name?.trim().split(/\s+/)[0]||'';
 const why=(anchor:string|undefined)=>{ const run=anchor?causes.get(anchor):undefined;
  return run&&<p className="note" role="alert" data-outcome={modelOutcome(run.cause)}><ModelLine cause={run.cause} agent={run.agent} slug={slug} owner={owner===true}/></p>; };
 // A comment's files under it, each opened from the Company's own storage: a picture as its thumbnail, any other file
 // as its chip.
 const filesOf=(row:LogRow)=>{ const own=row.source==='work_comments'?files.filter(file=>file.comment_id===row.source_id):[];
  return own.length>0&&<ul className="attachments">{own.map(file=>{ const href=`/c/${slug}/files/${file.id}`;
   return <li key={file.id}>{isThumbnail(file.content_type)?<a href={href} target="_blank" rel="noreferrer"><img src={href} alt={file.name}/></a>
    :<a className="file-chip" href={href} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)}><ShellIcon name="clip"/><bdi dir="auto">{file.name}</bdi></a>}</li>; })}</ul>; };
 // While the Agent a comment called works on it, the comment says so under it (#22), until its reply lands as a row of its own.
 const workingOn=(row:LogRow)=>{ const run=row.source==='work_comments'?runs.find(r=>r.note_id===row.source_id&&!r.outcome):undefined;
  return run&&<p className="lg-meta note-working"><span className="dot dot--working" aria-hidden="true"/><bdi>{run.agent_name}</bdi> · {t('noteWorkingOn',(row.actor_name||'').trim().split(/\s+/)[0])}</p>; };
 const drawList=(list:LogRow[],empty:string,forever:boolean)=><div className="lg-wrap">
  {list.length?<LogDays oldestFirst items={list.map(row=>({id:row.id,at:row.created_at,anchor:logAnchor(row),node:<><LogEntry row={row} people={people} me={me} slug={slug} company={company} canWrite={canWrite} drawnAt={drawn} t={t} language={language} cardLink={false}/>{filesOf(row)}{workingOn(row)}{why(logAnchor(row))}</>}))}/>
   :<div className="panel-card"><p className="panel-empty">{empty}</p></div>}
  {forever&&<p className="lg-forever"><PageIcon name="lock"/><span>{t('cwForever')}</span></p>}
 </div>;
 const comments=rows.filter(comment); const activity=rows.filter(row=>!comment(row));
 // Versions under Result, newest first, each numbered in the order it was added and opened through a link that lasts an hour.
 const versions=(versionRows||[]) as {id:number,creative_id:number,path:string,created_at:string}[];
 const signed=versions.length?await db.storage.from('creatives').createSignedUrls(versions.map(v=>v.path),3600):{data:[]};
 const creatives=(creativeRows||[]) as {id:number,name:string}[];
 return {id:card,working:runs.some(run=>!run.outcome),
  comments:drawList(comments,t('cwNoComments'),false),commentCount:comments.length,
  activity:drawList(activity,t('cwNoActivity'),true),activityCount:activity.length,
  runs:runs.map((run,n)=>({n:n+1,note:run.note_id,agent:run.agent_id,name:run.agent_name,outcome:run.outcome,start:run.created_at,end:run.closed_at})),
  files:files.map(file=>({id:file.id,name:file.name,by:nameOf(file.created_by),at:file.created_at})),
  creative:creatives[0]?.id??null,
  versions:versions.map((v,n)=>({id:v.id,n:n+1,name:creatives.find(c=>c.id===v.creative_id)?.name||v.path.split('/').pop()||'',url:signed.data?.[n]?.signedUrl||null,at:v.created_at})).reverse(),
  made};
}

// Who made a Card and where (design-reference-card: cwSideHTML's "Made by" row). A Card made in a chat names the chat's
// person; the chat itself is a link only for that person, since a Conversation reads only for its own person (RLS), and
// anyone else gets its lock and that person's first name, and nothing that was said. A Card a channel put on the board
// links to the channel for its members and is a lock for the others. Any other Card is from the board, made by the one
// whose row made it.
async function madeOf(db:Db,company:string,card:number,slug:string):Promise<CardMade> {
 const {data:current}=await db.from('work_cards').select('conversation_id,channel_id,title,created_at').eq('company_id',company).eq('id',card).maybeSingle();
 const {data:row}=current?{data:current}:await db.rpc('archived_cards',{c:company}).select('conversation_id,channel_id,title,created_at').eq('id',card).maybeSingle();
 const {data:first}=await db.from('company_log').select('actor_name').eq('company_id',company).eq('card_id',card).in('action',['card_created','idea_added','channel_card_added']).order('id').limit(1).maybeSingle();
 const at=typeof row?.created_at==='string'?row.created_at:'';
 const by=typeof first?.actor_name==='string'?first.actor_name.trim().split(/\s+/)[0]:'';
 if(row?.conversation_id) {
  const [{data:own},{data:person}]=await Promise.all([
   db.from('conversations').select('id').eq('company_id',company).eq('id',row.conversation_id).maybeSingle(),
   db.rpc('card_chat_person',{c:company,card}),
  ]);
  const name=typeof person==='string'?person:'';
  return own?{from:'chat',by:name||by,at,href:`/c/${slug}/conversations/${own.id}`}:{from:'chat-private',by:name,at,person:name};
 }
 if(row?.channel_id) {
  const {data:channel}=await db.from('channels').select('id,name').eq('company_id',company).eq('id',row.channel_id).maybeSingle();
  const name=typeof channel?.name==='string'?channel.name:typeof row.title==='string'?row.title:'';
  return channel?{from:'channel',by,at,href:`/c/${slug}/channels/${channel.id}`,name}:{from:'channel-locked',by,at,name};
 }
 return {from:'board',by,at};
}
