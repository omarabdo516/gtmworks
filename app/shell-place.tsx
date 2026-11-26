'use client';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
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
const chatSections=new Set(['chat','conversations','channels']);

const PlaceContext=createContext<{place:Place,mark:(marks:Marks)=>void}>({place:{section:'home',chat:false},mark:()=>{}});

export function ShellPlace({lead,chatAgents,children}:Known&{children:ReactNode}) {
 const segments=useSelectedLayoutSegments();
 const key=segments.join('/');
 const [marked,setMarked]=useState<{key:string,marks:Marks}|null>(null);
 const place=useMemo(()=>{
  const at=placeOf(key.split('/'));
  const marks=marked?.key===key?marked.marks:{};
  const agent=at.agent??marks.agent??(at.section==='chat'?lead:at.conversation?chatAgents[at.conversation]:undefined);
  return {...at,agent,card:marks.card,chat:chatSections.has(at.section)};
 },[key,marked,lead,chatAgents]);
 // A page naming the same marks again changes nothing, so its effect never draws the Shell twice.
 const mark=useCallback((marks:Marks)=>setMarked(was=>was?.key===key&&was.marks.agent===marks.agent&&was.marks.card===marks.card?was:{key,marks}),[key]);
 const value=useMemo(()=>({place,mark}),[place,mark]);
 return <PlaceContext value={value}>{children}</PlaceContext>;
}

export const useShellPlace=()=>useContext(PlaceContext).place;

// What a page knows of its place that its address does not say: the Agent of its Conversation or chat, the Card it opens.
export function PageMarks({agent,card}:Marks) {
 const {mark}=useContext(PlaceContext);
 useLayoutEffect(()=>{ mark({agent,card}); },[mark,agent,card]);
 return null;
}
