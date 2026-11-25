'use server';
import { withActionLog } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { agentDetails, type AgentDetailsView } from '@/app/agent-details-server';

// The details of an Agent picked in New's picker (#769): read only when it is picked, never beside the Agent the page
// opened with, so New waits for one Agent's details and not for every Agent's. Row-level security shows the reader only
// the Agents they see; one they do not is null.
export const pickedAgentDetails=withActionLog('pickedAgentDetails',async function pickedAgentDetails(company:string,agent:string,slug:string,tab?:string):Promise<AgentDetailsView|null> {
 const db=await supabase();
 if(!await actionAllowed(db,'pickedAgentDetails',company)) return null;
 const {data:{user}}=await db.auth.getUser(); if(!user) return null;
 const [{data:row},{data:membership}]=await Promise.all([
  db.from('hermes_agents').select('name').eq('id',agent).eq('company_id',company).maybeSingle(),
  db.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle(),
 ]);
 if(!row) return null;
 return agentDetails(db,{company,agent,name:row.name,slug,me:user.id,role:membership?.role||'',tab});
});
