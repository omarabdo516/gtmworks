'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { appUrl } from '@/lib/app-origin.mjs';
import { generateLinkSecret, inviteLink, linkSecretHash } from '@/lib/company-link.mjs';

const roles=new Set(['manager','contributor','viewer']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refusals:Record<string,string>={inviteLinkLabel:'inviteLinkNameEmpty'};

// An Administrator makes an Invite link from the Team page (#950, ADR 0019). The secret is made here and its hash alone
// goes to the database, with the Administrator's own session so make_invite_link checks who asks; the link itself
// comes back once, to be copied, and is kept nowhere. The answer's error is a catalogue key, never the database's text.
export const makeInviteLink=withActionLog('makeInviteLink',async function makeInviteLink(company:string,label:string,role:string,agents:string[]):Promise<{link?:string,error?:string}> {
 const db=await supabase();
 if(!await actionAllowed(db,'makeInviteLink',company)) return {error:'inviteLinkFailed'};
 if(!String(label??'').trim()) return {error:'inviteLinkNameEmpty'};
 if(!roles.has(role) || !Array.isArray(agents) || agents.some(agent=>typeof agent!=='string' || !uuid.test(agent))) return {error:'inviteLinkFailed'};
 const secret=generateLinkSecret();
 const {error}=await db.rpc('make_invite_link',{c:company,label,link_role:role,agents,link_hash:linkSecretHash(secret)});
 if(error) {
  if(Object.hasOwn(refusals,error.message)) return {error:refusals[error.message]};
  logActionFailure('makeInviteLink',{code:error.code,message:'make_invite_link refused'});
  return {error:'inviteLinkFailed'};
 }
 return {link:inviteLink(appUrl('/').origin,secret)};
});
