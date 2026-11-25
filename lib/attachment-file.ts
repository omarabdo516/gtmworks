import type { SupabaseClient } from '@supabase/supabase-js';
import { attachmentHeaders } from './attachments.mjs';

// Where a file is named: on a Card's messages, narrowed to one Card when `card` is given (a run key reaches its own Card's
// files only), in a Conversation (#21), which only its own person reads, or in a channel (#156), which every Member of
// that channel reads.
export type AttachmentSource={from:'card',card?:number}|{from:'conversation'}|{from:'channel'};
const tables={card:'work_attachments',conversation:'conversation_attachments',channel:'channel_attachments'} as const;

// The one place an attachment's bytes leave the private bucket. The caller passes a client that acts as the asking person
// or agent: the attachment row and the storage object are both read through it, so row level security decides who gets here.
// null when there is no such file for this reader; 'failed' when a read failed (#777), which the route answers as an
// error, never as "not found".
export async function attachmentFile(db: SupabaseClient, company: string, id: number, source: AttachmentSource = { from: 'card' }): Promise<Response | null | 'failed'> {
 if (!Number.isSafeInteger(id) || id < 1) return null;
 const found = db.from(tables[source.from]).select('name,content_type,path').eq('company_id', company).eq('id', id);
 const row = await (source.from === 'card' && source.card !== undefined ? found.eq('card_id', source.card) : found).maybeSingle();
 if (row.error) return 'failed';
 if (!row.data) return null;
 const file = await db.storage.from('creatives').download(row.data.path);
 if (file.error || !file.data) return missingObject(file.error) ? null : 'failed';
 return new Response(await file.data.arrayBuffer(), { headers: attachmentHeaders(row.data) });
}
// The storage answer for an object that is not there (a 404, or its "not found" in the body), as opposed to a failure.
const missingObject = (error: unknown) => { const answer = (error ?? {}) as { status?: number, statusCode?: string | number, message?: string }; return answer.status === 404 || String(answer.statusCode) === '404' || /not.?found/i.test(String(answer.message ?? '')); };

// A Company's file route (#777): no Company for this person, no permission or no such file answer 404, alike, so nothing
// tells an outsider the Company exists; a read that failed answers 503, so a Member tries again instead of thinking the
// file is gone.
// `permission` is the route's own check of its entry in lib/route-permissions.mjs, made where it runs.
export async function companyFileResponse(db: SupabaseClient, slug: string, id: string, permission: (company: string) => Promise<'allowed' | 'refused' | 'failed'>, source: AttachmentSource): Promise<Response> {
 const notFound = () => new Response('Not found', { status: 404 });
 const failed = () => new Response('Could not be read', { status: 503, headers: { 'Retry-After': '5' } });
 const company = await db.from('companies').select('id').eq('slug', slug).maybeSingle();
 if (company.error) return failed();
 if (!company.data) return notFound();
 const allowed = await permission(company.data.id);
 if (allowed === 'failed') return failed();
 if (allowed === 'refused' || !/^\d+$/.test(id)) return notFound();
 const response = await attachmentFile(db, company.data.id, Number(id), source);
 return response === 'failed' ? failed() : response || notFound();
}
