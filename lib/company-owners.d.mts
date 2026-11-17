import type { SupabaseClient } from '@supabase/supabase-js';
export declare function ownerNames(db: SupabaseClient, company: string): Promise<string[]>;
