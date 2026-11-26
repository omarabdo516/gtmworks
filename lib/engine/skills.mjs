import { agentName, manage, query, reachable, refusal, stepState } from './wire.mjs';

// A Company's shared space (ADR 0016), `cs-<company id>`: a profile made with no bundled Skills and never given a Run
// API key, so the Engine refuses every Run on it (v0.23.0 gateway/platforms/api_server.py 1413-1434). Its own Skills
// folder, as the Engine lists the profile's home, is the folder every Agent profile of the Company reads. A space
// already there under the reserved name is the same space.
export const spaceName=/^cs-[0-9a-f]{32}$/;
/** @param {any} connection @param {{name:string}} space */
export async function provideSharedSpace(connection,{name}) {
 const none=state=>({state,folder:null});
 if(!spaceName.test(name)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,no_skills:true}});
  const exists=made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists');
  if(!exists&&(!made.response.ok||made.result?.ok!==true||made.result.name!==name)) return none(stepState(made));
  const listed=await manage(connection,'/api/profiles');
  if(!listed.response.ok) return none(stepState(listed));
  const home=Array.isArray(listed.result?.profiles)?listed.result.profiles.find(found=>found?.name===name)?.path:undefined;
  if(typeof home!=='string'||!home.startsWith('/')||!home.endsWith(`/${name}`)) return none('failed');
  return {state:'provided',folder:`${home}/skills`};
 } catch { return none('unreachable'); }
}
// The space's Skill as the Engine keeps it: found with its text, absent when the space has none by that name, missing
// when the Engine no longer has the space.
/** @param {any} connection @param {{space:string,name:string}} skill */
export async function readSharedSkill(connection,{space,name}) {
 if(!spaceName.test(space)||!agentName.test(name)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const read=await manage(connection,`/api/skills/content${query(space)}&name=${encodeURIComponent(name)}`);
  if(read.response.ok&&typeof read.result?.content==='string') return {state:'found',content:read.result.content};
  if(read.response.status===404) return {state:typeof read.result?.detail==='string'&&read.result.detail.includes('does not exist')?'missing':'absent'};
  return {state:stepState(read)};
 } catch { return {state:'unreachable'}; }
}
// One of a profile's own Skills' text (#181), as the Engine serves that profile's SKILL.md (v0.23.0
// hermes_cli/web_routers/skills.py 436-455): found with its text, absent when the profile has none by that name, and
// refused, unreachable or failed as every read is. Only a Company's or an Agent's own profile is asked.
/** @param {any} connection @param {{name:string}} skill */
export async function readOwnSkill(connection,{name}) {
 if(!ownProfile.test(connection.profile)||!agentName.test(name)) return {state:'failed',content:null};
 if(!reachable(connection)) return {state:'unreachable',content:null};
 try {
  const read=await manage(connection,`/api/skills/content${query(connection.profile)}&name=${encodeURIComponent(name)}`);
  if(read.response.ok&&typeof read.result?.content==='string') return {state:'found',content:read.result.content};
  if(read.response.status===404) return {state:'absent',content:null};
  return {state:stepState(read),content:null};
 } catch { return {state:'unreachable',content:null}; }
}
// The space's Skill, written through the space's own profile (v0.23.0 hermes_cli/web_routers/skills.py 436-483): made
// when the space has none, else rewritten whole, then read back. The same text is never written again. A space the
// Engine no longer has is missing.
// With onlyNew, a Skill the space already has is left as it is (unchanged).
/** @param {any} connection @param {{space:string,name:string,content:string,onlyNew?:boolean}} skill */
export async function writeSharedSkill(connection,{space,name,content,onlyNew=false}) {
 if(!spaceName.test(space)||!agentName.test(name)||typeof content!=='string') return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 const read=()=>manage(connection,`/api/skills/content${query(space)}&name=${encodeURIComponent(name)}`);
 try {
  const before=await read();
  if(before.response.ok&&(onlyNew||before.result?.content===content)) return {state:'unchanged'};
  if(before.response.status===404&&typeof before.result?.detail==='string'&&before.result.detail.includes('does not exist')) return {state:'missing'};
  if(!before.response.ok&&before.response.status!==404) return {state:stepState(before)};
  const written=before.response.ok?await manage(connection,`/api/skills/content${query(space)}`,{method:'PUT',body:{name,content}})
   :await manage(connection,`/api/skills${query(space)}`,{method:'POST',body:{name,content}});
  // Another worker made it first: the read-back decides.
  const raced=written.response.status===400&&typeof written.result?.detail==='string'&&written.result.detail.includes('already exists');
  if(!raced&&(!written.response.ok||written.result?.success!==true)) return {state:stepState(written)};
  const after=await read();
  return {state:after.response.ok&&after.result?.content===content?'written':'failed'};
 } catch { return {state:'unreachable'}; }
}
// A Company's own profile or an Agent's reads the Company's shared folder and no other (skills.external_dirs), loads the
// shared Skill in each new session (skills.auto_load; v0.23.0 hermes_cli/config_defaults.py 1434 and 1445-1448) and
// holds it locked, so the Agent's own skill_manage refuses to change it (tools/skill_manager_guards.py 224-258). Both are
// read back. A lock the Engine cannot place, or a Skill the profile does not list at all, means the space or its Skill
// was lost: missing.
/** @param {any} connection @param {{profile:string,folder:string,skill:string}} sharing */
export async function shareSkills(connection,{profile,folder,skill}) {
 if(!/^(co|ag)-[0-9a-f]{32}$/.test(profile)||typeof folder!=='string'||!folder.startsWith('/')||!agentName.test(skill)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 const at=query(profile);
 try {
  const config=await manage(connection,`/api/config${at}`);
  if(!config.response.ok) return {state:stepState(config)};
  const loaded=Array.isArray(config.result?.skills?.auto_load)?config.result.skills.auto_load.filter(name=>typeof name==='string'&&name!==skill):[];
  const written=await manage(connection,`/api/config${at}`,{method:'PUT',body:{config:{skills:{external_dirs:[folder],auto_load:[...loaded,skill]}}}});
  if(!written.response.ok||written.result?.ok!==true) return {state:stepState(written)};
  const locked=await manage(connection,`/api/skills/lock${at}`,{method:'PUT',body:{name:skill,locked:true}});
  if(locked.response.status===404) return {state:'missing'};
  if(!locked.response.ok||locked.result?.ok!==true||locked.result.locked!==true) return {state:stepState(locked)};
  const [kept,listed]=[await manage(connection,`/api/config${at}`),await manage(connection,`/api/skills${at}`)];
  for(const read of [kept,listed]) if(!read.response.ok) return {state:stepState(read)};
  const dirs=kept.result?.skills?.external_dirs; const loads=kept.result?.skills?.auto_load;
  if(!Array.isArray(dirs)||dirs.length!==1||dirs[0]!==folder||!Array.isArray(loads)||!loads.includes(skill)) return {state:'failed'};
  const found=Array.isArray(listed.result)?listed.result.find(row=>row?.name===skill):undefined;
  // A Skill of the profile's own under the same name comes first (v0.23.0 agent/skill_utils.py 402-424): it is kept, and
  // only this profile stays unconfirmed.
  if(found&&found.provenance!=='external') return {state:'shadowed'};
  if(!found) return {state:'missing'};
  return {state:found.locked===true?'shared':'failed'};
 } catch { return {state:'unreachable'}; }
}

// An Agent's skills are its profile's own (#343, ADR 0011): listed as the Engine lists them, in its order, each with what
// the Engine says of it (v0.23.0 hermes_cli/web_routers/skills.py). The shared folder's skills are marked shared and
// kept off every page's own list (#180). The Engine's essential skill (#180: agent/skill_utils.py ESSENTIAL_SKILLS) is
// always on and carries the Engine's name, which no page may show, so it is left out here. Only a Company's or an
// Agent's profile is read.
export const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;
export const essentialSkill='hermes-agent';
/** @param {any} connection */
export async function readSkills(connection) {
 const none=state=>({state,skills:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const listed=await manage(connection,`/api/skills${query(connection.profile)}`);
  if(!listed.response.ok) return none(refusal(listed.response));
  if(!Array.isArray(listed.result)) return none('failed');
  return {state:'found',skills:listed.result.filter(row=>typeof row?.name==='string'&&row.name!==essentialSkill).map(row=>({
   name:row.name,description:typeof row.description==='string'?row.description:'',category:typeof row.category==='string'?row.category:null,
   locked:row.locked===true,provenance:typeof row.provenance==='string'?row.provenance:'agent',shared:row.provenance==='external',enabled:row.enabled!==false}))};
 } catch { return none('unreachable'); }
}

// What the Engine says an Agent learned on its own (#180): the skill nodes of its learning graph whose `createdBy` is
// "agent" (v0.23.0 web_routers/status.py 746, agent/learning_graph.py 218-245). `createdBy` covers agent-written and
// hand-made skills alike, so it is the Engine's own claim, not proof. Names only: the page draws the mark, no version.
/** @param {any} connection */
export async function readLearningGraph(connection) {
 const none=state=>({state,learned:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const graph=await manage(connection,`/api/learning/graph${query(connection.profile)}`);
  if(!graph.response.ok) return none(refusal(graph.response));
  if(!Array.isArray(graph.result?.nodes)) return none('failed');
  return {state:'found',learned:graph.result.nodes.filter(node=>node?.kind==='skill'&&node.createdBy==='agent'&&typeof node.id==='string').map(node=>node.id)};
 } catch { return none('unreachable'); }
}
// A SKILL.md written into the profile's own skills: made when it has none of that name, else rewritten whole, then read
// back. A skill of the shared folder is never written from here. In this and the four changes below, an answer given
// before the Engine was asked to change anything carries unsent, so a failed or unreachable one is known to have
// changed nothing (#370: lib/agent-change-log.mjs keeps the held log record of any other).
/** @param {any} connection @param {{name:string,content:string}} skill */
export async function writeSkill(connection,{name,content}) {
 if(!ownProfile.test(connection.profile)||!agentName.test(name)||typeof content!=='string') return {state:'failed',unsent:true};
 const listed=await readSkills(connection);
 if(listed.state!=='found') return {state:listed.state,unsent:true};
 const found=listed.skills.find(skill=>skill.name===name);
 if(found?.shared) return {state:'shared'};
 const at=query(connection.profile);
 try {
  const written=found?await manage(connection,`/api/skills/content${at}`,{method:'PUT',body:{name,content}})
   :await manage(connection,`/api/skills${at}`,{method:'POST',body:{name,content}});
  if(!written.response.ok||written.result?.success!==true) return {state:stepState(written)};
  // The Engine acknowledged the write: a read-back that fails or differs is still answered as failed, and says the
  // write itself was taken (acknowledged), so its held log record is finished (#370).
  const after=await manage(connection,`/api/skills/content${at}&name=${encodeURIComponent(name)}`).catch(()=>null);
  return after?.response.ok&&after.result?.content===content?{state:'written'}:{state:'failed',acknowledged:true};
 } catch { return {state:'unreachable'}; }
}

// One of the profile's own skills switched off or on for that profile alone (v0.23.0 web_routers/skills.py 418,
// PUT /api/skills/toggle: the profile's skills.disabled). A skill of the shared folder is never switched from here, and
// the Engine's essential skill is always on: it is refused here, before the Engine is asked (#180).
/** @param {any} connection @param {{name:string,enabled:boolean}} skill */
export async function setSkillEnabled(connection,{name,enabled}) {
 if(!ownProfile.test(connection.profile)||!agentName.test(name)||typeof enabled!=='boolean') return {state:'failed',unsent:true};
 if(name===essentialSkill) return {state:'essential'};
 const listed=await readSkills(connection);
 if(listed.state!=='found') return {state:listed.state,unsent:true};
 const found=listed.skills.find(skill=>skill.name===name);
 if(!found) return {state:'failed',unsent:true};
 if(found.shared) return {state:'shared'};
 try {
  const toggled=await manage(connection,`/api/skills/toggle${query(connection.profile)}`,{method:'PUT',body:{name,enabled}});
  return {state:toggled.response.ok&&toggled.result?.ok===true&&toggled.result.enabled===enabled?'changed':stepState(toggled)};
 } catch { return {state:'unreachable'}; }
}
