import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeAgentAbout } from '@/lib/agent-about.mjs';
import { changeAgentInstructions } from '@/lib/agent-instructions.mjs';

// One Agent's settings page (#161, #176): each field it edits is saved at once on the Agent's own Engine profile. About
// is its description, written by an Owner or a Manager; the standing instructions are the profile's SOUL.md outside the
// team's rules section, written by the Owner alone. The request runs as the signed-in person; the route is the Owner or a
// Manager gate, and each key adds its own database check before the Engine is written (check_agent_setting for About,
// check_agent_owner_setting for the instructions), then logs its change. Later fields join `changes` here with their own
// server checks. Nothing in this body reaches a log, and the Engine's answer is what the page shows.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields=['about','instructions'] as const;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const refused=(state:string)=>state==='notOwn'||state==='notAllowed';
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'agentPageNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentPageNotAllowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,agent?:unknown,changes?:unknown}|null;
 const changes=body?.changes&&typeof body.changes==='object'&&!Array.isArray(body.changes)?body.changes as Record<string,unknown>:null;
 const sent=changes?Object.keys(changes):[];
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)||!changes||!sent.length
  ||sent.some(key=>!fields.includes(key as typeof fields[number])||typeof changes[key]!=='string')) return reply({error:'agentPageInvalid'},400);
 if(!await routeAllowed(db,'app/api/agent-page/route.ts','POST',body.company,user.id)) return reply({error:'agentPageNotAllowed'},403);
 try {
  const saved:Record<string,string>={}; let sectionChars:number|undefined;
  if(typeof changes.about==='string') {
   const changed=await changeAgentAbout(db,{company:body.company,agent:body.agent,description:changes.about});
   if(changed.state==='written') saved.about=changed.description;
   else if(refused(changed.state)) return reply({error:'agentPageNotAllowed'},403);
   else if(changed.state==='invalid') return reply({error:'agentPageInvalid'},400);
   else if(changed.state==='noEngine') return reply({error:'agentPageNoEngine'},503);
   else return reply({error:'agentPageFailed'},502);
  }
  if(typeof changes.instructions==='string') {
   const changed=await changeAgentInstructions(db,{company:body.company,agent:body.agent,instructions:changes.instructions});
   if(changed.state==='written') { saved.instructions=changed.instructions; sectionChars=changed.sectionChars; }
   else if(refused(changed.state)) return reply({error:'agentPageNotAllowed'},403);
   else if(changed.state==='invalid'||changed.state==='tooLong') return reply({error:'agentPageInvalid'},400);
   else if(changed.state==='noEngine') return reply({error:'agentPageNoEngine'},503);
   else return reply({error:'agentPageFailed'},502);
  }
  return reply({saved,...(sectionChars===undefined?{}:{sectionChars})});
 } catch { return reply({error:'agentPageFailed'},500); }
}
