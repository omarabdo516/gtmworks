import { cache } from 'react';
import { chatOpenLine, type RenderKind } from './diagnostics.mjs';

// One clock per request (React's cache is per render): the chat page starts it, and the Shell and the transcript mark
// their steps on it, so the chat_opened line (docs/production-logs.md) says where an open spent its time.
type Clock={start:number,steps:Record<string,number>};
const clock=cache(():Clock=>({start:performance.now(),steps:{}}));
export const startOpen=()=>clock();
export const markOpen=(step:string,timing=clock())=>{ timing.steps[step]??=performance.now()-timing.start; };
// Written once the response has gone (next/server after), when every step has its mark.
export function logOpen(timing:Clock,company:string,conversation:string,render:RenderKind='open',write=console.log) {
 try { markOpen('done',timing); write(chatOpenLine({company,conversation,steps:timing.steps,render})); } catch { /* A broken log must never break the page. */ }
}
