import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { closeOpenRuns, sendMessage, startQueuedTurns, stopConversationRun } from '@/lib/conversation-runs.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { conversationColumns, uuid } from '@/lib/conversations';
import { conversationRecord } from '@/lib/conversation-record';

type Database=Awaited<ReturnType<typeof supabase>>;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const refusals:Record<string,[string,number]>={P0002:['conversationNotFound',404],'42501':['conversationNotAllowed',403]};
const refuse=(error:string,status:number)=>reply({error},status);
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const refuseFor=(code:string|undefined)=>refuse(...(refusals[code||'']||['conversationFailed',500]));
const encryptionKey=()=>process.env.WEBHOOK_ENCRYPTION_KEY;

// A message is checked, sent to the agent's engine and stored by lib/conversation-runs.mjs (through the engine
// contract, lib/engine.mjs); this route only checks the request's shape and turns refusals into answers. Who wrote it
// is the signed-in person: no field of the request names an author, and any such field is ignored.
async function send(db:Database,body:Record<string,unknown>) {
 if(![body.conversation,body.sendKey].every(value=>typeof value==='string'&&uuid.test(value))||body.agent!==undefined&&(typeof body.agent!=='string'||!uuid.test(body.agent))) return refuse('conversationFailed',400);
 if(typeof body.message!=='string'||!body.message.trim()||body.message.length>20000) return refuse('conversationFailed',400);
 const sent=await sendMessage(db,service(),{company:body.company as string,conversation:body.conversation as string,sendKey:body.sendKey as string,agent:body.agent as string|undefined,message:body.message,encryptionKey:encryptionKey()});
 if('code' in sent) return refuseFor(sent.code);
 if('error' in sent) return refuse(sent.error,sent.status);
 return reply(sent);
}

// Stop works for the person who started the open run, or a Manager or Owner of the Company (the database decides).
async function stop(db:Database,body:Record<string,unknown>) {
 if(typeof body.conversation!=='string'||!uuid.test(body.conversation)) return refuse('conversationFailed',400);
 const stopped=await stopConversationRun(db,service(),{company:body.company as string,conversation:body.conversation,encryptionKey:encryptionKey()});
 if('code' in stopped) return stopped.message==='conversationNothingToStop'?reply({stopped:false}):refuseFor(stopped.code);
 if('error' in stopped) return refuse(stopped.error,stopped.status);
 // The stopped run is closed now, and a turn waiting behind it may start.
 await closeOpenRuns(service(),{encryptionKey:encryptionKey(),conversation:body.conversation});
 await startQueuedTurns(service(),{encryptionKey:encryptionKey(),conversation:body.conversation});
 return reply(stopped);
}

// Reading the record also closes any of its runs Hermes has ended (lib/conversation-runs.mjs, as the worker does), so
// the page shows the reply, and the usage of every ended run, without a reload; then a turn that waited for that run
// starts. The person's session must see the conversation first; only their own runs of it are closed.
async function read(db:Database,person:string,company:string,conversation:string) {
 const {data:found}=await db.from('conversations').select(conversationColumns).eq('id',conversation).eq('company_id',company).maybeSingle();
 if(!found) return refuse('conversationNotFound',404);
 await closeOpenRuns(service(),{encryptionKey:encryptionKey(),conversation,owner:person});
 await startQueuedTurns(service(),{encryptionKey:encryptionKey(),conversation});
 return reply(await conversationRecord(db,person,company,found));
}

async function respond(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return refuse('conversationNotFound',401);
  const writing=request.method==='POST';
  if(writing&&(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers))) return refuse('conversationNotAllowed',403);
  const raw=writing?await request.text():''; if(raw.length>24000) return refuse('conversationFailed',400);
  const body=writing?JSON.parse(raw):Object.fromEntries(request.nextUrl.searchParams);
  if(typeof body.company!=='string'||!uuid.test(body.company)) return refuse('conversationFailed',400);
  const {data:company}=await db.from('companies').select('id').eq('id',body.company).maybeSingle();
  if(!company) return refuse('conversationNotFound',404);
  // The route's permission (lib/route-permissions.mjs), with the role read now: a Viewer's send is refused here, and
  // the database refuses it again (conversation_can_write) before the engine is called.
  if(!await routeAllowed(db,'app/api/conversations/route.ts',request.method,body.company,user.id)) return refuse('conversationNotAllowed',403);
  if(writing) return body.intent==='stop'?await stop(db,body):await send(db,body);
  if(body.conversation===undefined) {
   // What the composer needs: whether this person may chat (any Member but a Viewer, #287), and the company's agents.
   const {data:writer}=await db.rpc('conversation_can_write',{c:body.company});
   const {data:agents}=writer?await db.from('hermes_agents').select('id,connection_id,name,is_default').eq('company_id',body.company).order('name'):{data:[]};
   return reply({writer:!!writer,agents:agents||[]});
  }
  return typeof body.conversation==='string'&&uuid.test(body.conversation)?await read(db,user.id,body.company,body.conversation):refuse('conversationNotFound',404);
 } catch { logActionFailure('conversation',new Error('Conversation request failed')); return refuse('conversationFailed',400); }
}
export const GET=respond;
export const POST=respond;
