'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { fingerprint } from '@/lib/agent-crypto.mjs';
import { filesProblem } from '@/lib/attachments.mjs';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
import { driveNoteRuns } from '@/lib/channel-runs.mjs';
import type { Card, IdeaResult, PlaceResult, UndoResult } from './work';
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
// "Undo" on a move (#168): the database puts the Card back in the stage and place it left, as the person, and decides
// every refusal itself. The board says in a toast what happened, and is drawn again only when the Card really went back.
export const undoMove=withActionLog('undoMove',async function undoMove(form: FormData): Promise<UndoResult> {
 const db=await supabase(); const company=String(form.get('company')); const card=Number(form.get('card'));
 if(!await actionAllowed(db,'undoMove',company)) return {state:'refused'};
 const {data,error}=await db.rpc('undo_work_card_move',{c:company,card});
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
// A Card placed where its person drops it, or one place up or down its column (#174): the database decides every refusal
// and the board answers it in place, so a refused place neither leaves the board nor offers an "Undo" (#168).
export const placeMove=withActionLog('placeMove',async function placeMove(form: FormData): Promise<PlaceResult> {
 const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const evidence=String(form.get('evidence')||'').trim() || null;
 if(!await actionAllowed(db,'placeMove',company)) return {error:t('youCannotMoveTheCardToThisStage')};
 const {error}=await db.rpc('place_work_card',{c:company,card:Number(form.get('card')),target:String(form.get('column')||''),before_card:Number(form.get('before'))||null,evidence});
 if(!error) { revalidatePath(`/c/${String(form.get('slug'))}`,'layout'); return {ok:true}; }
 logActionFailure('placeMove',error,{form});
 // The refusals the board has words for; anything else is a failure worth its own log line.
 const reason=String(error.message||'');
 return {error:reason.includes('not permitted')||reason.includes('contributors cannot move')?t('youCannotMoveTheCardToThisStage'):reason.includes('approval required')?t('boardNeedsApproval'):reason.includes('decision required')?t('boardDecideFirst'):t('couldNotSaveTheChangeCheckPermissionsAnd')};
});
// An idea from the Ideas column (#188): made once per request key, so Add pressed twice or a retry is one Card (#452). It
// answers the form with its Card instead of redirecting, since a redirect rejects the promise the form waits on.
export const addIdea=withActionLog('addIdea',async function addIdea(form: FormData): Promise<IdeaResult> {
 const db=await supabase(); const company=String(form.get('company'));
 if(!await actionAllowed(db,'addIdea',company)) return {failed:true};
 const payload={stage:Number(form.get('stage')),title:String(form.get('title')||''),agent:String(form.get('agent')||'')};
 const {data,error}=await db.rpc('agent_write',{c:company,request_key:String(form.get('key')||''),fingerprint:fingerprint('POST','ideas',JSON.stringify(payload)),op:'idea',card:null,payload});
 if(error||!data?.id) { logActionFailure('addIdea',error||{message:'no card'},{form}); return {failed:true}; }
 revalidatePath(`/c/${String(form.get('slug'))}`,'layout');
 return {card:Number(data.id)};
});
export const workAction=withActionLog('workAction',async function workAction(form: FormData) { const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug')); const op=String(form.get('op')); const card=Number(form.get('card')); const base=`/c/${slug}/work/board`; const evidence=String(form.get('evidence')||'').trim() || null;
 let error: {message:string}|null=null; let created: number|undefined;
 // The action's permission (lib/route-permissions.mjs) for this operation, with the role read now; the database checks
 // the finer rules (the current approver, the stage rules) again.
 if(!await actionAllowed(db,'workAction',company,op)) error={message:'not permitted'};
 else if(op==='approve'||op==='reject') ({error}=await db.rpc('decide_approval',{c:company,card,decision:op==='approve'?'approve':'reject',reason:String(form.get('reason')||''),caption_marked:form.has('caption_marked'),design_marked:form.has('design_marked')}));
 else if(op==='save-step') { const [kind,value]=String(form.get('approver')).split(':'); ({error}=await db.rpc('save_approval_step',{c:company,step:Number(form.get('step'))||null,step_name:String(form.get('name')),step_position:Number(form.get('position')),member:kind==='person'?value:null,member_role:kind==='role'?value:null})); }
 else if(op==='remove-step') ({error}=await db.rpc('remove_approval_step',{c:company,step:Number(form.get('step'))}));
 else if(op==='create') { const result=await db.rpc('create_work_card',{c:company,s:Number(form.get('stage')),card_title:String(form.get('title')),template:String(form.get('template')||''),evidence}); error=result.error; created=result.data; }
 else if(op==='request') {
  // One card, its first message and its assignment, once per key: a double click or a retry returns the same card.
  const key=String(form.get('key')||''); const stored=await storeFiles(db,company,form,/^[0-9a-f-]{36}$/.test(key)?key:crypto.randomUUID()); error=stored.error;
  if(!error) {
   const payload={message:String(form.get('message')||''),agent:String(form.get('agent')||''),mode:String(form.get('mode')||'')};
   const result=await db.rpc('agent_write',{c:company,request_key:key,fingerprint:fingerprint('POST','cards',JSON.stringify(payload)),op:'create',card:null,payload});
   error=result.error; created=result.data?.id;
   if(!error && created && stored.files.length) error=(await db.rpc('attach_files',{c:company,card:created,message:null,files:stored.files})).error;
  }
 }
 else if(op==='project') ({error}=await db.rpc('edit_work_card',{c:company,card,fields:{project_id:String(form.get('project')||'')},evidence}));
 else if(op==='move') ({error}=await db.rpc('move_work_card',{c:company,card,stage:Number(form.get('stage')),evidence}));
 // The board moves a card by column (ADR 0013); the database picks the column's stage and applies every stage rule.
 else if(op==='move-column') ({error}=await db.rpc('move_work_card_to_column',{c:company,card,target:String(form.get('column')||''),evidence}));
 else if(op==='edit') { const fields=Object.fromEntries(['title','offering','segment','hook','channel','format','go_live','goal','caption'].map(k=>[k,String(form.get(k)||'')])); ({error}=await db.rpc('edit_work_card',{c:company,card,fields,evidence})); }
 else if(op==='comment') {
  const stored=await storeFiles(db,company,form,`${card}/${crypto.randomUUID()}`); error=stored.error;
  if(!error) {
   const body=String(form.get('body')||'');
   const sent=await db.rpc('change_work_card',{c:company,card,operation:'comment',payload:{body},evidence}); error=sent.error;
   if(!error && stored.files.length) error=(await db.rpc('attach_files',{c:company,card,message:sent.data,files:stored.files})).error;
   if(!error && body.includes('@')) await startNoteRun(sent.data);
  }
 }
 else if(['actor','assignee','label','check'].includes(op)) { const payload=Object.fromEntries(['person','label','item','done','body'].map(k=>[k,String(form.get(k)||'')])); ({error}=await db.rpc('change_work_card',{c:company,card,operation:op,payload,evidence})); }
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
 else if(op==='stage-settings') { const result=await db.from('work_stages').update({name:String(form.get('name')),position:Number(form.get('position'))}).eq('company_id',company).eq('id',Number(form.get('stage'))).select('id'); error=result.error || (!result.data?.length?{message:'not permitted'}:null); }
 else if(op==='label-settings') { const result=await db.from('work_labels').update({name:String(form.get('name')),color:String(form.get('color'))}).eq('company_id',company).eq('id',Number(form.get('label'))).select('id'); error=result.error || (!result.data?.length?{message:'not permitted'}:null); }
 else error={message:'unknown operation'};
 revalidatePath(`/c/${slug}`,'layout');
 if(error) { logActionFailure(`workAction:${op}`,error,{form}); const path=op==='request'?`/c/${slug}/work/new`:(op.endsWith('settings')||op.endsWith('step'))?`/c/${slug}/settings/work`:card&&form.get('view')==='sheet'?`${base}?card=${card}`:card&&(!['move','move-column'].includes(op)||form.get('view')==='card')?`${base}/${card}`:base; redirect(`${path}${path.includes('?')?'&':'?'}message=${encodeURIComponent(error.message.includes('contributors cannot move')?t('youCannotMoveTheCardToThisStage'):error.message.includes('approval required')?t('boardNeedsApproval'):error.message.includes('decision required')?t('boardDecideFirst'):t('couldNotSaveTheChangeCheckPermissionsAnd'))}`); }
 if(created) redirect(`${base}/${created}`);
});
