import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { speakAgentSample } from '@/lib/agent-voice.mjs';
import { speakLimit } from '@/lib/hermes.mjs';

// The Voice section's "Listen" (#162): the Engine speaks the sample sentence with the Agent's saved voice and speed, and
// the page plays what it answers. Only an Owner or a Manager asks, here and again in the database (check_agent_setting),
// because the sound is made on the Agent's profile. The Engine's route takes the text alone (v0.23.0
// hermes_cli/web_routers/audio.py 298-352); the sound comes back as a data URL, and neither the text nor the answer is
// logged. A provider that cannot speak, a sound past the reading cap and an Engine away are all "no sound to play".
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'voiceNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'voiceNotAllowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,agent?:unknown,text?:unknown}|null;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)
  ||typeof body.text!=='string'||!body.text.trim()||body.text.length>speakLimit) return reply({error:'voiceInvalid'},400);
 if(!await routeAllowed(db,'app/api/agent-speak/route.ts','POST',body.company,user.id)) return reply({error:'voiceNotAllowed'},403);
 try {
  const spoken=await speakAgentSample(db,{company:body.company,agent:body.agent,text:body.text});
  if(spoken.state==='spoken') return reply({dataUrl:spoken.dataUrl,mimeType:spoken.mimeType});
  if(spoken.state==='notAllowed') return reply({error:'voiceNotAllowed'},403);
  if(spoken.state==='noEngine'||spoken.state==='unreachable') return reply({error:'voiceUnavailable'},503);
  return reply({error:'voiceUnavailable'},502);
 } catch { return reply({error:'voiceUnavailable'},500); }
}
