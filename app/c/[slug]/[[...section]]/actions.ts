'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
import { appUrl } from '@/lib/app-origin.mjs';
import { actionAllowed } from '@/lib/route-permissions.mjs';
export const changeMember=withActionLog('changeMember',async function changeMember(form: FormData) { const {t}=await getI18n();
 const db=await supabase(); const slug=String(form.get('slug')); const company=String(form.get('company')); const person=String(form.get('person')); const op=String(form.get('op'));
 const values={role:String(form.get('role')),grant_publishing:form.has('publishing'),grant_money_figures:form.has('money'),grant_customer_data:form.has('customer')};
 let error;
 // The action's permission (lib/route-permissions.mjs), with the role read now; the database checks each change again.
 if(!await actionAllowed(db,'changeMember',company,op)) error={code:'42501',message:'not permitted'};
 else if(op==='invite') {
  const email=String(form.get('email')).trim().toLowerCase();
  ({error}=await db.from('member_invitations').upsert({company_id:company,email,claimed_at:null,...values},{onConflict:'company_id,email'}));
  if(!error) {
   const emailRedirectTo=appUrl(`/auth/accept?next=${encodeURIComponent(`/c/${slug}/settings/members`)}`).href;
   // The caller's own permissions were just checked by the invitation row above. Production has sign-ups off, so a sign-in link
   // is never sent to an address with no account; the server's own key invites it instead. Someone who already has an account
   // gets an ordinary sign-in link.
   const admin=createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY || '',{auth:{persistSession:false,autoRefreshToken:false}});
   ({error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:emailRedirectTo}));
   if(error && (error.code==='email_exists' || /already (been )?registered/i.test(error.message))) {
    const invitationAuth=createClient(supabaseConfig.url,supabaseConfig.anonKey,{auth:{flowType:'implicit',persistSession:false}});
    ({error}=await invitationAuth.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo}}));
   }
  }
 } else if(op==='remove') ({error}=await db.rpc('remove_member',{target_company:company,target_person:person}));
 else {
  const agentRole=values.role!=='contributor' ? {agent_role:null} : form.has('agent_role') ? {agent_role:String(form.get('agent_role')) || null} : {};
  ({error}=await db.from('members').update({...values,...agentRole}).eq('company_id',company).eq('person_id',person));
 }
 if(error) logActionFailure('changeMember',error,{form});
 revalidatePath(`/c/${slug}/settings/members`);
 revalidatePath(`/c/${slug}/home`);
 const message=error ? (error.code==='23505' && error.message.includes('members_active_agent_role')?t('thisAgentRoleIsAssignedToAnotherActive'):error.message.includes('last owner')?t('theLastOwnerCannotBeRemovedOrHave'):t('couldNotSaveTheChangeCheckPermissionsAnd')) : (op==='invite'?t('anInvitationLinkWasSentByEmail'):t('changeSaved'));
 redirect(`/c/${slug}/settings/members?message=${encodeURIComponent(message)}`);
});
