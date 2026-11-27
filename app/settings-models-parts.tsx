'use client';
import type { ComponentProps, ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { CompanyProviders, SpeechToText, DefaultModel, FallbackModel, EachAgent, DefaultEffort } from './settings-lazy';
import type { CompanySignIns } from '@/lib/company-sign-in.mjs';
import type { ModelsData, SpeechData } from './settings-models';
import type { ProviderKeysData, ProviderModelsData } from './settings-providers';
import { partUrl, useSettingsPart, type PartRead } from './settings-part-read';

type Part='signIns'|'models'|'keys'|'providers'|'speech';
type Read<T>=PartRead<T>;
// What each part reads, and whether a read of it is good: the shape a part comes back in when the Engine did not answer
// is a failed read, never a value to keep.
type Parts={signIns:CompanySignIns,models:{models:ModelsData|null},keys:ProviderKeysData|null,providers:ProviderModelsData|null,speech:SpeechData};
const good:{[part in Part]:(data:Parts[part])=>boolean}={
 signIns:data=>data.profiles!=null,
 models:data=>data.models!=null,
 keys:data=>data!=null&&data.keys!=null,
 providers:data=>data!=null,
 speech:data=>data.missing!=null,
};

// One part, read by the browser after the section is drawn (app/settings-part-read.ts). `asked` is when the overlay was
// last drawn on the server: a save that draws it again (router.refresh) reads every part again.
const usePart=<P extends Part>(company:string,part:P,asked:number):Read<Parts[P]>=>useSettingsPart(partUrl(company,part),asked,good[part]);

const Line=({children}:{children:ReactNode})=><div className="panel-card"><p className="panel-empty">{children}</p></div>;

// Settings → Models (#791, ADR 0030): drawn at once with what gtmworks stores (the Providers' names and order, the
// Fallback model), and each part the Engine backs filled in by its own read. A part still on its first read says so; one
// whose read fails keeps its last good read and says it is being read again, or with none shows its own line, and the
// other parts stay as they are.
export function ModelsParts({company,companyName,owner,names,order,fallback,asked}:{company:string,companyName:string,owner:boolean,names:Record<string,string>,order:ComponentProps<typeof CompanyProviders>['order'],fallback:string|null|undefined,asked:number}) {
 const {t}=useI18n();
 const signIns=usePart(company,'signIns',asked);
 const keys=usePart(company,'keys',asked);
 const providers=usePart(company,'providers',asked);
 const models=usePart(company,'models',asked);
 const speech=usePart(company,'speech',asked);
 const again=(read:Read<unknown>)=>read.state==='failed'&&read.kept?<p className="set-hint" role="status">{t('settingsPartReadAgain')}</p>:null;
 // The list needs the sign-ins and the keys; each Provider's models fill in its details when they arrive.
 const listed=signIns.data!==undefined&&keys.data!==undefined||signIns.state==='failed'||keys.state==='failed';
 const subs=signIns.data;
 const list=listed?<CompanyProviders company={company} companyName={companyName} owner={owner} keys={keys.data??null} models={providers.data??null} names={names} order={order}
  subscriptions={{available:subs?.profiles!=null,signIns:subs?.signIns??null,accounts:subs&&'accounts' in subs?subs.accounts??null:null,noEngine:subs?.noEngine===true}}/>:<Line>{t('settingsPartReading')}</Line>;
 const choices=models.kept?models.data?.models??null:null;
 return <>
  {list}{again(signIns)??again(keys)??again(providers)}
  {choices?<DefaultModel company={company} owner={owner} models={choices.default} readAt={models.readAt}/>:<Line>{t(models.state==='reading'?'settingsPartReading':'settingsModelsUnread')}</Line>}
  {again(models)}
  {choices&&fallback!==undefined?<FallbackModel company={company} owner={owner} model={fallback} options={choices.default.options} readAt={models.readAt}/>:null}
  <DefaultEffort/>
  {choices?<EachAgent company={company} owner={owner} models={choices} readAt={models.readAt}/>:null}
  {speech.data!==undefined||speech.state==='failed'?<SpeechToText company={company} owner={owner} data={speech.data??{provider:null,keys:null,missing:null}} readAt={speech.readAt}/>:<Line>{t('settingsPartReading')}</Line>}
  {again(speech)}
 </>;
}
