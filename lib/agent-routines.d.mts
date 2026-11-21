import type { Routine } from './engine.mjs';
export type AgentRoutines = { agent: string, name: string, connection: string, main: boolean, state: 'found', routines: Routine[] }
 | { agent: string, name: string, connection: string, main: boolean, state: 'refused' | 'unreachable' | 'failed', routines: null };
export type CompanyRoutines = { state: 'found', agents: AgentRoutines[] } | { state: 'invalid' | 'failed' | 'noEngine', agents: null };
export type OneAgentRoutines = { state: 'found', routines: Routine[] } | { state: 'invalid' | 'failed' | 'missing' | 'noEngine' | 'refused' | 'unreachable', routines: null };
export type RoutineAction = 'create' | 'change' | 'pause' | 'resume' | 'run' | 'delete';
export type RoutineChangeState = { state: 'done', routine: Routine | null, logged: boolean }
 | { state: 'missing' | 'invalid' | 'notAllowed' | 'noEngine' | 'busy' | 'refused' | 'unreachable' | 'failed' };
export function readCompanyRoutines(db: unknown, request: { company: string, hermes?: { address: string, key: string } | null, driver?: object }): Promise<CompanyRoutines>;
export function changeAgentRoutine(db: unknown, request: { company: string, agent: unknown, action: unknown, routine?: unknown, name?: unknown, prompt?: unknown, schedule?: unknown, timezone?: unknown, hermes?: { address: string, key: string } | null, driver?: object, leaseWait?: number }): Promise<RoutineChangeState>;
export function readAgentRoutines(db: unknown, request: { company: string, agent: unknown, hermes?: { address: string, key: string } | null, driver?: object }): Promise<OneAgentRoutines>;
