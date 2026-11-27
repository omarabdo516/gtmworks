import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { visibleSections } from '@/lib/settings-overlay.mjs';
import { companyEngine } from '@/lib/engine/handle.mjs';
import { readCompanySignIns } from '@/lib/company-sign-in.mjs';
import { readCompanyModels } from '@/lib/engine-settings.mjs';
import { readCompanyKeys } from '@/lib/provider-keys.mjs';
import { readProviderModels } from '@/lib/provider-models.mjs';
import { readCompanySpeech } from '@/lib/company-speech.mjs';
import { managedUsage } from '@/lib/company-app-items';
import { readCompanyLearning } from '@/lib/company-learning.mjs';
import { readCompanySkillPage } from '@/lib/company-skill-page.mjs';
import { readCompanyRoutines } from '@/lib/agent-routines.mjs';
import { readKnowledge } from '@/lib/company-knowledge-skill.mjs';
import { readAgentAbout } from '@/lib/agent-about.mjs';
import { readAgentSkills } from '@/lib/company-skills.mjs';
import { readAgentInstructions } from '@/lib/agent-instructions.mjs';
import { readAgentVoice } from '@/lib/agent-voice.mjs';
import { readAgentPermissions } from '@/lib/standing-permissions.mjs';
import { readAgentMorning } from '@/lib/agent-morning.mjs';

// One part of Settings that the Engine backs (#791, #898, ADR 0030), read by the browser after its section is drawn, so
// no Settings page waits on the Engine: Models' sign-ins, model choices, provider keys, each Provider's models and
// speech-to-text; the work sandbox, usage, learning, a learned Skill's page, Routines and the Company knowledge text; and
// on an Agent's page its About, Skills, How it works, voice, standing permissions, model choices and Good morning. Each
// part is its own request, so one the Engine is slow to answer holds up no other, and the browser sends at most four at
// once (lib/settings-part-queue.mjs). Each part is read by the Roles its section opens for (lib/settings-overlay.mjs),
// with the reader's own session, so an Agent the reader is not shown reads as not found. `readAt` is when the read
// started, so a save the page holds from after it stands (app/settings-saved.ts). A part the Engine did not answer comes
// back as its unread shape, and the browser keeps its last good read.
const file='app/api/settings-parts/route.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skillName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
// The service client the key read settles key holds with (lib/provider-keys.mjs), as the keys route does.
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
type Db=Awaited<ReturnType<typeof supabase>>;
type Ask={db:Db,company:string,role:string,person:string,agent:string,skill:string,days:7|30};
// Each part: the section it is drawn in (read only by a Role that section opens for), whether it needs an Agent (or a
// Skill), and its read.
const parts:Record<string,{section:string,agent?:boolean,skill?:boolean,read:(ask:Ask)=>Promise<unknown>}>={
 signIns:{section:'models',read:({db,company})=>readCompanySignIns(db,{company})},
 models:{section:'models',read:({db,company,role})=>readCompanyModels(db,{company,owner:role==='owner'})},
 keys:{section:'models',read:({db,company})=>readCompanyKeys(db,service(),{company})},
 providers:{section:'models',read:({db,company})=>readProviderModels(db,{company})},
 speech:{section:'models',read:({db,company})=>readCompanySpeech(db,{company})},
 // Whether the Company's work sandbox answers (#398), from its own Engine's ssh backend.
 sandbox:{section:'company',read:async({company})=>{ try { return await (await companyEngine(company))?.on('default')?.files.sandbox()??{state:'unreachable'}; } catch { return {state:'unreachable'}; } }},
 // The token use of the period of every Company the reader manages (#347, #32).
 usage:{section:'usage',read:({person,days})=>managedUsage(person,days)},
 learning:{section:'learning',read:({db,company})=>readCompanyLearning(db,{company}).catch(()=>({state:'failed',agents:null,rules:null,lessons:null}))},
 skillPage:{section:'learning',agent:true,skill:true,read:({db,company,agent,skill,person})=>readCompanySkillPage(db,{company,agent,name:skill,person}).catch(()=>null)},
 routines:{section:'routines',read:({db,company})=>readCompanyRoutines(db,{company}).catch(()=>({state:'failed',agents:null}))},
 knowledge:{section:'knowledge',read:({db,company})=>readKnowledge(db,company).catch(()=>({state:'failed',parts:null}))},
 about:{section:'agents',agent:true,read:({db,company,agent})=>readAgentAbout(db,{company,agent})},
 skills:{section:'agents',agent:true,read:({db,company,agent})=>readAgentSkills(db,{company,agent})},
 how:{section:'agents',agent:true,read:({db,company,agent})=>readAgentInstructions(db,{company,agent})},
 voice:{section:'agents',agent:true,read:({db,company,agent})=>readAgentVoice(db,{company,agent})},
 permissions:{section:'agents',agent:true,read:({db,company,agent})=>readAgentPermissions(db,{company,agent}).catch(()=>({state:'failed',permissions:null}))},
 agentModel:{section:'agents',agent:true,read:({db,company,agent,role})=>readCompanyModels(db,{company,agent,owner:role==='owner'}).catch(()=>({models:null}))},
 morning:{section:'agents',agent:true,read:({db,company,agent})=>readAgentMorning(db,{company,agent}).catch(()=>({state:'failed'}))},
};
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'settingNotAllowed'},401);
  const query=request.nextUrl.searchParams;
  const company=query.get('company'); const name=query.get('part'); const agent=query.get('agent')??''; const skill=query.get('skill')??'';
  const part=name&&Object.hasOwn(parts,name)?parts[name]:null;
  if(typeof company!=='string'||!uuid.test(company)||!part||(part.agent&&!uuid.test(agent))||(part.skill&&!skillName.test(skill))) return reply({error:'settingInvalid'},400);
  if(!await routeAllowed(db,file,'GET',company,user.id)) return reply({error:'settingNotAllowed'},403);
  const {data:member}=await db.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
  const role=String(member?.role??'');
  if(!visibleSections(role).some(([key])=>key===part.section)) return reply({error:'settingNotAllowed'},403);
  const readAt=Date.now();
  return reply({data:await part.read({db,company,role,person:user.id,agent,skill,days:query.get('period')==='30'?30:7}),readAt});
 } catch { return reply({error:'settingFailed'},502); }
}
