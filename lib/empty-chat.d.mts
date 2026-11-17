import type { SupabaseClient } from '@supabase/supabase-js';
export type EmptyChatFacts =
 | { state: 'fresh', owners: string[] }
 | { state: 'main', reader: 'alone' | 'owner' | 'member', owners: string[] }
 | { state: 'new', works: 'you' | 'team', owners: string[] }
 | { state: 'known', owners: string[] };
export declare function emptyChatFacts(db: SupabaseClient, facts: { company: string, agent: string, me: string, main: boolean, fresh: boolean, alone: boolean, owner: boolean, asks: boolean }): Promise<EmptyChatFacts>;
