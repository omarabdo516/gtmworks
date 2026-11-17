import { drawnAt, logPageSize, type LogRow } from '@/lib/activity-log.mjs';
import type { I18n, Language } from '@/lib/i18n.mjs';
import type { supabase } from '@/lib/supabase';
import { LogDays } from '@/app/c/[slug]/log/log-client';
import { LogEntry, logAnchor, logColumns, logPeople } from '@/app/c/[slug]/log/entries';
import { PageIcon } from '@/app/c/[slug]/log/icons';
import { conversationColumns } from '@/lib/conversations';
import { conversationRecord } from '@/lib/conversation-record';
import { agentAppStates } from '@/lib/company-app-items';
import type { CardSheetData } from './card-sheet';
import type { SheetChat } from './card-sheet-chat';

type Db=Awaited<ReturnType<typeof supabase>>;

// An open Card's sheet (#116; design-reference: cardLogHTML): its rows of the Activity log, the newest page of them shown
// oldest first, each drawn as the Activity log draws it, and whether an Agent called in one of its notes is still
// working. Read as the signed-in person, so the database shows only what they may see.
export async function cardSheet(db:Db,{company,card,slug,me,canWrite,t,language}:{company:string,card:number,slug:string,me:string,canWrite:boolean,t:I18n['t'],language:Language}):Promise<CardSheetData> {
 const [{data,count},{data:open},people,chat]=await Promise.all([
  db.from('company_log').select(logColumns,{count:'exact'}).eq('company_id',company).eq('card_id',card).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(logPageSize),
  db.from('note_runs').select('note_id').eq('company_id',company).eq('card_id',card).is('outcome',null).limit(1),
  logPeople(db,company,[card]),
  sheetChat(db,company,card,me),
 ]);
 const rows=(data||[]) as LogRow[]; const total=count??rows.length; const drawn=drawnAt();
 const log=<div className="lg-wrap">
  {total>rows.length&&<p className="lg-more">{t('logShowing',rows.length)}</p>}
  {rows.length?<LogDays oldestFirst items={rows.map(row=>({id:row.id,at:row.created_at,anchor:logAnchor(row),node:<LogEntry row={row} people={people} me={me} slug={slug} company={company} canWrite={canWrite} drawnAt={drawn} t={t} language={language} cardLink={false}/>}))}/>
   :<div className="panel-card"><p className="panel-empty">{t('sheetLogEmpty')}</p></div>}
  <p className="lg-forever"><PageIcon name="lock"/><span>{t('sheetLogForever')}</span></p>
 </div>;
 return {id:card,log,count:total,working:!!open?.length,chat};
}

// The Card's Chat tab (#145). Its Conversation reads only for its own person (RLS), who gets the record the
// Conversation's page draws; anyone else who sees the Card gets the Agent and the person's first name, and no message.
// A Card with no chat gets its Agent when the reader sees it, to start one with.
async function sheetChat(db:Db,company:string,card:number,me:string):Promise<SheetChat> {
 const {data:row}=await db.from('work_cards').select('agent_id,conversation_id').eq('company_id',company).eq('id',card).maybeSingle();
 if(!row) return {kind:'none'};
 if(row.conversation_id) {
  const {data:found}=await db.from('conversations').select(conversationColumns).eq('id',row.conversation_id).eq('company_id',company).maybeSingle();
  if(found) return {kind:'own',record:await conversationRecord(db,me,company,found,agent=>agentAppStates(company,agent))};
 }
 const {data:agent}=row.agent_id?await db.from('hermes_agents').select('id,name,connection_id').eq('company_id',company).eq('id',row.agent_id).maybeSingle():{data:null};
 if(!agent) return {kind:'none'};
 if(!row.conversation_id) return {kind:'empty',agent};
 const {data:person}=await db.rpc('card_chat_person',{c:company,card});
 return {kind:'theirs',agent,person:typeof person==='string'?person:''};
}
