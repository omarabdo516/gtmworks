import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { orderProviders, switchProvider } from '@/lib/provider-order.mjs';
import { applyAccountOrder } from '@/lib/provider-switches.mjs';
import { uuid } from '@/lib/conversations';

// The Owner's order of the Company's Providers, and one switched off or on again (#619): lib/provider-order.mjs checks
// the input and order_providers and switch_provider check the Owner again in the database. Every Member reads both on
// Settings, server side. A kept change goes to the Company's Engine at once (#621), which then takes its subscription
// accounts in that order and skips one switched off; a switched-off Provider keeps its sign-in or key there.
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'providerNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'providerNotAllowed'},403);
  const raw=await request.text(); if(raw.length>8000) return reply({error:'providerOrderInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)||!['order','switch'].includes(body.intent)) return reply({error:'providerOrderInvalid'},400);
  if(!await routeAllowed(db,'app/api/provider-order/route.ts','POST',body.company,user.id)) return reply({error:'providerNotAllowed'},403);
  const result=body.intent==='order'?await orderProviders(db,{company:body.company,entries:body.entries})
   :await switchProvider(db,{company:body.company,provider:body.provider,account:body.account,enabled:body.enabled});
  if(result.status===200) await applyAccountOrder(db,{company:body.company});
  return reply(result.body,result.status);
 } catch { return reply({error:'providerOrderInvalid'},400); }
}
