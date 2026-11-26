'use client';
import './apps.css';
import { useI18n } from '@/lib/i18n-client';
import en from '@/lib/messages/apps.en.json';
import ar from '@/lib/messages/apps.ar.json';
import { AppsList, AppDetail, type AppsPlace } from './settings-apps-client';
import { useAppsReader } from './apps-sheet-open';
import { useCompanyApps } from './company-apps-read';

// Settings, Apps (#30): the apps the Company's Agents can use, and at ?app=<key> one app's page. Every Member who sees the
// section reads it; only the Owner gets the buttons, and the route checks the Owner again. The strings live in their own
// catalogue (apps.en.json and apps.ar.json). The list is read by the browser after the section is drawn, through the same
// store as the Connect apps sheet (#898, ADR 0030): it shows at once, and each app that is on reads "checking…" until its
// own test answers.
export default function AppsSection({slug,company,owner,app,failed}:{slug:string,company:string,owner:boolean,app?:string,failed:boolean}) {
 const {language}=useI18n(); const rtl=language==='ar'; const text:Record<string,string>=language==='ar'?ar:en;
 const items=useCompanyApps(useAppsReader(company));
 const place:AppsPlace={kind:'address',slug};
 const item=items?.find(entry=>entry.key===app);
 if(item) return <div className="sov-apps"><AppDetail place={place} company={company} owner={owner} rtl={rtl} item={item} text={text} failed={failed}/></div>;
 return <div className="sov-apps"><AppsList place={place} owner={owner} items={items} text={text}/>
  {failed&&<p className="set-err" role="alert">{text.signInFailed}</p>}</div>;
}
