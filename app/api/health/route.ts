import { healthResponse } from '@/lib/health.mjs';
import { supabaseConfig } from '@/lib/supabase-config';

export const dynamic = 'force-dynamic';
export async function GET() {
  return healthResponse(supabaseConfig.url, supabaseConfig.anonKey);
}
