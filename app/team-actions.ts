'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { orderMembers } from '@/lib/member-roles.mjs';
import type { TeamData } from './team-table';

// The Team dialog's data (#187): the Members, the Agents and which ones each Member and each open invitation sees. It is
// read with the signed-in person's session, so row-level security decides the rows (supabase/tests/
// member_agent_visibility.sql, member_invites.sql), and only an Owner or a Manager reaches it at all: anyone else gets
// nothing back, as Settings, Company shows them no table.
export const teamChoices=withActionLog('teamChoices',async function teamChoices(company:string):Promise<TeamData|null> {
 const db=await supabase();
 if(!await actionAllowed(db,'teamChoices',company)) return null;
 const [agents,members,allowed,invitations]=await Promise.all([
  db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',company).order('is_default',{ascending:false}).order('name'),
  db.from('members').select('person_id,role,people(name)').eq('company_id',company).is('removed_at',null),
  db.from('member_agent_access').select('person_id,agent_id').eq('company_id',company),
  db.from('member_invitations').select('id,email,role').eq('company_id',company).is('claimed_at',null).order('created_at'),
 ]);
 const failure=agents.error||members.error||allowed.error||invitations.error;
 if(failure) { logActionFailure('teamChoices',{code:failure.code,message:'the Team table was not read'}); return null; }
 const invitedAllowed=invitations.data?.length?await db.from('invitation_agent_access').select('invitation_id,agent_id').eq('company_id',company):{data:[],error:null};
 if(invitedAllowed.error) { logActionFailure('teamChoices',{code:invitedAllowed.error.code,message:'the invited switches were not read'}); return null; }
 return {
  members:orderMembers((members.data||[]) as unknown as TeamData['members']),
  invitations:(invitations.data||[]) as unknown as TeamData['invitations'],
  agents:(agents.data||[]) as unknown as TeamData['agents'],
  allowed:(allowed.data||[]).map(row=>`${row.person_id}:${row.agent_id}`),
  invitedAllowed:(invitedAllowed.data||[]).map(row=>`${row.invitation_id}:${row.agent_id}`),
 };
});
