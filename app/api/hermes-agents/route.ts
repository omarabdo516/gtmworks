import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { moveAgentMorning, withMorningLease } from '@/lib/agent-morning.mjs';
import { seenAgents } from '@/lib/engine/handle.mjs';

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
   // The change and Good morning's move (#182) run under the Company's lease, as a save of the message does, so neither
   // runs between the other's steps. The Agents are read first, with their Engine profiles, so a removed Agent's profile
   // is still known; without that list nothing is changed.
   const changed=await withMorningLease(db,body.company,async fence=>{
    const listing=await seenAgents(db,body.company);
    if(!listing) return reply({error:'hermesAgentFailed'},503);
    const listed=listing as {agent:string,main:boolean,profile?:string}[];
    // The change is a write as the Engine's are: it runs only while the lease is still this request's (a request whose
    // lease ran out changes nothing), and only once the Agents' profiles are kept with the lease, so a removed Agent's copy
    // of the message is reached by a later settle even if this one does not finish.
    if(!await fence.profiles?.(listed.map(row=>row.profile).filter((profile):profile is string=>typeof profile==='string'&&/^(co|ag)-[0-9a-f]{32}$/.test(profile)))) return {state:'busy'};
    // The lease is renewed and the change made in one transaction (manage_hermes_agent_leased).
    const {error}=await db.rpc('manage_hermes_agent_leased',{c:body.company,holder:fence.holder,intent:body.intent,a:body.agent,replacement:body.replacement??null});
    if(error?.message==='morningLeaseLost') return {state:'busy'};
    if(error) {
     const key=['hermesNextDefault','hermesAgentNotFound','hermesNotAllowed'].includes(error.message)?error.message:'hermesAgentFailed';
     return reply({error:key},error.code==='42501'?403:error.code==='P0002'?404:key==='hermesNextDefault'?409:400);
    }
    // Good morning follows the main Agent with the same time and switch, and none is left on another one; with no Agent
    // left to take it, it is paused. It is settled after every change here, whatever the Agents read first said. The
    // change itself stands whatever the Engine answers; a failure is said in the server log.
    // A move that loses the lease stops before its next Engine write (the change made here stands); it is said too.
    const moved=await moveAgentMorning(db,{company:body.company,agents:listed,fence}).catch(()=>({state:'busy'}));
    if(!['moved','paused','none'].includes(moved.state)) console.error('Good morning not settled on the main Agent:',body.company,moved.state);
    return null;
   });
   if(changed&&'state' in changed) return reply({error:changed.state==='notAllowed'?'hermesNotAllowed':'hermesAgentFailed'},changed.state==='notAllowed'?403:changed.state==='busy'?409:500);
   if(changed) return changed;
  }
  const {data:agents,error}=await db.from('hermes_agents').select(columns).eq('company_id',body.company).order('name');
  return error?reply({error:'hermesAgentFailed'},500):reply({agents});
 } catch { return reply({error:'hermesAgentFailed'},400); }
}
export const GET=respond;
export const POST=respond;
