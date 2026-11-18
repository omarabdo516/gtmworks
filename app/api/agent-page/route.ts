import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeAgentAbout } from '@/lib/agent-about.mjs';
import { changeCompanySkillEnabled } from '@/lib/company-skills.mjs';

// One Agent's settings page (#161, #180): every changed field is saved at once on the Agent's own Engine profile. The
// request runs as the signed-in person; the route accepts an Owner or a Manager, and each field is checked again by the
// database before the Engine is written, then logged. `changes` holds a key per field: `about` is the profile's
// description (check_agent_setting / log_agent_setting), and `skill:<name>` is one Skill's switch, "on" or "off"
// (check_skill_write / log_skill_change, one row per Skill). Later fields join with their own checks. Nothing in this
// body reaches a log, and the Engine's answer is what the page shows.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skillName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
// Each refusal of a field, as the page's answer: a person below Manager or an Agent not theirs, a malformed field, no
// Engine, or the Engine's own failure.
const refused=(state:string)=>state==='notOwn'||state==='notAllowed'?reply({error:'agentPageNotAllowed'},403)
 :state==='invalid'||state==='shared'||state==='essential'?reply({error:'agentPageInvalid'},400)
 :state==='noEngine'?reply({error:'agentPageNoEngine'},503):reply({error:'agentPageFailed'},502);
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'agentPageNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentPageNotAllowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,agent?:unknown,changes?:unknown}|null;
 const changes=body?.changes&&typeof body.changes==='object'&&!Array.isArray(body.changes)?body.changes as Record<string,unknown>:null;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.agent!=='string'||!uuid.test(body.agent)||!changes||!Object.keys(changes).length) return reply({error:'agentPageInvalid'},400);
 // Every field is read before any write: one malformed key saves nothing.
 const about=typeof changes.about==='string'?changes.about:undefined;
 const skills:Record<string,boolean>={};
 for(const [key,value] of Object.entries(changes)) {
  if(key==='about') { if(about===undefined) return reply({error:'agentPageInvalid'},400); continue; }
  const name=key.startsWith('skill:')?key.slice(6):null;
  if(!name||!skillName.test(name)||(value!=='on'&&value!=='off')) return reply({error:'agentPageInvalid'},400);
  skills[name]=value==='on';
 }
 if(!await routeAllowed(db,'app/api/agent-page/route.ts','POST',body.company,user.id)) return reply({error:'agentPageNotAllowed'},403);
 try {
  const saved:Record<string,string>={};
  if(about!==undefined) {
   const changed=await changeAgentAbout(db,{company:body.company,agent:body.agent,description:about});
   if(changed.state!=='written') return refused(changed.state);
   saved.about=changed.description;
  }
  for(const [name,enabled] of Object.entries(skills)) {
   const changed=await changeCompanySkillEnabled(db,{company:body.company,agent:body.agent,name,enabled});
   if(changed.state!=='changed') return refused(changed.state);
   saved[`skill:${name}`]=enabled?'on':'off';
  }
  return reply({saved});
 } catch { return reply({error:'agentPageFailed'},500); }
}
