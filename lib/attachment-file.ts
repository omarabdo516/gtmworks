import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { attachmentHeaders } from './attachments.mjs';

// Where a file is named: on a Card's messages, narrowed to one Card when `card` is given (a run key reaches its own Card's
// files only), or in a Conversation (#21), which only its own person reads.
export type AttachmentSource={from:'card',card?:number}|{from:'conversation'};
const tables={card:'work_attachments',conversation:'conversation_attachments'} as const;

// The one place an attachment's bytes leave the private bucket. The caller passes a client that acts as the asking person
// or agent: the attachment row and the storage object are both read through it, so row level security decides who gets here.
export async function attachmentFile(db: SupabaseClient, company: string, id: number, source: AttachmentSource = { from: 'card' }): Promise<NextResponse | null> {
 if (!Number.isSafeInteger(id) || id < 1) return null;
 const found = db.from(tables[source.from]).select('name,content_type,path').eq('company_id', company).eq('id', id);
 const row = await (source.from === 'card' && source.card !== undefined ? found.eq('card_id', source.card) : found).maybeSingle();
 if (!row.data) return null;
 const file = await db.storage.from('creatives').download(row.data.path);
 if (file.error || !file.data) return null;
 return new NextResponse(await file.data.arrayBuffer(), { headers: attachmentHeaders(row.data) });
}
