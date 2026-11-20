import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { everyAgentGets, noAgentGets, toolConfig, fixedToolsets, toolsDiffer, profileSettingsDiffer, childToolsets, forbiddenOf, companyProfile, isAgentProfile, workFolder } from '../lib/agent-toolsets.mjs';

// The toolsets the pinned release names (toolsets.py, TOOLSETS keys of v0.23.0), so a misspelt name fails here instead of
// being ignored by Hermes.
const pinnedToolsets=['web','search','x_search','vision','video','image_gen','video_gen','computer_use','terminal','skills','browser','cronjob','file','tts','todo','memory','context_engine',
 'session_search','connections','project','bot_room','desktop_ui','onboarding','catalog','clarify','code_execution','delegation','kanban','debugging','safe','coding'];

test('every Agent gets the terminal, files and code in the work sandbox beside the fixed set', () => {
 // ADR 0018: web, vision, image generation, skills, the task list, memory, session search, the question tool,
 // scheduled work, and the work sandbox's terminal, files and code execution (#393), read as one literal list so a
 // change is seen here.
 assert.deepEqual([...everyAgentGets],['web','vision','image_gen','skills','todo','memory','session_search','clarify','cronjob',
  'terminal','file','code_execution']);
 for(const name of [...everyAgentGets,...noAgentGets]) assert.ok(pinnedToolsets.includes(name),name);
 const config=toolConfig();
 assert.deepEqual(config.platform_toolsets.api_server,[...everyAgentGets]);
 for(const name of ['terminal','file','code_execution']) assert.ok(!config.agent.disabled_toolsets.includes(name),`${name} is offered`);
 assert.deepEqual(fixedToolsets(),[...everyAgentGets]);
 // Every Agent's commands start in the Company's one work folder, and its code runs with no person to approve each call.
 assert.equal(workFolder,'/work');
 assert.deepEqual(config.terminal,{cwd:'/work'});
 assert.deepEqual(config.approvals,{unattended_mode:'approve'});
});

test('a profile is the fixed work folder and approval mode, or it is written again', () => {
 assert.equal(profileSettingsDiffer(toolConfig()),false);
 assert.equal(profileSettingsDiffer({terminal:{cwd:'/work'},approvals:{unattended_mode:'approve'}}),false);
 assert.equal(profileSettingsDiffer({terminal:{cwd:'/work/ag-other'},approvals:{unattended_mode:'approve'}}),true,'another start folder');
 assert.equal(profileSettingsDiffer({terminal:{cwd:'.'},approvals:{unattended_mode:'approve'}}),true,'the Engine\'s own disk');
 assert.equal(profileSettingsDiffer({terminal:{cwd:'/work'}}),true,'a profile that would ask a person to approve each call');
 assert.equal(profileSettingsDiffer({approvals:{unattended_mode:'deny'},terminal:{cwd:'/work'}}),true);
});

test('no Agent gets a switch for browser, computer_use, speech, video, project, desktop, catalog, onboarding, kanban or connections', () => {
 assert.deepEqual([...noAgentGets],['browser','computer_use','tts','video','video_gen','project','desktop_ui','catalog','onboarding','kanban','connections']);
 for(const subagents of [false,true]) {
  const config=toolConfig({subagents});
  for(const name of noAgentGets) {
   assert.ok(!config.platform_toolsets.api_server.includes(name),`${name} is never offered`);
   assert.ok(config.agent.disabled_toolsets.includes(name),`${name} is always disabled`);
  }
  assert.equal(config.platform_toolsets.api_server.some(name=>config.agent.disabled_toolsets.includes(name)),false);
 }
 assert.deepEqual(forbiddenOf(['web','browser','terminal','tts','project']),['browser','tts','project']);
});

test('sub-agents stay the Owner\'s switch per Agent, and a child never gains what its parent was not offered', () => {
 const off=toolConfig();
 assert.ok(!off.platform_toolsets.api_server.includes('delegation'));
 assert.ok(off.agent.disabled_toolsets.includes('delegation'));
 const on=toolConfig({subagents:true});
 assert.deepEqual(on.platform_toolsets.api_server,[...everyAgentGets,'delegation']);
 assert.ok(!on.agent.disabled_toolsets.includes('delegation'));
 const child=childToolsets(on);
 assert.ok(!child.toolsets.includes('delegation')&&!child.toolsets.includes('kanban'));
 assert.ok(child.disabled.includes('delegation'));
 for(const name of noAgentGets) assert.ok(child.disabled.includes(name),`a child keeps ${name} off`);
 // A child works in the same sandbox as its parent: the sandbox's tools are its own, not a switch delegation turns on.
 for(const name of ['terminal','file','code_execution']) assert.ok(child.toolsets.includes(name),`a child keeps ${name}`);
 assert.ok(childToolsets(off).disabled.includes('delegation'));
});

test('a read-back is the fixed set only when it is exactly it, with no forbidden tool on', () => {
 assert.equal(toolsDiffer(fixedToolsets()),false);
 assert.equal(toolsDiffer([...fixedToolsets()].reverse()),false,'order does not matter');
 assert.equal(toolsDiffer([...fixedToolsets(),'browser']),true,'a forbidden tool on is never the fixed set');
 assert.equal(toolsDiffer(fixedToolsets().filter(name=>name!=='cronjob')),true,'a missing fixed tool is not it');
 assert.equal(toolsDiffer([...fixedToolsets(),'x_search']),true,'a tool the module places nowhere is not it');
 assert.equal(toolsDiffer(fixedToolsets({subagents:true}),{subagents:false}),true,'the sub-agent variant is its own set');
 assert.equal(toolsDiffer(fixedToolsets({subagents:true}),{subagents:true}),false);
 // The terminal, files and code are part of the fixed set now, so their absence is a difference like any other.
 for(const name of ['terminal','file','code_execution']) assert.equal(toolsDiffer(fixedToolsets().filter(toolset=>toolset!==name)),true,`a missing ${name} is not the fixed set`);
});

