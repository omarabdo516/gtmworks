import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeAgentRoutine } from '@/lib/agent-routines.mjs';

// One change to one Routine (#31): made, rescheduled, paused, resumed, run now or deleted, on the Agent's own Engine
// profile. The request runs as the signed-in person: company_app_agents lists only the Agents they see, and the database
// checks the Role again (check_routine_change: an Owner or a Manager) before the Engine is asked; the change the Engine
// holds is one row of the Company log (log_routine_change). A body that is not JSON, or not the shape asked for, is the
// caller's (400); anything else that throws is ours (500).
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
function refused(state:string) {
 if(state==='missing') return reply({error:'routineNotFound'},404);
 if(state==='invalid') return reply({error:'routineInvalid'},400);
 if(state==='notAllowed') return reply({error:'routineNotAllowed'},403);
 if(state==='busy') return reply({error:'routineBusy'},409);
 if(state==='refused') return reply({error:'routineRefused'},400);
 return reply({error:'routineFailed'},state==='unreachable'||state==='noEngine'?503:502);
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'routineNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'routineNotAllowed'},403);
  const raw=await request.text(); if(raw.length>20000) return reply({error:'routineInvalid'},400);
  let body:Record<string,unknown>|null=null;
  try { const parsed=JSON.parse(raw); body=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null; } catch { body=null; }
  if(!body||typeof body.company!=='string') return reply({error:'routineInvalid'},400);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.company)) return reply({error:'routineInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-routines/route.ts','POST',body.company,user.id)) return reply({error:'routineNotAllowed'},403);
  const changed=await changeAgentRoutine(db,{company:body.company,agent:body.agent,action:body.action,routine:body.routine,name:body.name,prompt:body.prompt,schedule:body.schedule,timezone:body.timezone});
  return changed.state==='done'?reply({routine:changed.routine}):refused(changed.state);
 } catch { return reply({error:'routineFailed'},500); }
}
