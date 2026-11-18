import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeAgentAbout } from '@/lib/agent-about.mjs';

// One Agent's settings page (#161): its About is saved at once on the Agent's own Engine profile. The request runs as the
// signed-in person; the route accepts an Owner or a Manager, and the database checks it again (check_agent_setting)
// before the Engine is written, then logs the change (log_agent_setting). Later fields join `changes` here with their
// own server checks. Nothing in this body reaches a log, and the Engine's answer is what the page shows.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'agentPageNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentPageNotAllowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,agent?:unknown,changes?:unknown}|null;
 const changes=body?.changes&&typeof body.changes==='object'&&!Array.isArray(body.changes)?body.changes as Record<string,unknown>:null;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)||typeof changes?.about!=='string') return reply({error:'agentPageInvalid'},400);
 if(!await routeAllowed(db,'app/api/agent-page/route.ts','POST',body.company,user.id)) return reply({error:'agentPageNotAllowed'},403);
 try {
  const changed=await changeAgentAbout(db,{company:body.company,agent:body.agent,description:changes.about});
  if(changed.state==='written') return reply({saved:{about:changed.description}});
  if(changed.state==='notOwn'||changed.state==='notAllowed') return reply({error:'agentPageNotAllowed'},403);
  if(changed.state==='invalid') return reply({error:'agentPageInvalid'},400);
  if(changed.state==='noEngine') return reply({error:'agentPageNoEngine'},503);
  return reply({error:'agentPageFailed'},502);
 } catch { return reply({error:'agentPageFailed'},500); }
}
