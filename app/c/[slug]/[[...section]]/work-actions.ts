'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fingerprint } from '@/lib/agent-crypto.mjs';
import { filesProblem } from '@/lib/attachments.mjs';
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
export const workAction=withActionLog('workAction',async function workAction(form: FormData) { const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug')); const op=String(form.get('op')); const card=Number(form.get('card')); const base=`/c/${slug}/work/board`; const evidence=String(form.get('evidence')||'').trim() || null;
 let error: {message:string}|null=null; let created: number|undefined;
 if(op==='approve'||op==='reject') ({error}=await db.rpc('decide_approval',{c:company,card,decision:op==='approve'?'approve':'reject',reason:String(form.get('reason')||''),caption_marked:form.has('caption_marked'),design_marked:form.has('design_marked')}));
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
 else if(op==='edit') { const fields=Object.fromEntries(['title','offering','segment','hook','channel','format','go_live','goal','caption'].map(k=>[k,String(form.get(k)||'')])); ({error}=await db.rpc('edit_work_card',{c:company,card,fields,evidence})); }
 else if(op==='comment') {
  const stored=await storeFiles(db,company,form,`${card}/${crypto.randomUUID()}`); error=stored.error;
  if(!error) {
   const sent=await db.rpc('change_work_card',{c:company,card,operation:'comment',payload:{body:String(form.get('body')||'')},evidence}); error=sent.error;
   if(!error && stored.files.length) error=(await db.rpc('attach_files',{c:company,card,message:sent.data,files:stored.files})).error;
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
 if(error) { logActionFailure(`workAction:${op}`,error,{form}); const path=op==='request'?`/c/${slug}/work/new`:(op.endsWith('settings')||op.endsWith('step'))?`/c/${slug}/settings/work`:card&&(op!=='move'||form.get('view')==='card')?`${base}/${card}`:base; redirect(`${path}?message=${encodeURIComponent(error.message.includes('contributors cannot move')?t('youCannotMoveTheCardToThisStage'):t('couldNotSaveTheChangeCheckPermissionsAnd'))}`); }
 if(created) redirect(`${base}/${created}`);
});
