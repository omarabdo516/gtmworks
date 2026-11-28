'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { orderMembers } from '@/lib/member-roles.mjs';
import { addablePeople } from '@/lib/addable-people.mjs';
import type { TeamData } from './team-table';

// The Team dialog's data (#187): the Members, the Agents and which ones each Member sees, and the email invitations
// ended by #953 for an Administrator or a Manager to read. It is read with the signed-in person's session, so row-level
// security decides the rows (supabase/tests/member_agent_visibility.sql), and only an Administrator or a Manager reaches
// it at all: anyone else gets nothing back, as Settings, Company shows them no table. A pending Invite link is read only
// for an Administrator (#951), and so are the People they may add from another Company they administer (#952).
export const teamChoices=withActionLog('teamChoices',async function teamChoices(company:string):Promise<TeamData|null> {
 const db=await supabase();
 if(!await actionAllowed(db,'teamChoices',company)) return null;
 const [agents,members,allowed,ended]=await Promise.all([
  db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',company).order('is_default',{ascending:false}).order('name'),
  db.from('members').select('person_id,role,people(name)').eq('company_id',company).is('removed_at',null),
  db.from('member_agent_access').select('person_id,agent_id').eq('company_id',company),
  db.from('member_invitations').select('id,email,role').eq('company_id',company).is('claimed_at',null).not('ended_at','is',null).order('created_at'),
 ]);
 const links=await actionAllowed(db,'makeInviteLink',company)?await db.rpc('pending_invite_links',{c:company}):null;
 const failure=agents.error||members.error||allowed.error||ended.error||links?.error;
 if(failure) { logActionFailure('teamChoices',{code:failure.code,message:'the Team table was not read'}); return null; }
 // A failed read of the add list leaves the table as it is; the section is simply not offered.
 const candidates=await addablePeople(db,company).catch(error=>{
  logActionFailure('teamChoices',{code:error?.code,message:'the people from other Companies were not read'});
  return [];
 });
 return {
  members:orderMembers((members.data||[]) as unknown as TeamData['members']),
  ended:(ended.data||[]) as unknown as TeamData['ended'],
  links:(links?.data||[]) as unknown as TeamData['links'],
  agents:(agents.data||[]) as unknown as TeamData['agents'],
  allowed:(allowed.data||[]).map(row=>`${row.person_id}:${row.agent_id}`),
  candidates,
 };
});
