import type { Page } from '@playwright/test';

// The dialog's exit as the browser runs it (#130): gw-modal-out at once, for the leave's length (useLeave in lib/motion.ts
// and every .is-closing rule in app/*.css). Change the leave there and here, and every spec that reads an exit follows (#725).
export const dialogExit=['gw-modal-out running delay 0ms for 190ms'];

export type DialogExitRecord=(string|boolean|string[])[];

// Records a dialog's leave into window.seen, at the address it happens on (pathname and search):
// - ['closing', exits, at, ...alongside] when `part` takes is-closing, with the animations that class gives it and, for each
//   `alongside` selector, whether it is in the page then. It is read from the class and not from animationstart: the leave is
//   a timer, and a frame later than it (a busy CI runner) removes the dialog before that event is ever sent (#526, #595).
// - ['gone', at] once nothing matches `shown` after something did (the recorder may go in before the dialog opens).
// A spec that records more (an entrance, the composer taking focus) pushes its own records into the same window.seen.
export async function recordDialogExit(page:Page,{part,shown,alongside=[]}:{part:string,shown:string,alongside?:string[]}) {
 await page.evaluate(({part,shown,alongside})=>{
  const seen:(string|boolean|string[])[][]=[]; Object.assign(window,{seen});
  const at=()=>location.pathname+location.search;
  let opened=!!document.querySelector(shown);
  new MutationObserver(()=>{
   const dialog=document.querySelector(part);
   if(dialog?.matches('.is-closing')&&!seen.some(([what])=>what==='closing')) seen.push(['closing',dialog.getAnimations().map(run=>{ const {delay,duration}=run.effect!.getTiming(); return `${(run as CSSAnimation).animationName} ${run.playState} delay ${delay}ms for ${duration}ms`; }),at(),...alongside.map(other=>!!document.querySelector(other))]);
   if(document.querySelector(shown)) opened=true;
   else if(opened&&!seen.some(([what])=>what==='gone')) seen.push(['gone',at()]);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
 },{part,shown,alongside});
}

// What recordDialogExit, and anything the spec added, has seen so far.
export const recordedDialogExit=(page:Page)=>page.evaluate(()=>(window as unknown as {seen:DialogExitRecord[]}).seen);
