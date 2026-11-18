export declare const boardColumns: readonly ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];
export type BoardColumn = typeof boardColumns[number];
export declare const boardCardColumns: '*,wait:card_wait';
/** A Card's chat waiting on its person (#146), read with the Card as `wait:card_wait`. */
export type CardWait = {person:string, kind:'question'|'hand'|'permission', title:string};
export declare function columnOf(card: {stage_id:number, wait?:CardWait|null}, stages: {id:number, board_column?:string|null}[]): string;
export declare function chatWait(card: {wait?:CardWait|null}, reader: {me:string, writer:boolean, approval:boolean}): (CardWait & {mine:boolean, team:boolean}) | null;
type WaitingRow = {kind:string, card_id:number|null, conversation_id:string|null};
export declare function onCard(item: WaitingRow): boolean;
export declare function waitingCount(items: WaitingRow[]): number;
export declare function chatPlace(slug: string, item: {kind:string, id:number, conversation_id:string|null, channel_id?:string|null}): string | null;
export declare function columnLabel(column: string, writer: boolean): string;
export declare function progressOf(card: {id:number}, checklist: {card_id:number, title:string, done:boolean}[]): {pct:number, next?:string} | null;
export declare function keyboardTarget(column: string, key: string, rtl: boolean): string | null;
export declare function blockReason(from: string, to: string, byChat?: boolean): '' | 'same' | 'decide' | 'chat' | 'waiting';
export declare function cardAgent(card: {id:number, next_actor:string|null}, assignees: {card_id:number, person_id:string}[], agentIds: Set<string>): string | null;
export declare function inEdgeBand(box: {left:number, right:number, top:number, bottom:number, width:number, height:number}, point: {x:number, y:number}, scrolls?: {x:boolean, y:boolean}, share?: number): boolean;
export declare function scrollAxes(room: {x:number, y:number}): {x:boolean, y:boolean};
export declare function visibleApprovals<C extends {id:number, agent_id?:string|null}, I extends {kind:string, id:number}>(cards: C[], items: I[], seen: Set<string>): {cards: C[], items: I[]};
