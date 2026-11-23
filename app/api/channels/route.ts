import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { decideChannelPermission, driveChannelRuns, postChannelMessage, answerChannelQuestion, markChannelHandDone, stopChannelMessage } from '@/lib/channel-runs.mjs';
import { bodyLengthRefused, conversationFilesProblem, fileRefusal, maxRequestBytes } from '@/lib/attachments.mjs';
import type { PermissionChoice } from '@/lib/engine.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { channelRecord } from '@/lib/channels';
import { channelSessionTurns } from '@/lib/company-app-items';
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

// A pick on the question a channel's Agent waits on (#149): the card and the choice's index, never its text, or on a
// question where several may be picked the picked choices' indexes (#651), and one key per card on the page, so a second click is the same claim. Any Member of the channel who may write claims it, except
// the main Agent's own question, which only the Member it was addressed to may answer (answer_channel_question). The
// answer then goes to the waiting Run.
async function answer(db:Awaited<ReturnType<typeof supabase>>,body:Record<string,unknown>) {
 if(!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)) return refuse('channelFailed',400);
 const isChoiceIndex=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<4;
 const picks=Array.isArray(body.choice)&&body.choice.length>=1&&body.choice.length<=4&&body.choice.every(isChoiceIndex)?body.choice as number[]:null;
 if(!(isChoiceIndex(body.choice)||picks)) return refuse('channelFailed',400);
 if(typeof body.answerKey!=='string'||!uuid.test(body.answerKey)) return refuse('channelFailed',400);
 const answered=await answerChannelQuestion(db,service(),{company:body.company as string,channel:body.channel as string,card:body.card,...(picks?{picks}:{choice:body.choice as number}),answerKey:body.answerKey,later:after});
 if('code' in answered) return refuse(...(refusals[answered.code||'']||['channelFailed',500]));
 // Another Member or another tab was first: the pick is not recorded, so the card says so and reads the channel again.
 if(answered.state==='taken'||answered.state==='closed') return refuse(answered.state==='taken'?'questionTaken':'questionClosed',409);
 return reply({state:answered.state});
}

// "Done it" on a step a channel's Agent handed the team (#149): the Member's own word, recorded once by the database with
// who and when (mark_channel_hand_done), under the Member's own session. The first press also writes the message that asks
// that Agent to pick up (#140), as a Run of the channel. gtmworks does not do the step and checks nothing outside.
async function done(db:Awaited<ReturnType<typeof supabase>>,body:Record<string,unknown>) {
 if(!(typeof body.card==='number'&&Number.isSafeInteger(body.card)&&body.card>0)) return refuse('channelFailed',400);
 const made=await markChannelHandDone(db,service(),{company:body.company as string,channel:body.channel as string,card:body.card,later:after});
 if('code' in made) return refuse(...(refusals[made.code||'']||['channelFailed',500]));
 return reply({state:'done',at:made.at,first:made.first});
}

// Stop on a channel message's Run (#478): the message's id, never its text. The person who wrote it, or a Manager or Owner
// of the Company, ends its Runs and every Handover started from it, down the whole chain (stop_channel_message); other
// messages' work goes on. Its stopped Runs are closed after the answer.
async function stop(db:Awaited<ReturnType<typeof supabase>>,body:Record<string,unknown>) {
 if(!(typeof body.message==='number'&&Number.isSafeInteger(body.message)&&body.message>0)) return refuse('channelFailed',400);
 const stopped=await stopChannelMessage(db,{company:body.company as string,channel:body.channel as string,message:body.message,service:service(),later:after});
 if('code' in stopped) return refuse(...(refusals[stopped.code||'']||['channelFailed',500]));
 return reply(stopped);
}

async function respond(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return refuse('channelNotFound',401);
  const writing=request.method==='POST';
  // A message with images goes as a form (#156), as a Conversation's does (#155): the fields a text-only send posts in
  // JSON, and the images as `files`. Any other write is the JSON it always was; nothing of either is logged.
  const contentType=request.headers.get('content-type')||'';
  const form=writing&&contentType.startsWith('multipart/form-data');
  if(writing&&(!(contentType.startsWith('application/json')||form)||crossSiteWrite(request.headers))) return refuse('channelNotAllowed',403);
  let body:Record<string,unknown>; let chosen:File[]=[];
  if(!writing) body=Object.fromEntries(request.nextUrl.searchParams);
  else if(form) {
   // A message the Engine could never take is refused before its bytes are read: one request is at most 10 MB, and a
   // chunked form, which declares no length, is refused too rather than read without a bound.
   if(bodyLengthRefused(request.headers.get('content-length'),maxRequestBytes)) return refuse('attachRequestRefused',413);
   const fields=await request.formData();
   const field=(name:string)=>{ const value=fields.get(name); return typeof value==='string'?value:undefined; };
   body={company:field('company'),channel:field('channel'),sendKey:field('sendKey'),message:field('message'),intent:field('intent')};
   chosen=fields.getAll('files').filter((file):file is File=>file instanceof File);
   if(chosen.length&&body.intent!==undefined) return refuse('channelFailed',400);
  } else {
   const raw=await request.text(); if(raw.length>24000) return refuse('channelFailed',400);
   body=JSON.parse(raw);
  }
  const company=typeof body.company==='string'?body.company:''; const channelId=typeof body.channel==='string'?body.channel:'';
  if(![company,channelId].every(value=>uuid.test(value))) return refuse('channelFailed',400);
  if(!await routeAllowed(db,'app/api/channels/route.ts',request.method,company,user.id)) return refuse(writing?'channelNotAllowed':'channelNotFound',writing?403:404);
  if(writing&&body.intent==='permit') return await permit(db,body);
 if(writing&&body.intent==='answer') return await answer(db,body);
 if(writing&&body.intent==='done') return await done(db,body);
  if(writing&&body.intent==='stop') return await stop(db,body);
  if(writing) {
   if(typeof body.sendKey!=='string'||!uuid.test(body.sendKey)||typeof body.message!=='string'||body.message.length>20000) return refuse('channelFailed',400);
   // An image the Engine cannot read, more of them than a message carries, or text and images past its request limit:
   // refused here, with one line saying why, and nothing is stored or sent.
   const problem=conversationFilesProblem(chosen,body.message);
   if(problem) return refuse(fileRefusal(problem),400);
   if(!chosen.length&&!body.message.trim()) return refuse('channelFailed',400);
   const sent=await postChannelMessage(db,service(),{company,channel:channelId,sendKey:body.sendKey,message:body.message,files:chosen});
   return 'refused' in sent?refuse(sent.refused,sent.status):reply(sent);
  }
  // A Member opened the channel from their mention of a message (#200): their own item is done. Opening the channel any
  // other way leaves it waiting, since reading a channel is not reading a mention.
  if(typeof body.mention==='string'&&/^\d{1,19}$/.test(body.mention)) await db.rpc('read_channel_mention',{ch:channelId,message:Number(body.mention)});
  const record=await channelRecord(db,user.id,company,channelId,true,(_agent,session,profile)=>channelSessionTurns(company,profile,session));
  if(!record) return refuse('channelNotFound',404);
  if(!record.open) return reply(record);
  await driveChannelRuns(service(),{channel:channelId});
  return reply(await channelRecord(db,user.id,company,channelId,true,(_agent,session,profile)=>channelSessionTurns(company,profile,session))??record);
 } catch { logActionFailure('channel',new Error('Channel request failed')); return refuse('channelFailed',400); }
}
export const GET=respond;
export const POST=respond;
