'use client';
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import type { AppItem } from './settings-apps-client';
import type { AppState } from '@/lib/app-catalogue.mjs';
import { settingsReads } from '@/lib/settings-part-queue.mjs';

// The Company's apps as the browser last read them from /api/company-apps (#201), so no page waits on the Engine. Kept
// per signed-in person, Company and reader's language, outside any page, because a refresh draws the Shell again. A
// failed read never replaces a good one; a first read that fails is null, which the sheet shows as "can't be read".
// Absent until the first read lands.
// The copy is the signed-in person's alone (#552): an Owner's carries a command server's command, a Member's does not.
// A sign-out and sign-in in another tab leaves this tab open; the next page the Shell draws names the new person, which
// drops every copy held for the one before. A read for anyone else, an answer still on its way for them, or a change
// a callback of theirs reports late, is neither asked for nor kept.
type Held={apps:AppItem[]|null,at:number};
export type Reader={company:string,person:string,language:string};
const held=new Map<string,Held>();
let readingFor:string|undefined;
// Counts the sign-ins this tab has seen, so a read asked for before one is dropped even when the same person is back.
let signIns=0;
const listeners=new Set<()=>void>();
// One person's reads of one Company share a prefix: a change to an app makes every language's read of it stale.
const companyOf=({company,person}:Pick<Reader,'company'|'person'>)=>`${person}:${company}:`;
const keyOf=(reader:Reader)=>`${companyOf(reader)}${reader.language}`;
// A read this recent is shown as it is when a page is drawn; opening the sheet or changing an app reads again anyway.
const freshFor=60_000;

// Who is signed in, as the Shell drew it: only the sheet's provider says so, before any part of the page reads.
export function useSignedIn(person:string) {
 useLayoutEffect(()=>{
  if(readingFor===person) return;
  readingFor=person; signIns++;
  if(held.size) { held.clear(); listeners.forEach(listener=>listener()); }
 },[person]);
}
// A part drawn without the sheet's provider (only a component test does) reads as no one and holds its own copy.
const current=({person}:Reader)=>!person||person===readingFor;

export async function readApps(reader:Reader) {
 if(!current(reader)) return;
 const asked=signIns;
 const apps=await fetch(`/api/company-apps?company=${encodeURIComponent(reader.company)}`,{cache:'no-store'})
  .then(response=>response.ok?response.json():null).then(body=>Array.isArray(body?.apps)?body.apps as AppItem[]:null).catch(()=>null);
 if(!current(reader)||(reader.person&&asked!==signIns)) return;
 const key=keyOf(reader);
 if(!apps&&held.get(key)?.apps) return;
 held.set(key,{apps,at:Date.now()});
 listeners.forEach(listener=>listener());
 // Each app that is on reads `checking` until its own test answers (#898, ADR 0030): the list is drawn at once, each
 // test is its own request, in Settings' queue of four, and no row waits for another.
 for(const app of apps??[]) if(app.state==='checking') void testApp(reader,key,app.key,asked);
}

type Tested={state:AppState,agents:{id:string,state:AppState|null}[]};
async function testApp(reader:Reader,key:string,app:string,asked:number) {
 const tested=await settingsReads(()=>fetch(`/api/company-apps?company=${encodeURIComponent(reader.company)}&test=${encodeURIComponent(app)}`,{cache:'no-store'})
  .then(response=>response.ok?response.json() as Promise<Tested>:null)).catch(()=>null);
 if(!tested||typeof tested.state!=='string'||!Array.isArray(tested.agents)||!current(reader)||(reader.person&&asked!==signIns)) return;
 const entry=held.get(key);
 // A newer read already listed this app again; its own test answers it.
 if(!entry?.apps?.some(item=>item.key===app&&item.state==='checking')) return;
 const states=new Map(tested.agents.map(agent=>[agent.id,agent.state]));
 held.set(key,{...entry,apps:entry.apps.map(item=>item.key!==app?item:{...item,state:tested.state,agents:item.agents.map(agent=>states.has(agent.id)?{...agent,state:states.get(agent.id)??null}:agent)})});
 listeners.forEach(listener=>listener());
}

// An app was connected or disconnected: every language's read of this Company for this person is stale (no one else's
// copy is held), and this one is read now.
export function appsChanged(reader:Reader) {
 const prefix=companyOf(reader);
 for(const [key,entry] of held) if(key.startsWith(prefix)) entry.at=0;
 return readApps(reader);
}

const subscribe=(listener:()=>void)=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; };
// The apps as last read, without asking for a read: for a part of the page whose sheet or menu reads them itself.
export const useHeldApps=(reader:Reader):AppItem[]|null|undefined=>useSyncExternalStore(subscribe,()=>held.get(keyOf(reader))?.apps,()=>undefined);
export function useCompanyApps(reader:Reader):AppItem[]|null|undefined {
 // The reader is taken apart so the effect follows its three values, not a new object on every draw.
 const key=keyOf(reader); const {company,person,language}=reader;
 const apps=useHeldApps(reader);
 useEffect(()=>{ const last=held.get(key); if(!last||Date.now()-last.at>freshFor) void readApps({company,person,language}); },[key,company,person,language]);
 return apps;
}
