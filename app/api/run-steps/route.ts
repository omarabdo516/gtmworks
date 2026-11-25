import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { engineOf, onProfile } from '@/lib/company-engine.mjs';
import { engineFor } from '@/lib/engine.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { liveLines, type LiveLine } from '@/lib/live-steps.mjs';
import { uuid } from '@/lib/conversations';

// While an Agent works, its reader sees each step live (#646): the open Run of a Conversation or a channel, as the
// database names it to this reader (conversation_live_run, channel_live_run), and that Run's tool calls as the Engine
// streams them (the engine contract's `steps`), passed on one line of JSON per view (lib/live-steps.mjs) until the Run's
// events end or the reader goes. Nothing of it is kept or logged. With no Run working, or no Engine to read, the only
// line is the end, and the page keeps its "Thinking" line (#763).
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
// no-transform: the server's compression would hold the lines back until enough of them came.
const headers={'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'};
const refuse=(error:string,status:number)=>NextResponse.json({error},{status,headers:{'Cache-Control':'no-store'}});
const encoder=new TextEncoder();
const line=(value:LiveLine)=>encoder.encode(`${JSON.stringify(value)}\n`);
const only=(value:LiveLine)=>new Response(line(value),{headers});

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return refuse('conversationNotFound',401);
  const params=request.nextUrl.searchParams;
  const company=params.get('company'); const conversation=params.get('conversation'); const channel=params.get('channel');
  if(!company||!uuid.test(company)||(conversation===null)===(channel===null)||!uuid.test(conversation??channel??'')) return refuse('conversationFailed',400);
  if(!await routeAllowed(db,'app/api/run-steps/route.ts','GET',company,user.id)) return refuse('conversationNotAllowed',403);
  // The place is the Company's, read with the reader's own session, so its Engine is the one its Runs are on.
  const place=conversation
   ?await db.from('conversations').select('id').eq('id',conversation).eq('company_id',company).maybeSingle()
   :await db.from('channels').select('id').eq('id',channel as string).eq('company_id',company).maybeSingle();
  if(!place.data) return refuse('conversationNotFound',404);
  const {data}=conversation?await db.rpc('conversation_live_run',{conversation}):await db.rpc('channel_live_run',{ch:channel});
  const target=(data as {run:string,profile:string}[]|null)?.[0];
  if(!target) return only({end:'none'});
  const connection=onProfile(target.profile,company,await engineOf(company,service()));
  const read=connection&&engineFor(connection).steps;
  if(!connection||!read) return only({end:'unreachable'});
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
