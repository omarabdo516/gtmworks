import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { speakAgentSample, voiceSample } from '@/lib/agent-voice.mjs';

// The Voice section's "Listen" (#162): the Engine speaks the sample sentence with the Agent's saved voice and speed, and
// the page plays what it answers. Only an Owner or a Manager asks, here and again in the database (check_agent_setting),
// because the sound is made on the Agent's profile. The server builds the sentence itself, from the reader's own name in
// their language, and never speaks text the browser sent. The Engine's route takes the text alone (v0.23.0
// hermes_cli/web_routers/audio.py 298-352); the sound comes back as a data URL, and neither the text nor the answer is
// logged. A provider that cannot speak, a sound past the reading cap and an Engine away are all "no sound to play".
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'voiceNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'voiceNotAllowed'},403);
 const raw=await request.text(); if(raw.length>2000) return reply({error:'voiceInvalid'},400);
 let body:{company?:unknown,agent?:unknown}|null=null;
 try { body=JSON.parse(raw) as {company?:unknown,agent?:unknown}|null; } catch { return reply({error:'voiceInvalid'},400); }
 // Any text the browser sends is ignored: the sample is the server's own.
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)) return reply({error:'voiceInvalid'},400);
 if(!await routeAllowed(db,'app/api/agent-speak/route.ts','POST',body.company,user.id)) return reply({error:'voiceNotAllowed'},403);
 try {
  const {data:reader,error}=await db.from('people').select('name,language').eq('id',user.id).single();
  if(error||!reader) return reply({error:'voiceUnavailable'},500);
  const sample=voiceSample(reader.language,reader.name);
  const spoken=await speakAgentSample(db,{company:body.company,agent:body.agent,text:sample});
  if(spoken.state==='spoken') return reply({dataUrl:spoken.dataUrl,mimeType:spoken.mimeType});
  if(spoken.state==='notAllowed') return reply({error:'voiceNotAllowed'},403);
  if(spoken.state==='noEngine'||spoken.state==='unreachable') return reply({error:'voiceUnavailable'},503);
  return reply({error:'voiceUnavailable'},502);
 } catch { return reply({error:'voiceUnavailable'},500); }
}
