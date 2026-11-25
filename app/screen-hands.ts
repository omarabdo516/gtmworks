'use client';
// A step an Agent handed over on its own Screen (#714, spec #710; design-reference: scrHandOver, screenHandDone,
// handCardOf). The sidebar's poll reads the open ones of the reader's own Conversations (screen_hands, app/sidebar-live),
// so the Agent's screen card, its view and the toast on arrival follow it within 5 seconds wherever the reader is.
export type { ScreenHandRow as ScreenHand } from '@/lib/agent-screen.mjs';
// The button the Agent stopped at, such as "Publish", which the Screen's line, banner and toast name; a step handed with
// none names its title there.
export const stepOf=(hand:{title:string,step?:string})=>hand.step||hand.title;

// "Open the screen" on the chat card: the details beside the chat open on Activity, and the Agent's screen card opens its
// view with the keyboard on "Done it". The ask waits until the card takes it, so a card not drawn yet takes it once drawn
// (as app/details-routines.ts's showRoutines does).
let asked:number|null=null;
const opens=new Set<(card:number)=>void>();
export const showScreen=(card:number)=>{ asked=card; opens.forEach(listener=>listener(card)); };
export const onShowScreen=(listener:(card:number)=>void)=>{ opens.add(listener); return ()=>{ opens.delete(listener); }; };
export const takeShowScreen=()=>{ const was=asked; asked=null; return was; };

// "Done it" pressed on this page, in the view or on the chat card: the one record is kept, so the chat reads its record
// again and the Screen drops the step at once rather than at the next poll.
// `from` says where it was pressed: the chat that pressed it reads its record again on its own.
type From='view'|'chat';
const dones=new Set<(card:number,from:From)=>void>();
export const handDoneHere=(card:number,from:From)=>dones.forEach(listener=>listener(card,from));
export const onHandDone=(listener:(card:number,from:From)=>void)=>{ dones.add(listener); return ()=>{ dones.delete(listener); }; };
