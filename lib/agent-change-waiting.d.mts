import type { SupabaseClient } from '@supabase/supabase-js';
export type WaitingChange = { id: number, agent: string, conversation: string, askedBy: string, change: 'model' | 'instructions' | 'toolset' | 'setting', setting: string | null, value: unknown, by: string };
export function readWaitingChange(db: SupabaseClient, company: string, agent: string): Promise<WaitingChange | null>;
export function readWaitingAgents(db: SupabaseClient, company: string): Promise<Set<string>>;
export function countWaitingChanges(db: SupabaseClient, company: string): Promise<number>;
export function waitingChangeHref(slug: string, change: Pick<WaitingChange, 'id' | 'conversation' | 'askedBy'>, reader: { person: string, owner: boolean }): string | null;
