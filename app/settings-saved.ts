'use client';
import { useRef, useState, useSyncExternalStore } from 'react';

// A setting the person saved, shown at once and held on the page (#661). The click marks the choice and the row says
// "Saving" while the Engine writes and reads it back; nothing waits for the server first. The page is not read again:
// the confirmed value is held here, under its key, as the newest truth until a read of the page made after the save
// arrives (a section the router kept from before the save still shows the saved value). A save that fails or does not
// match goes back to the value held before it and says why.

type Held={value:unknown,at:number};
const held=new Map<string,Held>();
// Bumped by every hold, so a control that reads many keys at once (useSavedEach) sees each new one.
let version=0;
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; };

/** Holds a confirmed value, `at` being the server's time the save finished (the route's `savedAt`). */
export function holdSaved(key:string,value:unknown,at:number) {
 const was=held.get(key);
 if(was&&was.at>at) return;
 held.set(key,{value,at}); version++;
 listeners.forEach(listener=>listener());
}

/** The value the page shows: the server's, unless a save confirmed after that page was read (`readAt`) holds another. */
export function useSaved<T>(key:string,server:T,readAt:number):T {
 const entry=useSyncExternalStore(subscribe,()=>held.get(key),()=>undefined);
 return entry&&entry.at>readAt?entry.value as T:server;
}

/** useSaved for a list read together: each entry's server value, unless a save confirmed after `readAt` holds another. */
export function useSavedEach<T>(entries:{key:string,server:T}[],readAt:number):T[] {
 useSyncExternalStore(subscribe,()=>version,()=>0);
 return entries.map(({key,server})=>{ const entry=held.get(key); return entry&&entry.at>readAt?entry.value as T:server; });
}

export type Answer={ok:boolean,error:string,data:Record<string,unknown>|null};
export async function send(path:string,body:object):Promise<Answer> {
 try {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const answer=await response.json().catch(()=>null);
  return {ok:response.ok,error:response.ok?'':String((answer as {error?:unknown}|null)?.error||''),data:answer&&typeof answer==='object'?answer as Record<string,unknown>:null};
 } catch { return {ok:false,error:'',data:null}; }
}
/** When the server finished a save, from its answer. */
export const savedAt=(answer:Answer)=>{ const at=Number(answer.data?.savedAt); return Number.isFinite(at)?at:Date.now(); };

/**
 * One saved value: `value` is what the control shows (the choice being saved while `saving`), `error` the route's code
 * of the last save that failed. A second choice made while one is saving is marked at once and sent once the first has
 * answered, so the Engine ends on the last choice; only the newest one's answer clears the "Saving" state or shows an
 * error, and the answer says whether it is that newest one (`newest`).
 */
export function useSave<T>(key:string,server:T,readAt:number) {
 const confirmed=useSaved(key,server,readAt);
 const [pending,setPending]=useState<{value:T}|null>(null);
 const [error,setError]=useState('');
 const latest=useRef(0);
 const before=useRef<Promise<unknown>>(Promise.resolve());
 const save=async(value:T,request:()=>Promise<Answer>,confirmedOf:(answer:Answer)=>T=()=>value):Promise<Answer&{newest:boolean}>=>{
  const turn=++latest.current;
  setPending({value}); setError('');
  const sent=before.current.then(request);
  before.current=sent.catch(()=>null);
  const answer=await sent;
  if(answer.ok) holdSaved(key,confirmedOf(answer),savedAt(answer));
  const newest=turn===latest.current;
  if(newest) {
   setPending(null);
   if(!answer.ok) setError(answer.error||'settingFailed');
  }
  return {...answer,newest};
 };
 return {value:pending?pending.value:confirmed,saving:pending!==null,error,save};
}
