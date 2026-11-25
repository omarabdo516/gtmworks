import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { agentScreenPicture } from '@/lib/agent-screen.mjs';

// One picture of an Agent's Screen (#712), for its card and its large view: the Engine's own grab, fetched by gtmworks
// and handed on from gtmworks's own address (ADR 0011), never cached. Any Member who is shown the Agent reads it; a
// hidden Agent is not found. While the Screen sleeps, or a person controls it (the picture may show what they type),
// there is no picture: the answer says which.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status:number)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentScreenNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company')??''; const agent=request.nextUrl.searchParams.get('agent')??'';
  if(!uuid.test(company)||!uuid.test(agent)) return reply({error:'agentScreenInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-screen/picture/route.ts','GET',company,user.id)) return reply({error:'agentScreenNotAllowed'},403);
  const picture=await agentScreenPicture(db,{company,agent});
  if(picture.state==='found') return new Response(Buffer.from(picture.body),{headers:{'Content-Type':picture.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(picture.state==='asleep'||picture.state==='withheld') return reply({picture:picture.state},409);
  if(picture.state==='missing') return reply({error:'agentScreenNotFound'},404);
  return reply({error:'agentScreenUnreachable'},picture.state==='unreachable'?503:502);
 } catch { return reply({error:'agentScreenFailed'},500); }
}
