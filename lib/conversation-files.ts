import type { SupabaseClient } from '@supabase/supabase-js';

// The images of one Conversation message (#155). A message's files are kept in the Company's private folder for that
// Conversation, named by its send key and each image's place, so a retry of the same send writes the same paths and
// keeps the same rows: only the Conversation's own person reads them, by their id (app/c/[slug]/files/conversation/[id]).
const bucket='creatives';
export type ChosenImage={content_type:string,base64:string};

// Where one image of a message is stored: the Company's folder for one Conversation, by its send key.
export const conversationFilePath=(company:string,conversation:string,messageKey:string,index:number)=>`${company}/conversations/${conversation}/${messageKey}-${index}`;

// The images as the Engine reads them: the file's own type and its bytes in base64 for the image part of the Run. Read
// before the Agent is asked, so a retry of the same send sends the same body.
/** @param {File[]} files */
export async function imagesOf(files:File[]):Promise<ChosenImage[]> {
 return Promise.all(files.map(async file=>({content_type:file.type,base64:Buffer.from(await file.arrayBuffer()).toString('base64')})));
}

// Whether the send starts a Conversation already there: then its files can be kept before the Agent is asked, which a
// turn that waits behind another Run needs (the worker may start it at any moment, and it reads the files it finds).
// Row-level security shows only the sender's own Conversation, so another person's reads as not there and is refused by
// the send itself.
export async function conversationExists(db:SupabaseClient,company:string,conversation:string):Promise<boolean> {
 const {data}=await db.from('conversations').select('id').eq('id',conversation).eq('company_id',company).maybeSingle();
 return !!data;
}

// The refusal to show for a database answer, in the catalogue's words.
const refusalOf=(code:string|undefined)=>code==='42501'?'conversationNotAllowed':code==='P0002'?'conversationNotFound':'conversationFailed';

// Keeps a sent message's images with it: the rows first, under the database's own check (reserve_conversation_files
// refuses another person's Conversation, and a Viewer), then the bytes in the Company's folder. The bucket has no write
// policy for that folder, so the server writes them, where and as the rows the database just accepted say. A failed
// upload gives the rows back, so nothing is left of a send that kept nothing. Called after the message is stored, so a
// send the engine refused stores nothing at all.
export async function keepConversationFiles(db:SupabaseClient,service:SupabaseClient,{company,conversation,messageKey,files}:{company:string,conversation:string,messageKey:string,files:File[]}):Promise<{error?:string}> {
 const rows=files.map((file,index)=>({position:index,name:file.name.slice(0,255)||'image',content_type:file.type.slice(0,127),size:file.size,path:conversationFilePath(company,conversation,messageKey,index)}));
 const {error}=await db.rpc('reserve_conversation_files',{conversation,c:company,message_key:messageKey,files:rows});
 if(error) return {error:refusalOf(error.code)};
 const written:string[]=[];
 for(const [index,file] of files.entries()) {
  const stored=await service.storage.from(bucket).upload(rows[index].path,Buffer.from(await file.arrayBuffer()),{contentType:rows[index].content_type,upsert:true});
  if(stored.error) {
   if(written.length) await service.storage.from(bucket).remove(written);
   await discardConversationFiles(db,service,{company,conversation,messageKey});
   return {error:'conversationFailed'};
  }
  written.push(rows[index].path);
 }
 return {};
}

// A send that stored no message takes its images with it: the sender's own rows the database gives back, then their
// bytes. A file a stored message already took is kept.
export async function discardConversationFiles(db:SupabaseClient,service:SupabaseClient,{company,conversation,messageKey}:{company:string,conversation:string,messageKey:string}) {
 const {data}=await db.rpc('discard_conversation_files',{conversation,c:company,message_key:messageKey});
 const paths=(Array.isArray(data)?data:[]).filter((path):path is string=>typeof path==='string');
 if(paths.length) await service.storage.from(bucket).remove(paths);
}
