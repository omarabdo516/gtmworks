'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { appUrl } from '@/lib/app-origin.mjs';
import { generateLinkSecret, linkSecretHash, passwordLink } from '@/lib/company-link.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An Administrator or a Manager makes a password link for a Member from the Team page (#954, ADR 0019). The secret is
// made here and its hash alone goes to the database, with the maker's own session, so make_password_link checks who
// asks and refuses a Manager's link for an Administrator. The link comes back once, to be copied, and is kept nowhere.
// The answer's error is a catalogue key, never the database's text.
export const makePasswordLink=withActionLog('makePasswordLink',async function makePasswordLink(company:string,person:string):Promise<{link?:string,error?:string}> {
 const db=await supabase();
 if(!await actionAllowed(db,'makePasswordLink',company)) return {error:'passwordLinkFailed'};
 if(typeof person!=='string' || !uuid.test(person)) return {error:'passwordLinkFailed'};
 const secret=generateLinkSecret();
 const {error}=await db.rpc('make_password_link',{c:company,person,link_hash:linkSecretHash(secret)});
 if(error) {
  logActionFailure('makePasswordLink',{code:error.code,message:'make_password_link refused'});
  return {error:error.message==='passwordLinkInstallOwner'?'passwordLinkInstallOwner':error.code==='42501'?'passwordLinkNotAllowed':'passwordLinkFailed'};
 }
 return {link:passwordLink(appUrl('/').origin,secret)};
});
