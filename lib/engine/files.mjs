import { workFolder } from '../agent-toolsets.mjs';
import { engineRequest } from './transport.mjs';
import { downloadTime } from './sessions.mjs';
import { agentName, manage, reachable, refusal } from './wire.mjs';

// The Library of an Agent (#194) reads one named folder through the Engine's dashboard file routes, and never copies a
// file into gtmworks. It has two roots (#353), each a name gtmworks chooses and never a path segment a browser sends, so
// a work folder called `images` is still a folder of `work` and cannot collide with the images root.
//
// `work` is the Agent's own folder in its Company's work folder (#395, ADR 0018): `/work/<profile>` in the work sandbox,
// where every command of that Agent starts (#393, sandbox/work-shell) and where its file tools write. Every Agent of the
// Company can read and change all of the work folder; the Library opens on the Agent's own part of it. The Engine sees
// the same volume read-only at `/opt/data/work` (scripts/engine-template.yml), inside the dashboard's managed files root
// (`/opt/data`, hermes_cli/web_server_files.py _managed_files_policy), so a folder is listed by the Engine with each
// entry's size and time and the path it resolves to. A file's bytes are never read through that mount: what the work
// folder holds is written by whoever talks to an Agent, so a link swapped in between the listing and the read would
// resolve on the Engine's own disk (another Agent's memory, a private Conversation). They are read through the profile's
// ssh workspace instead (v0.23.0 /api/fs/read-text and /api/fs/download with `profile`, hermes_cli/ssh_workspace_fs.py),
// inside the sandbox, where a link reaches nothing an Agent's own terminal cannot.
//
// `images` is where the Engine writes a generated image (`agent/provider_media.py`: GENERATED_SUBDIR under the
// profile's cache_dir, outside the folders the gateway sweeps), on the Engine's own disk, where no Agent writes: it is
// listed and read through the managed files routes (/api/files, /api/files/download), never through the ssh workspace,
// which holds none of the Engine's files.
// The sandbox's path is the one every Agent's start folder is pinned under (lib/agent-toolsets.mjs).
const engineWork='/opt/data/work'; const sandboxWork=workFolder;
// A Library root, by name: `work` unless the caller names one. Anything else is null — refused before the Engine is
// asked, so no other folder of a profile is ever read through the Library.
/** @param {unknown} raw @returns {'work'|'images'|null} */
export function libraryRoot(raw) {
 if(raw===undefined) return 'work';
 return raw==='work'||raw==='images'?raw:null;
}
// Whether the Company's work sandbox answers (#398): one read of the Engine's own ssh workspace, the backend its Agents'
// terminal, files and code run in. A folder the sandbox holds lists; a sandbox that is not running answers the Engine's
// 503 (`SSH workspace is unavailable`), a 502 when its dial fails, or a listing with an error instead of entries. No
// polling and no retry: the next page or command reads it again. `unreachable` is the Engine itself not answering (which
// Settings names separately), `refused` its key.
/** @param {{address:string,key:string,managementAddress?:string}|null} connection @returns {Promise<{state:'running'|'notRunning'|'refused'|'unreachable'}>} */
export async function readWorkSandbox(connection) {
 if(!connection||!reachable(connection)) return {state:'unreachable'};
 try {
  // The page that reads it waits for it, so it gets the management reads' own 5 s, not more.
  const {response,result}=await manage(connection,`/api/fs/list?path=${encodeURIComponent(sandboxWork)}`);
  if([502,503].includes(response.status)) return {state:'notRunning'};
  if(!response.ok) return {state:refusal(response)};
  if(typeof result?.error==='string'&&result.error) return {state:'notRunning'};
  return Array.isArray(result?.entries)?{state:'running'}:{state:'unreachable'};
 } catch { return {state:'unreachable'}; }
}
// A file gtmworks serves as an attachment is read to its end, up to this size: a longer one is refused, never held.
const libraryLimit=25*1024*1024;
// The preview's first part, as the Engine's own read-text cuts it (files.py _FS_TEXT_PREVIEW_MAX_BYTES).
const previewLimit=512*1024;

