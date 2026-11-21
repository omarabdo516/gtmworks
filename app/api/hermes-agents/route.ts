import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { moveAgentMorning } from '@/lib/agent-morning.mjs';

const columns='id,company_id,connection_id,name,speciality,is_default';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function respond(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'hermesNotAllowed'},401);
  const writing=request.method==='POST';
  if(writing&&(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers))) return reply({error:'hermesNotAllowed'},403);
  const raw=writing?await request.text():''; if(raw.length>4000) return reply({error:'hermesAgentFailed'},400);
  const body=writing?JSON.parse(raw):Object.fromEntries(request.nextUrl.searchParams);
  if(typeof body.company!=='string'||!uuid.test(body.company)) return reply({error:'hermesAgentFailed'},400);
  const {data:company}=await db.from('companies').select('id').eq('id',body.company).maybeSingle();
  if(!company) return reply({error:'hermesAgentNotFound'},404);
  if(!await routeAllowed(db,'app/api/hermes-agents/route.ts',request.method,body.company,user.id)) return reply({error:'hermesNotAllowed'},403);
  if(writing) {
   if(!['default','remove'].includes(body.intent)||!body.agent||['agent','replacement'].some(key=>body[key]!==undefined&&(typeof body[key]!=='string'||!uuid.test(body[key])))) return reply({error:'hermesAgentFailed'},400);
   // The Agents before the change, with their Engine profiles: the main Agent's daily message (#182) moves to the new main
   // Agent once the database made it so, by Make it main or by removing the main Agent with a replacement. Read first, so a
   // removed Agent's profile is still known.
   const listed=(await db.rpc('company_app_agents',{c:body.company})).data as {agent:string,main:boolean}[]|null;
   const before=Array.isArray(listed)?listed.find(row=>row.main)?.agent:undefined;
   const {error}=await db.rpc('manage_hermes_agent',{c:body.company,intent:body.intent,a:body.agent,replacement:body.replacement??null});
   if(error) {
    const key=['hermesNextDefault','hermesAgentNotFound','hermesNotAllowed'].includes(error.message)?error.message:'hermesAgentFailed';
    return reply({error:key},error.code==='42501'?403:error.code==='P0002'?404:key==='hermesNextDefault'?409:400);
   }
   // Good morning follows the main Agent, with the same time and switch, and none is left on another one; with no Agent
   // left to take it, it is paused. The change itself stands whatever the Engine answers; a failure is said in the log.
   if(before&&(body.intent==='default'?body.agent!==before:body.agent===before)) {
    const moved=await moveAgentMorning(db,{company:body.company,agents:listed}).catch(()=>({state:'failed'}));
    if(!['moved','paused','none'].includes(moved.state)) console.error('Good morning not settled on the main Agent:',body.company,moved.state);
   }
  }
  const {data:agents,error}=await db.from('hermes_agents').select(columns).eq('company_id',body.company).order('name');
  return error?reply({error:'hermesAgentFailed'},500):reply({agents});
 } catch { return reply({error:'hermesAgentFailed'},400); }
}
export const GET=respond;
export const POST=respond;
