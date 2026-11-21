import { useState } from 'react';

// What arrives while a chat is open, for the reference's rise (design-reference: msgHTML's `fresh`, which renderThread
// clears after one draw). Each item is what a message is known by (`key`) and the element it is drawn as (`element`,
// its key in the list). The keys of the first draw are the baseline, and `settled` adds to it (a channel's own first
// read, which replaces a prefetched page). A key first drawn later has arrived as that element, which keeps its class:
// the animation runs once, when the element is put in the page, and drawing it again (the record asked for again) does
// not restart it. Drawn later as another element (a waiting turn that started), it stays still. Decided while drawing,
// so the new element's first frame is already its animation's first.
export type Arrival={key:string,element:string};
export function useArrivals(items:readonly Arrival[]):{rises:(item:Arrival)=>boolean,settled:(items:readonly Arrival[])=>void} {
 const [book]=useState(()=>{
  const seen=new Set(items.map(item=>item.key)); const arrived=new Map<string,string>();
  return {seen,arrived,rises:(item:Arrival)=>arrived.get(item.key)===item.element,settled:(more:readonly Arrival[])=>{ for(const item of more) seen.add(item.key); }};
 });
 for(const item of items) if(!book.seen.has(item.key)) { book.seen.add(item.key); book.arrived.set(item.key,item.element); }
 return book;
}
