import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { engineRequest, onProfile } from './transport.mjs';
import { mainAgentToolset } from '../agent-toolsets.mjs';
import { boundedJson, manage, query, reachable, refusal, stepState } from './wire.mjs';

// gtmworks's plugin of the main Agent's profile (#884, spec #865): its files are in ./gtmworks-plugin/, shipped with
// this release, and the worker keeps them in the main Agent's profile on its Company's Engine (lib/main-agent-plugin.mjs).
// Everything here goes through the Engine's own management listener with the Engine's key, as every other write of a
// profile does: the files through the managed files routes (v0.23.0 web_routers/files.py, under the Engine's data root),
// the plugin's name into the profile's `plugins.enabled` (user plugins are opt-in, hermes_cli/plugins.py), and a restart
// of the Engine's gateway (web_routers/actions.py POST /api/gateway/restart), which loads a profile's plugins only when it
// starts (docs/engine-probes/plugin-tool.md section 3). The Engine image is not changed, and the Engine opens no
// connection to the install for any of it.

const pluginName='gtmworks';
// Read from the app's own folder, where the image keeps lib/ whole (Dockerfile) and a checkout runs from.
const folder=join(process.cwd(),'lib','engine','gtmworks-plugin');

/** The plugin's files as this release ships them, by their path inside the plugin's folder.
 * @returns {Promise<{path:string,data:Buffer}[]>} */
export async function releasePlugin() {
 const names=/** @type {string[]} */(await readdir(folder,{recursive:true}));
 const files=[];
 for(const name of names.map(one=>one.split('\\').join('/')).sort()) {
  if(name.split('/').includes('__pycache__')) continue;
  const data=await readFile(join(folder,name)).catch(failure=>failure?.code==='EISDIR'?null:Promise.reject(failure));
  if(data) files.push({path:name,data});
 }
 return files;
}

// The plugin's revision: a digest of every file but plugin.yaml, which states it in its description. The Engine reports
// that description beside the plugin's toolset to a profile's Runs (GET /v1/toolsets), so the revision there is the one
// the running Engine loaded, not only the one on its disk (tests/main-agent-plugin.test.mjs holds plugin.yaml to it).
/** @param {{path:string,data:Buffer}[]} files */
export function pluginRevision(files) {
 const hash=createHash('sha256');
 for(const file of files.filter(one=>one.path!=='plugin.yaml')) hash.update(file.path).update('\0').update(file.data).update('\0');
 return hash.digest('hex').slice(0,12);
}

/** Whether the Engine offers this release's plugin to the profile's Runs: its toolset on, with this release's revision.
 * @param {any} connection @returns {Promise<{state:'found',offered:boolean,current:boolean}|{state:'missing'|'refused'|'unreachable'}>} */
export async function readOfferedPlugin(connection) {
 try {
  const response=await engineRequest(connection,{path:onProfile(connection.profile,'/v1/toolsets')});
  const result=await boundedJson(response);
  if(response.status===404) return {state:'missing'};
  if(!response.ok||!Array.isArray(result?.data)) return {state:[401,403].includes(response.status)?'refused':'unreachable'};
  const toolset=result.data.find(one=>one?.name===mainAgentToolset&&one.enabled===true);
  const revision=pluginRevision(await releasePlugin());
  return {state:'found',offered:!!toolset,current:!!toolset&&typeof toolset.description==='string'&&toolset.description.includes(`Revision ${revision}.`)};
 } catch { return {state:'unreachable'}; }
}

// The profile's own folder, as the Engine lists it (GET /api/profiles `path`); the plugin's folder is in it.
/** @param {any} connection @returns {Promise<{state:'found',folder:string}|{state:'missing'|'refused'|'unreachable'}>} */
async function profileFolder(connection) {
 const listed=await manage(connection,'/api/profiles');
 if(!listed.response.ok) return {state:refusal(listed.response)};
 const found=Array.isArray(listed.result?.profiles)?listed.result.profiles.find(one=>one?.name===connection.profile):null;
 if(!found) return {state:'missing'};
 return typeof found.path==='string'&&found.path.startsWith('/')?{state:'found',folder:`${found.path.replace(/\/+$/,'')}/plugins/${pluginName}`}:{state:'unreachable'};
}

/** What one placed file holds, or null when the Engine has none there. @param {any} connection @param {string} path */
async function placedFile(connection,path) {
 const response=await engineRequest(connection,{listener:'management',path:`/api/files/download?path=${encodeURIComponent(path)}`});
 if(response.status===404) { await response.body?.cancel().catch(()=>{}); return null; }
 if(!response.ok) { await response.body?.cancel().catch(()=>{}); throw Object.assign(new Error('unreadable'),{response}); }
 return Buffer.from(await response.arrayBuffer());
}

/** Whether the main Agent's profile holds this release's plugin, file for file, with its name enabled. `differs` lists
 * the files that are missing or not this release's, and whether the name is enabled.
 * @param {any} connection
 * @returns {Promise<{state:'placed'}|{state:'differs',files:string[],enabled:boolean}|{state:'missing'|'refused'|'unreachable'}>} */
