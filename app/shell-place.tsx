'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';

// Which page of the Company the Shell is drawn around (#789). The Shell lives in the Company's layout, which is not drawn
// again when a person moves between its pages, so the sidebar's marks (the entry, the Agent, the Conversation, the channel
// that is open) follow the page shown under it here, in the browser. The page's place comes from its address segments
// below the layout: Settings opened over a page keep that page's segments, so the page underneath stays marked. What the
// address does not say (the Agent a Conversation is with, Lead's chat at /chat, the Card open over the board), the page
// names with <PageMarks/>; the Shell names what it already knows from its own reads, so the first paint is marked too.
export type Place={section:string,chat:boolean,agent?:string,conversation?:string,channel?:string,card?:number};
type Marks={agent?:string,card?:number};
type Known={lead?:string,chatAgents:Record<string,string>};

// A page's place from its segments; an optional catch-all may come as one joined segment or as several.
export function placeOf(segments:readonly string[]):Omit<Place,'chat'|'card'> {
 const parts=segments.join('/').split('/').filter(part=>part&&!part.startsWith('__PAGE__'));
 const [first,second,third]=parts;
 // The page slot's default is the Company's frame under Settings at their own address (app/c/[slug]/default.tsx).
 if(!first) return {section:'home'};
 if(first.startsWith('__DEFAULT__')) return {section:'settings'};
 if(first==='chat') return {section:'chat',agent:second};
 if(first==='conversations') return second?{section:'conversations',conversation:second}:{section:'all-conversations'};
 if(first==='channels') return {section:'channels',channel:second};
 if(first==='work'&&second==='board'&&third) return {section:'work/board'};
 return {section:parts.join('/')};
}
export const chatSections=new Set(['chat','conversations','channels']);

// The place is a store, not a context value: a context whose value changes while a page still streams in (a page naming
// its marks during the first load) makes React draw that page's part in the browser beside its streamed copy (#172).
// The store reaches only the sidebar's parts that read it.
type PlaceStore={get:()=>Place,subscribe:(listener:()=>void)=>()=>void,set:(place:Place)=>void};
function placeStore(first:Place):PlaceStore {
 let current=first; const listeners=new Set<()=>void>();
 return {get:()=>current,subscribe:listener=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; },
  set:place=>{ if(place===current) return; current=place; listeners.forEach(listener=>listener()); }};
}
const home:Place={section:'home',chat:false};
const outside=placeStore(home);
const PlaceContext=createContext<{store:PlaceStore,mark:(marks:Marks)=>void}>({store:outside,mark:()=>{}});

export function ShellPlace({lead,chatAgents,children}:Known&{children:ReactNode}) {
 const segments=useSelectedLayoutSegments();
 const key=segments.join('/');
 const [marked,setMarked]=useState<{key:string,marks:Marks}|null>(null);
 const at=useMemo(()=>placeOf(key.split('/')),[key]);
 const marks=marked?.key===key?marked.marks:{};
 const agent=at.agent??marks.agent??(at.section==='chat'?lead:at.conversation?chatAgents[at.conversation]:undefined);
 const {section,conversation,channel}=at, card=marks.card;
 // The same place keeps the same object, so a page naming what the Shell already knew redraws nothing.
 const place=useMemo<Place>(()=>({section,agent,conversation,channel,card,chat:chatSections.has(section)}),[section,agent,conversation,channel,card]);
 const [store]=useState(()=>placeStore(place));
 useLayoutEffect(()=>{ store.set(place); },[store,place]);
 // The marks belong to the page shown: the address they were named on is read when they are named, after the Shell has
 // taken the new address (its layout effect runs before the page's effect).
 const shown=useRef(key);
 useLayoutEffect(()=>{ shown.current=key; },[key]);
 const mark=useCallback((marks:Marks)=>setMarked(was=>{ const named=shown.current;
  return was?.key===named&&was.marks.agent===marks.agent&&was.marks.card===marks.card?was:{key:named,marks}; }),[]);
 const value=useMemo(()=>({store,mark}),[store,mark]);
 return <PlaceContext value={value}>{children}</PlaceContext>;
}

export function useShellPlace() {
 const {store}=useContext(PlaceContext);
 return useSyncExternalStore(store.subscribe,store.get,store.get);
}

// What a page knows of its place that its address does not say: the Agent of its Conversation or chat, the Card it opens.
export function PageMarks({agent,card}:Marks) {
 const {mark}=useContext(PlaceContext);
 useEffect(()=>{ mark({agent,card}); },[mark,agent,card]);
 return null;
}
