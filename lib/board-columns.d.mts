export declare const boardColumns: readonly ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];
export type BoardColumn = typeof boardColumns[number];
export declare const boardCardColumns: '*,wait:card_wait';
/** The five columns of the Engine's board (spec #831), Waiting on you first. */
export declare const cardColumns: readonly ['waiting', 'ideas', 'planned', 'progress', 'done'];
export type CardColumn = typeof cardColumns[number];
export declare function columnOfStatus(status: string): CardColumn | null;
// 'sentBack' and 'passed' are a review's outcome, which only a Card's own read knows (lib/company-card.mjs, #839).
export type CardSymbol = {kind:'working'|'question'|'review'|'failed'|'stopped'|'sentBack'|'passed'} | {kind:'waits', count:number};
export declare function cardSymbol(card: {status:string, failures:number, parents:number}): CardSymbol | null;
/** Whom a Card of the Engine's board waits on (#841): a person by id, every Administrator and Manager, or no one. */
export type CardWaits = {person:string} | {leads:true};
export declare function waitsOn(card: {status:string, person:string|null, maker:string|null}, members: Set<string>): CardWaits | null;
export declare function waitsOnReader(waits: CardWaits | null, reader: {me:string, role:string|null|undefined}): boolean;
export declare function orderCards<C extends {column:string, createdAt:number|null}>(cards: C[]): C[];
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
/** The order a column's Cards are drawn in: "Waiting on you" newest first (ADR 0013), every other column by each Card's saved place (#174). */
export declare function orderColumn<C extends {id:number, board_order?:number|null, created_at?:string|null}>(cards: C[], column: string): number[];
/** The Card a Card moved one place up or down its column lands above; null at the column's end, undefined when it stays. */
export declare function placeByOne(ids: number[], id: number, key: string): number | null | undefined;
/** A column's order once a Card is placed above `before` (null: at the column's end). */
export declare function placeOrder(ids: number[], id: number, before: number | null): number[];
/** Whether a drop would change the column's order at all. */
export declare function placeChanges(ids: number[], id: number, before: number | null): boolean;
export declare function blockReason(from: string, to: string, byChat?: boolean): '' | 'same' | 'decide' | 'chat' | 'waiting';
export declare function cardAgent(card: {id:number, next_actor:string|null}, assignees: {card_id:number, person_id:string}[], agentIds: Set<string>): string | null;
export declare function inEdgeBand(box: {left:number, right:number, top:number, bottom:number, width:number, height:number}, point: {x:number, y:number}, scrolls?: {x:boolean, y:boolean}, share?: number): boolean;
export declare function scrollAxes(room: {x:number, y:number}): {x:boolean, y:boolean};
export declare function visibleApprovals<C extends {id:number, agent_id?:string|null}, I extends {kind:string, id:number}>(cards: C[], items: I[], seen: Set<string>): {cards: C[], items: I[]};
