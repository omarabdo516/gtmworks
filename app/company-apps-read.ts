'use client';
import { useEffect, useSyncExternalStore } from 'react';
import type { AppItem } from './settings-apps-client';

// The Company's apps as the browser last read them from /api/company-apps (#201), so no page waits on the Engine. Kept
// per signed-in person, Company and reader's language, outside any page, because every page draws its own Shell. A
// failed read never replaces a good one; a first read that fails is null, which the sheet shows as "can't be read".
// Absent until the first read lands.
// The copy is the signed-in person's alone (#552): an Owner's carries a command server's command, a Member's does not.
// A sign-out and sign-in in another tab leaves this tab open, and the first read for the new person drops every copy
// held for the one before, along with any answer still on its way for them.
type Held={apps:AppItem[]|null,at:number};
export type Reader={company:string,person:string,language:string};
const held=new Map<string,Held>();
let readingFor:string|undefined;
const listeners=new Set<()=>void>();
const keyOf=({company,person,language}:Reader)=>`${person}:${company}:${language}`;
// A read this recent is shown as it is when a page is drawn; opening the sheet or changing an app reads again anyway.
const freshFor=60_000;

function signedIn(person:string) {
 if(readingFor===person) return;
 readingFor=person;
 if(held.size) { held.clear(); listeners.forEach(listener=>listener()); }
}

export async function readApps(reader:Reader) {
 signedIn(reader.person);
 const apps=await fetch(`/api/company-apps?company=${encodeURIComponent(reader.company)}`,{cache:'no-store'})
  .then(response=>response.ok?response.json():null).then(body=>Array.isArray(body?.apps)?body.apps as AppItem[]:null).catch(()=>null);
 if(readingFor!==reader.person) return;
 const key=keyOf(reader);
 if(!apps&&held.get(key)?.apps) return;
 held.set(key,{apps,at:Date.now()});
 listeners.forEach(listener=>listener());
}

// An app was connected or disconnected: every language's read of this Company is stale, and this one is read now.
export function appsChanged(reader:Reader) {
 const company=`${reader.person}:${reader.company}:`;
 for(const [key,entry] of held) if(key.startsWith(company)) entry.at=0;
 return readApps(reader);
}

const subscribe=(listener:()=>void)=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; };
// The apps as last read, without asking for a read: for a part of the page whose sheet or menu reads them itself.
export const useHeldApps=(reader:Reader):AppItem[]|null|undefined=>useSyncExternalStore(subscribe,()=>held.get(keyOf(reader))?.apps,()=>undefined);
export function useCompanyApps(reader:Reader):AppItem[]|null|undefined {
 const key=keyOf(reader); const {company,person,language}=reader;
 const apps=useHeldApps(reader);
 useEffect(()=>{ const last=held.get(key); if(!last||Date.now()-last.at>freshFor) void readApps({company,person,language}); },[key,company,person,language]);
 return apps;
}
