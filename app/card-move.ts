'use client';
import { toast } from '@/app/toast';
import { statusOfColumn } from '@/lib/board-columns.mjs';

// One change to a Card after it is made (spec #831, #837), through gtmworks's own route (app/api/board/card/edit): the
// answer, not the request, says whether it was taken, and carries the board as it now reads, so the Card is drawn where
// the Engine put it. A refusal says why in the board's words; nothing is changed in the browser before the answer.
export type CardChange={title:string,was:string}|{description:string,was:string}|{tick:{index:number,text:string,done:boolean}}|{column:string}|{waitFor:string}|{stopWaitingFor:string}|{publishOn:string};
export type ChangeAnswer={changed?:string,cards?:unknown[],main?:{id:string,name:string}|null,error?:string};

/** Sends one change; answers the route's body with `ok`, or `ok:false` with its error (or none when nothing answered). */
export async function changeCard(company:string,card:string,change:CardChange):Promise<ChangeAnswer&{ok:boolean}> {
 let response:Response|null=null;
 try { response=await fetch('/api/board/card/edit',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,card,change})}); } catch { response=null; }
 const body=await response?.json().catch(()=>null) as ChangeAnswer|null;
 return {...body??{},ok:!!response?.ok};
}

// The line a refused move says (lib/messages: cardMove*), by the route's error.
const refusals:Record<string,string>={cardMoveProgress:'cardMoveProgress',cardMoveWaiting:'cardMoveWaiting',cardMoveWaits:'cardMoveWaits',cardMoveRefused:'cardMoveRefused',cardNotFound:'cardMoveGone'};

/**
 * Moves a Card into a column (design-reference-card: boardMove, cwSetCol): told with "Undo" for six seconds when the
 * column it left is one a person moves a Card into (Ideas, Planned, Done), so Undo asks for that column again. A move
 * the Engine does not take leaves the Card where it was, and says why in one line. Answers whether it moved.
 */
export async function moveCard({company,card,from,to,t,columnName,onBoard}:{company:string,card:string,from:string,to:string,t:(key:string,...values:unknown[])=>string,
 columnName:(column:string)=>string,onBoard:(answer:ChangeAnswer)=>void}):Promise<boolean> {
 if(from===to) return false;
 const answer=await changeCard(company,card,{column:to});
 if(!answer.ok) { toast(t(refusals[answer.error??'']??'cardMoveFailed'),{icon:'x'}); return false; }
 onBoard(answer);
 const undo=statusOfColumn(from,false)?{label:t('boardUndo'),run:()=>{ void changeCard(company,card,{column:from}).then(back=>{
  if(!back.ok) { toast(t('boardUndoRefused'),{icon:'x'}); return; }
  onBoard(back); toast(t('boardBackIn',columnName(from)));
 }); }}:undefined;
 toast(t('boardMoved',columnName(to)),{action:undo});
 return true;
}
