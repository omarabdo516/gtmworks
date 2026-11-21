import 'server-only';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import type { supabase } from '@/lib/supabase';
import { inviteError } from '@/lib/invite.mjs';
import { sendInvitationMail } from '@/lib/invitation-mail';

const refusals=new Set(['inviteEmailEmpty','inviteEmailMalformed','inviteEmailTaken']);
const roles=new Set(['manager','contributor','viewer']);

// The Owner invites a Member (#185; design-reference: sendInvite). The form's own check runs again here; invite_member
// checks the Owner, the email and whether it is taken before the invitation email is sent as the members page sends it,
// and writes the invitation only once it is sent, so a failed send can be tried again. The answer is a catalogue key,
// never the email or the database's text. Its caller has checked the Owner where it runs (both actions are the Owner's,
// lib/route-permissions.mjs), on the client it passes. It refreshes no page: the Team table's action
// (app/invite-actions.ts) does, and first run's question sends its rows here so it stays on the page until it has left
// (#130).
export async function sendInvite(db:Awaited<ReturnType<typeof supabase>>,company:string,slug:string,email:string,role:string):Promise<{error?:string}> {
 const wrong=inviteError(email); if(wrong) return {error:wrong};
 if(!roles.has(role)) return {error:'inviteFailed'};
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
 return failed?{error:failed}:{};
}
