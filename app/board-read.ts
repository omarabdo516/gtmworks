'use client';
import { useCallback, useSyncExternalStore } from 'react';
import type { CardColumn, CardSymbol } from '@/lib/board-columns.mjs';
import { followBoard } from '@/app/board-live';

// The board's read in the browser (spec #831, #834): the Company's Engine's own Kanban board, asked of gtmworks's own
// /api/board after the page has drawn (ADR 0030). One read for each Company is shared by everything on the page that
// shows it: the board, its list and calendar (#845), and what waits on the reader beside the sidebar's Inbox and in
// Waiting on you (#841), so one change the Engine reports is read once.
//
// The last good read stays: it is shown while the board reads again and kept when the Engine does not answer. It lives in
// this browser's memory only, never in storage, and never in a table.
//
// The read follows the Engine live (#840): a change the Engine reports, through gtmworks's own web server
// (app/board-live.ts), reads the board again at once. While the stream is down the board reads again on a slow timer.
// Whom a Card waits on (#841): a Member by name, or every Administrator and Manager (`person` null), and whether that is
// the reader (`mine`).
export type CardWaits={mine:boolean,person:{id:string,name:string}|null};
export type BoardCard={id:string,title:string,column:CardColumn,symbol:CardSymbol|null,agent:{id:string,name:string}|null,person?:{id:string,name:string}|null,waits?:CardWaits|null,comments:number,createdAt?:number|null,project?:string|null,publishOn?:string|null};
type Agent={id:string,name:string};
export type Board={cards:BoardCard[],main:Agent|null};
export type BoardRead={board:Board|null,state:'reading'|'read'|'failed'};

// A read that failed is asked again after a pause, longer each time; a good one is read again when the board's live
// stream reports a change, when the window comes back to the board, and on a slow timer while the stream is down. A
// change reported while a read is on its way reads again once that read has answered.
const againAfter=[3000,10000,30000];
const slowRead=30000;

type Reader={read:BoardRead,listeners:Set<()=>void>,set:(read:BoardRead)=>void,stop?:()=>void};
const kept=new Map<string,Board>();
const readers=new Map<string,Reader>();
const reading=(company:string):BoardRead=>({board:kept.get(company)??null,state:'reading'});

function readerOf(company:string):Reader {
 let reader=readers.get(company);
 if(!reader) {
  const made:Reader={read:reading(company),listeners:new Set(),set:read=>{ if(read.board) kept.set(company,read.board); made.read=read; made.listeners.forEach(listener=>listener()); }};
  readers.set(company,made); reader=made;
 }
 return reader;
}

function start(company:string,reader:Reader) {
 let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined; let tries=0; let asking=false; let stale=false; let live=false;
 const controller=new AbortController();
 const next=(after:number)=>{ clearTimeout(timer); timer=setTimeout(ask,after); };
 function ask() {
  if(stopped) return;
  if(asking) { stale=true; return; }
  asking=true; stale=false;
  void fetch(`/api/board?company=${encodeURIComponent(company)}`,{cache:'no-store',signal:controller.signal})
   // The answer is read whole either way, so a refused read leaves no response open behind it.
   .then(async response=>{ const body=await response.json().catch(()=>null) as {cards?:unknown,main?:Agent|null}|null; return response.ok?body:null; },()=>null)
   .then(body=>{
    asking=false;
    if(stopped) return;
    if(body&&Array.isArray(body.cards)) {
     tries=0; reader.set({board:{cards:body.cards as BoardCard[],main:body.main??null},state:'read'});
     if(stale) ask(); else if(live) clearTimeout(timer); else next(slowRead);
     return;
    }
    reader.set({board:kept.get(company)??null,state:'failed'});
    next(againAfter[Math.min(tries++,againAfter.length-1)]);
   });
 }
 const back=()=>{ if(document.visibilityState==='visible') ask(); };
 ask();
 const unfollow=followBoard(company,{changed:()=>ask(),live:on=>{ live=on; if(!on&&!asking&&!tries) next(slowRead); }});
 window.addEventListener('focus',ask); document.addEventListener('visibilitychange',back);
 return ()=>{ stopped=true; clearTimeout(timer); controller.abort(); unfollow(); window.removeEventListener('focus',ask); document.removeEventListener('visibilitychange',back); };
}

// The first part that shows a Company's board starts its read, and the last one to go stops it; one that comes later
// starts from the read as it stands. A read starts afresh each time, from the last good read kept.
// No Company (a part drawn outside one) reads nothing.
function subscribe(company:string,listener:()=>void) {
 if(!company) return ()=>{};
 const reader=readerOf(company);
 reader.listeners.add(listener);
 if(!reader.stop) { reader.read=reading(company); reader.stop=start(company,reader); }
 return ()=>{
  reader.listeners.delete(listener);
  if(reader.listeners.size) return;
  reader.stop?.(); reader.stop=undefined; readers.delete(company);
 };
}

const serverRead:BoardRead={board:null,state:'reading'};

// `accept` takes the board a write answered with (#836): it is a read like any other, for every part that shows it.
export function useBoard(company:string):BoardRead&{accept:(board:Board)=>void} {
 const read=useSyncExternalStore(useCallback((listener:()=>void)=>subscribe(company,listener),[company]),()=>readerOf(company).read,()=>serverRead);
 const accept=useCallback((board:Board)=>readerOf(company).set({board,state:'read'}),[company]);
 return {...read,accept};
}

/**
 * The Cards of the Company's board that wait on the reader (#841): a question or a review they may decide, or a Card
 * given to them, in the board's order; worked out on the server for each read and never written anywhere. Undefined
 * while the first read is on its way; while the Engine does not answer, those of the last good read, and none when there
 * has been none. `company` empty reads nothing.
 */
export function useWaitingCards(company:string):BoardCard[]|undefined {
 const read=useBoard(company);
 if(!company) return noCards;
 if(read.board) return read.board.cards.filter(card=>card.waits?.mine);
 return read.state==='failed'?noCards:undefined;
}
const noCards:BoardCard[]=[];
