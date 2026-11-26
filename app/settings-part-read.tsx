'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { settingsReads } from '@/lib/settings-part-queue.mjs';

// One part of Settings that the Engine backs (ADR 0030, #791, #898), read by the browser after its section is drawn
// (GET /api/settings-parts): the section never waits for it, and no part waits for another. Every part of the page waits
// its turn in one queue of four (lib/settings-part-queue.mjs), so a page cannot fill its Engine's listener. Two places
// that show the same part share one read. `kept` says the data is a good read, the last one, while a new read runs or
// after it failed: a good read is kept in this browser's memory for a minute, never in storage, and a part whose read
// fails shows it and is read again after a pause, longer each time, while it is open.
export type PartRead<T>={data:T|undefined,readAt:number,state:'reading'|'read'|'failed',kept:boolean};
type Answer={data:unknown,readAt:number};
const kept=new Map<string,{data:unknown,readAt:number,at:number}>();
const keptFor=60000;
// A read is the signed-in reader's own: what one person read is never shown to another who signs in in the same tab,
// since the server shows each reader only the Agents they see. The overlay names its reader before any part draws.
let readerOf='';
export function PartsReader({person}:{person:string}) {
 if(readerOf!==person) { readerOf=person; kept.clear(); }
 return null;
}
const keyOf=(url:string)=>`${readerOf}|${url}`;
const keptOf=(url:string)=>{ const entry=kept.get(keyOf(url)); return entry&&Date.now()-entry.at<keptFor?entry:undefined; };
const againAfter=[3000,10000,30000];
const inflight=new Map<string,{answer:Promise<Answer|null>,users:number,stop:AbortController}>();
function share(url:string,round:string) {
 const key=`${keyOf(url)}#${round}`;
 let entry=inflight.get(key);
 if(!entry) {
  const stop=new AbortController();
  const answer=settingsReads(()=>fetch(url,{cache:'no-store',signal:stop.signal}).then(response=>response.ok?response.json() as Promise<Answer>:null),stop.signal)
   .catch(()=>null).finally(()=>{ if(inflight.get(key)===made) inflight.delete(key); });
  const made={answer,users:0,stop}; entry=made; inflight.set(key,made);
 }
 const used=entry; used.users++; let left=false;
 return {answer:used.answer,leave:()=>{ if(left) return; left=true; if(--used.users===0) { used.stop.abort(); if(inflight.get(key)===used) inflight.delete(key); } }};
}

export const partUrl=(company:string,part:string,with_:Record<string,string|undefined>={})=>`/api/settings-parts?${new URLSearchParams({company,part,...Object.fromEntries(Object.entries(with_).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))})}`;

// `asked` is when the overlay was last drawn on the server: a save that draws it again (router.refresh) reads the part
// again. `good` says whether an answer is a good read: the shape a part comes back in when the Engine did not answer is
// a failed read, never one to keep.
const first=<T,>(url:string):PartRead<T>=>{ const entry=keptOf(url); return {data:entry?.data as T|undefined,readAt:entry?.readAt??0,state:'reading',kept:!!entry}; };
export function useSettingsPart<T>(url:string,asked:number,good:(data:T)=>boolean):PartRead<T> {
 // Each read belongs to its reader and its address: a part drawn again for another person, Agent or period never shows
 // the one before's.
 const id=`${readerOf}|${url}`;
 const [held,setHeld]=useState<{id:string,read:PartRead<T>}>(()=>({id,read:first<T>(url)}));
 const read=held.id===id?held.read:first<T>(url);
 const setRead=(next:PartRead<T>|((was:PartRead<T>)=>PartRead<T>))=>setHeld(was=>({id,read:typeof next==='function'?next(was.id===id?was.read:first<T>(url)):next}));
 useEffect(()=>{
  // The reader this read is made for, fixed when it is asked (PartsReader names the reader before any part draws).
  const reader=readerOf;
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined; let tries=0; let leave=()=>{};
  // A failed read keeps the last good one: the one this part shows, even past the minute, else the one this browser
  // kept; with none, the part shows what the Engine answered (its own unread line).
  const fail=(answered:T|undefined)=>{
   const entry=keptOf(url);
   setRead(was=>was.kept?{...was,state:'failed'}:entry?{data:entry.data as T,readAt:entry.readAt,state:'failed',kept:true}:{data:answered,readAt:was.readAt,state:'failed',kept:false});
   timer=setTimeout(()=>ask(`${asked}:${tries}`),againAfter[Math.min(tries++,againAfter.length-1)]);
  };
  const ask=(round:string)=>{
   const shared=share(url,round); leave=shared.leave;
   void shared.answer.then(body=>{
    if(stopped) return;
    // Kept under the reader who asked: a read that lands after another person signed in is never theirs.
    if(body&&good(body.data as T)) { if(readerOf===reader) kept.set(`${reader}|${url}`,{data:body.data,readAt:body.readAt,at:Date.now()}); setRead({data:body.data as T,readAt:body.readAt,state:'read',kept:true}); return; }
    fail(body?.data as T|undefined);
   });
  };
  ask(String(asked));
  return ()=>{ stopped=true; clearTimeout(timer); leave(); };
 },[id,asked]); // eslint-disable-line react-hooks/exhaustive-deps
 return read;
}

// What the parts share: a read is good when the Engine found it; a part on its first read with nothing kept says so.
export const foundRead=(data:{state?:string}|null|undefined)=>data?.state==='found';
export const firstReading=(read:PartRead<unknown>)=>read.state==='reading'&&!read.kept;
export function PartReading() { const {t}=useI18n(); return <div className="panel-card"><p className="panel-empty set-part-reading" role="status">{t('settingsPartReading')}</p></div>; }