test('a Company\'s own App is beside the fixed set, and a toolset the Engine adds later is not', () => {
 // An App (#30) is an MCP server gtmworks wrote into the profile's config, which an Engine may report as a toolset of
 // its own under the server's name or the registry's `mcp-<server>`. It is not part of the fixed set, and the check lets
 // it be instead of looping on a Company that connected one. Any other toolset on is a tool the module places nowhere.
 assert.equal(toolsDiffer([...fixedToolsets(),'klaviyo'],{apps:['klaviyo']}),false);
 assert.equal(toolsDiffer([...fixedToolsets(),'mcp-klaviyo'],{apps:['klaviyo']}),false);
 assert.equal(toolsDiffer([...fixedToolsets(),'klaviyo'],{apps:[]}),true,'an App toolset the Company does not have is a difference');
 assert.equal(toolsDiffer([...fixedToolsets(),'acme'],{apps:['klaviyo']}),true,'a toolset the Engine added later is a difference');
 assert.equal(toolsDiffer(fixedToolsets().filter(name=>name!=='web').concat('klaviyo'),{apps:['klaviyo']}),true,'and an App covers no fixed tool that is missing');
 // A toolset no Agent gets is never let through, whatever an App is called.
 assert.equal(toolsDiffer([...fixedToolsets(),'browser'],{apps:['browser']}),true);
 assert.equal(toolsDiffer([...fixedToolsets(),'mcp-browser'],{apps:['browser']}),true);
});

test('the sandbox tools are one place only: no caller can ask for a fixed set without them', () => {
 // #392 held terminal, files and code back until a sandbox existed; #393 gives every Company one, so the module offers
 // them always. A `sandbox: false` option would be a way to run an Agent's code on the Engine's own disk again.
 const config=toolConfig();
 assert.equal(Object.hasOwn(config,'sandbox'),false);
 assert.equal(toolConfig({sandbox:false}).platform_toolsets.api_server.includes('terminal'),true);
 for(const name of ['terminal','file','code_execution']) assert.ok(toolsDiffer([...everyAgentGets,...noAgentGets].filter(toolset=>toolset!==name)),`${name} missing`);
});

test('a profile name is the Company\'s and an Agent\'s, and nothing else is one', () => {
 assert.equal(companyProfile('10000000-0000-0000-0000-000000000002'),'co-10000000000000000000000000000002');
 assert.match(companyProfile('ABCDEF01-2345-4678-9abc-def012345678'),/^[a-z0-9][a-z0-9_-]{0,63}$/);
 for(const bad of ['default','',null,'10000000-0000-0000-0000-00000000000']) assert.throws(()=>companyProfile(bad),/companyInvalid/);
 assert.ok(isAgentProfile('ag-a0000000000000000000000000000001'));
 for(const bad of ['default','co-a0000000000000000000000000000001','ag-1','']) assert.equal(isAgentProfile(bad),false,bad);
});

// The names of the old shape are gone from the code that runs, its scripts, its tests, both message catalogues and the
// database tests. A database migration is history and keeps its own words; the Company's log still reads past level
// changes by their name (agent_level_changed), and one database test names the gone column and function to prove they
// are gone.
const sources=(directory,pattern=/\.(mjs|js|ts|tsx)$/)=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
 if(entry.name==='node_modules'||entry.name==='ci-logs'||entry.name.startsWith('.')) return [];
 const path=`${directory}/${entry.name}`;
 if(entry.isDirectory()) return sources(path,pattern);
 return pattern.test(entry.name)?[path]:[];
});

test('no level route, level function, policy copy or level setting is left in the code', () => {
 const gone=[
  [/set_agent_level/, 'set_agent_level'],
  [/engine_tool_policy/, 'engine_tool_policy'],
  [/\bagent_level\b(?!_changed)/, 'the agent_level column'],
  [/agent-levels\.mjs/, 'lib/agent-levels.mjs'],
  [/agent-level\/route/, 'the level route'],
  [/\b(levelConfig|levelToolsets|agentLevels|toolPolicy|riskyToolsets|riskyOf)\b/, 'the level table'],
  [/agentLevel(Title|Hint|OwnerOnly|NotAllowed|Invalid)/, 'the level setting'],
  [/agentLevelPending/, 'the level-pending error'],
 ];
 // Both message catalogues are read as text, so a level setting that only survives in one language fails here too.
 const files=[...sources('app'),...sources('lib'),...sources('scripts'),...sources('worker'),...sources('tests'),
  ...sources('lib/messages',/\.json$/),...sources('supabase/tests',/\.sql$/)]
  .filter(file=>!file.endsWith('tests/agent-toolsets.test.mjs')&&file!=='supabase/tests/company_profiles.sql');
 for(const file of files) {
  const text=readFileSync(file,'utf8');
  for(const [pattern,name] of gone) assert.doesNotMatch(text,pattern,`${file} still names ${name}`);
 }
});
