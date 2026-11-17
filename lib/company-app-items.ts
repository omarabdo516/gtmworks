import 'server-only';
import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { supabaseConfig } from './supabase-config';
import { readAgentApps, readCompanyApps } from './company-apps.mjs';
import type { Language } from './i18n.mjs';
import en from './messages/apps.en.json';
import ar from './messages/apps.ar.json';
import type { AppItem } from '@/app/settings-apps-client';
import type { AppStates } from './conversations';

type Text=Record<string,string>;
const catalogues:Text[]=[en,ar];

// A Company's apps as Settings, Apps and the Connect apps sheet draw them (#30, #201): each with its state read now from
// the Company's own profile in the Engine (lib/company-apps.mjs), in the reader's words; search reads an app's words in
// both languages. null when the Engine or the database cannot be read; it never rejects. Settings reads it while drawing;
// the sheet asks for it through GET /api/company-apps, so no other page waits on the Engine.
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
export const companyAppItems=cache(async(company:string,language:Language):Promise<AppItem[]|null>=>{
 try {
  const apps=await readCompanyApps(await supabase(),service(),{company,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY});
  if(!apps) return null;
  const text:Text=language==='ar'?ar:en;
  return apps.map(entry=>({...entry,use:text[`use.${entry.key}`],can:text[`can.${entry.key}`],
   words:[entry.name,...catalogues.flatMap(words=>[`use.${entry.key}`,`can.${entry.key}`,`alias.${entry.key}`,`category.${entry.category}`].map(key=>words[key]))].join(' ')}));
 } catch { return null; }
});

// One Agent's apps now, by key, for the connect cards of its Conversations (#203); null when they cannot be read.
export const agentAppStates=cache(async(company:string,agent:string):Promise<AppStates>=>{
 try { return await readAgentApps(await supabase(),service(),{company,agent,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY}); } catch { return null; }
});
