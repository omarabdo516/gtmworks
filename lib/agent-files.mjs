import { engineOf } from './company-engine.mjs';
import { downloadAgentFile, libraryRoot, listAgentFiles, readAgentFile, workSegments } from './hermes.mjs';
import { filePreviewKind, pictureType } from './file-preview.mjs';

// The Library of an Agent (#194, ADR 0016, ADR 0017): the files saved in its own Engine profile, read through the Engine
// and never copied into gtmworks, and never named by an address or a path gtmworks holds. The Library has two roots
// (#353): `work`, the profile's work folder, and `images`, the folder the Engine writes a generated image into. `db` is
// the signed-in person's own session: company_app_agents lists the Agents they see and the profile each runs on, so a
// hidden Agent, another Company's Agent and an Agent with no profile are all missing here. Who may open the Library at
// all (the Owner and Managers) is the route's own check (lib/route-permissions.mjs). The profile never leaves this file.
const drivers={list:listAgentFiles,download:downloadAgentFile,read:readAgentFile};
// A Library answer here is one of: found (with the folder's entries), missing (no such Agent, Agent profile or folder),
// invalid (a root that is not the Library's, or a folder or a name that could leave it), refused (the Engine's key),
// unreachable, or tooLarge (a file over the size gtmworks serves as an attachment).
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Engine profile an Agent runs on, or null when this person does not see it in this Company.
/** @param {any} db @param {string} company @param {string} agent */
async function agentProfile(db,company,agent) {
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 if(error||!Array.isArray(data)) return null;
 return data.find(row=>row?.agent===agent&&typeof row.profile==='string')?.profile||null;
}

// Each folder of the folder read carries how many files it holds and when the newest of them was saved, as the reference
// writes a folder's row (#194; design-reference: filesWord and libraryHTML): the Engine lists a folder's entries, so a
// folder's own entries are read for it, inside the same root. A folder that cannot be read now keeps no count (null),
// which is not "Empty".
/** @param {{list:any}} driver @param {any} target @param {unknown} folder @param {'work'|'images'} root @param {import('./hermes.mjs').LibraryEntry[]} entries */
async function counted(driver,target,folder,root,entries) {
 const parent=typeof folder==='string'?folder:'';
 return await Promise.all(entries.map(async entry=>{
  if(!entry.isFolder) return {...entry,files:null,latest:null};
  const inside=await driver.list(target,parent?`${parent}/${entry.name}`:entry.name,root);
  if(inside.state!=='found') return {...entry,files:null,latest:null};
  const times=inside.entries.filter(item=>!item.isFolder&&typeof item.time==='string').map(item=>item.time).sort();
  return {...entry,files:inside.entries.filter(item=>!item.isFolder).length,latest:times.at(-1)??null};
 }));
}

// One folder of one of the Agent's Library roots ('' for the root itself), each entry with its name, whether it is a
// folder, its size and its time — and, for a folder, how many files it holds and when the newest was saved. A Company
// with no Engine of its own, or an Agent whose profile the Engine does not answer for, has nothing this page can show.
/** @param {any} db @param {{company:string,agent:unknown,folder?:unknown,root?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function agentLibrary(db,{company,agent,folder='',root='work',hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'missing',entries:null};
 const at=libraryRoot(root);
 if(!at) return {state:'invalid',entries:null};
 const profile=await agentProfile(db,company,agent);
 if(!profile||!hermes) return {state:'missing',entries:null};
 const use={list:driver.list||drivers.list,download:driver.download||drivers.download};
 const target={...hermes,profile};
 const read=await use.list(target,folder,at);
 if(read.state!=='found') return {state:read.state,entries:null};
 return {state:'found',entries:await counted(use,target,folder,at,read.entries)};
}

// One file of that folder, as bytes with its name and type, for the download route.
/** @param {any} db @param {{company:string,agent:unknown,folder?:unknown,name:unknown,root?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function agentFileDownload(db,{company,agent,folder='',name,root='work',hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'missing'};
 const at=libraryRoot(root);
 if(!at) return {state:'invalid'};
 const profile=await agentProfile(db,company,agent);
 if(!profile||!hermes) return {state:'missing'};
 return await (driver.download||drivers.download)({...hermes,profile},{folder,name,root:at});
}

// One file of that folder, as the preview may draw it (#195): its name, its kind (a picture, text, a table or none),
// its type, its whole size and whether more follows — and the text only for the kinds drawn as text. The folder is
// listed first, so the file must still be one of its entries, and a name that could leave the folder is refused before
// the Engine is asked. A picture and anything the dialog cannot draw are answered from that listed entry: their type
// from the name and their listed size, with no read of their bytes, because the Engine's read-text refuses a large file
// (413) where the dialog only needs its icon and Download. The Engine's own text is read for text and table kinds
// alone. A vector image or a page is `none` and its content never leaves this file, so no answer can carry something
// the dialog would not draw.
/** @param {any} db @param {{company:string,agent:unknown,folder?:unknown,name:unknown,root?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function agentFilePreview(db,{company,agent,folder='',name,root='work',hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'missing',preview:null};
 const at=libraryRoot(root);
 if(!at) return {state:'invalid',preview:null};
 const profile=await agentProfile(db,company,agent);
 if(!profile||!hermes) return {state:'missing',preview:null};
 const one=workSegments(name);
 if(!one||one.length!==1) return {state:'invalid',preview:null};
 const target={...hermes,profile};
 const list=await (driver.list||drivers.list)(target,folder,at);
 if(list.state!=='found') return {state:list.state,preview:null};
 const entry=list.entries.find(item=>item.name===name);
 if(!entry) return {state:'missing',preview:null};
 if(entry.isFolder) return {state:'invalid',preview:null};
 const picture=pictureType(entry.name);
 const kind=picture?'image':filePreviewKind(entry.name,'');
 const byteSize=Number.isSafeInteger(entry.size)&&entry.size>=0?entry.size:0;
 if(kind!=='text'&&kind!=='table') return {state:'found',preview:{name:entry.name,kind,type:picture||'application/octet-stream',
  byteSize,truncated:false,text:null}};
 const read=await (driver.read||drivers.read)(target,{folder,name,root:at});
 if(read.state!=='found') return {state:read.state,preview:null};
 const drawn=filePreviewKind(read.name,read.type);
 return {state:'found',preview:{name:read.name,kind:drawn,type:read.type,byteSize:read.byteSize,truncated:read.truncated,
  text:drawn==='text'||drawn==='table'?read.text:null}};
}
