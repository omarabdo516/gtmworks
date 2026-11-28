import type { PermissionChoice, SessionUsage } from './engine.mjs';
import { faceOf, type ConversationMessage } from './conversations';

// What a Conversation's screen draws (spec #864): its frame, from its own row, and its messages, read from the Agent's
// Engine session on their own request (app/c/[slug]/conversations/[id]/conversation.tsx) and laid into `messages` by the
// browser with the Run it follows live. The optional states are the ones a message, a Run or a card of the screen sets.
export type ConversationRecord={
 conversation:{id:string,agent_id:string|null,agent_name:string,face:string},
 morningDay?:string,
 messages:ConversationMessage[],
 usage:SessionUsage|null,
 pending:boolean,
 lead?:true,
 asking?:true,
 handover?:true,
 permit?:PermissionChoice[],
 connect?:{owner:boolean,owners:string[]},
 changeOwner?:true,
 alone?:true,
 failed:boolean,
 noModel?:{owner:boolean},
 modelRefused?:{reason:'credit'|'key'|'model'|'access',owner:boolean,agent?:string,resetsAt?:string,ranOut?:string[]},
 working:string|null,
 workingFor?:string,
 canStop:boolean,
};

// The frame of a Conversation, from its row alone (ADR 0030): nothing of the Conversation is stored in gtmworks, so a
// page draws this at once and its messages arrive from the Engine. The main Agent's Conversation offers its chips.
export function conversationFrame(found:{id:string,agent_id:string|null,kept_agent_id?:string|null,agent_name:string,good_morning_day?:string|null,hermes_agents?:unknown}):ConversationRecord {
 const lead=(found.hermes_agents as {is_default?:boolean}|null|undefined)?.is_default===true;
 return {
  conversation:{id:found.id,agent_id:found.agent_id,agent_name:found.agent_name,face:faceOf(found)},
  ...(found.good_morning_day?{morningDay:found.good_morning_day}:{}),
  messages:[],usage:null,pending:false,
  ...(lead?{lead:true as const}:{}),
  failed:false,working:null,canStop:false,
 };
}
