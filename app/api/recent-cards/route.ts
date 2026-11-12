import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'no-store' };

// The sidebar's Recent list. An open card is recorded for the signed-in person only when the page asks with its card id (a mounted card);
// server rendering and link prefetch never call this. The database policies on work_card_visits still decide what is allowed.
export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'JSON required' }, { status: 415, headers });
  const body = await request.json().catch(() => null) as { company?: unknown, cardId?: unknown } | null;
  const company = body?.company, cardId = body?.cardId;
  if (typeof company !== 'string' || !uuid.test(company) || (cardId !== undefined && !(Number.isSafeInteger(cardId) && (cardId as number) > 0))) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers });
  }
  const db = await supabase();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Session unavailable' }, { status: 401, headers });
  if (cardId !== undefined) {
    const { error } = await db.from('work_card_visits').upsert({ company_id: company, person_id: user.id, card_id: cardId as number }, { onConflict: 'company_id,person_id,card_id' });
    if (error) return NextResponse.json({ error: 'Could not record the visit' }, { status: 500, headers });
  }
  const { data, error } = await db.from('work_card_visits').select('work_cards!inner(id,title)').eq('company_id', company).eq('person_id', user.id)
    .order('opened_at', { ascending: false }).order('card_id', { ascending: false }).limit(3);
  if (error) return NextResponse.json({ error: 'Could not load recent cards' }, { status: 500, headers });
  return NextResponse.json({ cards: (data || []).map(row => row.work_cards) }, { headers });
}
