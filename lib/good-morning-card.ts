import type { WaitingItem } from './approval-queue';

// The card of a morning's Conversation (#183; design-reference: checkinHTML): its person's "Waiting on you", the steps
// handed to them, the Routine results of the night before and the Good morning job's own time and state. It was read
// with the old Conversation record, which is switched off (#883), so no Conversation reads one now; the card's shape
// stays for app/morning-card.tsx until spec #926 takes Good morning out.
export type MorningItem=Pick<WaitingItem,'kind'|'id'|'title'|'body'|'asked_by'|'card_id'|'conversation_id'|'channel_id'|'channel_message_id'|'agent'>;
type MorningNight={id:number,agent:{id:string,connection_id:string,name:string},routine:string,line:string,at:string};
export type MorningCard={day:string,waiting:MorningItem[],handed:MorningItem[],overnight:MorningNight[],viewer:boolean,manage:boolean,
 main:string|null,foot:{on:boolean,time:string,custom:string|null,zone:string|null}|null};
