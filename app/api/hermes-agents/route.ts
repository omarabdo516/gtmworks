import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const columns='id,company_id,connection_id,name,speciality,is_default';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function respond(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'hermesAgencyOnly'},401);
  const writing=request.method==='POST';
  if(writing&&(!request.headers.get('content-type')?.startsWith('application/json')||(request.headers.get('origin')&&new URL(request.headers.get('origin')!).host!==request.headers.get('host')))) return reply({error:'hermesAgencyOnly'},403);
  const raw=writing?await request.text():''; if(raw.length>4000) return reply({error:'hermesAgentFailed'},400);
  const body=writing?JSON.parse(raw):Object.fromEntries(request.nextUrl.searchParams);
  if(typeof body.company!=='string'||!uuid.test(body.company)) return reply({error:'hermesAgentFailed'},400);
  const {data:company}=await db.from('companies').select('id').eq('id',body.company).maybeSingle();
  if(!company) return reply({error:'hermesAgentNotFound'},404);
  if(writing) {
   if(!['attach','default','remove'].includes(body.intent)||['connection','agent','replacement'].some(key=>body[key]!==undefined&&(typeof body[key]!=='string'||!uuid.test(body[key])))) return reply({error:'hermesAgentFailed'},400);
   if(body.intent==='attach'&&(!body.connection||typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof body.speciality!=='string'||!body.speciality.trim()||body.speciality.length>200)||body.intent!=='attach'&&!body.agent) return reply({error:'hermesAgentFailed'},400);
   const {error}=await db.rpc('manage_hermes_agent',{c:body.company,intent:body.intent,connection:body.connection??null,a:body.agent??null,agent_name:body.name??null,speciality:body.speciality??null,make_default:body.makeDefault===true,confirm_sharing:body.confirmSharing===true,replacement:body.replacement??null});
   if(error) {
    const key=['hermesSharingWarning','hermesNextDefault','hermesAgentNotFound','hermesAgencyOnly'].includes(error.message)?error.message:'hermesAgentFailed';
    return reply({error:key},error.code==='42501'?403:error.code==='P0002'?404:key==='hermesSharingWarning'||key==='hermesNextDefault'?409:400);
   }
  }
  const {data:agents,error}=await db.from('hermes_agents').select(columns).eq('company_id',body.company).order('name');
  return error?reply({error:'hermesAgentFailed'},500):reply({agents});
 } catch { return reply({error:'hermesAgentFailed'},400); }
}
export const GET=respond;
export const POST=respond;
