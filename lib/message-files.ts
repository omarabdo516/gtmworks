import type { SupabaseClient } from '@supabase/supabase-js';

// The images of one message in a channel (#156); a Conversation's go in its Run's input and are kept nowhere (#880). They are kept in the Company's private folder
// for that place, named by the message's send key, the keep attempt that first wrote its rows, and each image's place: a
// retry that finds the rows still there writes the paths they name, and a send that keeps them again after they were
// given back writes new ones, which the earlier attempt's removal never reaches (#598). The bucket has no write policy
// for those folders, so the server writes them, where the database's rows say: the database builds every path itself
// and ignores one a caller sends.
const bucket='creatives';
export type ChosenImage={content_type:string,base64:string};

// Where a send's files belong: the Company, the folder that names the feature, and the channel; and the
// send's keep attempt, which its keep and its discard both name (#727).
export type FilesPlace={company:string,folder:'channels',scope:string,messageKey:string,attempt:string};
// The catalogue's words for a database refusal: a Viewer, a place that is not the caller's, and any other failure.
type FileRefusalWords={notAllowed:string,notFound:string,failed:string};
// The table that names a channel's files, and its column for the channel.
export type FilesTable={table:'channel_attachments',scope:'channel_id'};
type KeepFiles={place:FilesPlace,files:File[],table:FilesTable,reserve:string,reserveArgs:(place:FilesPlace)=>Record<string,unknown>,discard:string,discardArgs:(place:FilesPlace)=>Record<string,unknown>,words:FileRefusalWords};

// The paths the database named for a send key's files, by each image's place: the rows this attempt kept, or the ones an
// attempt before it kept and nobody gave back, or a stored message's own. Read as the server, which writes the bytes.
async function keptPaths(service:SupabaseClient,{place,table}:{place:FilesPlace,table:FilesTable}):Promise<Map<number,string>|undefined> {
 const {data,error}=await service.from(table.table).select('position,path').eq('company_id',place.company).eq(table.scope,place.scope).eq('send_key',place.messageKey).order('position');
 if(error) return undefined;
 return new Map((data||[]).map((row:{position:number,path:string})=>[row.position,row.path]));
}

const refusalOf=(code:string|undefined,words:FileRefusalWords)=>code==='42501'?words.notAllowed:code==='P0002'?words.notFound:words.failed;

// The image parts of a stored message, read from its file rows in the order they were chosen: base64 in the file's own
// type. Read when the Run starts, so a retry of the same start sends the same body. A stored object that is gone never
// reads again, so a waiting turn fails for its sender instead of being claimed on every pass (#368); any other storage
// failure is thrown as it is and tried again.
type StorageFailure={statusCode?:string|number,status?:number,code?:string,message?:string};
const gone=(error:StorageFailure)=>error.statusCode==='404'||error.statusCode===404||error.status===404||error.code==='NoSuchKey';
class MessageFileGone extends Error {
 constructor(message:string) { super(message); this.name='MessageFileGone'; }
}
/** @param {SupabaseClient} service @param {{content_type:string,path:string}[]} rows @param {string} missing */
export async function filesAsImages(service:SupabaseClient,rows:{content_type:string,path:string}[],missing:string):Promise<ChosenImage[]|undefined> {
 const images:ChosenImage[]=[];
 for(const row of rows) {
  const file=await service.storage.from(bucket).download(row.path);
  if(file.error) throw gone(file.error as StorageFailure)?new MessageFileGone(missing):file.error;
  if(!file.data) throw new MessageFileGone(missing);
  images.push({content_type:row.content_type,base64:Buffer.from(await file.data.arrayBuffer()).toString('base64')});
 }
 return images.length?images:undefined;
}

// Keeps a send's images: the rows first, under the database's own checks (the place is the caller's, they may write, the
// type is an image the Engine reads), then the bytes in the Company's folder, at the paths the rows name. Each keep is its
// own attempt: rows it adds are named by it, so a send of the same key that kept them again after an earlier one gave
// them back writes where that earlier removal never reaches (#598). Every waiting row of the key records the attempts that
// hold it, the ones that added it and the ones that found it, so a concurrent send of the key that gives them back takes
// only itself off and leaves this one's rows and objects (#727). A failed upload gives the rows back: the guarded discard
// names the paths of the rows it took, and only those are removed, so a stored message's file stays.
/** @param {SupabaseClient} db @param {SupabaseClient} service @param {KeepFiles} kept @returns {Promise<{error?:string}>} */
export async function keepMessageFiles(db:SupabaseClient,service:SupabaseClient,{place,files,table,reserve,reserveArgs,discard,discardArgs,words}:KeepFiles):Promise<{error?:string}> {
 const rows=files.map((file,index)=>({position:index,name:file.name.slice(0,255)||'image',content_type:file.type.slice(0,127),size:file.size}));
 const {data,error}=await db.rpc(reserve,{...reserveArgs(place),files:rows,attempt:place.attempt});
 if(error) return {error:refusalOf(error.code,words)};
 // -2: the send key's files are kept and still held by its waiting turn or its Run (#465). The send goes on to that turn,
 // and nothing is written: not over a kept image, so its retry carries what it was sent with, and not beside them at a
 // place no row names, which nothing would read or give back.
 if(data===-2) return {};
 const paths=await keptPaths(service,{place,table});
 // -1: the files of this send key are already a stored message's own; the send goes on to its message, which the send key
 // answers with the one it stored. A file whose upload failed the first time is written now, at the path its row names,
 // and one already stored is never replaced (no upsert: "already exists" is the file being there). Its rows stay: they
 // are the message's. The repair is best effort: a storage error here never stops the send from reaching the message
 // its key already stored.
 if(typeof data==='number'&&data<0) {
  for(const [index,file] of files.entries()) {
   const path=paths?.get(index);
   if(path) await service.storage.from(bucket).upload(path,Buffer.from(await file.arrayBuffer()),{contentType:rows[index].content_type,upsert:false});
  }
  return {};
 }
 for(const [index,file] of files.entries()) {
  // A place no row names (the read failed, or the rows went while this send read them) is a send whose images cannot
  // be kept: given back like a failed upload.
  const path=paths?.get(index);
  const stored=path&&await service.storage.from(bucket).upload(path,Buffer.from(await file.arrayBuffer()),{contentType:rows[index].content_type,upsert:true});
  if(!stored||stored.error) {
   await discardMessageFiles(db,service,{place,discard,discardArgs});
   return {error:words.failed};
  }
 }
 return {};
}

// A send that stored no message takes its images with it: the sender's own rows the database gives back, then their
// bytes. The discard names the send's attempt, and the database gives back only rows no other attempt still holds
// (#727; a hold lapses fifteen minutes after its key's last keep). A file a stored message already took is kept, and so is every file of a send key that is still a waiting turn
// or holds a Run reservation: the database gives back no path for them (#465).
/** @param {SupabaseClient} db @param {SupabaseClient} service @param {{place:FilesPlace,discard:string,discardArgs:(place:FilesPlace)=>Record<string,unknown>}} gone */
export async function discardMessageFiles(db:SupabaseClient,service:SupabaseClient,{place,discard,discardArgs}:{place:FilesPlace,discard:string,discardArgs:(place:FilesPlace)=>Record<string,unknown>}) {
 const {data}=await db.rpc(discard,{...discardArgs(place),attempt:place.attempt});
 const paths=(Array.isArray(data)?data:[]).filter((path):path is string=>typeof path==='string');
 if(paths.length) await service.storage.from(bucket).remove(paths);
}
