import type { supabase } from './supabase';

type Database=Awaited<ReturnType<typeof supabase>>;
// The state an Agent's face carries for the reader (#699, spec #694), one of them, in this order: something of it waits
// on the reader, it works on anything, its last Run the reader can see failed, it has done nothing for 7 days, or none.
export type AgentFaceState='waiting'|'working'|'stuck'|'asleep'|'idle';
// The words beside a face for each state it may carry (design-reference-orb: ST): what a screen reader hears after the
// Agent's name, and the line under it. Done is the open chat's own (#700).
export const faceStateWords={waiting:'agentStatusWaiting',working:'agentStatusWorking',stuck:'agentStatusStuck',asleep:'agentStatusAsleep',
 idle:'agentStatusIdle',done:'agentStatusDone'} as const satisfies Record<AgentFaceState|'done',string>;
// Where a stuck Agent failed, so opening there clears it (seeAgentFailure): exactly one place.
export type FailurePlace={conversation:string}|{channel:string}|{card:number};
// One Agent's face for the reader: its state, whether it also works under a waiting state, its failure (when and where)
// while it is stuck, and the times asleep is read from: its newest work of any kind, when it was made, and when the
// reader last opened its chat.
export type AgentFace={state:AgentFaceState,working:boolean,waiting:boolean,failedAt:string|null,failedIn:FailurePlace|null,
 lastWorkAt:string|null,createdAt:string|null,wokenAt:string|null};
type Row={agent:string,state:AgentFaceState,working:boolean,waiting:boolean,failed_at:string|null,failed_conversation:string|null,
 failed_channel:string|null,failed_card:number|null,last_work_at:string|null,created_at:string|null,woken_at:string|null};

const idle:AgentFace={state:'idle',working:false,waiting:false,failedAt:null,failedIn:null,lastWorkAt:null,createdAt:null,wokenAt:null};
const placeOf=(row:Row):FailurePlace|null=>row.failed_conversation?{conversation:row.failed_conversation}
 :row.failed_channel?{channel:row.failed_channel}:row.failed_card!==null?{card:row.failed_card}:null;

// Every Agent the reader sees, from one agent_face_states call as the signed-in reader: the sidebar's poll and every page
// that draws a face ask it. An Agent the read did not answer for (one hidden from the reader, or a read that failed,
// `available` false) is idle, never a guess. `states` is each answered Agent's state alone, by id: all the browser is
// given (app/sidebar-live).
export async function agentFaceStates(db:Database,company:string):Promise<{available:boolean,of:(agent:string)=>AgentFace,states:Record<string,AgentFaceState>}> {
 const {data,error}=await db.rpc('agent_face_states',{c:company});
 const faces=new Map(((error?null:data) as Row[]|null||[]).map(row=>[row.agent,{state:row.state,working:row.working,waiting:row.waiting,
  failedAt:row.failed_at,failedIn:placeOf(row),lastWorkAt:row.last_work_at,createdAt:row.created_at,wokenAt:row.woken_at} satisfies AgentFace]));
 return {available:!error,of:agent=>faces.get(agent)??idle,states:Object.fromEntries([...faces].map(([agent,face])=>[agent,face.state]))};
}

// The reader opened a Conversation, a channel or a Card: a failure of an Agent there is seen by them, and its face stops
// looking stuck for them until it fails again. Answers how many Agents it cleared, or null when the call failed.
export async function seeAgentFailure(db:Database,company:string,place:FailurePlace):Promise<number|null> {
 const {data,error}=await db.rpc('see_agent_failure',{c:company,...place});
 return error?null:data as number;
}

// The reader opened an Agent's chat: it is awake for them, on every device, for 7 days. False for an Agent they do not
// see, or when the call failed.
export async function wakeAgent(db:Database,company:string,agent:string):Promise<boolean> {
 const {data,error}=await db.rpc('wake_agent',{c:company,agent});
 return !error&&data===true;
}
