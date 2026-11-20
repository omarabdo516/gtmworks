import type { SupabaseClient } from '@supabase/supabase-js';

// The images of one message, in a Conversation (#155) or a channel (#156). They are kept in the Company's private folder
// for that place, named by the message's send key and each image's place, so a retry of the same send writes the same
// paths and keeps the same rows. The bucket has no write policy for those folders, so the server writes them, where the
// database's rows say: the database builds every path itself and ignores one a caller sends.
const bucket='creatives';
export type ChosenImage={content_type:string,base64:string};

// Where a send's files belong: the Company, the folder that names the feature, and the Conversation or channel.
export type FilesPlace={company:string,folder:'conversations'|'channels',scope:string,messageKey:string};
// The catalogue's words for a database refusal: a Viewer, a place that is not the caller's, and any other failure.
type FileRefusalWords={notAllowed:string,notFound:string,failed:string};
type KeepFiles={place:FilesPlace,files:File[],reserve:string,reserveArgs:(place:FilesPlace)=>Record<string,unknown>,discard:string,discardArgs:(place:FilesPlace)=>Record<string,unknown>,words:FileRefusalWords};

// The path the database builds for one image of a message: <company>/<folder>/<conversation or channel>/<send key>-<place>.
const messageFilePath=(place:FilesPlace,position:number)=>`${place.company}/${place.folder}/${place.scope}/${place.messageKey}-${position}`;

const refusalOf=(code:string|undefined,words:FileRefusalWords)=>code==='42501'?words.notAllowed:code==='P0002'?words.notFound:words.failed;

// The images as the Engine reads them: each file's own type and its bytes in base64, for the image part of a Run.
/** @param {File[]} files */
export async function imagesOf(files:File[]):Promise<ChosenImage[]> {
 return Promise.all(files.map(async file=>({content_type:file.type,base64:Buffer.from(await file.arrayBuffer()).toString('base64')})));
}

// The image parts of a stored message, read from its file rows in the order they were chosen: base64 in the file's own
// type. Read when the Run starts, so a retry of the same start sends the same body. A stored object that is gone never
// reads again, so a waiting turn fails for its sender instead of being claimed on every pass (#368); any other storage
// failure is thrown as it is and tried again.
type StorageFailure={statusCode?:string|number,status?:number,code?:string,message?:string};
const gone=(error:StorageFailure)=>error.statusCode==='404'||error.statusCode===404||error.status===404||error.code==='NoSuchKey';
export class MessageFileGone extends Error {
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
// type is an image the Engine reads), then the bytes in the Company's folder. A failed upload gives the rows back: the
// guarded discard names the paths of the rows it took, and only those are removed, so a stored message's file stays.
/** @param {SupabaseClient} db @param {SupabaseClient} service @param {KeepFiles} kept @returns {Promise<{error?:string}>} */
export async function keepMessageFiles(db:SupabaseClient,service:SupabaseClient,{place,files,reserve,reserveArgs,discard,discardArgs,words}:KeepFiles):Promise<{error?:string}> {
 const rows=files.map((file,index)=>({position:index,name:file.name.slice(0,255)||'image',content_type:file.type.slice(0,127),size:file.size}));
 const {data,error}=await db.rpc(reserve,{...reserveArgs(place),files:rows});
 if(error) return {error:refusalOf(error.code,words)};
 // -1: the files of this send key are already a stored message's own; the send goes on to its message, which the send key
 // answers with the one it stored. A file whose upload failed the first time is written now, and one already stored is
 // never replaced (no upsert: "already exists" is the file being there). Its rows stay: they are the message's. The repair
 // is best effort: a storage error here never stops the send from reaching the message its key already stored.
 if(typeof data==='number'&&data<0) {
  for(const [index,file] of files.entries())
   await service.storage.from(bucket).upload(messageFilePath(place,index),Buffer.from(await file.arrayBuffer()),{contentType:rows[index].content_type,upsert:false});
  return {};
 }
 for(const [index,file] of files.entries()) {
  const path=messageFilePath(place,index);
  const stored=await service.storage.from(bucket).upload(path,Buffer.from(await file.arrayBuffer()),{contentType:rows[index].content_type,upsert:true});
  if(stored.error) {
   await discardMessageFiles(db,service,{place,discard,discardArgs});
   return {error:words.failed};
  }
 }
 return {};
}

// A send that stored no message takes its images with it: the sender's own rows the database gives back, then their
// bytes. A file a stored message already took is kept.
/** @param {SupabaseClient} db @param {SupabaseClient} service @param {{place:FilesPlace,discard:string,discardArgs:(place:FilesPlace)=>Record<string,unknown>}} gone */
export async function discardMessageFiles(db:SupabaseClient,service:SupabaseClient,{place,discard,discardArgs}:{place:FilesPlace,discard:string,discardArgs:(place:FilesPlace)=>Record<string,unknown>}) {
 const {data}=await db.rpc(discard,discardArgs(place));
 const paths=(Array.isArray(data)?data:[]).filter((path):path is string=>typeof path==='string');
 if(paths.length) await service.storage.from(bucket).remove(paths);
}
