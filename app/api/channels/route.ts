import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { decideChannelPermission, driveChannelRuns, postChannelMessage } from '@/lib/channel-runs.mjs';
import type { PermissionChoice } from '@/lib/engine.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { channelRecord } from '@/lib/channels';
import { uuid } from '@/lib/conversations';

const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const refuse=(error:string,status:number)=>reply({error},status);
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const permissionChoices:readonly unknown[]=['once','always','deny'] satisfies PermissionChoice[];
const refusals:Record<string,[string,number]>={P0002:['channelNotFound',404],'42501':['channelNotAllowed',403],'22023':['channelFailed',400]};

// A choice on the request an Agent's Run in this channel waits on (#165): one of three fixed words, never text. Only the
// Member who called the Agent decides (decide_channel_permission); the press is answered once the choice is kept, and
// the choice then goes to the waiting Run after the answer. Nothing of the request is logged.
async function permit(db:Awaited<ReturnType<typeof supabase>>,body:Record<string,unknown>) {
 if(!(typeof body.request==='number'&&Number.isSafeInteger(body.request)&&body.request>0)||!permissionChoices.includes(body.choice)) return refuse('channelFailed',400);
 const decided=await decideChannelPermission(db,service(),{company:body.company as string,channel:body.channel as string,request:body.request,choice:body.choice as PermissionChoice,later:after});
 if('code' in decided) return refuse(...(refusals[decided.code||'']||['channelFailed',500]));
 return reply(decided);
}

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
  if(writing&&body.intent==='permit') return await permit(db,body);
  if(writing) {
   if(typeof body.sendKey!=='string'||!uuid.test(body.sendKey)||typeof body.message!=='string'||!body.message.trim()||body.message.length>20000) return refuse('channelFailed',400);
   const sent=await postChannelMessage(db,service(),{channel:body.channel,sendKey:body.sendKey,message:body.message});
   return 'refused' in sent?refuse(sent.refused,sent.status):reply(sent);
  }
  const record=await channelRecord(db,user.id,body.company,body.channel,true);
  if(!record) return refuse('channelNotFound',404);
  if(!record.open) return reply(record);
  await driveChannelRuns(service(),{channel:body.channel});
  return reply(await channelRecord(db,user.id,body.company,body.channel,true)??record);
 } catch { logActionFailure('channel',new Error('Channel request failed')); return refuse('channelFailed',400); }
}
export const GET=respond;
export const POST=respond;
