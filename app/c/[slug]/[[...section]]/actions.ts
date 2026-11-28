'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
export const changeMember=withActionLog('changeMember',async function changeMember(form: FormData) {
 const db=await supabase(); const slug=String(form.get('slug')); const company=String(form.get('company')); const person=String(form.get('person')); const op=String(form.get('op'));
 const values={role:String(form.get('role')),grant_publishing:form.has('publishing'),grant_money_figures:form.has('money'),grant_customer_data:form.has('customer')};
 let error;
 // The action's permission (lib/route-permissions.mjs), with the role read now; the database checks each change again: only
 // an Owner changes or removes an Owner, and a Manager never changes their own row (guard_member, #774). Inviting a Person
 // is not this action: an Administrator makes an Invite link (#950, #953).
 if(!['update','remove'].includes(op)||!await actionAllowed(db,'changeMember',company,op)) error={code:'42501',message:'not permitted'};
 else if(op==='remove') ({error}=await db.rpc('remove_member',{target_company:company,target_person:person}));
 else {
  ({error}=await db.from('members').update(values).eq('company_id',company).eq('person_id',person));
 }
 if(error) logActionFailure('changeMember',error,{form});
 revalidatePath(`/c/${slug}/settings/members`);
 revalidatePath(`/c/${slug}/home`);
 // A catalogue key the page draws in the reader's language (lib/page-alert.mjs, #778), never text.
 const message=error ? (error.message.includes('last owner')?'theLastOwnerCannotBeRemovedOrHave':'couldNotSaveTheChangeCheckPermissionsAnd') : 'changeSaved';
 redirect(`/c/${slug}/settings/members?message=${message}`);
});
