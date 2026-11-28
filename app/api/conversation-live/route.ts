import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { agentEngine } from '@/lib/engine/handle.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { liveLines, type LiveDelta, type LiveLine } from '@/lib/live-steps.mjs';
import { uuid } from '@/lib/conversations';

// The open Run of a Conversation whose messages are the Engine's, as it happens (#876): gtmworks's web server follows the
// Run's event stream on the Engine and relays it to the Conversation's own person, one JSON line each, as it carries the
// Screen's stream (ADR 0011: no browser reaches the Engine or holds its key). A view line is the Run's steps so far and
// the call it makes now; a `{delta}` line is the next words of the reply as the model writes them; the last line says
// how it ended. Once the Run's end is seen the row no longer holds it (end_conversation_run). Nothing of it is kept.
type Line=LiveLine|LiveDelta;
// no-transform: the server's compression would hold the lines back until enough of them came.
const headers={'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'};
const refuse=(error:string,status:number)=>NextResponse.json({error},{status,headers:{'Cache-Control':'no-store'}});
const encoder=new TextEncoder();
const line=(value:Line)=>encoder.encode(`${JSON.stringify(value)}\n`);
const only=(value:Line)=>new Response(line(value),{headers});

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return refuse('conversationNotFound',401);
  const params=request.nextUrl.searchParams;
  const company=params.get('company'); const conversation=params.get('conversation');
  if(!company||!uuid.test(company)||!conversation||!uuid.test(conversation)) return refuse('conversationFailed',400);
  if(!await routeAllowed(db,'app/api/conversation-live/route.ts','GET',company,user.id)) return refuse('conversationNotAllowed',403);
  // Only the Conversation's own person: the row is read with their session and named as theirs.
  const {data:found}=await db.from('conversations').select('id,agent_id,open_runs').eq('id',conversation).eq('company_id',company).eq('person_id',user.id).maybeSingle<{id:string,agent_id:string|null,open_runs:string[]|null}>();
  if(!found) return refuse('conversationNotFound',404);
  if(!found.agent_id) return only({end:'none'});
  const target=await agentEngine(db,{company,agent:found.agent_id});
  if(target.state==='missing') return refuse('conversationNotFound',404);
  // The oldest open Run first: the Engine runs a session's Runs in the order they were started.
  const run=found.open_runs?.[0];
  if(!run) return only({end:'none'});
  if(target.state!=='found') return only({end:'unreachable'});
  const stopped=new AbortController();
  request.signal.addEventListener('abort',()=>stopped.abort(),{once:true});
  const lines=liveLines(run,target.engine.sessions.follow(run,{signal:stopped.signal}),{reply:true})[Symbol.asyncIterator]();
  return new Response(new ReadableStream({
   async pull(controller) {
    try {
     const next=await lines.next();
     if(next.done) { controller.close(); return; }
     const value=next.value;
     // The Run ended, or the Engine no longer knows it: the row lets it go, and the reader reads the session.
     if('end' in value&&(value.end==='ended'||value.end==='gone')) await db.rpc('end_conversation_run',{conversation,run});
     controller.enqueue(line(value));
    } catch { controller.enqueue(line({end:'unreachable'})); controller.close(); }
   },
   async cancel() { stopped.abort(); await lines.return?.(undefined); },
  }),{headers});
 } catch { return refuse('conversationFailed',500); }
}
