// The install job's profile proof (#126) prints names, states and counts only, never a key or any other value of the
// install's environment (#2). Every line it writes goes through here, and only the fields named below are kept: a value
// a caller passes beside them, such as a credential or an environment entry, is never printed.

const fields=['step','companies','profiles','spaces','memory','skills','keys','capacity','company','profile','space','agent',
 'second','main','seconds','count','state','run','kind','made','ready','provider',
 // The work sandbox proof (#393): where a tool's command ran and what it left, by name only.
 'marker','sandbox_host','user','cwd','pwd','file','code',
 // The work sandbox's state and the reply that needed no tool (#398).
 'sandbox','plain',
 // The Company's Screen (#711): its state as display.status reads it, and the page's window title; the bytes of its live
 // stream that came through gtmworks (#713).
 'screen','window','bytes',
 // The Engine's own Kanban board (spec #831, #833): what a Card and the Engine's dispatcher, review and decomposer did,
 // by id, status, profile and count only; and the phase a long step reached (stepClock).
 'board','phase'];

/** @param {Record<string, unknown>} figures */
export function proof(figures) {
 const kept={};
 for(const field of fields) if(figures?.[field]!==undefined) kept[field]=figures[field];
 return `${JSON.stringify(kept)}\n`;
}

// A bare name the proof computed itself: a Company's or an Agent's Engine profile, printed for the install job to read.
/** @param {string} value */
export const proofName=value=>`${value}\n`;

// The script's only printers: a line of named fields, and a bare name.
/** @param {Record<string, unknown>} figures */
export const writeProof=figures=>process.stdout.write(proof(figures));
/** @param {string} value */
export const writeName=value=>process.stdout.write(proofName(value));

// A long step's clock (spec #831, #833): it prints one line of named fields as each phase ends, with the whole seconds
// since the step began, and gives each wait the seconds it asks for, never more than the step has left, so the step
// ends inside its area's minutes and its log says how far it got. Once the budget is spent a wait fails naming the step,
// the budget and the last phase reached.
/** @param {string} step @param {number} budget seconds @param {{now?:()=>number,write?:(figures:Record<string, unknown>)=>unknown}} [options] */
export function stepClock(step,budget,{now=Date.now,write=writeProof}={}) {
 const started=now();
 let reached='its start';
 const left=()=>Math.max(0,Math.floor((started+budget*1000-now())/1000));
 return {
  left,
  /** @param {string} what @param {Record<string, unknown>} [figures] */
  phase(what,figures={}) { reached=what; write({...figures,step,phase:what,seconds:Math.floor((now()-started)/1000)}); },
  /** @param {number} wanted */
  within(wanted) {
   const seconds=left();
   if(seconds<=0) throw new Error(`${step}: its ${budget} s are spent after ${reached}`);
   return Math.min(wanted,seconds);
  },
 };
}
