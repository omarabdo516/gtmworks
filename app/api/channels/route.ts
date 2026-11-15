import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { driveChannelRuns, postChannelMessage } from '@/lib/channel-runs.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { channelRecord } from '@/lib/channels';
import { uuid } from '@/lib/conversations';

const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const refuse=(error:string,status:number)=>reply({error},status);
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const encryptionKey=()=>process.env.WEBHOOK_ENCRYPTION_KEY;

async function respond(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return refuse('channelNotFound',401);
  const writing=request.method==='POST';
  if(writing&&(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers))) return refuse('channelNotAllowed',403);
  const raw=writing?await request.text():''; if(raw.length>24000) return refuse('channelFailed',400);
  const body=writing?JSON.parse(raw):Object.fromEntries(request.nextUrl.searchParams);
  if(![body.company,body.channel].every(value=>typeof value==='string'&&uuid.test(value))) return refuse('channelFailed',400);
  if(!await routeAllowed(db,'app/api/channels/route.ts',request.method,body.company,user.id)) return refuse(writing?'channelNotAllowed':'channelNotFound',writing?403:404);
  if(writing) {
   if(typeof body.sendKey!=='string'||!uuid.test(body.sendKey)||typeof body.message!=='string'||!body.message.trim()||body.message.length>20000) return refuse('channelFailed',400);
   const sent=await postChannelMessage(db,service(),{channel:body.channel,sendKey:body.sendKey,message:body.message,encryptionKey:encryptionKey()});
   return 'refused' in sent?refuse(sent.refused,sent.status):reply(sent);
  }
  const record=await channelRecord(db,user.id,body.company,body.channel);
  if(!record) return refuse('channelNotFound',404);
  if(!record.open) return reply(record);
  await driveChannelRuns(service(),{encryptionKey:encryptionKey(),channel:body.channel});
  return reply(await channelRecord(db,user.id,body.company,body.channel)??record);
 } catch { logActionFailure('channel',new Error('Channel request failed')); return refuse('channelFailed',400); }
}
export const GET=respond;
export const POST=respond;
