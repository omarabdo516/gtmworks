import { hermesAt } from './bundled-hermes.mjs';
import { downloadAgentFile, listAgentFiles, readAgentFile } from './hermes.mjs';
import { filePreviewKind } from './file-preview.mjs';

// The Library of an Agent (#194, ADR 0016, ADR 0017): the files saved in its own Engine profile's work folder, read
// through the Engine and never copied into gtmworks, and never named by an address or a path gtmworks holds. `db` is
// the signed-in person's own session: company_app_agents lists the Agents they see and the profile each runs on, so a
// hidden Agent, another Company's Agent and an Agent with no profile are all missing here. Who may open the Library at
// all (the Owner and Managers) is the route's own check (lib/route-permissions.mjs). The profile never leaves this file.
const drivers={list:listAgentFiles,download:downloadAgentFile,read:readAgentFile};
// A Library answer here is one of: found (with the folder's entries), missing (no such Agent, Agent profile or folder),
// invalid (a folder or a name that could leave the work folder), refused (the Engine's key), unreachable, or tooLarge
// (a file over the size gtmworks serves as an attachment).
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
// folder's own entries are read for it. A folder that cannot be read now keeps no count (null), which is not "Empty".
/** @param {{list:any}} driver @param {any} target @param {unknown} folder @param {import('./hermes.mjs').LibraryEntry[]} entries */
async function counted(driver,target,folder,entries) {
 const parent=typeof folder==='string'?folder:'';
 return await Promise.all(entries.map(async entry=>{
  if(!entry.isFolder) return {...entry,files:null,latest:null};
  const inside=await driver.list(target,parent?`${parent}/${entry.name}`:entry.name);
  if(inside.state!=='found') return {...entry,files:null,latest:null};
  const times=inside.entries.filter(item=>!item.isFolder&&typeof item.time==='string').map(item=>item.time).sort();
  return {...entry,files:inside.entries.filter(item=>!item.isFolder).length,latest:times.at(-1)??null};
 }));
}

// One folder of the Agent's work folder ('' for the work folder itself), each entry with its name, whether it is a
// folder, its size and its time — and, for a folder, how many files it holds and when the newest was saved. A Company
// with no Engine of its own, or an Agent whose profile the Engine does not answer for, has nothing this page can show.
/** @param {any} db @param {{company:string,agent:unknown,folder?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function agentLibrary(db,{company,agent,folder='',hermes=hermesAt(),driver={}}) {
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'missing',entries:null};
 const profile=await agentProfile(db,company,agent);
 if(!profile||!hermes) return {state:'missing',entries:null};
 const use={list:driver.list||drivers.list,download:driver.download||drivers.download};
 const target={...hermes,profile};
 const read=await use.list(target,folder);
 if(read.state!=='found') return {state:read.state,entries:null};
 return {state:'found',entries:await counted(use,target,folder,read.entries)};
}

// One file of that folder, as bytes with its name and type, for the download route.
/** @param {any} db @param {{company:string,agent:unknown,folder?:unknown,name:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function agentFileDownload(db,{company,agent,folder='',name,hermes=hermesAt(),driver={}}) {
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'missing'};
 const profile=await agentProfile(db,company,agent);
 if(!profile||!hermes) return {state:'missing'};
 return await (driver.download||drivers.download)({...hermes,profile},{folder,name});
}

// One file of that folder, as the preview may draw it (#195): its name, its kind (a picture, text, a table or none),
// its type, its whole size and whether more follows — and the text only for the kinds drawn as text. A vector image or
// a page is `none` and its content never leaves this file, so no answer can carry something the dialog would not draw.
/** @param {any} db @param {{company:string,agent:unknown,folder?:unknown,name:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function agentFilePreview(db,{company,agent,folder='',name,hermes=hermesAt(),driver={}}) {
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'missing',preview:null};
 const profile=await agentProfile(db,company,agent);
 if(!profile||!hermes) return {state:'missing',preview:null};
 const read=await (driver.read||drivers.read)({...hermes,profile},{folder,name});
 if(read.state!=='found') return {state:read.state,preview:null};
 const kind=filePreviewKind(read.name,read.type);
 return {state:'found',preview:{name:read.name,kind,type:read.type,byteSize:read.byteSize,truncated:read.truncated,
  text:kind==='text'||kind==='table'?read.text:null}};
}
