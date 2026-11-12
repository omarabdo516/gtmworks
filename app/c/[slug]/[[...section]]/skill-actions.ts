'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { skillLibrary } from '@/lib/skill-library.mjs';
// The stored copy is the only source of a skill's instructions: a library skill is read from the code, never from the form.
export const installSkill=withActionLog('installSkill',async function installSkill(form:FormData) {
 const db=await supabase(); const slug=String(form.get('slug')); const path=`/c/${slug}/skills`; const kind=String(form.get('source'));
 let body='';
 if(kind==='library') body=skillLibrary.find(entry=>entry.name===String(form.get('entry')))?.content || '';
 else if(kind==='team') body=String(form.get('content') || '');
 else { const file=form.get('file'); if(file instanceof File && file.size>64*1024) redirect(`${path}?refused=too_large`); if(file instanceof File && file.size>0) body=await file.text(); }
 const {data,error}=body?await db.rpc('install_skill',{c:String(form.get('company')),src:kind,body}):{data:null,error:{message:'empty'}};
 revalidatePath(path);
 if(error) logActionFailure('installSkill',error,{form});
 redirect(error?`${path}?failed=1`:Array.isArray(data?.refused)?`${path}?refused=${data.refused.join(',')}`:path);
});
export const setSkillEnabled=withActionLog('setSkillEnabled',async function setSkillEnabled(form:FormData) {
 const db=await supabase(); const path=`/c/${String(form.get('slug'))}/skills`;
 const {error}=await db.rpc('set_skill_enabled',{c:String(form.get('company')),s:String(form.get('skill')),a:String(form.get('agent')),enable:form.get('intent')==='enable'});
 revalidatePath(path);
 if(error) logActionFailure('setSkillEnabled',error,{form});
 redirect(error?`${path}?failed=1`:path);
});
// Only a person who manages the company decides on a lesson; the database refuses anyone else, and an agent has no way to reach this action.
export const decideSkillLesson=withActionLog('decideSkillLesson',async function decideSkillLesson(form:FormData) {
 const db=await supabase(); const path=`/c/${String(form.get('slug'))}/approvals`;
 const {error}=await db.rpc('decide_skill_lesson',{c:String(form.get('company')),l:Number(form.get('lesson')),approve:form.get('intent')==='approve'});
 revalidatePath(path); revalidatePath(path.replace('/approvals','/skills'));
 if(error) logActionFailure('decideSkillLesson',error,{form});
 redirect(error?`${path}?failed=1`:path);
});
