export declare function latestActivity<T extends { id: number, created_at: string }>(rows: T[], since: string, n?: number): T[];
export declare function agentLogFilter(agent: string): string;
export type DetailsTab = 'activity' | 'tasks' | 'files' | 'memory' | 'log';
export declare function pickTab(value: unknown): DetailsTab;
export declare function fileSize(bytes: number): string;
export type AgentFile = { key: string, name: string, size: number, at: string, href: string, source: string };
export declare function agentFiles(files: { slug: string, conversationFiles: { id: number, name: string, size: number, created_at: string, conversation_id: string, agent_name: string }[], titles: Map<string, string>, channelFiles: { id: number, name: string, size: number, created_at: string, channel: string }[] }): AgentFile[];
export declare function worksWith(facts: { alone: boolean, me: string, members: { person_id: string, role: string }[], access: string[] }): 'you' | 'team';
