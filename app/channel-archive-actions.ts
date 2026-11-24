'use server';
import { after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { archiveChannel } from '@/lib/channel-runs.mjs';
import { archiveIntents, type ArchiveAnswer, type ArchiveIntent, type ArchiveStopKind } from '@/lib/archive-stops';

// Archiving a team channel (#675), asked and answered as Cards and Conversations are (lib/archive-stops.ts): what it
// stops, for its one confirmation; the archive itself, which stops the Runs it had going on their Engines after the
// database marks it (archive_channel) and closes them after the answer; and restoring it, which starts nothing. Only an
// Owner or a Manager in a team channel may, as the database checks again; the general channel never.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
export const archiveChannels=withActionLog('archiveChannels',async function archiveChannels(company:string,intent:ArchiveIntent,channel:string):Promise<ArchiveAnswer<string>> {
 const db=await supabase();
 if(!archiveIntents.includes(intent)||!uuid.test(String(channel))||!await actionAllowed(db,'archiveChannels',company)) return {state:'refused'};
 if(intent==='stops') {
  const {data,error}=await db.rpc('channel_archive_stops',{ch:channel});
  if(error) { logActionFailure('archiveChannels',error); return {state:'refused'}; }
  return {state:'stops',stops:((data||[]) as {kind:ArchiveStopKind,agent:string|null,agent_id:string|null,title:string|null}[])
   .map(stop=>({...stop,title:stop.title??'',about:channel}))};
 }
 if(intent==='restore') {
  const {error}=await db.rpc('restore_channel',{c:company,ch:channel});
  if(error) { logActionFailure('archiveChannels',error); return {state:'refused'}; }
  return {state:'done',done:[channel]};
 }
 const archived=await archiveChannel(db,{company,channel,service:service(),later:after});
 if('code' in archived) { logActionFailure('archiveChannels',archived); return {state:'refused'}; }
 return {state:'done',done:[channel]};
});
