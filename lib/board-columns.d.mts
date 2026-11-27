/** The five columns of the Engine's board (spec #831), Waiting on you first. */
export declare const cardColumns: readonly ['waiting', 'ideas', 'planned', 'progress', 'done'];
export type CardColumn = typeof cardColumns[number];
export declare function columnOfStatus(status: string): CardColumn | null;
export declare function statusOfColumn(column: string, waits: boolean): 'triage' | 'ready' | 'todo' | 'done' | null;
export declare function moveTarget(column: string, key: string, rtl: boolean): CardColumn | null;
// 'sentBack' and 'passed' are a review's outcome, which only a Card's own read knows (lib/company-card.mjs, #839).
export type CardSymbol = {kind:'working'|'question'|'review'|'failed'|'stopped'|'sentBack'|'passed'} | {kind:'waits', count:number};
export declare function cardSymbol(card: {status:string, failures:number, parents:number}): CardSymbol | null;
/** Whom a Card of the Engine's board waits on (#841): a person by id, every Administrator and Manager, or no one. */
export type CardWaits = {person:string} | {leads:true};
export declare function waitsOn(card: {status:string, person:string|null, maker:string|null}, members: Set<string>): CardWaits | null;
export declare function waitsOnReader(waits: CardWaits | null, reader: {me:string, role:string|null|undefined}): boolean;
export declare function orderCards<C extends {column:string, createdAt:number|null}>(cards: C[]): C[];
export declare function chatPlace(slug: string, item: {kind:string, id:number, conversation_id:string|null, channel_id?:string|null}): string | null;
export declare function columnLabel(column: string, writer: boolean): string;
/** A column's order once a Card is placed above `before` (null: at the column's end). */
export declare function placeOrder<I extends string | number>(ids: I[], id: I, before: I | null): I[];
/** Whether a drop would change the column's order at all. */
export declare function placeChanges<I extends string | number>(ids: I[], id: I, before: I | null): boolean;
export declare function inEdgeBand(box: {left:number, right:number, top:number, bottom:number, width:number, height:number}, point: {x:number, y:number}, scrolls?: {x:boolean, y:boolean}, share?: number): boolean;
export declare function scrollAxes(room: {x:number, y:number}): {x:boolean, y:boolean};
