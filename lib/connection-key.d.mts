import type { SupabaseClient } from '@supabase/supabase-js';
export function savedConnectionKey(service:SupabaseClient,connection:{id:string,company:string},encryptionKey:string|undefined):Promise<string|null>;
