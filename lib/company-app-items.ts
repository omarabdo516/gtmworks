import 'server-only';
import { cache } from 'react';
import { supabase } from './supabase';
import { readAgentApps, readAgentSession, readAgentTools, readChannelAgentSession, readCompanyApps, readCompanyUsage, type AgentsUsage } from './company-apps.mjs';
import type { Language } from './i18n.mjs';
import en from './messages/apps.en.json';
import ar from './messages/apps.ar.json';
import type { AppItem } from '@/app/settings-apps-client';
import type { AgentToolItem } from '@/app/connected-tools';
import type { AppStates } from './conversations';

type Text=Record<string,string>;
const catalogues:Text[]=[en,ar];

// A Company's apps as Settings, Apps and the Connect apps sheet draw them (#30, #201): each with its state read now from
// the Company's own profile in the Engine (lib/company-apps.mjs), in the reader's words; search reads an app's words in
// both languages. null when the Engine or the database cannot be read; it never rejects. Settings reads it while drawing;
// the sheet asks for it through GET /api/company-apps, so no other page waits on the Engine.
export const companyAppItems=cache(async(company:string,language:Language):Promise<AppItem[]|null>=>{
 try {
  const apps=await readCompanyApps(await supabase(),{company});
  if(!apps) return null;
  const text:Text=language==='ar'?ar:en;
  return apps.map(entry=>({...entry,use:text[`use.${entry.key}`],can:text[`can.${entry.key}`],
   words:[entry.name,...catalogues.flatMap(words=>[`use.${entry.key}`,`can.${entry.key}`,`alias.${entry.key}`,`category.${entry.category}`].map(key=>words[key]))].join(' ')}));
 } catch { return null; }
});

// One Agent's apps now, by key, for the connect cards of its Conversations (#203); null when they cannot be read.
export const agentAppStates=cache(async(company:string,agent:string):Promise<AppStates>=>{
 try { return await readAgentApps(await supabase(),{company,agent}); } catch { return null; }
});

// One Agent's Hermes session now, its turns and token use, for its Conversation's steps and usage (#346, #347); null
// when it cannot be read.
export const agentSessionTurns=cache(async(company:string,agent:string,session:string)=>{
 try { return await readAgentSession(await supabase(),{company,agent,session}); } catch { return null; }
});

// One channel reply's Hermes session on the profile its Run was pinned to, for the channel's steps (#148); null when it
// cannot be read. The database gave the profile only to a member of that channel (channel_run_sessions).
export const channelSessionTurns=cache(async(company:string,profile:string,session:string)=>{
 try { return await readChannelAgentSession(await supabase(),{company,profile,session}); } catch { return null; }
});

// One Agent's connected tools now, each with what it is for in the reader's words, for its details (#204); null when
// they cannot be read.
export const agentToolItems=cache(async(company:string,agent:string,language:Language):Promise<AgentToolItem[]|null>=>{
 try {
  const tools=await readAgentTools(await supabase(),{company,agent});
  const text:Text=language==='ar'?ar:en;
  return tools&&tools.map(tool=>({...tool,use:text[`use.${tool.key}`]}));
 } catch { return null; }
});

// The token use of every Company this person owns over the last `days` (#347), each Agent's Hermes profile's own, for
// the usage screens: one row per profile, by Company name. A Company whose Engine or database does not answer has no
// rows; a profile Hermes does not answer for has unknown usage (nulls).
export type UsageRow=AgentsUsage&{company_id:string,company_name:string};
export const ownedUsage=cache(async(person:string,days:number):Promise<UsageRow[]>=>{
 const db=await supabase();
 const {data}=await db.from('members').select('company_id,companies(name)').eq('person_id',person).eq('role','owner').is('removed_at',null);
 const owned=((data||[]) as unknown as {company_id:string,companies:{name:string}|null}[]).sort((a,b)=>(a.companies?.name||'').localeCompare(b.companies?.name||''));
 const rows=await Promise.all(owned.map(async({company_id,companies})=>{
  const read=await readCompanyUsage(db,{company:company_id,days}).catch(()=>null);
  return (read||[]).map(entry=>({...entry,company_id,company_name:companies?.name||''}));
 }));
 return rows.flat();
});
