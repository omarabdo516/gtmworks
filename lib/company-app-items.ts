import 'server-only';
import { cache } from 'react';
import { supabase } from './supabase';
import { readAgentApps, readAgentTools, readChannelAgentSession, readCompanyApps, readCompanyUsage, testAgentTool, testCompanyApp, type AgentTool, type AgentsUsage } from './company-apps.mjs';
import { appsUnreadLine } from './diagnostics.mjs';
import { appByKey } from './app-catalogue.mjs';
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
// both languages. null when the Engine or the database cannot be read; it never rejects. Settings, Apps and the sheet ask
// for it through GET /api/company-apps, so no page waits on the Engine (#898, ADR 0030); an app that is on reads
// `checking` until its own test (companyAppTest) answers, so the list never waits on a test.
export const companyAppItems=cache(async(company:string,language:Language):Promise<AppItem[]|null>=>{
 try {
  const db=await supabase();
  const [apps,owner]=await Promise.all([readCompanyApps(db,{company,test:false}),db.rpc('is_company_owner',{c:company}).then(({data,error})=>!error&&data===true)]);
  if(!apps) return null;
  const text:Text=language==='ar'?ar:en;
  return apps.map(entry=>{
   // A command server the Owner added (#459) reads as one that runs in the work sandbox; one added under a preset's name
   // (Open Design) keeps the preset's words.
   const style=entry.source==='custom'&&!appByKey(entry.key)?.preset?entry.auth==='command'?'command':'custom':entry.key;
   const name=entry.source==='own'&&!entry.preset?text.ownName:entry.name;
   const use=text[`use.${style}`], can=text[`can.${style}`];
   // A command server's command and arguments (#459) reach the Owner's browser only: an argument can hold what the
   // Owner would not show every Member, as a token never is.
   const shown=owner?entry:{...entry,command:undefined,args:undefined};
   return {...shown,name,use,can,
    words:[name,...catalogues.flatMap(words=>[`use.${style}`,`can.${style}`,`alias.${style}`,`category.${entry.category}`].map(key=>words[key]))].join(' ')};
  });
 } catch { return null; }
});

// One of the Company's apps tested on its own (#898): its state and each Agent's; null when it cannot be tested.
export const companyAppTest=cache(async(company:string,app:string)=>{
 try { return await testCompanyApp(await supabase(),{company,app}); } catch { return null; }
});

// One Agent's apps now, by key, for the connect cards of its Conversations (#203); null when they cannot be read.
export const agentAppStates=cache(async(company:string,agent:string):Promise<AppStates>=>{
 try { return await readAgentApps(await supabase(),{company,agent}); } catch { return null; }
});

// One channel reply's Hermes session on the profile its Run was pinned to, for the channel's steps (#148); null when it
// cannot be read. The database gave the profile only to a member of that channel (channel_run_sessions).
export const channelSessionTurns=cache(async(company:string,profile:string,session:string)=>{
 try { return await readChannelAgentSession(await supabase(),{company,profile,session}); } catch { return null; }
});

// One Agent's connected tools now, each with what it is for in the reader's words, for its details (#204); null when
// they cannot be read.
// The last good list of each Agent's tools, kept in this web process for a minute (#770, ADR 0030): a read that fails
// meanwhile answers it, so a slow moment never reads as "can't be read". Nothing is kept in a table (ADR 0017).
const lastTools=new Map<string,{tools:AgentTool[],at:number}>();
const toolsKeptFor=60000;
// One Agent's connected tools, each with what it is for in the reader's words, for its details (#204): the catalogue
// and the profile's settings only, so the list shows at once; each connected app reads `checking` until its own test
// (agentToolTest) answers (#770). null when they cannot be read and none was read in the last minute; a failed read is
// logged once with its cause (docs/production-logs.md: apps_unread).
export const agentToolItems=cache(async(company:string,agent:string,language:Language):Promise<AgentToolItem[]|null>=>{
 const key=`${company}:${agent}`; let why='failed';
 try {
  const tools=await readAgentTools(await supabase(),{company,agent,test:false,cause:cause=>{ why=cause; }});
  if(tools) lastTools.set(key,{tools,at:Date.now()});
  else console.log(appsUnreadLine({company,agent,cause:why}));
  // Only a read the Engine failed answers from the last good list: an Agent the reader does not see (or whose profile is
  // gone) reads nothing, so the list one reader kept never reaches another who may not see that Agent.
  const engineFailed=!tools&&why!=='noProfile'&&why!=='database';
  const shown=tools??(engineFailed?(()=>{ const kept=lastTools.get(key); return kept&&Date.now()-kept.at<toolsKeptFor?kept.tools:null; })():null);
  const text:Text=language==='ar'?ar:en;
  return shown&&shown.map(tool=>({...tool,use:text[`use.${tool.key}`]??text['use.custom']}));
 } catch { console.log(appsUnreadLine({company,agent,cause:'failed'})); return null; }
});
// One connected app of an Agent tested on its own (#770); null when it cannot be tested.
export const agentToolTest=cache(async(company:string,agent:string,app:string)=>{
 try { return await testAgentTool(await supabase(),{company,agent,app}); } catch { return null; }
});

// The token use of every Company this person manages (Owner or Manager) over the last `days` (#347, #32), each Agent's
// Hermes profile's own with its per-model rows, for the usage screens: one row per profile, by Company name. A Company
// whose Engine or database does not answer has no rows; a profile Hermes does not answer for has unknown usage (nulls).
export type UsageRow=AgentsUsage&{company_id:string,company_name:string};
export const managedUsage=cache(async(person:string,days:number):Promise<UsageRow[]>=>{
 const db=await supabase();
 const {data}=await db.from('members').select('company_id,companies(name)').eq('person_id',person).in('role',['owner','manager']).is('removed_at',null);
 const managed=((data||[]) as unknown as {company_id:string,companies:{name:string}|null}[]).sort((a,b)=>(a.companies?.name||'').localeCompare(b.companies?.name||''));
 const rows=await Promise.all(managed.map(async({company_id,companies})=>{
  const read=await readCompanyUsage(db,{company:company_id,days}).catch(()=>null);
  return (read||[]).map(entry=>({...entry,company_id,company_name:companies?.name||''}));
 }));
 return rows.flat();
});
