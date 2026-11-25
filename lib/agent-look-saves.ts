import type { AgentLook } from './agent-look';

// An Agent's look as the database keeps it (public.agent_looks, #696): the look it was given, the Owner's picks over it,
// and when it last changed.
export type KeptLook={automatic:AgentLook,picked:Partial<AgentLook>,changedAt:string|null};
export type LookPart=keyof AgentLook;
export type LookChange={part:LookPart,choice:string|null}|'reset';
const lookParts:LookPart[]=['shape','colour','temperament'];
export const shownLook=(kept:KeptLook):AgentLook=>({...kept.automatic,...kept.picked});
export const lookPicked=(kept:KeptLook)=>lookParts.some(part=>kept.picked[part]!=null);

// The Owner's changes of a look in this tab (#698), shared by every face of the page whichever provider draws it, so a
// press in the window shows at once in the sidebar, the chat and Settings behind it. Each Agent's saves go to the database
// one after another, in the order they were pressed, so the database ends with the last press. An answer puts back
// only the parts no newer press has changed since: a failed save takes its part back to the look last saved, and a
// failed reset all three. A read of the page newer than the last save (another Owner's change) wins once no save waits.
type Entry={saved:KeptLook,shown:KeptLook,latest:Record<LookPart,number>,queue:Promise<unknown>,pending:number};
const entries=new Map<string,Entry>();
const listeners=new Set<()=>void>();
let version=0, presses=0;
const emit=()=>{ version++; listeners.forEach(listener=>listener()); };
export const subscribeLooks=(listener:()=>void)=>{ listeners.add(listener); return ()=>{ listeners.delete(listener); }; };
export const looksVersion=()=>version;

const time=(at:string|null)=>at?Date.parse(at):0;
const newer=(read:KeptLook,local:KeptLook)=>time(read.changedAt)>time(local.changedAt);

// The look to draw for `agent`, given the one the page read.
export function keptLook(agent:string,read:KeptLook):KeptLook {
 const entry=entries.get(agent);
 return entry&&(entry.pending>0||!newer(read,entry.shown))?entry.shown:read;
}

// One press: shown at once, saved after the Agent's earlier saves. Answers false when the save failed and the press was
// put back, so the window says so; a failed save a newer press has already replaced answers true, as nothing changes.
export function changeLook(agent:string,read:KeptLook,change:LookChange,save:()=>Promise<KeptLook|null>):Promise<boolean> {
 let entry=entries.get(agent);
 if(!entry||(entry.pending===0&&newer(read,entry.shown))) { entry={saved:read,shown:read,latest:{shape:0,colour:0,temperament:0},queue:Promise.resolve(),pending:0}; entries.set(agent,entry); }
 const own=entry, press=++presses, parts=change==='reset'?lookParts:[change.part];
 parts.forEach(part=>{ own.latest[part]=press; });
 const picked={...own.shown.picked};
 for(const part of parts) { const choice=change==='reset'?null:change.choice; if(choice==null) delete picked[part]; else (picked as Record<string,string>)[part]=choice; }
 own.shown={...own.shown,picked}; own.pending++; emit();
 const answer=own.queue.then(save).catch(()=>null);
 own.queue=answer;
 return answer.then(saved=>{
  own.pending--;
  if(saved) own.saved=saved;
  const mine=parts.filter(part=>own.latest[part]===press);
  const shown={...own.shown.picked} as Record<string,string>;
  for(const part of mine) { const value=own.saved.picked[part]; if(value==null) delete shown[part]; else shown[part]=value; }
  own.shown={automatic:own.saved.automatic,picked:shown as Partial<AgentLook>,changedAt:own.saved.changedAt};
  emit();
  return saved!==null||mine.length===0;
 });
}
