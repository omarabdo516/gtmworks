import type { SupabaseClient } from '@supabase/supabase-js';
import { discardMessageFiles, imagesOf, keepMessageFiles, type FilesPlace, type FilesTable } from './message-files';

// The images of one Conversation message (#155): kept in the Company's private folder for that Conversation, under the
// message's send key, and read only by the Conversation's own person (app/c/[slug]/files/conversation/[id]).
export { imagesOf };

const placeOf=(company:string,conversation:string,messageKey:string):FilesPlace=>({company,folder:'conversations',scope:conversation,messageKey});
const words={notAllowed:'conversationNotAllowed',notFound:'conversationNotFound',failed:'conversationFailed'};
const reserveArgs=(place:FilesPlace)=>({conversation:place.scope,c:place.company,message_key:place.messageKey});
const discardArgs=reserveArgs;
const reserve='reserve_conversation_files';
const discard='discard_conversation_files';
const table:FilesTable={table:'conversation_attachments',scope:'conversation_id'};

// Whether the send starts a Conversation already there: then its files can be kept before the Agent is asked, which a
// turn that waits behind another Run needs (the worker may start it at any moment, and it reads the files it finds).
// Row-level security shows only the sender's own Conversation, so another person's reads as not there and is refused by
// the send itself.
export async function conversationExists(db:SupabaseClient,company:string,conversation:string):Promise<boolean> {
 const {data}=await db.from('conversations').select('id').eq('id',conversation).eq('company_id',company).maybeSingle();
 return !!data;
}

// Keeps a sent message's images with it: the rows first, under the database's own check (reserve_conversation_files
// refuses another person's Conversation, a Viewer and an image the Engine cannot read, and answers -1 for a send key
// whose files a stored message already took, so only a file missing from storage is written, never over a stored one),
// then the bytes in the Company's folder, at the paths the database built for this keep attempt (#598).
export async function keepConversationFiles(db:SupabaseClient,service:SupabaseClient,{company,conversation,messageKey,files}:{company:string,conversation:string,messageKey:string,files:File[]}):Promise<{error?:string}> {
 return keepMessageFiles(db,service,{place:placeOf(company,conversation,messageKey),files,table,reserve,reserveArgs,discard,discardArgs,words});
}

// A send that stored no message takes its images with it: the sender's own rows the database gives back, then their
// bytes. A file a stored message already took is kept.
export async function discardConversationFiles(db:SupabaseClient,service:SupabaseClient,{company,conversation,messageKey}:{company:string,conversation:string,messageKey:string}) {
 return discardMessageFiles(db,service,{place:placeOf(company,conversation,messageKey),discard,discardArgs});
}
