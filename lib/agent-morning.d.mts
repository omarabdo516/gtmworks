import type { RoutineSchedule } from './engine.mjs';
export const morningName: string;
export const morningPrompt: string;
export type MorningRoutine = { id: string, on: boolean, time: string | null, schedule: RoutineSchedule, timezone: string | null };
export type MorningRead = { state: 'found', level: number, allowed: boolean, routine: MorningRoutine | null, quietYesterday: boolean } | { state: 'invalid' | 'failed' | 'notMain' | 'notOwn' | 'noEngine' | 'refused' | 'unreachable' };
export function findMorning(routines: import('./engine.mjs').Routine[]): import('./engine.mjs').Routine | null;
export function readAgentMorning(db: unknown, request: { company: string, agent: string, hermes?: { address: string, key: string } | null, driver?: object, now?: Date }): Promise<MorningRead>;
export function changeAgentMorning(db: unknown, request: { company: string, agent: unknown, on: unknown, time: unknown, zone?: unknown, hermes?: { address: string, key: string } | null, driver?: object }): Promise<{ state: 'written', morning: { on: boolean, time: string } } | { state: string, morning?: undefined }>;
export function moveAgentMorning(db: unknown, request: { company: string, from: string, to: string, hermes?: { address: string, key: string } | null, driver?: object }): Promise<{ state: string }>;
