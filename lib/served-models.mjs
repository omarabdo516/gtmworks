// The models a key provider serves to one key, read from the provider itself (#643). The pinned Engine lists a key
// provider's models from a live read merged with its own catalogue, so for OpenCode Go it also lists older ids OpenCode
// refuses ("Model mimo-v2-omni isn't included in OpenCode Go"; v0.23.0 hermes_cli/models.py merge_profile_catalog). A
// provider here answers GET <base>/models with the ids the key may run, and that list, not the Engine's, is what a
// Company is offered. Each provider's key and address variables are the Engine's own (hermes_cli/auth.py 225-226), so the
// list is read where the Engine sends its requests.

/** @type {Record<string,{keyEnv:string,baseEnv:string,base:string}>} */
const listed={'opencode-go':{keyEnv:'OPENCODE_GO_API_KEY',baseEnv:'OPENCODE_GO_BASE_URL',base:'https://opencode.ai/zen/go/v1'}};

/** Whether this provider's models are the ones it serves to the key, read from the provider. @param {string} provider */
export const servesOwnList=provider=>Object.hasOwn(listed,provider);
/** The Engine's variables that name the provider's key and address, or null for a provider that keeps the Engine's list. @param {string} provider */
export const servedListOf=provider=>servesOwnList(provider)?listed[provider]:null;

// A list read is kept a few minutes per provider, address and key, so a Settings page that reads every Agent's profile
// asks the provider once. Only a digest of the key is kept.
const keepFor=5*60*1000;
/** @type {Map<string,{at:number,ids:string[]}>} */
const kept=new Map();
/** @param {string} text */
async function digest(text) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

// The ids the provider serves to `key` at `base`, or null when it did not answer with a list: the caller then keeps the
// Engine's list rather than offering nothing.
/** @param {{provider:string,key:string,base?:string|null}} read @returns {Promise<string[]|null>} */
export async function readServedModels({provider,key,base}) {
 const source=servedListOf(provider);
 if(!source||typeof key!=='string'||!key.trim()) return null;
 let address;
 try {
  const url=new URL(typeof base==='string'&&base.trim()?base.trim():source.base);
  if(!['https:','http:'].includes(url.protocol)) return null;
  address=`${url.href.replace(/\/$/,'')}/models`;
 } catch { return null; }
 const at=`${provider}\u0000${address}\u0000${await digest(key)}`;
 const known=kept.get(at);
 if(known&&Date.now()-known.at<keepFor) return known.ids;
 try {
  const response=await fetch(address,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok) return null;
  const body=await response.json();
  if(!Array.isArray(body?.data)) return null;
  const ids=[...new Set(body.data.map(row=>typeof row?.id==='string'?row.id.trim():'').filter(id=>id&&id.length<=200))];
  if(!ids.length) return null;
  kept.set(at,{at:Date.now(),ids});
  return ids;
 } catch { return null; }
}

// The Engine's models for the provider kept to those it serves (case aside, as the Engine compares ids), in the Engine's
// order. Unchanged when the served list is unknown.
/** @param {string[]} models @param {string[]|null} served */
export function keepServed(models,served) {
 if(!served) return models;
 const ids=new Set(served.map(id=>id.toLowerCase()));
 return models.filter(model=>ids.has(model.toLowerCase()));
}
