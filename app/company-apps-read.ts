'use client';
import { useEffect, useSyncExternalStore } from 'react';
import type { AppItem } from './settings-apps-client';

// The Company's apps as the browser last read them from /api/company-apps (#201), so no page waits on the Engine. Kept
// per Company and reader's language, outside any page, because every page draws its own Shell. A failed read never
// replaces a good one; a first read that fails is null, which the sheet shows as "can't be read". Absent until the
// first read lands.
type Held={apps:AppItem[]|null,at:number};
const held=new Map<string,Held>();
const listeners=new Set<()=>void>();
const keyOf=(company:string,language:string)=>`${company}:${language}`;
// A read this recent is shown as it is when a page is drawn; opening the sheet or changing an app reads again anyway.
const freshFor=60_000;

export async function readApps(company:string,language:string) {
 const apps=await fetch(`/api/company-apps?company=${encodeURIComponent(company)}`,{cache:'no-store'})
  .then(response=>response.ok?response.json():null).then(body=>Array.isArray(body?.apps)?body.apps as AppItem[]:null).catch(()=>null);
 const key=keyOf(company,language);
 if(!apps&&held.get(key)?.apps) return;
 held.set(key,{apps,at:Date.now()});
 listeners.forEach(listener=>listener());
}

// An app was connected or disconnected: every language's read of this Company is stale, and this one is read now.
export function appsChanged(company:string,language:string) {
 for(const [key,entry] of held) if(key.startsWith(`${company}:`)) entry.at=0;
 return readApps(company,language);
}

const subscribe=(listener:()=>void)=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; };
// The apps as last read, without asking for a read: for a part of the page whose sheet or menu reads them itself.
export const useHeldApps=(company:string,language:string):AppItem[]|null|undefined=>useSyncExternalStore(subscribe,()=>held.get(keyOf(company,language))?.apps,()=>undefined);
export function useCompanyApps(company:string,language:string):AppItem[]|null|undefined {
 const key=keyOf(company,language);
 const apps=useHeldApps(company,language);
 useEffect(()=>{ const last=held.get(key); if(!last||Date.now()-last.at>freshFor) void readApps(company,language); },[key,company,language]);
 return apps;
}
