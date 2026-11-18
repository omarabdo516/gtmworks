import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { readAgentMemory, resetAgentMemory } from '@/lib/agent-memory.mjs';

// An Agent's memory (#350): the notes of its own Engine profile, read for any Member who is shown the Agent, and the
// Owner's reset of them. The request runs as the signed-in person: company_app_agents lists only the Agents they see, so
// an Agent hidden from them is not found, and the database checks the Owner again (check_memory_reset). A reset writes
// one row of the Company log (log_memory_reset) and carries no note text either way.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
function refused(state:string) {
 if(state==='missing') return reply({error:'agentMemoryNotFound'},404);
 if(state==='invalid') return reply({error:'agentMemoryInvalid'},400);
 if(state==='notAllowed') return reply({error:'agentMemoryNotAllowed'},403);
 return reply({error:'agentMemoryFailed'},state==='unreachable'||state==='noEngine'?503:502);
}
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentMemoryNotAllowed'},401);
  const body=Object.fromEntries(request.nextUrl.searchParams);
  if(typeof body.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)) return reply({error:'agentMemoryInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-memory/route.ts','GET',body.company,user.id)) return reply({error:'agentMemoryNotAllowed'},403);
  const read=await readAgentMemory(db,{company:body.company,agent:body.agent});
  return read.state==='found'?reply({notes:read.notes,main:read.main}):refused(read.state);
 } catch { return reply({error:'agentMemoryInvalid'},400); }
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentMemoryNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentMemoryNotAllowed'},403);
  const raw=await request.text(); if(raw.length>1000) return reply({error:'agentMemoryInvalid'},400);
  const body=JSON.parse(raw) as {company?:unknown,agent?:unknown}|null;
  if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)) return reply({error:'agentMemoryInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-memory/route.ts','POST',body.company,user.id)) return reply({error:'agentMemoryNotAllowed'},403);
  const reset=await resetAgentMemory(db,{company:body.company,agent:body.agent});
  return reset.state==='reset'?reply({reset:true}):refused(reset.state);
 } catch { return reply({error:'agentMemoryInvalid'},400); }
}
