import './apps.css';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { getI18n } from '@/lib/i18n-server';
import { readCompanyApps } from '@/lib/company-apps.mjs';
import en from '@/lib/messages/apps.en.json';
import ar from '@/lib/messages/apps.ar.json';
import { AppsList, AppDetail, type AppItem } from './settings-apps-client';

type Text=Record<string,string>;
const catalogues:Text[]=[en,ar];

// Settings, Apps (#30): the apps the Company's Agents can use, each with its state read now from the Company's own
// profile in the Engine (lib/company-apps.mjs), and at ?app=<key> one app's page. Every Member who sees the section reads
// it; only the Owner gets the buttons, and the route checks the Owner again. The strings live in their own catalogue
// (apps.en.json and apps.ar.json); search reads an app's words in both languages.
export default async function AppsSection({slug,company,owner,rtl,app,failed}:{slug:string,company:string,owner:boolean,rtl:boolean,app?:string,failed:boolean}) {
 const {t,language}=await getI18n(); const text:Text=language==='ar'?ar:en;
 const db=await supabase();
 const apps=await (async()=>{ try { return await readCompanyApps(db,createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}}),{company,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY}); } catch { return null; } })();
 const items:AppItem[]=(apps||[]).map(entry=>({...entry,use:text[`use.${entry.key}`],can:text[`can.${entry.key}`],
  words:[entry.name,...catalogues.flatMap(words=>[`use.${entry.key}`,`can.${entry.key}`,`alias.${entry.key}`,`category.${entry.category}`].map(key=>words[key]))].join(' ')}));
 const item=items.find(entry=>entry.key===app);
 if(item) return <div className="sov-apps"><AppDetail slug={slug} company={company} owner={owner} rtl={rtl} item={item} text={text} soon={t('soon')} failed={failed}/></div>;
 return <div className="sov-apps"><AppsList slug={slug} owner={owner} items={items} text={text}/>
  {!apps?<div className="panel-card"><p className="panel-empty">{text.unreadable}</p></div>:!items.length&&<div className="panel-card"><p className="panel-empty">{text.noneOffered}</p></div>}
  {failed&&<p className="set-err" role="alert">{text.signInFailed}</p>}</div>;
}
