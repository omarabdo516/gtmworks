import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { readCompanySignIns } from '@/lib/company-sign-in.mjs';
import { readCompanyModels } from '@/lib/engine-settings.mjs';
import { readCompanyKeys } from '@/lib/provider-keys.mjs';
import { readProviderModels } from '@/lib/provider-models.mjs';
import { readCompanySpeech } from '@/lib/company-speech.mjs';

// One part of Settings → Models that the Engine backs (#791, ADR 0030), read by the browser after the section is drawn:
// the Company's sign-ins, its model choices, its provider keys, each Provider's models and its speech-to-text provider.
// Each part is its own request, so one the Engine is slow to answer holds up no other. Any Member reads them, as the
// section did; `readAt` is when the read started, so a save the page holds from after it stands (app/settings-saved.ts).
// A part the Engine did not answer comes back as its unread shape, and the browser keeps its last good read.
const file='app/api/settings-models/route.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
// The service client the key read settles key holds with (lib/provider-keys.mjs), as the keys route does.
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
type Db=Awaited<ReturnType<typeof supabase>>;
const parts:Record<string,(db:Db,company:string,owner:boolean)=>Promise<unknown>>={
 signIns:(db,company)=>readCompanySignIns(db,{company}),
 models:(db,company,owner)=>readCompanyModels(db,{company,owner}),
 keys:(db,company)=>readCompanyKeys(db,service(),{company}),
 providers:(db,company)=>readProviderModels(db,{company}),
 speech:(db,company)=>readCompanySpeech(db,{company}),
};
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'settingNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company'); const part=request.nextUrl.searchParams.get('part');
  if(typeof company!=='string'||!uuid.test(company)||!part||!Object.hasOwn(parts,part)) return reply({error:'settingInvalid'},400);
  if(!await routeAllowed(db,file,'GET',company,user.id)) return reply({error:'settingNotAllowed'},403);
  const {data:member}=await db.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
  const readAt=Date.now();
  return reply({data:await parts[part](db,company,member?.role==='owner'),readAt});
 } catch { return reply({error:'settingFailed'},502); }
}