// A folder or file inside the work folder is named by a relative path of plain segments: no absolute path, no `..`, no
// hidden name, no backslash, no colon and no NUL, at most eight names of 128 characters each. '' is the work folder
// itself. Anything else is refused here, before the Engine is asked (null).
/** @param {unknown} raw @returns {string[]|null} */
export function workSegments(raw) {
 if(raw===undefined||raw==='') return [];
 if(typeof raw!=='string'||raw.length>512) return null;
 const parts=raw.split('/');
 if(parts.length>8) return null;
 for(const part of parts) if(!part||part.length>128||part==='.'||part==='..'||part.startsWith('.')||/[:\\\u0000-\u001f\u007f]/.test(part)) return null;
 return parts;
}
const folderOf=path=>path.slice(0,path.lastIndexOf('/'));
/** @param {unknown} mtime @returns {string|null} */
const fileTime=mtime=>Number.isFinite(mtime)&&/** @type {number} */(mtime)>0?new Date(/** @type {number} */(mtime)*1000).toISOString():null;
// The Engine path a root starts at for the profile this connection is bound to. The profile must be one the Engine's
// own profile list names (v0.23.0 web_routers/profiles.py 84-92): the images root is inside its home, and the work root
// is the profile's own folder of the work folder. gtmworks builds the path it asks about and never takes one from a
// browser.
/** @param {any} connection @param {'work'|'images'} root */
async function rootPath(connection,root) {
 if(!agentName.test(connection.profile)) return {state:'missing',path:null};
 const {response,result}=await manage(connection,'/api/profiles');
 if(!response.ok) return {state:refusal(response),path:null};
 const found=Array.isArray(result?.profiles)?result.profiles.find(profile=>profile?.name===connection.profile):undefined;
 const home=typeof found?.path==='string'?found.path.replace(/\/+$/,''):'';
 if(!home.startsWith('/')) return {state:'missing',path:null};
 return {state:'found',path:root==='work'?`${engineWork}/${connection.profile}`:`${home}/cache/generated/images`};
}
// One folder of a root, as `/api/files?path=` reports it (v0.23.0 web_routers/files.py 616 with
// web_server_files.py _managed_file_entry): a name, whether it is a folder, its size, its time and the path it resolves
// to. An entry the Engine resolved outside this folder is a link out of it, and is neither listed nor read. The folder
// the Engine resolved must be the one gtmworks asked for — a root, or a folder inside it, that is a link somewhere else is
// not this Agent's Library at all (missing) — and no entry is used before that check. `unmade` says the Engine has no
// such folder at all (404) rather than a folder that is a link.
/** @param {any} connection @param {string} base @param {string[]} segments */
async function readFolder(connection,base,segments) {
 const target=[base,...segments].join('/');
 const {response,result}=await manage(connection,`/api/files?path=${encodeURIComponent(target)}`);
 if(response.status===404) return {state:'missing',entries:null,folder:null,unmade:true};
 if(!response.ok) return {state:refusal(response),entries:null,folder:null,unmade:false};
 if(!Array.isArray(result?.entries)) return {state:'unreachable',entries:null,folder:null,unmade:false};
 const folder=typeof result.path==='string'?result.path.replace(/\/+$/,''):'';
 if(folder!==target) return {state:'missing',entries:null,folder:null,unmade:false};
 const entries=[];
 for(const entry of result.entries) {
  const name=entry?.name; const at=typeof entry?.path==='string'?entry.path.replace(/\/+$/,''):'';
  if(typeof name!=='string'||workSegments(name)?.length!==1) continue;
  if(entry.broken_link===true||!at||folderOf(at)!==folder) continue;
  const isFolder=entry.is_directory===true;
  const size=!isFolder&&Number.isSafeInteger(entry.size)&&entry.size>=0?entry.size:null;
  entries.push({name,isFolder,size,time:isFolder?null:fileTime(entry.mtime)});
 }
 return {state:'found',entries,folder,unmade:false};
}
// The empty answer a Library root gives when the Engine has no such folder yet: the generated images folder is made with
// the first image (#353), and an Agent's own work folder with its first command (#395, sandbox/work-shell), so a profile
// with neither reads as the empty folder it is rather than a missing one. A folder that is a link somewhere else is
// still missing — only the Engine's own 404 of a root itself is empty.
const unmadeRoot=(segments,read)=>!segments.length&&read.unmade===true;
/** @param {any} connection @param {unknown} [folder] @param {unknown} [root] */
export async function listAgentFiles(connection,folder='',root='work') {
 const segments=workSegments(folder); const at=libraryRoot(root);
 if(!segments||!at) return {state:'invalid',entries:null};
 if(!reachable(connection)) return {state:'unreachable',entries:null};
 try {
  const base=await rootPath(connection,at);
  if(base.state!=='found') return {state:base.state,entries:null};
  const read=await readFolder(connection,base.path,segments);
  if(unmadeRoot(segments,read)) return {state:'found',entries:[]};
  return {state:read.state,entries:read.entries};
 } catch { return {state:'unreachable',entries:null}; }
}
// A download is read to its end, up to the size gtmworks serves; null when it is longer than that. With `cut`, a body
// longer than the limit is its first `limit` bytes instead: an Engine that ignores a Range still sends no more than that.
/** @param {Response} response @param {number} [limit] @param {boolean} [cut] */
export async function boundedBytes(response,limit=libraryLimit,cut=false) {
 const reader=response.body?.getReader(); if(!reader) return new Uint8Array(0);
 const chunks=[]; let size=0;
 for(;;) {
  const {done,value}=await reader.read();
  if(done) break;
  if(size+value.byteLength>limit) {
   await reader.cancel().catch(()=>{});
   if(!cut) return null;
   chunks.push(value.subarray(0,limit-size)); size=limit; break;
  }
  size+=value.byteLength;
  chunks.push(value);
 }
 const body=new Uint8Array(size); let at=0; for(const chunk of chunks) { body.set(chunk,at); at+=chunk.byteLength; }
 return body;
}
// One file of a root, named by its folder and its own name: the folder is listed first, so a name the folder no longer
// holds, a folder itself and a link out of the folder are refused before the Engine is asked for the file. The path guard
// runs over both names, and the root over its own closed list, before anything is asked. States: found (the entry, and
// where its bytes are read: the Engine's own path for the images root, the sandbox's path for the work root), invalid,
// missing, refused (the key) or unreachable.
/** @param {any} connection @param {{folder?:unknown,name?:unknown,root?:unknown}} file */
async function listedFile(connection,{folder='',name,root='work'}={}) {
 const segments=workSegments(folder); const one=workSegments(name); const at=libraryRoot(root);
 if(!segments||!one||one.length!==1||!at) return {state:'invalid'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const base=await rootPath(connection,at);
  if(base.state!=='found') return {state:base.state};
  const read=await readFolder(connection,base.path,segments);
  if(read.state!=='found') return {state:read.state};
  const entry=read.entries.find(item=>item.name===name);
  if(!entry) return {state:'missing'};
  if(entry.isFolder) return {state:'invalid'};
  const path=at==='work'?[sandboxWork,connection.profile,...segments,name].join('/'):`${read.folder}/${name}`;
  return {state:'found',entry,root:at,path};
 } catch { return {state:'unreachable'}; }
}
// The bytes of a listed file: from the profile's ssh workspace for the work root, from the Engine's managed files for
// the images root. The answer is the response, its body unread.
/** @param {any} connection @param {{root:'work'|'images',path:string}} listed @param {Record<string,string>} [headers] */
const fetchFile=(connection,listed,headers={})=>engineRequest(connection,{listener:'management',path:listed.root==='work'
 ?`/api/fs/download?path=${encodeURIComponent(listed.path)}&profile=${encodeURIComponent(connection.profile)}`
 :`/api/files/download?path=${encodeURIComponent(listed.path)}`,
 headers,deadline:downloadTime,signal:AbortSignal.timeout(downloadTime),stream:true});
