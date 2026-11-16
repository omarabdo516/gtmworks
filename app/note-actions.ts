'use server';
import { revalidatePath } from 'next/cache';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';

type NoteEditResult='noteSaved'|'noteUnchanged'|'noteEmpty'|'noteLockedBeforeSave'|'couldNotSaveTheChangeCheckPermissionsAnd';

// The writer changes a note's text, from its Card or from wherever the log shows it (#22). The database decides who and
// until when (edit_card_note): only the writer, in the note's first five minutes. Returns a message key; the note's text
// is never logged.
export const editNote=withActionLog('editNote',async function editNote({company,slug,note,body}:{company:string,slug:string,note:number,body:string}):Promise<NoteEditResult> {
 const db=await supabase();
 if(!await actionAllowed(db,'editNote',company)) return 'couldNotSaveTheChangeCheckPermissionsAnd';
 if(!String(body).trim()) return 'noteEmpty';
 const {data,error}=await db.rpc('edit_card_note',{c:company,note,note_body:String(body)});
 if(error) {
  if(error.message==='noteLocked') return 'noteLockedBeforeSave';
  logActionFailure('editNote',{code:error.code,message:'edit_card_note refused'});
  return 'couldNotSaveTheChangeCheckPermissionsAnd';
 }
 if(/^[a-z0-9-]{1,60}$/.test(slug)) revalidatePath(`/c/${slug}`,'layout');
 return data?'noteSaved':'noteUnchanged';
});
