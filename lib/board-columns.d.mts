export declare const boardColumns: readonly ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];
export type BoardColumn = typeof boardColumns[number];
export declare const boardCardColumns: '*,wait:card_wait';
/** A Card's chat waiting on its person (#146), read with the Card as `wait:card_wait`. */
export type CardWait = {person:string, kind:'question'|'hand'|'permission', title:string};
export declare function columnOf(card: {status?:string|null, wait?:CardWait|null}): string;
export declare function chatWait(card: {wait?:CardWait|null}, reader: {me:string, writer:boolean, approval:boolean}): (CardWait & {mine:boolean, team:boolean}) | null;
export declare function cardSymbol(card: {status:string, wait?:CardWait|null, assignee_person?:string|null, approved_version?:number|null, approved_at?:string|null, latest_version?:number|null, open_waits?:number}, reader: {me:string, working?:boolean}): 'question'|'review'|'working'|'waits'|'onyou'|'approved'|'';
type WaitingRow = {kind:string, card_id:number|null, conversation_id:string|null};
export declare function onCard(item: WaitingRow): boolean;
export declare function waitingCount(items: WaitingRow[], assigned?: {id:number}[]): number;
/** The reader's list under the bell (#677). */
export declare function bellRows<I extends WaitingRow, C extends {id:number}>(items: I[], assigned: C[]): {act: I[], assigned: C[], requests: I[], mentions: I[]};
export declare function chatPlace(slug: string, item: {kind:string, id:number, conversation_id:string|null, channel_id?:string|null}): string | null;
export declare function columnLabel(column: string, writer: boolean): string;
export declare function progressOf(card: {description?: string | null}): {pct:number, next?:string} | null;
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
export declare function inEdgeBand(box: {left:number, right:number, top:number, bottom:number, width:number, height:number}, point: {x:number, y:number}, scrolls?: {x:boolean, y:boolean}, share?: number): boolean;
export declare function scrollAxes(room: {x:number, y:number}): {x:boolean, y:boolean};
export declare function visibleApprovals<C extends {id:number, assignee_agent?:string|null}, I extends {kind:string, id:number}>(cards: C[], items: I[], seen: Set<string>): {cards: C[], items: I[]};
