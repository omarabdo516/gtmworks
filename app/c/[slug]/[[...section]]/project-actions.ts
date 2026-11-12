'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// Projects are plain rows: the database decides who may write them (a Contributor or above of that company).
export const projectAction=withActionLog('projectAction',async function projectAction(form: FormData) { const {t}=await getI18n();
 const db=await supabase(); const company=String(form.get('company')); const slug=String(form.get('slug')); const op=String(form.get('op'));
 const fields={name:String(form.get('name')||'').trim(),goal:String(form.get('goal')||'').trim()};
 let error: {message:string}|null=null;
 if(op==='create') ({error}=await db.from('work_projects').insert({company_id:company,...fields}));
 else if(op==='update') { const result=await db.from('work_projects').update({...fields,status:String(form.get('status'))}).eq('company_id',company).eq('id',Number(form.get('project'))).select('id'); error=result.error || (!result.data?.length?{message:'not permitted'}:null); }
 else error={message:'unknown operation'};
 revalidatePath(`/c/${slug}`,'layout');
 if(error) { logActionFailure(`projectAction:${op}`,error,{form}); redirect(`/c/${slug}/projects?message=${encodeURIComponent(t('couldNotSaveTheChangeCheckPermissionsAnd'))}`); }
});
