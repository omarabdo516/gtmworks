import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { companyEngine } from '@/lib/engine/handle.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { liveLines, type LiveDelta, type LiveLine } from '@/lib/live-steps.mjs';
import { uuid } from '@/lib/conversations';

// no-transform: the server's compression would hold the lines back until enough of them came.
const headers={'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'};
const refuse=(error:string,status:number)=>NextResponse.json({error},{status,headers:{'Cache-Control':'no-store'}});
const encoder=new TextEncoder();
const line=(value:LiveLine|LiveDelta)=>encoder.encode(`${JSON.stringify(value)}\n`);
const only=(value:LiveLine)=>new Response(line(value),{headers});

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return refuse('conversationNotFound',401);
  const params=request.nextUrl.searchParams;
  // A channel's open Run (#646). A Conversation's is its own live read's (app/api/conversation-live, #876).
  const company=params.get('company'); const channel=params.get('channel');
  if(!company||!uuid.test(company)||params.has('conversation')||!channel||!uuid.test(channel)) return refuse('conversationFailed',400);
  if(!await routeAllowed(db,'app/api/run-steps/route.ts','GET',company,user.id)) return refuse('conversationNotAllowed',403);
  // The channel is the Company's, read with the reader's own session, so its Engine is the one its Runs are on. A
  // Channel's Run is on the profile it was pinned to, for a member of the Channel (channel_live_run: a Channel's own
  // Agent is read there even when it is hidden elsewhere).
  const place=await db.from('channels').select('id').eq('id',channel).eq('company_id',company).maybeSingle<{id:string}>();
  if(!place.data) return refuse('conversationNotFound',404);
  const {data}=await db.rpc('channel_live_run',{ch:channel});
  const target=(data as {run:string,profile:string}[]|null)?.[0];
  if(!target) return only({end:'none'});
  const read=(await companyEngine(company))?.on(target.profile)?.runs.steps;
  if(!read) return only({end:'unreachable'});
  const stopped=new AbortController();
  request.signal.addEventListener('abort',()=>stopped.abort(),{once:true});
  const lines=liveLines(target.run,read(target.run,{signal:stopped.signal}))[Symbol.asyncIterator]();
  return new Response(new ReadableStream({
   async pull(controller) {
    try {
     const next=await lines.next();
     if(next.done) controller.close(); else controller.enqueue(line(next.value));
    } catch { controller.enqueue(line({end:'unreachable'})); controller.close(); }
   },
   async cancel() { stopped.abort(); await lines.return?.(undefined); },
  }),{headers});
 } catch { return refuse('conversationFailed',500); }
}
