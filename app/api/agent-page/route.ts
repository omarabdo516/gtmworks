import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeAgentAbout } from '@/lib/agent-about.mjs';
import { changeAgentVoice } from '@/lib/agent-voice.mjs';

// One Agent's settings page (#161, #162): each field is saved at once on the Agent's own Engine profile, from one request
// that names every field the person changed. The request runs as the signed-in person; the route accepts an Owner or a
// Manager, and the database checks it again (check_agent_setting) before the Engine is written, then logs the change
// (log_agent_setting). About is the profile's description; the voice is its speaking language, speed and voice. Later
// fields join `changes` here with their own server checks. Nothing in this body reaches a log, and the Engine's answer is
// what the page shows.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failure=(state:string)=>
 state==='notOwn'||state==='notAllowed'?{status:403,error:'agentPageNotAllowed'}
 :state==='noEngine'?{status:503,error:'agentPageNoEngine'}
 :state==='invalid'||state==='noVoices'?{status:400,error:'agentPageInvalid'}
 :{status:502,error:'agentPageFailed'};
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'agentPageNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentPageNotAllowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,agent?:unknown,changes?:unknown}|null;
 const changes=body?.changes&&typeof body.changes==='object'&&!Array.isArray(body.changes)?body.changes as Record<string,unknown>:null;
 const {about,voice}=changes??{};
 // Each field is its own shape: About is text, the voice is the section's three values as text (only the changed ones are
 // sent). A request that names no field, or one of another shape, changes nothing.
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)||!changes
  ||(about!==undefined&&typeof about!=='string')
  ||(voice!==undefined&&(!voice||typeof voice!=='object'||Array.isArray(voice)))
  ||(about===undefined&&voice===undefined)) return reply({error:'agentPageInvalid'},400);
 if(!await routeAllowed(db,'app/api/agent-page/route.ts','POST',body.company,user.id)) return reply({error:'agentPageNotAllowed'},403);
 try {
  const saved: Record<string, unknown> = {};
  if(about!==undefined) {
   const changed=await changeAgentAbout(db,{company:body.company,agent:body.agent,description:about});
   if(changed.state!=='written') { const failed=failure(changed.state); return reply({error:failed.error},failed.status); }
   saved.about=changed.description;
  }
  if(voice!==undefined) {
   const changed=await changeAgentVoice(db,{company:body.company,agent:body.agent,voice});
   if(changed.state!=='written') { const failed=failure(changed.state); return reply({error:failed.error},failed.status); }
   saved.voice=changed.voice;
  }
  return reply({saved});
 } catch { return reply({error:'agentPageFailed'},500); }
}
