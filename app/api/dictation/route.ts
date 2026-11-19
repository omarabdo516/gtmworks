import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { engineOf, onProfile } from '@/lib/company-engine.mjs';
import { engineFor } from '@/lib/engine.mjs';
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
// The Engine record is readable by the server role alone (#380).
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});

// The Agent whose profile transcribes: the one named, or the Company's main Agent for a channel. Both are read under the
// caller's own session, so an Agent or channel they cannot see reads as absent.
async function spokenFor(db:Awaited<ReturnType<typeof supabase>>,company:string,body:{agent?:unknown,channel?:unknown}) {
 if(body.channel!==undefined) {
  if(typeof body.channel!=='string'||!uuid.test(body.channel)) return null;
  const {data:channel}=await db.from('channels').select('id').eq('id',body.channel).eq('company_id',company).maybeSingle();
  if(!channel) return null;
  const {data}=await db.from('hermes_agents').select('id,profile').eq('company_id',company).eq('is_default',true).maybeSingle();
  return data as {id:string,profile:string}|null;
 }
 if(typeof body.agent!=='string'||!uuid.test(body.agent)) return null;
 const {data}=await db.from('hermes_agents').select('id,profile').eq('company_id',company).eq('id',body.agent).maybeSingle();
 return data as {id:string,profile:string}|null;
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
  const {data:company}=await db.from('companies').select('id').eq('id',body.company).maybeSingle();
  if(!company) return reply({error:'dictationNotFound'},404);
  const agent=await spokenFor(db,body.company,body);
  if(!agent) return reply({error:'dictationNotFound'},404);
  if(!await routeAllowed(db,file,request.method,body.company,user.id)) return reply({error:'dictationNotAllowed'},403);
  const connection=onProfile(agent.profile,body.company,await engineOf(body.company,service()));
  if(!connection) return reply({error:'dictationNotFound'},404);
  const engine=engineFor(connection);
  if(!writing) {
   const read=await engine.dictation?.()??{state:'failed',language:null};
   return reply({language:read.state==='found'?read.language:null});
  }
  if(typeof body.dataUrl!=='string'||!body.dataUrl.startsWith('data:audio/')) return reply({error:'dictationInvalid'},400);
  if(typeof body.mimeType!=='string'||!body.mimeType.startsWith('audio/')) return reply({error:'dictationInvalid'},400);
  const heard=await engine.transcribe({dataUrl:body.dataUrl,mimeType:body.mimeType});
  if(heard.state==='transcribed') return reply({text:heard.text});
  if(heard.state==='unavailable') return reply({state:'unavailable'});
  return reply({state:'failed'},502);
 } catch { return reply({error:'dictationFailed'},400); }
}
export const GET=respond;
export const POST=respond;
