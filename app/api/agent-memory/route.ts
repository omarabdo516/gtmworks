import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { editAgentMemory, forgetAgentMemory, readAgentMemory, resetAgentMemory } from '@/lib/agent-memory.mjs';

// An Agent's memory (#350): the notes of its own Engine profile, read for any Member who is shown the Agent, and the
// Owner's reset of them. The request runs as the signed-in person: company_app_agents lists only the Agents they see, so
// an Agent hidden from them is not found, and the database checks the Role again (check_memory_reset). A reset writes
// one row of the Company log (log_memory_reset) and carries no note text either way.
// One note is rewritten by an Owner or Manager (#191, check_memory_edit) and removed by the Owner alone
// (check_memory_forget); each change writes one row of the Company log with no note text.
// A body that is not JSON, or not the shape asked for, is the caller's (400); a note over the limit is a refusal (400,
// `agentMemoryRefused`) so the screen shows its own "That note is too long" line; anything else that throws is ours (500).
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One note's text is at most this long, and a body over the raw limit below cannot hold a note under it even with every
// character escaped: both are refused before anything is parsed or kept.
const memoryTextLimit=12000;
const rawLimit=memoryTextLimit*6+1024;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
function refused(state:string) {
 if(state==='missing') return reply({error:'agentMemoryNotFound'},404);
 if(state==='invalid') return reply({error:'agentMemoryInvalid'},400);
 if(state==='notAllowed') return reply({error:'agentMemoryNotAllowed'},403);
 if(state==='stale') return reply({error:'agentMemoryStale'},409);
 if(state==='refused') return reply({error:'agentMemoryRefused'},400);
 return reply({error:'agentMemoryFailed'},state==='unreachable'||state==='noEngine'?503:502);
}
// The body as JSON, or null when it is not JSON at all: a parse error is the request's, never the server's.
/** @param {string} raw */
function parsed(raw:string):Record<string,unknown>|null {
 try { const body=JSON.parse(raw); return body&&typeof body==='object'&&!Array.isArray(body)?body:null; }
 catch { return null; }
}
function identified<T extends {company?:unknown,agent?:unknown}>(body:T|null):body is T&{company:string,agent:string} {
 return typeof body?.company==='string'&&uuid.test(body.company)&&typeof body.agent==='string'&&uuid.test(body.agent);
}
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentMemoryNotAllowed'},401);
  const body=Object.fromEntries(request.nextUrl.searchParams);
  if(!identified(body)) return reply({error:'agentMemoryInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-memory/route.ts','GET',body.company,user.id)) return reply({error:'agentMemoryNotAllowed'},403);
  const read=await readAgentMemory(db,{company:body.company,agent:body.agent});
  return read.state==='found'?reply({notes:read.notes,main:read.main}):refused(read.state);
 } catch { return reply({error:'agentMemoryFailed'},500); }
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentMemoryNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentMemoryNotAllowed'},403);
  const raw=await request.text(); if(raw.length>1000) return reply({error:'agentMemoryInvalid'},400);
  const body=parsed(raw) as {company?:unknown,agent?:unknown}|null;
  if(!identified(body)) return reply({error:'agentMemoryInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-memory/route.ts','POST',body.company,user.id)) return reply({error:'agentMemoryNotAllowed'},403);
  const reset=await resetAgentMemory(db,{company:body.company,agent:body.agent});
  return reset.state==='reset'?reply({reset:true}):refused(reset.state);
 } catch { return reply({error:'agentMemoryFailed'},500); }
}
export async function PUT(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentMemoryNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentMemoryNotAllowed'},403);
  const raw=await request.text();
  // An over-long note is what the screen has a line for, so it is refused rather than called a malformed request.
  if(raw.length>rawLimit) return reply({error:'agentMemoryRefused'},400);
  const body=parsed(raw) as {company?:unknown,agent?:unknown,note?:unknown,text?:unknown}|null;
  if(!identified(body)||typeof body.note!=='string'||typeof body.text!=='string') return reply({error:'agentMemoryInvalid'},400);
  if(body.text.length>memoryTextLimit) return reply({error:'agentMemoryRefused'},400);
  if(!await routeAllowed(db,'app/api/agent-memory/route.ts','PUT',body.company,user.id)) return reply({error:'agentMemoryNotAllowed'},403);
  const edited=await editAgentMemory(db,{company:body.company,agent:body.agent,note:body.note,text:body.text});
  return edited.state==='edited'?reply({edited:true}):refused(edited.state);
 } catch { return reply({error:'agentMemoryFailed'},500); }
}
export async function DELETE(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentMemoryNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentMemoryNotAllowed'},403);
  const raw=await request.text(); if(raw.length>1000) return reply({error:'agentMemoryInvalid'},400);
  const body=parsed(raw) as {company?:unknown,agent?:unknown,note?:unknown}|null;
  if(!identified(body)||typeof body.note!=='string') return reply({error:'agentMemoryInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-memory/route.ts','DELETE',body.company,user.id)) return reply({error:'agentMemoryNotAllowed'},403);
  const forgotten=await forgetAgentMemory(db,{company:body.company,agent:body.agent,note:body.note});
  return forgotten.state==='forgotten'?reply({forgotten:true}):refused(forgotten.state);
 } catch { return reply({error:'agentMemoryFailed'},500); }
}
