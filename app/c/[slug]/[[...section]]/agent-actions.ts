'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
export const changeAgentAccess=withActionLog('changeAgentAccess',async function changeAgentAccess(form:FormData) {
 const db=await supabase(); const path=`/c/${String(form.get('slug'))}/agents`;
 const {error}=await actionAllowed(db,'changeAgentAccess',String(form.get('company')))?await db.rpc(form.get('intent')==='grant'?'grant_agent_access':'revoke_agent_access',{c:String(form.get('company')),a:String(form.get('agent'))}):{error:{message:'not permitted'}};
 revalidatePath(path);
 if(error) logActionFailure('changeAgentAccess',error,{form});
 redirect(error?`${path}?message=couldNotChangeThisAgentsAccess`:path);
});
