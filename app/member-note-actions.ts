'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { noteLimit, secretLike } from '@/lib/secret-text.mjs';

type NoteMessage=''|'memberNoteSaved'|'memberNoteTooLong'|'memberNoteSecret'|'memberNoteFailed';
// A Member's own note for the Agents in one Company (settings overlay, "Your account"). It is saved as the signed-in
// person (RLS: only they read or write it); the database refuses a note over 4,000 characters or one that looks like a
// secret even when this check is passed by. The note itself is never logged. Returns a message key.
export const saveMemberNote=withActionLog('saveMemberNote',async function saveMemberNote(_state:NoteMessage,form:FormData):Promise<NoteMessage> {
 const db=await supabase(); const company=String(form.get('company')||''); const note=String(form.get('note')||'');
 if(!await actionAllowed(db,'saveMemberNote',company)) return 'memberNoteFailed';
 if(note.trim().length>noteLimit) return 'memberNoteTooLong';
 if(secretLike(note)) return 'memberNoteSecret';
 const {error}=await db.rpc('save_member_note',{c:company,note});
 if(error?.message==='memberNoteTooLong'||error?.message==='memberNoteSecret') return error.message;
 if(error) { logActionFailure('saveMemberNote',{code:error.code,message:'save_member_note refused'}); return 'memberNoteFailed'; }
 return 'memberNoteSaved';
});
