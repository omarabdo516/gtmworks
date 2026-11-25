'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { keptOf } from '@/lib/agent-looks';
import type { KeptLook, LookPart } from '@/lib/agent-look-saves';

// The Owner's window changes one part of an Agent's look, or resets it to automatic (#698): change_agent_look and
// reset_agent_look check the Owner, the Company's Agent and the value again, and write the Activity log's rows. Each
// answers the look as the database now keeps it, or null when it was not saved.
const parts:LookPart[]=['shape','colour','temperament'];
export const changeAgentLook=withActionLog('changeAgentLook',async function changeAgentLook(company:string,agent:string,part:LookPart,choice:string|null):Promise<KeptLook|null> {
 const db=await supabase();
 if(!parts.includes(part)||!await actionAllowed(db,'changeAgentLook',company)) return null;
 const {data,error}=await db.rpc('change_agent_look',{c:company,agent,part,choice}).single();
 if(error||!data) { logActionFailure('changeAgentLook',{code:error?.code,message:'change_agent_look refused'}); return null; }
 return keptOf(data as Parameters<typeof keptOf>[0]);
});
export const resetAgentLook=withActionLog('resetAgentLook',async function resetAgentLook(company:string,agent:string):Promise<KeptLook|null> {
 const db=await supabase();
 if(!await actionAllowed(db,'resetAgentLook',company)) return null;
 const {data,error}=await db.rpc('reset_agent_look',{c:company,agent}).single();
 if(error||!data) { logActionFailure('resetAgentLook',{code:error?.code,message:'reset_agent_look refused'}); return null; }
 return keptOf(data as Parameters<typeof keptOf>[0]);
});
