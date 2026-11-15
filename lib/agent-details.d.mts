export type AgentStatus = 'working' | 'waiting' | 'idle';
export declare function agentStatus(facts: { waitingMine: boolean, running: boolean }): AgentStatus;
export declare function agentTasks(cards: { id: number, title: string, stage_id: number }[], stages: { id: number, name: string, board_column?: string | null }[], checklist: { card_id: number, title: string, done: boolean }[], waitingItems: { kind: string, title: string, body: string, card_id: number | null }[]): { id: number, title: string, column: string, line: { key: string, args: string[] } | { text: string }, waiting: boolean }[];
export declare function latestActivity<T extends { id: number, created_at: string }>(rows: T[], since: string, n?: number): T[];
export declare function agentLogFilter(agent: string): string;
