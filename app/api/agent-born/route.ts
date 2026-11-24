import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { uuid } from '@/lib/conversations';

// A made Agent is born once for the person who asked for it (#701): its card and its sidebar tile ask after they have
// mounted, and the database answers true only for the first call from that Agent's requester (mark_agent_born). A
// reload, another device or another Member is answered false, so the birth plays once. The Company is the Agent's own,
// as this reader may read it.
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'Session unavailable'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'Not allowed'},403);
 const body=await request.json().catch(()=>null) as {agent?:unknown}|null;
 if(typeof body?.agent!=='string'||!uuid.test(body.agent)) return reply({error:'Invalid request'},400);
 const {data:agent}=await db.from('hermes_agents').select('company_id').eq('id',body.agent).maybeSingle();
 if(!agent) return reply({born:false});
 if(!await routeAllowed(db,'app/api/agent-born/route.ts','POST',agent.company_id,user.id)) return reply({error:'Not allowed'},403);
 const {data,error}=await db.rpc('mark_agent_born',{agent:body.agent});
 if(error) return reply({error:'Could not record it'},500);
 return reply({born:data===true});
}