export async function readMainAgentPlugin(connection) {
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const at=await profileFolder(connection);
  if(at.state!=='found') return at;
  const differs=[];
  for(const file of await releasePlugin()) {
   const placed=await placedFile(connection,`${at.folder}/${file.path}`);
   if(!placed||!placed.equals(file.data)) differs.push(file.path);
  }
  const config=await manage(connection,`/api/config${query(connection.profile)}`);
  if(!config.response.ok) return {state:refusal(config.response)};
  const enabled=Array.isArray(config.result?.plugins?.enabled)&&config.result.plugins.enabled.includes(pluginName);
  return differs.length===0&&enabled?{state:'placed'}:{state:'differs',files:differs,enabled};
 } catch(failure) { const response=/** @type {any} */(failure)?.response; return {state:response?refusal(response):'unreachable'}; }
}

/** This release's plugin written into the main Agent's profile, each file the Engine does not already hold as this
 * release ships it, and its name added to the profile's enabled plugins with the others kept. A step the Engine does not
 * apply fails the whole; the next pass writes what is still different.
 * @param {any} connection @param {{files:string[],enabled:boolean}} differs
 * @returns {Promise<{state:'placed'|'missing'|'refused'|'unreachable'|'failed'}>} */
export async function placeMainAgentPlugin(connection,{files,enabled}) {
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const at=await profileFolder(connection);
  if(at.state!=='found') return at;
  for(const file of (await releasePlugin()).filter(one=>files.includes(one.path))) {
   const written=await manage(connection,'/api/files/upload',{method:'POST',
    body:{path:`${at.folder}/${file.path}`,data_url:`data:application/octet-stream;base64,${file.data.toString('base64')}`,overwrite:true}});
   if(!written.response.ok||written.result?.ok!==true) return {state:stepState(written)};
  }
  if(!enabled) {
   const config=await manage(connection,`/api/config${query(connection.profile)}`);
   if(!config.response.ok) return {state:stepState(config)};
   const held=Array.isArray(config.result?.plugins?.enabled)?config.result.plugins.enabled.filter(name=>typeof name==='string'):[];
   const written=await manage(connection,`/api/config${query(connection.profile)}`,{method:'PUT',body:{config:{plugins:{enabled:[...new Set([...held,pluginName])]}}}});
   if(!written.response.ok||written.result?.ok!==true) return {state:stepState(written)};
  }
  return {state:'placed'};
 } catch { return {state:'unreachable'}; }
}

/** Whether the Engine is working a turn now (GET /api/status `gateway_busy`, its in-flight turns), so a restart would
 * stop it. An Engine that does not say is busy. @param {any} connection @returns {Promise<boolean>} */
export async function engineBusy(connection) {
 if(!reachable(connection)) return true;
 try {
  const status=await manage(connection,'/api/status');
  return !status.response.ok||status.result?.gateway_busy!==false;
 } catch { return true; }
}

/** The Engine's gateway restarted, which loads the plugin it now holds. @param {any} connection
 * @returns {Promise<{state:'restarting'|'refused'|'failed'|'unreachable'}>} */
export async function restartEngine(connection) {
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const restarted=await manage(connection,'/api/gateway/restart',{method:'POST'});
  return restarted.response.ok&&restarted.result?.ok===true?{state:'restarting'}:{state:stepState(restarted)};
 } catch { return {state:'unreachable'}; }
}

// The plugin's own route (gtmworks-plugin/dashboard/plugin_api.py), on the main Agent's profile.
const route=(connection,path)=>`/api/plugins/${pluginName}${path}${query(connection.profile)}`;

/** A session marked as an Owner's for `seconds` (the plugin keeps a mark a short while; none names its own default).
 * @param {any} connection @param {{session:string,person:string,seconds?:number}} mark
 * @returns {Promise<{state:'marked',until:number}|{state:'refused'|'failed'|'unreachable'}>} */
export async function markOwnerSession(connection,{session,person,seconds}) {
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const marked=await manage(connection,route(connection,'/owner-sessions'),{method:'POST',body:{session_id:session,person,...(seconds?{seconds}:{})}});
  return marked.response.ok&&marked.result?.ok===true&&typeof marked.result.until==='number'?{state:'marked',until:marked.result.until}:{state:stepState(marked)};
 } catch { return {state:'unreachable'}; }
}

/** The sessions the plugin holds as an Owner's now. @param {any} connection
 * @returns {Promise<{state:'found',sessions:{session:string,person:string,until:number}[]}|{state:'refused'|'failed'|'unreachable'}>} */
export async function readOwnerSessions(connection) {
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const response=await engineRequest(connection,{listener:'management',path:route(connection,'/owner-sessions')});
  const result=await boundedJson(response);
  if(!response.ok||!Array.isArray(result?.sessions)) return {state:[401,403].includes(response.status)?'refused':'failed'};
  return {state:'found',sessions:result.sessions.map(one=>({session:one.session_id,person:one.person,until:one.until}))};
 } catch { return {state:'unreachable'}; }
}
