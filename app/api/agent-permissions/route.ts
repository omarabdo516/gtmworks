import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { revokeAgentPermission } from '@/lib/standing-permissions.mjs';

// "Revoke" on one of an Agent's standing permissions (#166): the entry leaves the Agent's own Engine profile and the
// Agent asks again. The request runs as the signed-in person: an Agent hidden from them is not found, and the database
// checks the Role again (check_permission_revoke) before the Engine is written and when the revoke is logged. An entry
// already gone answers gone, so the page drops its row with nothing logged.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
function refused(state:string) {
 if(state==='missing') return reply({error:'agentPermissionNotFound'},404);
 if(state==='invalid') return reply({error:'agentPermissionInvalid'},400);
 if(state==='notAllowed') return reply({error:'agentPermissionNotAllowed'},403);
 return reply({error:'agentPermissionFailed'},state==='unreachable'||state==='noEngine'?503:502);
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentPermissionNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentPermissionNotAllowed'},403);
  const raw=await request.text(); if(raw.length>8000) return reply({error:'agentPermissionInvalid'},400);
  let body:{company?:unknown,agent?:unknown,entry?:unknown}|null=null;
  try { const parsed=JSON.parse(raw); body=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null; } catch { body=null; }
  if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)||typeof body.entry!=='string') return reply({error:'agentPermissionInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-permissions/route.ts','POST',body.company,user.id)) return reply({error:'agentPermissionNotAllowed'},403);
  const revoked=await revokeAgentPermission(db,{company:body.company,agent:body.agent,entry:body.entry});
  return revoked.state==='revoked'||revoked.state==='gone'?reply({revoked:revoked.state==='revoked'}):refused(revoked.state);
 } catch { return reply({error:'agentPermissionFailed'},500); }
}
