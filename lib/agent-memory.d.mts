export type MemoryMain = { state: 'found', main: boolean, notes: import('./engine.mjs').MemoryNote[] }
 | { state: 'missing' | 'invalid' | 'noEngine' | 'refused' | 'unreachable' | 'failed', main: boolean, notes: null };
export type MemoryResetState = { state: 'reset' | 'missing' | 'invalid' | 'notAllowed' | 'noEngine' | 'refused' | 'unreachable' | 'failed' };
export function readAgentMemory(db: unknown, request: { company: string, agent: unknown, hermes?: { address: string, key: string } | null, driver?: object }): Promise<MemoryMain>;
export function resetAgentMemory(db: unknown, request: { company: string, agent: unknown, hermes?: { address: string, key: string } | null, driver?: object }): Promise<MemoryResetState>;
export type MemoryEditState = { state: 'edited' | 'missing' | 'invalid' | 'notAllowed' | 'noEngine' | 'stale' | 'refused' | 'unreachable' | 'failed' };
export type MemoryForgetState = { state: 'forgotten' | 'missing' | 'invalid' | 'notAllowed' | 'noEngine' | 'stale' | 'refused' | 'unreachable' | 'failed' };
export function editAgentMemory(db: unknown, request: { company: string, agent: unknown, note: string, text: string, hermes?: { address: string, key: string } | null, driver?: object }): Promise<MemoryEditState>;
export function forgetAgentMemory(db: unknown, request: { company: string, agent: unknown, note: string, hermes?: { address: string, key: string } | null, driver?: object }): Promise<MemoryForgetState>;
