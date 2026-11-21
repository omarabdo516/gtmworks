import type { SupabaseClient } from '@supabase/supabase-js';
export type WaitingChange = { id: number, agent: string, conversation: string, askedBy: string, change: 'model' | 'instructions' | 'toolset' | 'setting', setting: string | null, value: unknown, by: string };
export const waitingChangeColumns: string;
export function readWaitingChanges(db: SupabaseClient, company: string): Promise<WaitingChange[]>;
export function countWaitingChanges(db: SupabaseClient, company: string): Promise<number>;
export function waitingChangeFor(changes: WaitingChange[], agent: string): WaitingChange | null;
export function waitingChangeHref(slug: string, change: Pick<WaitingChange, 'id' | 'conversation' | 'askedBy'>, reader: { person: string, owner: boolean }): string | null;
