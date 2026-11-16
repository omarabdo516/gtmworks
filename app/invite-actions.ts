'use server';
import { revalidatePath } from 'next/cache';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { inviteError } from '@/lib/invite.mjs';
import { sendInvitationMail } from '@/lib/invitation-mail';

const refusals=new Set(['inviteEmailEmpty','inviteEmailMalformed','inviteEmailTaken']);
const roles=new Set(['manager','contributor','viewer']);

// The Owner invites a Member from Company settings (#185; design-reference: sendInvite). The form's own check runs
// again here; invite_member checks the Owner, the email and whether it is taken before the invitation email is sent as
// the members page sends it, and writes the invitation only once it is sent, so a failed send can be tried again. The
// answer is a catalogue key, never the email or the database's text.
export const inviteMember=withActionLog('inviteMember',async function inviteMember(company:string,slug:string,email:string,role:string):Promise<{error?:string}> {
 const wrong=inviteError(email); if(wrong) return {error:wrong};
 if(!roles.has(role)) return {error:'inviteFailed'};
 const db=await supabase();
 if(!await actionAllowed(db,'inviteMember',company)) return {error:'inviteFailed'};
 const invite=async(checkOnly:boolean)=>{
  const {error}=await db.rpc('invite_member',{c:company,mail:email,member_role:role,check_only:checkOnly});
  if(!error) return '';
  if(refusals.has(error.message)) return error.message;
  logActionFailure('inviteMember',{code:error.code,message:'invite_member refused'});
  return 'inviteFailed';
 };
 const refused=await invite(true); if(refused) return {error:refused};
 const mailError=await sendInvitationMail(email.trim().toLowerCase(),slug);
 if(mailError) { logActionFailure('inviteMember',{code:mailError.code,message:'invitation email not sent'}); return {error:'inviteFailed'}; }
 const failed=await invite(false);
 revalidatePath(`/c/${slug}/settings`);
 return failed?{error:failed}:{};
});
