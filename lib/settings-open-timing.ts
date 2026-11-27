import { cache } from 'react';
import { settingsOpenLine } from './diagnostics.mjs';
import type { RenderKind } from './diagnostics.mjs';

// One clock per request (React's cache is per render), as the chat's (lib/chat-open-timing.ts): the Settings layer starts
// it, the overlay marks its steps and names its section, so the settings_opened line (docs/production-logs.md) says
// where an open spent its time (#898).
type Clock={start:number,steps:Record<string,number>,section:string};
const clock=cache(():Clock=>({start:performance.now(),steps:{},section:''}));
export const startSettingsOpen=()=>clock();
export const markSettingsOpen=(step:string,section?:string)=>{ const timing=clock(); timing.steps[step]??=performance.now()-timing.start; if(section) timing.section=section; };
// Written once the response has gone (next/server after), when every step has its mark.
export function logSettingsOpen(timing:Clock,company:string,render:RenderKind='open',write=console.log) {
 try { timing.steps.done??=performance.now()-timing.start; write(settingsOpenLine({company,section:timing.section,steps:timing.steps,render})); } catch { /* A broken log must never break the page. */ }
}