// What a file read that is not a success means. The Engine refuses a path that resolves outside the root it reads under,
// and a sensitive file, with a 403: for a file the folder listed, that is a file this Agent does not have (missing), and
// only a 401 is the key refused.
/** @param {Response} response */
const fileRefusal=response=>[403,404].includes(response.status)?'missing':response.status===413?'tooLarge':response.status===401?'refused':'unreachable';
// One file's bytes, up to the size gtmworks serves, with the Engine's type: found, missing, tooLarge, refused or
// unreachable.
/** @param {any} connection @param {{root:'work'|'images',path:string}} listed */
async function fileBytes(connection,listed) {
 const response=await fetchFile(connection,listed);
 if(!response.ok) { await response.body?.cancel().catch(()=>{}); return {state:fileRefusal(response)}; }
 const body=await boundedBytes(response);
 if(!body) return {state:'tooLarge'};
 const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 return {state:'found',type:type||'application/octet-stream',body};
}

// One file of a root is fetched by gtmworks and never by an address the browser holds: the file is `listedFile`
// first, so a name the folder no longer holds, a folder itself and a link out of the folder are refused before the
// Engine is asked for any bytes. The file's type is the Engine's, and its body is never written down.
// shortcut: a download's answer carries no path of its own, so a link swapped between the listing and this one request is
// only as narrow as the folder's own check above. For the work root that link resolves inside the sandbox, which holds
// nothing an Agent's terminal cannot already read; the bytes are handed on as an attachment, never as a page.
/** @param {any} connection @param {{folder?:unknown,name?:unknown,root?:unknown}} file */
export async function downloadAgentFile(connection,file={}) {
 const listed=await listedFile(connection,file);
 if(listed.state!=='found') return {state:listed.state};
 try {
  const read=await fileBytes(connection,listed);
  if(read.state!=='found') return {state:read.state};
  return {state:'found',name:listed.entry.name,type:read.type,size:read.body.byteLength,body:read.body};
 } catch { return {state:'unreachable'}; }
}

