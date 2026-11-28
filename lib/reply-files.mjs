import { createHash } from 'node:crypto';
import { workSegments } from './engine/handle.mjs';
import { workFolder } from './agent-toolsets.mjs';
import { pictureType } from './file-preview.mjs';
import { fileTagName, takeFileTags } from './media-tags.mjs';

// The files an Agent hands its person in a reply (#708, ADR 0028). The Agent names each by a `MEDIA:<path>` tag, the
// Engine's own way of naming a file in a reply, with the file's path in its own work folder (`/work/<profile>/…`, or a
// path relative to that folder). gtmworks reads the file through the Library's own guarded read (downloadAgentFile: the
// work root, the folder listed first, up to 25 MB), keeps its bytes in the place's private folder of the `creatives`
// bucket, and takes every tag out of the reply's text. A tag that names anything else (another Agent's folder, the
// Engine's own files, a `..` or a hidden name), a file that is not there, one past the limit or past the ten a reply
// carries is kept as the name of a file that could not be attached: the person never reads a path.
const bucket='creatives';
const mostFiles=10;
// The names a reply keeps of files it could not hand over, as the close takes them.
const mostMissed=20;
/** @typedef {{company:string,folder:'conversations'|'channels',scope:string}} ReplyPlace */
/** @typedef {{position:number,name:string,content_type:string,size:number,path:string}} ReplyFile */

// The file a tag names inside the Agent's own work folder, or null: an absolute path must be under the Agent's own
// folder, and every part is a plain name (workSegments), so nothing outside it is ever asked for.
/** @param {string} path @param {string} profile @returns {{folder:string,name:string}|null} */
export function ownWorkFile(path,profile) {
 const own=`${workFolder}/${profile}/`;
 const inside=path.startsWith(own)?path.slice(own.length):/^[/~\\]/.test(path)?null:path.replace(/^(\.\/)+/,'');
 const parts=inside===null?null:workSegments(inside);
 if(!parts?.length) return null;
 return {folder:parts.slice(0,-1).join('/'),name:/** @type {string} */(parts.at(-1))};
}
// The path a reply's file is kept at: <company>/<folder>/<conversation or channel>/reply-<md5 of the Run>-<place>. The
// database builds the same path for the row (close_conversation_run, close_channel_run), so a closer that runs again
// writes the same bytes to the same place.
/** @param {ReplyPlace} place @param {string} run @param {number} position */
export const replyFilePath=(place,run,position)=>`${place.company}/${place.folder}/${place.scope}/reply-${createHash('md5').update(run).digest('hex')}-${position}`;
// The type a kept file is served with: a raster image by its name, so it is drawn as a thumbnail, else the Engine's.
/** @param {string} name @param {string} type */
const typeOf=(name,type)=>pictureType(name)||(type&&type!=='application/octet-stream'?type.slice(0,127):'application/octet-stream');

// The service's upload into the private bucket. A failure throws: the Run stays open and the next closer tries again.
/** @param {any} service @returns {(path:string,body:Uint8Array,type:string)=>Promise<void>} */
export const storageUpload=service=>async(path,body,type)=>{
 const {error}=await service.storage.from(bucket).upload(path,body,{contentType:type,upsert:true});
 if(error) throw error;
};

// The reply as it is kept: its text without the tags, the files it hands over (kept at their paths already), and the
// names of those it could not.
/** @param {{engine:{profile:string,files:{download:(file:{folder?:unknown,name?:unknown,root?:unknown})=>Promise<any>}},place:ReplyPlace,run:string,reply:string,upload:(path:string,body:Uint8Array,type:string)=>Promise<void>}} handed
 * @returns {Promise<{reply:string,files:ReplyFile[],missed:string[]}>} */
export async function keepReplyFiles({engine,place,run,reply,upload}) {
 const {body,paths}=takeFileTags(reply);
 const files=[]; const missed=[]; const seen=new Set();
 for(const path of paths) {
  if(seen.has(path)) continue;
  seen.add(path);
  const file=ownWorkFile(path,engine.profile);
  const read=file&&files.length<mostFiles?await engine.files.download({...file,root:'work'}):null;
  if(read?.state!=='found'||!read.size) { if(missed.length<mostMissed) missed.push(fileTagName(path)); continue; }
  const position=files.length; const at=replyFilePath(place,run,position); const type=typeOf(read.name,read.type);
  await upload(at,read.body,type);
  files.push({position,name:read.name.slice(0,255),content_type:type,size:read.size,path:at});
 }
 return {reply:body,files,missed};
}

// A file an Agent named by a MEDIA line, read for a person who opens it from where it lies, its Agent's own work folder in
// the Company's work sandbox, through the Library's guarded download (a Card's, #843, and a Conversation's, #880): no
// copy is kept. A tag naming anything outside that folder is missing; the work sandbox stopped, or its Engine not
// answering or refusing, is a file that cannot be read now (`notNow`), never one that is gone. It is served as a raster
// image by its name, else as bytes to download.
/** @param {{profile:string,files:{download:(file:{folder?:unknown,name?:unknown,root?:unknown})=>Promise<any>}}} agent @param {string} path
 * @returns {Promise<{state:'found',name:string,type:string,body:Uint8Array<ArrayBuffer>}|{state:'missing'|'notNow'|'tooLarge'}>} */
export async function readAgentWorkFile(agent,path) {
 const at=ownWorkFile(path,agent.profile);
 if(!at) return {state:'missing'};
 const read=await agent.files.download({...at,root:'work'});
 if(read.state==='found') return {state:'found',name:read.name,type:pictureType(read.name)||'application/octet-stream',body:read.body};
 if(read.state==='tooLarge') return {state:'tooLarge'};
 return {state:read.state==='unreachable'||read.state==='refused'?'notNow':'missing'};
}
