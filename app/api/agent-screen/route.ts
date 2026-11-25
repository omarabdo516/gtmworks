import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { readAgentScreen, wakeAgentScreen } from '@/lib/agent-screen.mjs';

// An Agent's Screen in its details (#712): GET reads its state for any Member who is shown the Agent, POST is "Wake it"
// for a Member who is not a Viewer. The request runs as the signed-in person: company_app_agents lists only the Agents
// they see, so a hidden Agent is not found, and the database checks the Role again (check_screen_wake) before the Engine
// is asked to start it, then logs the wake (log_screen_woken). No answer names the Engine, its address or its words: a
// refused start is one of the reasons the page has a line for.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const identified=(body:{company?:unknown,agent?:unknown}|null):body is {company:string,agent:string}=>
 typeof body?.company==='string'&&uuid.test(body.company)&&typeof body.agent==='string'&&uuid.test(body.agent);

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentScreenNotAllowed'},401);
  const body=Object.fromEntries(request.nextUrl.searchParams);
  if(!identified(body)) return reply({error:'agentScreenInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-screen/route.ts','GET',body.company,user.id)) return reply({error:'agentScreenNotAllowed'},403);
  const read=await readAgentScreen(db,{company:body.company,agent:body.agent});
  if(read.state==='missing') return reply({error:'agentScreenNotFound'},404);
  if(read.state!=='found') return reply({error:'agentScreenUnreachable'},503);
  return reply({screen:read.screen});
 } catch { return reply({error:'agentScreenFailed'},500); }
}

export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentScreenNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentScreenNotAllowed'},403);
  const raw=await request.text(); if(raw.length>2000) return reply({error:'agentScreenInvalid'},400);
  let body:{company?:unknown,agent?:unknown}|null=null;
  try { const parsed=JSON.parse(raw); body=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null; } catch { body=null; }
  if(!identified(body)) return reply({error:'agentScreenInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-screen/route.ts','POST',body.company,user.id)) return reply({error:'agentScreenNotAllowed'},403);
  const woken=await wakeAgentScreen(db,{company:body.company,agent:body.agent});
  if(woken.state==='awake') return reply({screen:'awake'});
  if(woken.state==='notStarted') return reply({error:'agentScreenNotStarted',reason:woken.reason,...(woken.busy?{busy:woken.busy}:{})},409);
  if(woken.state==='notAllowed') return reply({error:'agentScreenNotAllowed'},403);
  if(woken.state==='missing') return reply({error:'agentScreenNotFound'},404);
  return reply({error:'agentScreenUnreachable'},woken.state==='unreachable'?503:502);
 } catch { return reply({error:'agentScreenFailed'},500); }
}
