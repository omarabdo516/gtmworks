'use client';
import { createContext } from 'react';

// What an Agent's details panel tells its Routines section about the chat beside it (#205; design-reference: the
// routine-example case): `suggest` puts a sentence in this Agent's chat message field, closing the panel where it covers
// the chat, and sends nothing; it is missing for a reader who may not write there.
export const DetailsChat=createContext<{suggest?:(sentence:string)=>void}>({});

// "See it in details" under a reply in which the Agent made a Routine (design-reference: showRoutines): the details open
// on Activity, and the Routines section, once its list is read, scrolls into view and puts the focus on the newest row's
// switch. The ask waits until the section takes it, so a section still reading its list takes it when the list lands.
let asked=false;
const listeners=new Set<()=>void>();
export const showRoutines=()=>{ asked=true; listeners.forEach(listener=>listener()); };
export const onShowRoutines=(listener:()=>void)=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; };
export const takeShowRoutines=()=>{ const was=asked; asked=false; return was; };
