import { openCompanyCard, agentFileAt } from './company-card.mjs';
import { cardFileLimit } from './engine/handle.mjs';
import { pictureType } from './file-preview.mjs';

// A Card's files (spec #831, #843), added and read back through gtmworks, never by an address the browser holds of the
// Engine. Both go through the Card as its reader may see it (openCompanyCard), so a Card of an Agent hidden from them, or
// another Company's, has no file for them either.
//
// - A person adds a file: it becomes a Kanban attachment on the Company's Engine, under the person's name (the Engine
//   has no identity of its own for them, as for a comment). The Engine's own cap is checked before anything is sent.
//   The Engine keeps it in its Kanban attachments folder, which the install mounts read-only into the Company's work
//   sandbox at the same path (scripts/engine-template.yml), so the Agent working the Card opens it where its prompt names
//   it, and nothing in the sandbox can write there (ADR 0018).
// - A file is read back by its key on the Card: `a<id>` is a person's, read from the Engine by that id once the Card is
//   found to hold it; any other key is a file an Agent named by a MEDIA line (ADR 0028), read from that Agent's own work
//   folder in the sandbox through the Library's guarded download. gtmworks keeps no copy of either.
// The type a file is served with is a raster image's, by its name, so it is drawn inline; anything else downloads
// (lib/attachments.mjs attachmentHeaders).

export { cardFileLimit };
const nameLimit=255;

/**
 * @param {any} db the person's own session @param {{company:string,card:unknown,person:string,file:{name:unknown,type:unknown,body:Uint8Array}}} added
 * @returns {Promise<{state:'attached'}|{state:'invalid'|'tooLarge'|'missing'|'archived'|'noEngine'|'unreachable'|'failed'}>}
 */
export async function addCardFile(db,{company,card,person,file}) {
 const name=typeof file.name==='string'?file.name.trim().replace(/[\\/]/g,'_').slice(0,nameLimit):'';
 if(!name||!file.body.byteLength) return {state:'invalid'};
 if(file.body.byteLength>cardFileLimit) return {state:'tooLarge'};
 const open=await openCompanyCard(db,{company,card});
 if(open.state!=='found') return {state:open.state==='refused'?'unreachable':open.state};
 if(open.card.archived) return {state:'archived'};
 const {data:who,error}=await db.from('people').select('name').eq('id',person).maybeSingle();
 if(error||!who) return {state:'failed'};
 const type=typeof file.type==='string'&&/^[\w.+-]+\/[\w.+-]+$/.test(file.type)?file.type.toLowerCase():'application/octet-stream';
 const added=await open.engine.board.attach({id:open.task.id,name,type,body:file.body,by:String(who.name||'').trim().slice(0,200)||'A Member'});
 if(added.state==='attached') return {state:'attached'};
 return {state:added.state==='refused'?'unreachable':added.state};
}

/**
 * One file of a Card, by its key: its name, the type it is served with and its bytes.
 * @param {any} db the reader's own session @param {{company:string,card:unknown,file:unknown}} asked
 * @returns {Promise<{state:'found',name:string,type:string,body:Uint8Array}|{state:'missing'|'notNow'|'tooLarge'|'noEngine'|'unreachable'|'failed'}>}
 */
export async function readCardFile(db,{company,card,file}) {
 if(typeof file!=='string'||!/^(a\d{1,12}|s\d{1,3}|c\d{1,12}-\d{1,3})$/.test(file)) return {state:'missing'};
 const open=await openCompanyCard(db,{company,card});
 if(open.state==='invalid'||open.state==='missing') return {state:'missing'};
 if(open.state!=='found') return {state:open.state==='refused'?'unreachable':open.state};
 const served=(/** @type {string} */ name)=>pictureType(name)||'application/octet-stream';
 if(file.startsWith('a')) {
  const kept=open.task.attachments.find(row=>row.id===Number(file.slice(1)));
  if(!kept) return {state:'missing'};
  const read=await open.engine.board.file(kept.id);
  if(read.state!=='found') return {state:read.state==='refused'?'unreachable':read.state};
  return {state:'found',name:kept.name,type:served(kept.name),body:read.body};
 }
 // An Agent's file is served only as the Card lists it: one an Agent hidden from the reader named is not theirs to read.
 const listed=open.card.files.find(found=>found.key===file);
 const tag=listed?.by&&'agent' in listed.by&&listed.by.agent?open.tags.find(found=>found.key===file):undefined;
 const at=tag?agentFileAt(tag):null;
 const agent=at&&tag?open.engine.on(tag.profile):null;
 if(!at||!agent) return {state:'missing'};
 const read=await agent.files.download({...at,root:'work'});
 // The work sandbox stopped, or its Engine not answering, is a file that cannot be read now, never one that is gone.
 if(read.state==='unreachable') return {state:'notNow'};
 if(read.state==='tooLarge') return {state:'tooLarge'};
 if(read.state!=='found') return {state:read.state==='refused'?'unreachable':'missing'};
 return {state:'found',name:read.name,type:served(read.name),body:read.body};
}
