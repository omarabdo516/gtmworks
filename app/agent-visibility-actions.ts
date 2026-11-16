'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';

// One switch of the Member × Agent table in Company settings (#15): shows one Agent to one Member, or hides it. The
// database checks the Role again, refuses the main Agent and an Owner's row, and finds no Agent hidden from the caller.
export const setAgentVisible=withActionLog('setAgentVisible',async function setAgentVisible(company:string,person:string,agent:string,visible:boolean):Promise<''|'agentVisibilityFailed'> {
 const db=await supabase();
 if(!await actionAllowed(db,'setAgentVisible',company)) return 'agentVisibilityFailed';
 const {error}=await db.rpc('set_agent_visible',{c:company,person,agent,visible});
 if(error) { logActionFailure('setAgentVisible',{code:error.code,message:'set_agent_visible refused'}); return 'agentVisibilityFailed'; }
 return '';
});

// One switch on an invited row of the Team table (#185), kept with the invitation until the person joins.
export const setInvitationAgentVisible=withActionLog('setInvitationAgentVisible',async function setInvitationAgentVisible(company:string,invitation:string,agent:string,visible:boolean):Promise<''|'agentVisibilityFailed'> {
 const db=await supabase();
 if(!await actionAllowed(db,'setInvitationAgentVisible',company)) return 'agentVisibilityFailed';
 const {error}=await db.rpc('set_invitation_agent_visible',{c:company,invitation,agent,visible});
 if(error) { logActionFailure('setInvitationAgentVisible',{code:error.code,message:'set_invitation_agent_visible refused'}); return 'agentVisibilityFailed'; }
 return '';
});
