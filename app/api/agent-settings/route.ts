import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanySetting, changeCompanySettings, changeLearningMode, readAgentSettings } from '@/lib/engine-settings.mjs';

// The Engine settings gtmworks shows and changes (#125). Any active Member reads the listed settings of one Agent (or of
// every Agent); only an active Owner writes one, which lib/engine-settings.mjs checks again on the server and writes
// through the Engine to the Agent's profile, or for the whole Company to each Agent profile and the shared space. A
// setting is never a credential: the reader drops every value whose key ends api_key, and no value is logged here.
// A learning mode (#28) is the one write that is two settings at once, both write approvals: `mode` "ask" or "auto",
// for the whole Company or one Agent, with the same Owner check, read-back and log rows.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
// The service answers an outcome, and this route decides its status and error code: a refused Role, an Agent not there,
// a shared profile, an Engine away, or a read-back that did not match.
function outcomeReply(result:Record<string,unknown>&{state?:string}) {
 const {state,...body}=result;
 if(state==='written') return reply(body);
 if(state==='invalid') return reply({error:'settingInvalid',...(body.problem?{problem:body.problem}:{})},400);
 if(state==='notAllowed') return reply({error:'settingNotAllowed'},403);
 if(state==='agentUnknown') return reply({error:'settingAgentUnknown'},404);
 if(state==='noEngine') return reply({error:'settingNoEngine'},409);
 if(state==='shared') return reply({error:'settingAgentShared'},409);
 if(state==='subagentsOff') return reply({error:'settingSubagentsOff'},409);
 if(state==='noDefault') return reply({error:'settingNoDefault'},409);
 if(state==='notEnabled') return reply({error:'settingModelNotEnabled'},409);
 if(state==='unknown') return reply({error:'settingUnknown'},400);
 if(state==='installOnly') return reply({error:'settingInstallOnly'},409);
 if(state==='mismatch') return reply({error:'settingMismatch'},502);
 if(state==='unreachable') return reply({error:'settingFailed'},503);
 return reply({error:'settingFailed'},502);
}
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'settingNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(typeof company!=='string'||!uuid.test(company)) return reply({error:'settingInvalid'},400);
  const agent=request.nextUrl.searchParams.get('agent');
  if(agent!==null&&!uuid.test(agent)) return reply({error:'settingInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-settings/route.ts','GET',company,user.id)) return reply({error:'settingNotAllowed'},403);
  return reply(await readAgentSettings(db,{company,agent}));
 } catch { return reply({error:'settingFailed'},502); }
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'settingNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'settingNotAllowed'},403);
  const raw=await request.text(); if(raw.length>8000) return reply({error:'settingInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'settingInvalid'},400);
  if(body.agent!==undefined&&(typeof body.agent!=='string'||!uuid.test(body.agent))) return reply({error:'settingInvalid'},400);
  // A learning mode is "ask" or "auto" for the Company or one Agent; "follow" gives one Agent back to the Company's own
  // mode (#28), so it names that Agent.
  if(body.mode!==undefined&&body.mode!=='ask'&&body.mode!=='auto'&&!(body.mode==='follow'&&typeof body.agent==='string')) return reply({error:'settingInvalid'},400);
  if(body.mode===undefined&&body.settings!==undefined) {
   if(typeof body.settings!=='object'||Array.isArray(body.settings)||!Object.keys(body.settings).length) return reply({error:'settingInvalid'},400);
   for(const [setting,value] of Object.entries(body.settings)) {
    if(typeof setting!=='string'||setting.length>120||setting.length<1||!['string','number','boolean'].includes(typeof value)) return reply({error:'settingInvalid'},400);
   }
  }
  if(body.mode===undefined&&body.settings===undefined&&(typeof body.setting!=='string'||body.setting.length>120||body.setting.length<1)) return reply({error:'settingInvalid'},400);
  // A model of null is the Agent following the Company default again; every other setting takes a string, number or
  // boolean. A model is written through the Engine's profile route, never PUT /api/config (lib/engine-settings.mjs).
  const followsDefault=body.setting==='model'&&body.value===null;
  if(body.mode===undefined&&body.settings===undefined&&!followsDefault&&!['string','number','boolean'].includes(typeof body.value)) return reply({error:'settingInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-settings/route.ts','POST',body.company,user.id)) return reply({error:'settingNotAllowed'},403);
  const result=body.mode!==undefined?await changeLearningMode(db,{company:body.company,agent:body.agent,mode:body.mode})
   :body.settings!==undefined?await changeCompanySettings(db,{company:body.company,agent:body.agent,settings:body.settings})
   :await changeCompanySetting(db,{company:body.company,agent:body.agent,setting:body.setting,value:body.value});
  return outcomeReply(result);
 } catch { return reply({error:'settingFailed'},500); }
}
