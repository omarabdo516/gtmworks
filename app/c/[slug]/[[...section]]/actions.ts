'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { sendInvitationMail } from '@/lib/invitation-mail';
import { actionAllowed } from '@/lib/route-permissions.mjs';
export const changeMember=withActionLog('changeMember',async function changeMember(form: FormData) { const {t}=await getI18n();
 const db=await supabase(); const slug=String(form.get('slug')); const company=String(form.get('company')); const person=String(form.get('person')); const op=String(form.get('op'));
 const values={role:String(form.get('role')),grant_publishing:form.has('publishing'),grant_money_figures:form.has('money'),grant_customer_data:form.has('customer')};
 let error; let invited: string|undefined;
 // The action's permission (lib/route-permissions.mjs), with the role read now; the database checks each change again.
 if(!await actionAllowed(db,'changeMember',company,op)) error={code:'42501',message:'not permitted'};
 else if(op==='invite') {
  const email=String(form.get('email')).trim().toLowerCase();
  // The invitation's id comes back, never its address: the page reads that invitation again and the address keeps no email.
  const saved=await db.from('member_invitations').upsert({company_id:company,email,claimed_at:null,...values},{onConflict:'company_id,email'}).select('id').single();
  ({error}=saved);
  if(!error) error=await sendInvitationMail(email,slug);
  if(!error) invited=String(saved.data?.id||'');
 } else if(op==='remove') ({error}=await db.rpc('remove_member',{target_company:company,target_person:person}));
 else {
  const agentRole=values.role!=='contributor' ? {agent_role:null} : form.has('agent_role') ? {agent_role:String(form.get('agent_role')) || null} : {};
  ({error}=await db.from('members').update({...values,...agentRole}).eq('company_id',company).eq('person_id',person));
 }
 if(error) logActionFailure('changeMember',error,{form});
 revalidatePath(`/c/${slug}/settings/members`);
 revalidatePath(`/c/${slug}/home`);
 // A sent invitation is confirmed by the toast the Team table raises (#169); an error stays on the page.
 if(!error&&op==='invite'&&invited) redirect(`/c/${slug}/settings/members?invited=${invited}`);
 const message=error ? (error.code==='23505' && error.message.includes('members_active_agent_role')?t('thisAgentRoleIsAssignedToAnotherActive'):error.message.includes('last owner')?t('theLastOwnerCannotBeRemovedOrHave'):t('couldNotSaveTheChangeCheckPermissionsAnd')) : t('changeSaved');
 redirect(`/c/${slug}/settings/members?message=${encodeURIComponent(message)}`);
});