// A file's first part, for the read-only preview (#195). In the work root the Engine reads the first 512 KB of the file
// in the sandbox and says how big the whole file is, what type it is and whether more follows (v0.23.0 GET
// /api/fs/read-text, web_routers/files.py 1032-1079), and the answer must name the file asked for. In the images root,
// where only the Engine writes, the same first 512 KB is asked for as a range and cut there whatever the Engine sends,
// with the whole size from its Content-Range (or the folder's listing). The same guard as the download; a file that reads
// as binary is handed on with no text at all.
// A file reads as binary by the Engine's own rule (web_routers/files.py 157-163): a NUL, or more than 12% control bytes,
// in its first 4 KB.
/** @param {Uint8Array} data */
const looksBinary=data=>{ const head=data.subarray(0,4096); if(!head.length) return false; if(head.includes(0)) return true;
 let odd=0; for(const byte of head) if(byte<32&&![9,10,13].includes(byte)) odd++; return odd/head.length>0.12; };
/** @param {any} connection @param {{folder?:unknown,name?:unknown,root?:unknown}} file */
export async function readAgentFile(connection,file={}) {
 const listed=await listedFile(connection,file);
 if(listed.state!=='found') return {state:listed.state};
 try {
  if(listed.root==='images') {
   const response=await fetchFile(connection,listed,{Range:`bytes=0-${previewLimit-1}`});
   // An empty file has no first byte to give: the range is refused (416), and the file is the empty preview it is.
   if(response.status===416&&listed.entry.size===0) { await response.body?.cancel().catch(()=>{}); return {state:'found',name:listed.entry.name,type:'text/plain',byteSize:0,truncated:false,text:''}; }
   if(!response.ok) { await response.body?.cancel().catch(()=>{}); return {state:fileRefusal(response)}; }
   const data=/** @type {Uint8Array} */(await boundedBytes(response,previewLimit,true));
   const whole=Number(/\/(\d+)$/.exec(response.headers.get('content-range')||'')?.[1]??listed.entry.size??data.byteLength);
   const byteSize=Number.isSafeInteger(whole)&&whole>=data.byteLength?whole:data.byteLength;
   const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()||'application/octet-stream';
   return {state:'found',name:listed.entry.name,type,byteSize,truncated:byteSize>previewLimit,text:looksBinary(data)?null:new TextDecoder().decode(data,{stream:byteSize>data.byteLength})};
  }
  const {response,result}=await manage(connection,`/api/fs/read-text?path=${encodeURIComponent(listed.path)}&profile=${encodeURIComponent(connection.profile)}`);
  // A file over the Engine's own read ceiling (413) is refused rather than read.
  if(!response.ok) return {state:fileRefusal(response)};
  if(result?.path!==listed.path) return {state:'missing'};
  if(typeof result?.text!=='string'||!Number.isSafeInteger(result?.byteSize)||typeof result?.mimeType!=='string') return {state:'failed'};
  return {state:'found',name:listed.entry.name,type:result.mimeType,byteSize:result.byteSize,truncated:result.truncated===true,text:result.binary===true?null:result.text};
 } catch { return {state:'unreachable'}; }
}
