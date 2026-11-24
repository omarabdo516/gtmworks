import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { seeAgentFailure, wakeAgent, type FailurePlace } from '@/lib/agent-face-states';

// The reader opened a place or an Agent's chat (#699; app/sidebar-live OpenedHere): a failure of an Agent in that
// Conversation, channel or Card is seen by them (see_agent_failure), and the Agent whose chat they opened wakes for them
// (wake_agent). The page tells it once it has mounted; server rendering and link prefetch never call this. Both
// functions run as the reader and answer only for what they see. `changed` says whether a face may look different now.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const placeOf=(value:unknown):FailurePlace|null|undefined=>{
 if(value===undefined) return null;
 const place=value as Record<string,unknown>|null;
 if(!place||typeof place!=='object'||Object.keys(place).length!==1) return undefined;
 if(typeof place.conversation==='string'&&uuid.test(place.conversation)) return {conversation:place.conversation};
 if(typeof place.channel==='string'&&uuid.test(place.channel)) return {channel:place.channel};
 if(Number.isSafeInteger(place.card)&&(place.card as number)>0) return {card:place.card as number};
 return undefined;
};
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'Session unavailable'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'Not allowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,agent?:unknown,place?:unknown}|null;
 const place=placeOf(body?.place);
 const agent=body?.agent;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||place===undefined||(agent!==undefined&&(typeof agent!=='string'||!uuid.test(agent)))||(!place&&agent===undefined)) return reply({error:'Invalid request'},400);
 if(!await routeAllowed(db,'app/api/agent-face/route.ts','POST',body.company,user.id)) return reply({error:'Not allowed'},403);
 const [woke,seen]=await Promise.all([typeof agent==='string'?wakeAgent(db,body.company,agent):false,place?seeAgentFailure(db,body.company,place):0]);
 if(seen===null) return reply({error:'Could not record it'},500);
 return reply({changed:woke||seen>0});
}
