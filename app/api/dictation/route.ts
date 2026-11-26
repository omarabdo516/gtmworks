import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { agentEngine, seenAgents } from '@/lib/engine/handle.mjs';
import { bodyLengthRefused } from '@/lib/attachments.mjs';

// Voice dictation (#160): one recording becomes text on the Engine, for the Agent the Member is writing to, on that
// Agent's own profile. In a channel it is the Company's main Agent. The recording is the only thing this route receives
// and nothing keeps it: no row, no file and no log line names it, and the answer is its words or why there are none.
// A Member may dictate only for an Agent they see in their own Company (the row-level policies decide, as on every read);
// a hidden Agent, another Company's Agent or a channel they cannot see is not found.
const file = 'app/api/dictation/route.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const maxBody=Math.ceil(25*1024*1024/3)*4+2048;

// The Agent whose profile transcribes: the one named, or the Company's main Agent for a channel. Both are read under the
// caller's own session, so an Agent or channel they cannot see reads as absent.
// The Agent whose profile listens: the one named, or in a channel the main Agent, as the reader sees it (the Engine handle).
async function spokenFor(db:Awaited<ReturnType<typeof supabase>>,company:string,body:{agent?:unknown,channel?:unknown}) {
 let agent=body.agent;
 if(body.channel!==undefined) {
  if(typeof body.channel!=='string'||!uuid.test(body.channel)) return null;
  const {data:channel}=await db.from('channels').select('id').eq('id',body.channel).eq('company_id',company).maybeSingle();
  if(!channel) return null;
  agent=(await seenAgents(db,company))?.find(row=>row.main===true)?.agent;
 }
 if(typeof agent!=='string'||!uuid.test(agent)) return null;
 return agentEngine(db,{company,agent});
}

async function respond(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'dictationNotAllowed'},401);
  const writing=request.method==='POST';
  if(writing&&(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers))) return reply({error:'dictationNotAllowed'},403);
  // The recording is refused before its bytes are read when the request declares no length, or one past the limit:
  // reading first would take whatever a chunked body streams.
  if(writing&&bodyLengthRefused(request.headers.get('content-length'),maxBody)) return reply({error:'dictationTooLarge'},413);
  const raw=writing?await request.text():'';
  if(raw.length>maxBody) return reply({error:'dictationTooLarge'},413);
  const body=writing?JSON.parse(raw):Object.fromEntries(request.nextUrl.searchParams);
  if(typeof body.company!=='string'||!uuid.test(body.company)) return reply({error:'dictationNotFound'},404);
  const {data:company}=await db.from('companies').select('id,slug').eq('id',body.company).maybeSingle();
  if(!company) return reply({error:'dictationNotFound'},404);
  const agent=await spokenFor(db,body.company,body);
  if(!agent||agent.state==='missing'||agent.state==='invalid') return reply({error:'dictationNotFound'},404);
  if(!await routeAllowed(db,file,request.method,body.company,user.id)) return reply({error:'dictationNotAllowed'},403);
  const engine=agent.engine?.speech;
  if(!engine) return reply({error:'dictationNotFound'},404);
  if(!writing) {
   const read=await engine.dictation();
   return reply({language:read.state==='found'?read.language:null});
  }
  if(typeof body.dataUrl!=='string'||!body.dataUrl.startsWith('data:audio/')) return reply({error:'dictationInvalid'},400);
  if(typeof body.mimeType!=='string'||!body.mimeType.startsWith('audio/')) return reply({error:'dictationInvalid'},400);
  const heard=await engine.transcribe({dataUrl:body.dataUrl,mimeType:body.mimeType});
  if(heard.state==='transcribed') return reply({text:heard.text});
  // No provider (#430): the line under the box tells an Owner where to set one, and anyone else that the Owner must.
  if(heard.state==='unavailable') {
   const {data:owner,error}=await db.rpc('is_company_owner',{c:body.company});
   return reply({state:'unavailable',owner:!error&&owner===true,slug:company.slug});
  }
  return reply({state:'failed'},502);
 } catch { return reply({error:'dictationFailed'},400); }
}
export const GET=respond;
export const POST=respond;
