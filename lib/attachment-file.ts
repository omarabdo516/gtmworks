import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { attachmentHeaders } from './attachments.mjs';

// The one place an attachment's bytes leave the private bucket. The caller passes a client that acts as the asking person
// or agent: the attachment row and the storage object are both read through it, so row level security decides who gets here.
export async function attachmentFile(db: SupabaseClient, company: string, id: number, card?: number): Promise<NextResponse | null> {
 if (!Number.isSafeInteger(id) || id < 1) return null;
 const found = db.from('work_attachments').select('name,content_type,path').eq('company_id', company).eq('id', id);
 const row = await (card === undefined ? found : found.eq('card_id', card)).maybeSingle();
 if (!row.data) return null;
 const file = await db.storage.from('creatives').download(row.data.path);
 if (file.error || !file.data) return null;
 return new NextResponse(await file.data.arrayBuffer(), { headers: attachmentHeaders(row.data) });
}
