import type { supabase } from './supabase';
import { approvalQueue, type WaitingItem } from './approval-queue';
import { readAgentMorning } from './agent-morning.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;

// The card of a morning's Conversation (#183; design-reference: checkinHTML), read from gtmworks's own records whenever
// the Conversation is read, as its own reader: their "Waiting on you" now (an item settled since is gone), the steps
// handed to them, and the Routine results of the night before that morning from the Agents they see (RLS). The foot is
// the Good morning job's own time and state, read from the Engine; an Engine that cannot be read draws no foot line.
export type MorningItem=Pick<WaitingItem,'kind'|'id'|'title'|'body'|'asked_by'|'card_id'|'conversation_id'|'channel_id'|'channel_message_id'|'note_id'|'agent'>;
type MorningNight={id:number,agent:{id:string,connection_id:string,name:string},routine:string,line:string,at:string};
export type MorningCard={day:string,waiting:MorningItem[],handed:MorningItem[],overnight:MorningNight[],viewer:boolean,manage:boolean,
 main:string|null,foot:{on:boolean,time:string,custom:string|null,zone:string|null}|null};

// A step an Agent handed to the reader (#139, #149) is its own part of the card, "Handed to you".
const handed=(item:WaitingItem)=>item.kind==='hand'||item.kind==='channel_hand';
const keep=({kind,id,title,body,asked_by,card_id,conversation_id,channel_id,channel_message_id,note_id,agent}:WaitingItem):MorningItem=>
 ({kind,id,title,body,asked_by,card_id,conversation_id,channel_id:channel_id??null,channel_message_id:channel_message_id??null,note_id:note_id??null,agent:agent??null});

/** @param {Database} db @param {string} company @param {string} person @param {number} morning @param {string} day */
export async function morningCard(db:Database,company:string,person:string,morning:number,day:string):Promise<MorningCard> {
 const [queue,{data:results},{data:membership},{data:main}]=await Promise.all([
  approvalQueue(db,company,person),
  db.from('good_morning_results').select('id,routine,line,ran_at,hermes_agents(id,connection_id,name)').eq('morning_id',morning).order('ran_at',{ascending:false}).order('id'),
  db.from('members').select('role').eq('company_id',company).eq('person_id',person).is('removed_at',null).maybeSingle(),
  db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle(),
 ]);
 // The foot is #182's job as the Engine holds it now, on the main Agent's own profile.
 const mainId=(main as {id?:string}|null)?.id??null;
 const job=mainId?await readAgentMorning(db,{company,agent:mainId}).catch(()=>null):null;
 const routine=job?.state==='found'?job.routine:null;
 type Row={id:number,routine:string,line:string,ran_at:string,hermes_agents:{id:string,connection_id:string,name:string}|null};
 const role=(membership as {role?:string}|null)?.role;
 return {day,
  waiting:queue.items.filter(item=>!handed(item)).map(keep),
  handed:queue.items.filter(handed).map(keep),
  overnight:((results||[]) as unknown as Row[]).flatMap(row=>row.hermes_agents?[{id:row.id,agent:row.hermes_agents,routine:row.routine,line:row.line,at:row.ran_at}]:[]),
  viewer:role==='viewer',manage:role==='owner'||role==='manager',main:mainId,
  foot:job?.state==='found'?{on:!!routine?.on,time:routine?.time??'9:00',custom:routine&&!routine.time?routine.schedule.display||routine.schedule.expr||'':null,zone:routine?.timezone??null}:null};
}
