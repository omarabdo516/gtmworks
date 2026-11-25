'use client';
// A step an Agent handed over on its own Screen (#714, spec #710; design-reference: scrHandOver, screenHandDone,
// handCardOf). The sidebar's poll reads the open ones of the reader's own Conversations (screen_hands, app/sidebar-live),
// so the Agent's screen card, its view and the toast on arrival follow it within 5 seconds wherever the reader is.
export type ScreenHand={card:number,conversation:string,agent:string,agent_name:string,title:string,app:string};

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
const dones=new Set<(card:number)=>void>();
export const handDoneHere=(card:number)=>dones.forEach(listener=>listener(card));
export const onHandDone=(listener:(card:number)=>void)=>{ dones.add(listener); return ()=>{ dones.delete(listener); }; };
