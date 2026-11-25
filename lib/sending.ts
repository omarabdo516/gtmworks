import { useEffect, useState } from 'react';
import { reportWait } from './waits';

// A message drawn the moment its person sends it (#756), before the send is answered: the place it is sent to (a
// Conversation or a channel) draws it from here, with the text and the names of the files it carries, until its own record
// holds it. The send is answered only once the message is stored, so a read of the record begun after that answer holds
// it, and that read, once drawn, takes the drawn message's place (`reading`); a read begun before may not, and leaves it.
// While the send is on its way the message is `posting`; refused, it goes, and the composer takes its words back.
// Kept in the page's memory only, by its send key, so sending the same key again (a retry) draws it once.
// `id` is the drawn message's own, in the order sent, so one going leaves the others' as they were.
export type Sending={id:number,key:string,body:string,files:string[],at:string,posting:boolean};
export type Send=(key:string,body:string,files:readonly {name:string}[])=>(failure:string|null)=>void;
// In a Conversation (`place`), the time from the press until the message is drawn is reported once (#762).
export function useSending(place?:{company:string,conversation:string}):{list:Sending[],start:Send,reading:()=>()=>void} {
 const [list,setList]=useState<Sending[]>([]);
 const [pressed]=useState(()=>new Map<number,number>());
 const [calls]=useState(()=>{
  const accepted=new Set<string>(); let sent=0;
  const start:Send=(key,body,files)=>{
   accepted.delete(key); const id=++sent; pressed.set(id,performance.now());
   setList(current=>[...current.filter(sending=>sending.key!==key),{id,key,body,files:files.map(file=>file.name),at:new Date().toISOString(),posting:true}]);
   return failure=>{
    if(failure) { setList(current=>current.filter(sending=>sending.key!==key)); return; }
    accepted.add(key);
    setList(current=>current.map(sending=>sending.key===key?{...sending,posting:false}:sending));
   };
  };
  // A read of the record begins: what was answered by now is in it. Call what it returns once that read is drawn.
  const reading=()=>{
   const held=new Set(accepted);
   return ()=>{
    if(!held.size) return;
    for(const key of held) accepted.delete(key);
    setList(current=>current.filter(sending=>!held.has(sending.key)));
   };
  };
  return {start,reading};
 });
 const company=place?.company; const conversation=place?.conversation;
 useEffect(()=>{
  if(!company||!conversation) return;
  for(const sending of list) {
   const at=pressed.get(sending.id); if(at===undefined) continue;
   pressed.delete(sending.id);
   // Drawn once the browser paints the frame that holds it.
   requestAnimationFrame(()=>reportWait({event:'message_drawn',company,conversation,ms:performance.now()-at}));
  }
 },[list,pressed,company,conversation]);
 return {list,...calls};
}
