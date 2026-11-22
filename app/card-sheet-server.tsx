import { drawnAt, logPageSize, type LogRow } from '@/lib/activity-log.mjs';
import type { I18n, Language } from '@/lib/i18n.mjs';
import type { supabase } from '@/lib/supabase';
import { LogDays } from '@/app/c/[slug]/log/log-client';
import { LogEntry, logAnchor, logColumns, logPeople } from '@/app/c/[slug]/log/entries';
import { PageIcon } from '@/app/c/[slug]/log/icons';
import { conversationColumns } from '@/lib/conversations';
import { channelRecord } from '@/lib/channels';
import { conversationRecord } from '@/lib/conversation-record';
import { agentAppStates, agentSessionTurns } from '@/lib/company-app-items';
import { ModelLine } from './model-line';
import { modelCauseOf, modelOutcome } from '@/lib/model-causes';
import type { CardSheetData } from './card-sheet';
import type { SheetChat } from './card-sheet-chat';

type Db=Awaited<ReturnType<typeof supabase>>;

// An open Card's sheet (#116; design-reference: cardLogHTML): its rows of the Activity log, the newest page of them shown
// oldest first, each drawn as the Activity log draws it, and whether an Agent called in one of its notes is still
// working. A note whose Agent's Run ended for a cause a retry cannot fix (#530) says why under it, as the Card's own
// view does. Read as the signed-in person, so the database shows only what they may see.
export async function cardSheet(db:Db,{company,card,slug,me,canWrite,t,language}:{company:string,card:number,slug:string,me:string,canWrite:boolean,t:I18n['t'],language:Language}):Promise<CardSheetData> {
 const [{data,count},{data:open},{data:refused},people,chat]=await Promise.all([
  db.from('company_log').select(logColumns,{count:'exact'}).eq('company_id',company).eq('card_id',card).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(logPageSize),
  db.from('note_runs').select('note_id').eq('company_id',company).eq('card_id',card).is('outcome',null).limit(1),
  db.from('note_runs').select('note_id,agent_name,outcome').eq('company_id',company).eq('card_id',card).in('outcome',['no_model','no_credit','key_refused','model_missing']),
  logPeople(db,company,[card]),
  sheetChat(db,company,card,me),
 ]);
 const rows=(data||[]) as LogRow[]; const total=count??rows.length; const drawn=drawnAt();
 const causes=new Map(((refused||[]) as {note_id:number,agent_name:string,outcome:string}[]).flatMap(run=>{ const cause=modelCauseOf(run.outcome); return cause?[[`note-${run.note_id}` as string,{cause,agent:run.agent_name}] as const]:[]; }));
 const {data:owner}=causes.size?await db.rpc('is_company_owner',{c:company}):{data:false};
 const why=(anchor:string|undefined)=>{ const run=anchor?causes.get(anchor):undefined;
  return run&&<p className="note" role="alert" data-outcome={modelOutcome(run.cause)}><ModelLine cause={run.cause} agent={run.agent} slug={slug} owner={owner===true}/></p>; };
 const log=<div className="lg-wrap">
  {total>rows.length&&<p className="lg-more">{t('logShowing',rows.length)}</p>}
  {rows.length?<LogDays oldestFirst items={rows.map(row=>({id:row.id,at:row.created_at,anchor:logAnchor(row),node:<><LogEntry row={row} people={people} me={me} slug={slug} company={company} canWrite={canWrite} drawnAt={drawn} t={t} language={language} cardLink={false}/>{why(logAnchor(row))}</>}))}/>
   :<div className="panel-card"><p className="panel-empty">{t('sheetLogEmpty')}</p></div>}
  <p className="lg-forever"><PageIcon name="lock"/><span>{t('sheetLogForever')}</span></p>
 </div>;
 return {id:card,log,count:total,working:!!open?.length,chat};
}

// The Card's Chat tab (#145, #151). A chat's Conversation reads only for its own person (RLS), who gets the record the
// Conversation's page draws; anyone else who sees the Card gets the Agent and the person's first name, and no message.
// A Card with no chat gets its Agent when the reader sees it, to start one with. A Card a channel put on the board shows
// that channel to its members; a Member outside it gets the lock, the channel's name and no message.
async function sheetChat(db:Db,company:string,card:number,me:string):Promise<SheetChat> {
 const {data:row}=await db.from('work_cards').select('agent_id,conversation_id,channel_id,title').eq('company_id',company).eq('id',card).maybeSingle();
 if(!row) return {kind:'none'};
 if(row.channel_id) {
  const channel=await channelRecord(db,me,company,row.channel_id);
  if(channel) return {kind:'channel',record:channel};
  return {kind:'channel-locked',name:typeof row.title==='string'?row.title:''};
 }
 if(row.conversation_id) {
  const {data:found}=await db.from('conversations').select(conversationColumns).eq('id',row.conversation_id).eq('company_id',company).maybeSingle();
  if(found) return {kind:'own',record:await conversationRecord(db,me,company,found,agent=>agentAppStates(company,agent),(agent,session)=>agentSessionTurns(company,agent,session))};
 }
 const {data:agent}=row.agent_id?await db.from('hermes_agents').select('id,name,connection_id').eq('company_id',company).eq('id',row.agent_id).maybeSingle():{data:null};
 if(!agent) return {kind:'none'};
 if(!row.conversation_id) return {kind:'empty',agent};
 const {data:person}=await db.rpc('card_chat_person',{c:company,card});
 return {kind:'theirs',agent,person:typeof person==='string'?person:''};
}
