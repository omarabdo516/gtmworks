import { supabaseConfig } from '@/lib/supabase-config';

export const dynamic = 'force-dynamic';
export function GET() {
  const url = process.env.GTMWORKS_SELF_HOSTED === 'true' ? process.env.SUPABASE_PUBLIC_URL : supabaseConfig.url;
  return Response.json({ ...supabaseConfig, url }, { headers: { 'Cache-Control': 'no-store' } });
}
