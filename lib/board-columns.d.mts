export declare const boardColumns: readonly ['waiting', 'ideas', 'planned', 'progress', 'live', 'done'];
export type BoardColumn = typeof boardColumns[number];
export declare function columnOf(card: {stage_id:number}, stages: {id:number, board_column?:string|null}[]): string;
export declare function keyboardTarget(column: string, key: string, rtl: boolean): string | null;
export declare function blockReason(from: string, to: string): '' | 'same' | 'decide' | 'waiting';
export declare function cardAgent(card: {id:number, next_actor:string|null}, assignees: {card_id:number, person_id:string}[], agentIds: Set<string>): string | null;
