import type { SupabaseClient } from '@supabase/supabase-js';
import { discardMessageFiles, keepMessageFiles, type FilesPlace, type FilesTable } from './message-files';

// The images of one Conversation message (#155): kept in the Company's private folder for that Conversation, under the
// message's send key, and read only by the Conversation's own person (app/c/[slug]/files/conversation/[id]). They are
// kept before the turn they go with is stored (#764), so its Run reads them from here, whenever the starter takes it.

const placeOf=(company:string,conversation:string,messageKey:string,attempt:string):FilesPlace=>({company,folder:'conversations',scope:conversation,messageKey,attempt});
// One send's files: its keep and its discard name the same attempt (#727).
export type ConversationFiles={company:string,conversation:string,messageKey:string,attempt:string};
const words={notAllowed:'conversationNotAllowed',notFound:'conversationNotFound',failed:'conversationFailed'};
const reserveArgs=(place:FilesPlace)=>({conversation:place.scope,c:place.company,message_key:place.messageKey});
const discardArgs=reserveArgs;
const reserve='reserve_conversation_files';
const discard='discard_conversation_files';
const table:FilesTable={table:'conversation_attachments',scope:'conversation_id'};

// Keeps a sent message's images with it: the rows first, under the database's own check (reserve_conversation_files
// refuses another person's Conversation, a Viewer and an image the Engine cannot read, and answers -1 for a send key
// whose files a stored message already took, so only a file missing from storage is written, never over a stored one),
// then the bytes in the Company's folder, at the paths the database built for this keep attempt (#598).
export async function keepConversationFiles(db:SupabaseClient,service:SupabaseClient,{company,conversation,messageKey,attempt,files}:ConversationFiles&{files:File[]}):Promise<{error?:string}> {
 return keepMessageFiles(db,service,{place:placeOf(company,conversation,messageKey,attempt),files,table,reserve,reserveArgs,discard,discardArgs,words});
}

// A send that stored no message takes its images with it: the sender's own rows the database gives back, then their
// bytes. A file a stored message already took is kept, and so is one another send of the key still holds (#727).
export async function discardConversationFiles(db:SupabaseClient,service:SupabaseClient,{company,conversation,messageKey,attempt}:ConversationFiles) {
 return discardMessageFiles(db,service,{place:placeOf(company,conversation,messageKey,attempt),discard,discardArgs});
}
