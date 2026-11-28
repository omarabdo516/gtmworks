'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { inviteRoleKeys } from '@/lib/member-roles.mjs';

const roles=new Set(inviteRoleKeys);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refusals:Record<string,string>={alreadyMember:'addMemberAlready',memberNotFromAdminCompany:'addMemberNotAllowed'};

// An Administrator adds a Person who is a Member of another Company they administer, from the Team page, with a Role and
// the Agents they will see and no link (#952, ADR 0019). add_company_member checks the Administrator, the other Company,
// the Role (never Administrator) and the Agents again, and writes the Member and their Agents in one transaction; the
// members trigger writes it in the Company log. The answer's error is a catalogue key, never the database's text.
export const addMemberFromCompany=withActionLog('addMemberFromCompany',async function addMemberFromCompany(company:string,person:string,role:string,agents:string[]):Promise<{error?:string}> {
 const db=await supabase();
 if(!await actionAllowed(db,'addMemberFromCompany',company)) return {error:'addMemberFailed'};
 if(!uuid.test(person) || !roles.has(role) || !Array.isArray(agents) || agents.some(agent=>typeof agent!=='string' || !uuid.test(agent))) return {error:'addMemberFailed'};
 const {error}=await db.rpc('add_company_member',{c:company,person,member_role:role,agents});
 if(error) {
  if(Object.hasOwn(refusals,error.message)) return {error:refusals[error.message]};
  logActionFailure('addMemberFromCompany',{code:error.code,message:'add_company_member refused'});
  return {error:'addMemberFailed'};
 }
 return {};
});
