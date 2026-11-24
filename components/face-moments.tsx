'use client';
import { useEffect } from 'react';
import { playMoment } from './face-life';

// Two of an Agent's three moments, each played once where it happens (#701; design-reference-orb section 4). Each is
// a moment of components/face-life: under 1.2s, never looping, still frames with reduced motion, and played over the
// face as it is, so it never holds back what the person does. The third, perking up, is the @ list's (conversation-composer).
const facesIn=(places:string,agent:string)=>document.querySelectorAll<HTMLElement>(`[data-${places}] .face--live[data-agent="${CSS.escape(agent)}"]`);

// Birth: a made Agent is born once for the person who asked for it, on its card and its sidebar tile (the places that
// carry data-birth). Each place where the Agent is still new for them draws <Birth>; the page asks the server once per
// Agent, and the server answers true only to that Agent's requester, once (mark_agent_born): the record is kept as it
// answers, so a reload while it is being born, another device and another Member are answered false.
const birthAsked=new Set<string>();
export function Birth({agent}:{agent:string}) {
 useEffect(()=>{
  if(birthAsked.has(agent)) return;
  birthAsked.add(agent);
  void fetch('/api/agent-born',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent}),cache:'no-store'})
   .then(response=>response.ok?response.json() as Promise<{born?:boolean}>:null)
   .then(result=>{ if(result?.born===true) facesIn('birth',agent).forEach(face=>playMoment(face,'birth')); })
   .catch(()=>{});
 },[agent]);
 return null;
}

// Greeting: the first time a day a chat with the Agent is opened on this device, its faces in the chat's head and its
// empty chat (the places that carry data-greet) greet. The day is the device's own, kept in its browser by Agent; with
// browser storage blocked the page remembers it instead, so it greets at most once until the page loads again.
const greetedHere=new Map<string,string>();
const today=()=>{ const now=new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };
export function greetsNow(agent:string) {
 const day=today(), key=`gw-greeted:${agent}`;
 let kept:string|null|undefined;
 try { kept=window.localStorage.getItem(key); } catch { kept=undefined; }
 if(kept===undefined?greetedHere.has(agent):kept===day||greetedHere.get(agent)===day) return false;
 greetedHere.set(agent,day);
 try { window.localStorage.setItem(key,day); } catch { /* the page remembers it */ }
 return true;
}
export function Greeting({agent}:{agent:string|null|undefined}) {
 useEffect(()=>{ if(agent&&greetsNow(agent)) facesIn('greet',agent).forEach(face=>playMoment(face,'greet')); },[agent]);
 return null;
}
