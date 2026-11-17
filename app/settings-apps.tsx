import './apps.css';
import { getI18n } from '@/lib/i18n-server';
import { companyAppItems } from '@/lib/company-app-items';
import en from '@/lib/messages/apps.en.json';
import ar from '@/lib/messages/apps.ar.json';
import { AppsList, AppDetail, type AppsPlace } from './settings-apps-client';

// Settings, Apps (#30): the apps the Company's Agents can use, and at ?app=<key> one app's page. Every Member who sees the
// section reads it; only the Owner gets the buttons, and the route checks the Owner again. The strings live in their own
// catalogue (apps.en.json and apps.ar.json).
export default async function AppsSection({slug,company,owner,rtl,app,failed}:{slug:string,company:string,owner:boolean,rtl:boolean,app?:string,failed:boolean}) {
 const {t,language}=await getI18n(); const text:Record<string,string>=language==='ar'?ar:en;
 const items=await companyAppItems(company,language);
 const place:AppsPlace={kind:'address',slug};
 const item=items?.find(entry=>entry.key===app);
 if(item) return <div className="sov-apps"><AppDetail place={place} company={company} owner={owner} rtl={rtl} item={item} text={text} soon={t('soon')} failed={failed}/></div>;
 return <div className="sov-apps"><AppsList place={place} owner={owner} items={items} text={text}/>
  {failed&&<p className="set-err" role="alert">{text.signInFailed}</p>}</div>;
}
