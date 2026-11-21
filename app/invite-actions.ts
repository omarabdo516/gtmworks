'use server';
import { revalidatePath } from 'next/cache';
import { withActionLog } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { sendInvite } from '@/lib/invite-member';

// The Owner invites a Member from Company settings or the Team dialog (#185): the invitation (lib/invite-member.ts),
// then the settings drawn again with its row.
export const inviteMember=withActionLog('inviteMember',async function inviteMember(company:string,slug:string,email:string,role:string):Promise<{error?:string}> {
 const db=await supabase();
 if(!await actionAllowed(db,'inviteMember',company)) return {error:'inviteFailed'};
 const answer=await sendInvite(db,company,slug,email,role);
 revalidatePath(`/c/${slug}/settings`);
 return answer;
});
