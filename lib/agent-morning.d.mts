import type { RoutineSchedule } from './engine.mjs';
export const morningName: string;
export type MorningRoutine = { id: string, on: boolean, time: string | null, schedule: RoutineSchedule, timezone: string | null };
export type MorningRead = { state: 'found', routine: MorningRoutine | null, quietYesterday: boolean } | { state: 'invalid' | 'failed' | 'notMain' | 'notOwn' | 'noEngine' | 'refused' | 'unreachable' };
export function readAgentMorning(db: unknown, request: { company: string, agent: string, hermes?: { address: string, key: string } | null, driver?: object, now?: Date }): Promise<MorningRead>;
export function changeAgentMorning(db: unknown, request: { company: string, agent: unknown, on: unknown, time: unknown, zone?: unknown, hermes?: { address: string, key: string } | null, driver?: object }): Promise<{ state: 'written', morning: { on: boolean, time: string } } | { state: string, morning?: undefined }>;
export function moveAgentMorning(db: unknown, request: { company: string, agents?: unknown[] | null, hermes?: { address: string, key: string } | null, driver?: object, fence?: (() => Promise<boolean>) | null }): Promise<{ state: string }>;
export type MorningFence = (() => Promise<boolean>) & { holder?: string; profiles?: (adding: string[], settled?: string[]) => Promise<string[] | null> };
export function withMorningLease<T>(db: unknown, company: string, work: (fence: MorningFence) => Promise<T>): Promise<T | { state: 'busy' | 'notAllowed' | 'failed' }>;
