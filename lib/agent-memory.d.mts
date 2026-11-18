export type MemoryMain = { state: 'found', main: boolean, notes: import('./engine.mjs').MemoryNote[] }
 | { state: 'missing' | 'invalid' | 'noEngine' | 'refused' | 'unreachable' | 'failed', main: boolean, notes: null };
export type MemoryResetState = { state: 'reset' | 'missing' | 'invalid' | 'notAllowed' | 'noEngine' | 'refused' | 'unreachable' | 'failed' };
export function readAgentMemory(db: unknown, request: { company: string, agent: unknown, hermes?: { address: string, key: string } | null, driver?: object }): Promise<MemoryMain>;
export function resetAgentMemory(db: unknown, request: { company: string, agent: unknown, hermes?: { address: string, key: string } | null, driver?: object }): Promise<MemoryResetState>;
