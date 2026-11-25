'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { filesProblem } from '@/lib/attachments.mjs';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
import { driveNoteRuns } from '@/lib/channel-runs.mjs';
import type { Card, NewCardResult, PlaceResult, SaveResult, UndoResult } from './work';
import type { TickResult } from '@/app/card-description';
import type { DescriptionSaved, PictureUploaded } from '@/app/description-editor';
import { mergeDescriptions } from '@/lib/description-merge.mjs';
import { archiveIntents, type ArchiveAnswer, type ArchiveIntent, type ArchiveStopKind } from '@/lib/archive-stops';
import { archivedCardPage, type ArchivedCursor, type ArchivedPage, type ArchivedWant } from '@/lib/archived-cards';
// A note that calls an Agent starts its one Run at once (#22), as a channel message does; the worker reads the reply. A
// start that fails is left to the worker and logged without the note.
async function startNoteRun(note:number) {
 try { await driveNoteRuns(createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}),{message:note}); }
 catch(failure) { console.error('Note run not started:',note,failure instanceof Error?failure.message:'unknown error'); }
}
// Files chosen in a form are stored in the company's folder first; the database then records them against a message.
async function storeFiles(db: Awaited<ReturnType<typeof supabase>>, company: string, form: FormData, folder: string) {
 const chosen=form.getAll('files').filter((f): f is File=>f instanceof File && f.size>0);
 const files: {name:string,content_type:string,size:number,path:string}[]=[];
 if(filesProblem(chosen)) return {files,error:{message:'invalid files'}};
 for(const [i,file] of chosen.entries()) {
  const path=`${company}/${folder}/${i}`; const type=file.type || 'application/octet-stream';
  const uploaded=await db.storage.from('creatives').upload(path,file,{contentType:type});
  // A retried request (the same key) finds its files already stored.
  if(uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) return {files,error:uploaded.error};
  files.push({name:file.name.slice(0,255) || 'file',content_type:type.slice(0,127),size:file.size,path});
 }
 return {files,error:null};
}
// "Undo" on a move (#168): the database puts the Card back in the status, stage and place it left, as the person, and
// decides every refusal itself (undo_card_move, under move_card's rules, #676). The board says in a toast what happened, and is drawn again only when the Card really went back.
export const undoMove=withActionLog('undoMove',async function undoMove(form: FormData): Promise<UndoResult> {
 const db=await supabase(); const company=String(form.get('company')); const card=Number(form.get('card'));
 if(!await actionAllowed(db,'undoMove',company)) return {state:'refused'};
 const {data,error}=await db.rpc('undo_card_move',{c:company,card});
 if(!error) { revalidatePath(`/c/${String(form.get('slug'))}`,'layout'); return {state:'undone',column:String(data)}; }
 // A Card moved or decided meanwhile is the one expected refusal; anything else is a failure worth the log.
 if(String(error.message||'').includes('the card moved on')) return {state:'gone'};
 logActionFailure('undoMove',error,{form});
 return {state:'refused'};
});
// Archiving and restoring Cards (#670): the database checks the Role and who sees each Card, and answers the Cards it
// archived or restored; one it left (already archived, hidden, or another Company's) is not in the answer, so the board
// says so and offers no Undo for it. Every Card asked is tried, as many as the board showed: "Select all shown" and
// "Archive everything in Done" are one action under one confirmation. An archive answers its version, and its Undo
// (`undo`, with that version) restores only what that archive archived, so a Card someone restored and archived again
// meanwhile stays archived.
export const archiveCards=withActionLog('archiveCards',async function archiveCards(company:string,intent:ArchiveIntent|'undo',ids:number[],version?:string):Promise<ArchiveAnswer<number>> {
 const db=await supabase();
 const cards=[...new Set((Array.isArray(ids)?ids:[]).map(Number).filter(Number.isSafeInteger))];
 const undoing=intent==='undo'&&typeof version==='string'&&!Number.isNaN(Date.parse(version));
 if(!(archiveIntents.includes(intent as ArchiveIntent)||undoing)||!await actionAllowed(db,'archiveCards',company)) return {state:'refused'};
 // #671: before archiving, what it would stop, so the board asks once, naming each thing, only when something does.
 if(intent==='stops') {
  const {data,error}=await db.rpc('card_archive_stops',{c:company,cards});
  if(error) { logActionFailure('archiveCards',error); return {state:'refused'}; }
  return {state:'stops',stops:((data||[]) as {card:number,title:string,kind:ArchiveStopKind,agent:string|null,agent_id:string|null}[])
   .map(({card,...stop})=>({...stop,about:String(card)}))};
 }
 if(intent==='archive') {
  const {data,error}=await db.rpc('archive_cards',{c:company,cards});
  if(error) { logActionFailure('archiveCards',error); return {state:'refused'}; }
  const rows=(data||[]) as {card:number|string,archived_at:string}[];
  if(!rows.length) return {state:'refused'};
  revalidatePath('/c/[slug]','layout');
  return {state:'done',done:rows.map(row=>Number(row.card)),version:rows[0].archived_at};
 }
 const {data,error}=await db.rpc('restore_cards',undoing?{c:company,cards,archived:version}:{c:company,cards});
 if(error) { logActionFailure('archiveCards',error); return {state:'refused'}; }
 const done=((data||[]) as (number|string)[]).map(Number);
 if(done.length) revalidatePath('/c/[slug]','layout');
 return done.length?{state:'done',done}:{state:'refused'};
});
// A page of the board's archive list (#705): the next one after `after`, or the first of a search or a filter. Any
// Member reads it; archived_card_list keeps it to the archived Cards they see. A failed read is null.
export const archivedCardList=withActionLog('archivedCardList',async function archivedCardList(company:string,want:ArchivedWant,after:ArchivedCursor|null):Promise<ArchivedPage<Card>|null> {
 const db=await supabase();
 if(!await actionAllowed(db,'archivedCardList',company)) return null;
 const project=Number(want?.project);
 const cursor=after&&typeof after.at==='string'&&Number.isSafeInteger(after.id)?{at:after.at,id:after.id}:null;
 return archivedCardPage<Card>(db,company,{q:String(want?.q||'').slice(0,200),agent:typeof want?.agent==='string'&&want.agent?want.agent:null,
  project:want?.project!=null&&Number.isSafeInteger(project)?project:null},cursor);
});
// A Card placed where its person drops it, or one place up or down its column (#174): move_card moves its status (#676)
// and decides every refusal, and the board answers it in place, so a refused place neither leaves the board nor offers an "Undo" (#168).
export const placeMove=withActionLog('placeMove',async function placeMove(form: FormData): Promise<PlaceResult> {
 const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const evidence=String(form.get('evidence')||'').trim() || null;
 if(!await actionAllowed(db,'placeMove',company)) return {error:t('youCannotMoveTheCardToThisStage')};
 const {error}=await db.rpc('move_card',{c:company,card:Number(form.get('card')),target:String(form.get('column')||''),before_card:Number(form.get('before'))||null,evidence});
 if(!error) { revalidatePath(`/c/${String(form.get('slug'))}`,'layout'); return {ok:true}; }
 logActionFailure('placeMove',error,{form});
 // The refusals the board has words for; anything else is a failure worth its own log line.
 const reason=String(error.message||'');
 return {error:reason.includes('not permitted')?t('youCannotMoveTheCardToThisStage'):reason.includes('waiting is not placed by hand')?t('boardWaitingFillsItself'):t('couldNotSaveTheChangeCheckPermissionsAnd')};
});
// One property of a Card saved in its window as it changes (#678): the title, the publishing date, the Project or the
// assignee, over the value the window read. save_card refuses a save over a value someone changed meanwhile and answers
// the newer one, which the window shows in its place; it decides every other refusal too.
export const saveCard=withActionLog('saveCard',async function saveCard(form: FormData): Promise<SaveResult> {
 const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const field=String(form.get('field')||'');
 if(!await actionAllowed(db,'saveCard',company)) return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')};
 const {data,error}=await db.rpc('save_card',{c:company,card:Number(form.get('card')),field,value:String(form.get('value')??''),seen:String(form.get('seen')??'')});
 if(error) {
  const reason=String(error.message||'');
  if(reason.includes('title required')) return {error:t('cardTitleRequired')};
  logActionFailure('saveCard',error,{form});
  return {error:field==='assignee'&&/agent not found|assignee not a member|one assignee/.test(reason)?t('assigneeNotPermitted'):t('couldNotSaveTheChangeCheckPermissionsAnd')};
 }
 const answer=data as {saved:boolean,value:string};
 revalidatePath(`/c/${String(form.get('slug'))}`,'layout');
 return answer.saved?{saved:answer.value}:{stale:answer.value};
});
// One to-do of a Card's description ticked or unticked while reading (#679): the item is named by the line the reader saw
// it on and its text, so tick_card_todo finds it where it now is when the text changed meanwhile, and refuses it when it
// is gone. It answers instead of redirecting: the window shows the tick at once and takes it back on a refusal.
export const tickTodo=withActionLog('tickTodo',async function tickTodo(form: FormData): Promise<TickResult> {
 const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company'));
 if(!await actionAllowed(db,'tickTodo',company)) return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')};
 const {data,error}=await db.rpc('tick_card_todo',{c:company,card:Number(form.get('card')),line:Number(form.get('line')),item:String(form.get('item')??''),done:form.get('done')==='true'});
 if(error) {
  if(String(error.message||'').includes('to-do changed')) return {gone:true};
  logActionFailure('tickTodo',error,{form});
  return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')};
 }
 revalidatePath(`/c/${String(form.get('slug'))}`,'layout');
 return (data as {changed:boolean}).changed?{ticked:true}:{changed:false};
});
// The description written on the page (#680), saved by itself over the version its writer read. When it moved on
// meanwhile (another writer, or a tick), the text read, the newer text and this one are merged by lines and saved again:
// different lines both stay and a line both changed keeps both. The answer is the text now saved and its version, which
// the editor shows in place of its own when the merge changed it.
export const saveDescription=withActionLog('saveDescription',async function saveDescription(form: FormData): Promise<DescriptionSaved> {
 const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const card=Number(form.get('card'));
 if(!await actionAllowed(db,'saveDescription',company)) return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')};
 // A form sends its line breaks as CR LF; the description keeps Markdown's own.
 let body=String(form.get('body')??'').replace(/\r\n?/g,'\n'); let base=Number(form.get('base')); let merged=false; let conflicted=false;
 for(let attempt=0;attempt<4;attempt++) {
  const {data,error}=await db.rpc('save_card_description',{c:company,card,body,base});
  if(error) { logActionFailure('saveDescription',error,{form}); return {error:String(error.message||'').includes('too long')?t('deTooLong'):t('couldNotSaveTheChangeCheckPermissionsAnd')}; }
  const answer=data as {saved:boolean,version:number,body:string,base?:string|null};
  if(answer.saved) { revalidatePath(`/c/${String(form.get('slug'))}`,'layout'); return {version:answer.version,body:answer.body,merged,conflicted}; }
  const result=mergeDescriptions(answer.base??'',body,answer.body);
  body=result.text; base=answer.version; merged=true; conflicted=conflicted||result.conflicted;
 }
 return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')};
});
// A picture put in the description (#680) is stored in the Card's own folder of the Company's storage and served by the
// app, so the description only ever shows pictures from inside the Company.
export const uploadDescriptionPicture=withActionLog('uploadDescriptionPicture',async function uploadDescriptionPicture(form: FormData): Promise<PictureUploaded> {
 const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const card=Number(form.get('card')); const slug=String(form.get('slug'));
 if(!await actionAllowed(db,'uploadDescriptionPicture',company)) return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')};
 const file=form.get('files');
 if(!(file instanceof File)||!file.type.startsWith('image/')) return {error:t('deNotAPicture')};
 const stored=await storeFiles(db,company,form,`${card}/files/${crypto.randomUUID()}`);
 if(stored.error||!stored.files.length) { logActionFailure('uploadDescriptionPicture',stored.error??{message:'nothing stored'},{form}); return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')}; }
 const {error}=await db.rpc('attach_card_files',{c:company,card,files:stored.files});
 const {data:row}=error?{data:null}:await db.from('work_attachments').select('id').eq('company_id',company).eq('path',stored.files[0].path).maybeSingle();
 if(error||!row) { logActionFailure('uploadDescriptionPicture',error??{message:'attachment not found'},{form}); return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')}; }
 return {url:`/c/${slug}/files/${row.id}`,name:stored.files[0].name};
});
// A new Card from the one New card form (#683): from the toolbar into Planned, from the Ideas column at its top, with
// its description, its assignee or no one, the board's Project, and files. Made once per request key, so pressing Add
// twice or a retry is one Card. It answers instead of redirecting: the form shows a refusal and stays open.
export const newCard=withActionLog('newCard',async function newCard(form: FormData): Promise<NewCardResult> {
 const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company'));
 if(!await actionAllowed(db,'newCard',company)) return {error:t('couldNotSaveTheChangeCheckPermissionsAnd')};
 const [kind,who]=String(form.get('assignee')||'').split(':'); const key=String(form.get('key')||'');
 const {data,error}=await db.rpc('new_card',{c:company,card_title:String(form.get('title')||''),status:String(form.get('status')||'planned'),
  description:String(form.get('description')??'').replace(/\r\n?/g,'\n'),agent:kind==='a'?who:null,person:kind==='p'?who:null,
  project:form.get('project')?Number(form.get('project')):null,request_key:/^[0-9a-f-]{36}$/.test(key)?key:null});
 if(error||!data) {
  logActionFailure('newCard',error??{message:'no card'},{form});
  const reason=String(error?.message||'');
  return {error:reason.includes('title required')?t('ncTitleMissing'):/agent not found|assignee not a member/.test(reason)?t('assigneeNotPermitted'):t('couldNotSaveTheChangeCheckPermissionsAnd')};
 }
 const card=Number(data);
 const stored=await storeFiles(db,company,form,`${card}/files/${key||crypto.randomUUID()}`);
 if(!stored.error&&stored.files.length) {
  const attached=await db.rpc('attach_card_files',{c:company,card,files:stored.files});
  if(attached.error) logActionFailure('newCard',attached.error,{form});
 } else if(stored.error) logActionFailure('newCard',stored.error,{form});
 revalidatePath(`/c/${String(form.get('slug'))}`,'layout');
 return {id:card};
});
export const workAction=withActionLog('workAction',async function workAction(form: FormData) { const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug')); const op=String(form.get('op')); const card=Number(form.get('card')); const base=`/c/${slug}/work/board`; const evidence=String(form.get('evidence')||'').trim() || null;
 let error: {message:string}|null=null;
 // The action's permission (lib/route-permissions.mjs) for this operation, with the role read now; the database checks
 // the finer rules (who may move or decide the Card) again.
 if(!await actionAllowed(db,'workAction',company,op)) error={message:'not permitted'};
 // A review (#681): anyone who may edit asks for it on the Card's latest Version; an Owner or a Manager who sees the Card
 // approves it or sends it back with a reason, on the Version the review was asked on. decide_review keeps the first
 // answer and refuses the second.
 else if(op==='review') ({error}=await db.rpc('ask_review',{c:company,card}));
 // A Card waits for another, or stops waiting (#682); the database refuses a loop.
 else if(op==='wait-add'||op==='wait-remove') ({error}=await db.rpc(op==='wait-add'?'add_card_wait':'remove_card_wait',{c:company,card,waits_for:Number(form.get('waits_for'))}));
 else if(op==='approve'||op==='send-back') ({error}=await db.rpc('decide_review',{c:company,card,version:form.get('version')?Number(form.get('version')):null,decision:op==='approve'?'approve':'send_back',reason:String(form.get('reason')||'')}));

 else if(op==='project') ({error}=await db.rpc('edit_work_card',{c:company,card,fields:{project_id:String(form.get('project')||'')},evidence}));
 // A Card's status is its column (#676): move_card holds every rule of a move.
 else if(op==='move-column') ({error}=await db.rpc('move_card',{c:company,card,target:String(form.get('column')||''),evidence}));
 else if(op==='edit') { const fields=Object.fromEntries(['title','go_live'].map(k=>[k,String(form.get(k)||'')])); ({error}=await db.rpc('edit_work_card',{c:company,card,fields,evidence})); }
 else if(op==='comment') {
  const stored=await storeFiles(db,company,form,`${card}/${crypto.randomUUID()}`); error=stored.error;
  if(!error) {
   const body=String(form.get('body')||'');
   const sent=await db.rpc('change_work_card',{c:company,card,operation:'comment',payload:{body},evidence}); error=sent.error;
   if(!error && stored.files.length) error=(await db.rpc('attach_files',{c:company,card,message:sent.data,files:stored.files})).error;
   if(!error && body.includes('@')) await startNoteRun(sent.data);
  }
 }
 // Files added to the Card itself in its window (#678), stored in the Card's folder first, as a comment's are.
 else if(op==='files') {
  const stored=await storeFiles(db,company,form,`${card}/files/${crypto.randomUUID()}`); error=stored.error;
  if(!error) error=stored.files.length?(await db.rpc('attach_card_files',{c:company,card,files:stored.files})).error:{message:'missing file'};
 }
 // A Card's one assignee (#677): an Agent ("a:<id>"), a Member ("p:<id>", the caller's own for "Assign to me") or nobody
 // (""); assign_card checks the Role, the Agent the caller sees and the Member who may be one. It starts nothing.
 else if(op==='assign') { const [kind,id]=String(form.get('assignee')||'').split(':'); ({error}=await db.rpc('assign_card',{c:company,card,agent:kind==='a'?id:null,person:kind==='p'?id:null})); }

 else if(op==='upload') {
  const file=form.get('file');
  if(file instanceof File && file.size) {
   const creative=Number(form.get('creative'));
   const path=`${company}/${card}/${crypto.randomUUID()}`;
   const uploaded=await db.storage.from('creatives').upload(path,file);
   error=uploaded.error;
   if(!error) {
    const result=await db.rpc('change_work_card',{c:company,card,operation:creative?'version':'creative_with_version',payload:creative?{creative,path}:{name:file.name,path},evidence});
    error=result.error;
   }
  } else error={message:'missing file'};
 }
 else error={message:'unknown operation'};
 revalidatePath(`/c/${slug}`,'layout');
 if(error) { logActionFailure(`workAction:${op}`,error,{form}); const path=card&&form.get('view')==='sheet'?`${base}?card=${card}`:card&&(op!=='move-column'||form.get('view')==='card')?`${base}/${card}`:base; redirect(`${path}${path.includes('?')?'&':'?'}message=${encodeURIComponent(error.message.includes('contributors cannot move')||['move','move-column'].includes(op)&&error.message.includes('not permitted')?t('youCannotMoveTheCardToThisStage'):error.message.includes('waiting is not placed by hand')?t('boardWaitingFillsItself'):error.message.includes('approval required')?t('boardNeedsApproval'):error.message.includes('decision required')?t('boardDecideFirst'):error.message.includes('wait loop')?t('cwWaitLoop'):error.message.includes('review closed')?t('reviewClosed'):error.message.includes('version changed')?t('reviewVersionChanged'):error.message.includes('already in review')?t('reviewAlready'):error.message.includes('reason required')?t('reviewReasonRequired'):op==='assign'&&(error.message.includes('agent not found')||error.message.includes('assignee not a member')||error.message.includes('one assignee'))?t('assigneeNotPermitted'):t('couldNotSaveTheChangeCheckPermissionsAnd'))}`); }
});
