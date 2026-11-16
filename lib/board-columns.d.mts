export declare const boardColumns: readonly ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];
export type BoardColumn = typeof boardColumns[number];
export declare function columnOf(card: {stage_id:number}, stages: {id:number, board_column?:string|null}[]): string;
export declare function columnLabel(column: string, writer: boolean): string;
export declare function progressOf(card: {id:number}, checklist: {card_id:number, title:string, done:boolean}[]): {pct:number, next?:string} | null;
export declare function keyboardTarget(column: string, key: string, rtl: boolean): string | null;
export declare function blockReason(from: string, to: string): '' | 'same' | 'decide' | 'waiting';
export declare function cardAgent(card: {id:number, next_actor:string|null}, assignees: {card_id:number, person_id:string}[], agentIds: Set<string>): string | null;
export declare function inEdgeBand(box: {left:number, right:number, top:number, bottom:number, width:number, height:number}, point: {x:number, y:number}, scrolls?: {x:boolean, y:boolean}, share?: number): boolean;
