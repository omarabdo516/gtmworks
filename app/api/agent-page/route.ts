import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { secretLike } from '@/lib/secret-text.mjs';
import { changeAgentAbout } from '@/lib/agent-about.mjs';
import { changeAgentInstructions } from '@/lib/agent-instructions.mjs';
import { changeAgentVoice } from '@/lib/agent-voice.mjs';
import { changeAgentEffort } from '@/lib/agent-effort.mjs';
import { changeAgentMorning } from '@/lib/agent-morning.mjs';
import { changeCompanySkillEnabled } from '@/lib/company-skills.mjs';

// One Agent's settings page (#161, #162, #176, #179, #180): every changed field is saved at once on the Agent's own Engine
// profile. The request runs as the signed-in person; the route accepts an Owner or a Manager, and each field is checked
// again by the database before the Engine is written, then logged. `changes` holds a key per field: `about` is the
// profile's description (check_agent_setting / log_agent_setting); `instructions` is the profile's SOUL.md outside the
// team's rules section, written by the Owner alone (check_agent_owner_setting); `voice` is the Voice section's values,
// its speaking language, speed and voice (check_agent_setting / log_agent_setting); `effort` is the thinking level, the
// Owner's alone (check_agent_owner_setting / log_engine_setting, with old and new); and `skill:<name>` is one Skill's
// switch, "on" or "off" (hold_agent_change, one row per Skill); `morning` is the main Agent's daily message (#182),
// `{on, time, zone}`, a job of its own Engine profile (check_agent_setting / log_agent_morning). Later fields join with their own
// checks. Nothing in this body reaches a log, and the Engine's answer is what the page shows.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skillName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// The largest body this page may send: How it works can reach the Engine's own 500,000-character son cap, with the rest
// of the draft beside it.
const bodyLimit=600000;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
// Each refusal of a field, as the page's answer: a person not allowed or an Agent not theirs, a malformed or too long
// field or a voice the Engine does not offer, no Engine, or the Engine's own failure.
const refused=(state:string)=>state==='notOwn'||state==='notAllowed'?reply({error:'agentPageNotAllowed'},403)
 :state==='invalid'||state==='tooLong'||state==='noVoices'||state==='shared'||state==='essential'||state==='notMain'?reply({error:'agentPageInvalid'},400)
 :state==='noEngine'?reply({error:'agentPageNoEngine'},503):reply({error:'agentPageFailed'},502);
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'agentPageNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentPageNotAllowed'},403);
 const raw=await request.text();
 if(!raw.length||raw.length>bodyLimit) return reply({error:'agentPageInvalid'},400);
 let body:{company?:unknown,agent?:unknown,changes?:unknown}|null=null;
 try { body=JSON.parse(raw) as {company?:unknown,agent?:unknown,changes?:unknown}|null; } catch { return reply({error:'agentPageInvalid'},400); }
 const changes=body?.changes&&typeof body.changes==='object'&&!Array.isArray(body.changes)?body.changes as Record<string,unknown>:null;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)||!changes||!Object.keys(changes).length) return reply({error:'agentPageInvalid'},400);
 // Every field is read before any write: one malformed key saves nothing.
 const about=typeof changes.about==='string'?changes.about:undefined;
 const instructions=typeof changes.instructions==='string'?changes.instructions:undefined;
 const effort=typeof changes.effort==='string'?changes.effort:undefined;
 const voice=changes.voice;
 const morning=changes.morning as {on?:unknown,time?:unknown,zone?:unknown}|undefined;
 // A key pasted into About or How it works is refused here, as the note and Skill writes refuse it, before any write.
 if((about!==undefined&&secretLike(about))||(instructions!==undefined&&secretLike(instructions))) return reply({error:'agentPageInvalid'},400);
 const skills:Record<string,boolean>={};
 for(const [key,value] of Object.entries(changes)) {
  if(key==='about'||key==='instructions'||key==='effort') { if(typeof value!=='string') return reply({error:'agentPageInvalid'},400); continue; }
  if(key==='voice'||key==='morning') { if(!value||typeof value!=='object'||Array.isArray(value)) return reply({error:'agentPageInvalid'},400); continue; }
  const name=key.startsWith('skill:')?key.slice(6):null;
  if(!name||!skillName.test(name)||(value!=='on'&&value!=='off')) return reply({error:'agentPageInvalid'},400);
  skills[name]=value==='on';
 }
 if(!await routeAllowed(db,'app/api/agent-page/route.ts','POST',body.company,user.id)) return reply({error:'agentPageNotAllowed'},403);
 try {
  const saved:Record<string,unknown>={}; let sectionChars:number|undefined;
  // Good morning first: a refusal of it leaves every other field of the save unwritten too.
  if(morning!==undefined) {
   const changed=await changeAgentMorning(db,{company:body.company,agent:body.agent,on:morning.on,time:morning.time,zone:morning.zone});
   if(changed.state!=='written') return refused(changed.state);
   saved.morning=changed.morning;
  }
  if(about!==undefined) {
   const changed=await changeAgentAbout(db,{company:body.company,agent:body.agent,description:about});
   if(changed.state!=='written') return refused(changed.state);
   saved.about=changed.description;
  }
  if(instructions!==undefined) {
   const changed=await changeAgentInstructions(db,{company:body.company,agent:body.agent,instructions});
   if(changed.state!=='written') return refused(changed.state);
   saved.instructions=changed.instructions; sectionChars=changed.sectionChars;
  }
  if(effort!==undefined) {
   const changed=await changeAgentEffort(db,{company:body.company,agent:body.agent,effort});
   if(changed.state!=='written') return refused(changed.state);
   saved.effort=changed.effort;
  }
  if(voice!==undefined) {
   const changed=await changeAgentVoice(db,{company:body.company,agent:body.agent,voice});
   if(changed.state!=='written') return refused(changed.state);
   saved.voice=changed.voice;
  }
  for(const [name,enabled] of Object.entries(skills)) {
   const changed=await changeCompanySkillEnabled(db,{company:body.company,agent:body.agent,name,enabled});
   if(changed.state!=='changed') return refused(changed.state);
   saved[`skill:${name}`]=enabled?'on':'off';
  }
  return reply({saved,...(sectionChars===undefined?{}:{sectionChars})});
 } catch { return reply({error:'agentPageFailed'},500); }
}
