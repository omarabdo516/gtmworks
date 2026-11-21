import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// #485: every Claude Code cloud session brings the whole local app up with one repo-owned command. The SessionStart hook
// (scripts/cloud-session-setup.sh) prepares the machine; `npm run cloud:up` starts the stack and the app.
const root=process.cwd();
const json=path=>JSON.parse(readFileSync(join(root,path),'utf8'));

// A copy of the hook script in a folder of its own, with stand-ins for npm, docker, dockerd and pgrep that write each
// call to calls.log: what the script would run, with nothing installed or started.
function machine() {
 const dir=mkdtempSync(join(tmpdir(),'cloud-session-'));
 mkdirSync(join(dir,'scripts')); mkdirSync(join(dir,'bin'));
 copyFileSync(join(root,'scripts/cloud-session-setup.sh'),join(dir,'scripts/cloud-session-setup.sh'));
 writeFileSync(join(dir,'package-lock.json'),'{"lockfileVersion":3}\n');
 const stub=(name,body)=>{ writeFileSync(join(dir,'bin',name),`#!/usr/bin/env bash\necho "${name} $*" >> "${dir}/calls.log"\n${body}\n`); chmodSync(join(dir,'bin',name),0o755); };
 // Only the tools the script needs, so a machine without dockerd is one where the stand-in is gone.
 for(const tool of ['bash','cat','cut','dirname','id','mkdir','nohup','seq','setsid','sha256sum','sleep','tail','touch']) symlinkSync(execFileSync('bash',['-c',`command -v ${tool}`],{encoding:'utf8'}).trim(),join(dir,'bin',tool));
 stub('npm','mkdir -p node_modules');
 // No daemon answers until the stand-in dockerd has run once.
 stub('docker',`[[ -f "${dir}/dockerd-started" ]]`);
 stub('dockerd',`touch "${dir}/dockerd-started"`);
 stub('pgrep',`[[ -f "${dir}/dockerd-started" ]]`);
 const run=(args=[],env={})=>spawnSync('bash',[join(dir,'scripts/cloud-session-setup.sh'),...args],{cwd:dir,encoding:'utf8',
  env:{PATH:join(dir,'bin'),HOME:dir,TMPDIR:dir,...env}});
 const calls=()=>existsSync(join(dir,'calls.log'))?readFileSync(join(dir,'calls.log'),'utf8').trim().split('\n'):[];
 return {dir,run,calls,done:()=>rmSync(dir,{recursive:true,force:true,maxRetries:5})};
}

test('outside a cloud session the hook exits at once and runs nothing',()=>{
 const m=machine();
 try {
  for(const value of [undefined,'','false','1']) {
   const result=m.run([],value===undefined?{}:{CLAUDE_CODE_REMOTE:value});
   assert.equal(result.status,0,result.stderr);
   assert.deepEqual(m.calls(),[],String(value));
  }
 } finally { m.done(); }
});

test('in a cloud session the hook starts dockerd in the background and installs dependencies only when the lockfile changed',async()=>{
 const m=machine();
 try {
  const first=m.run([],{CLAUDE_CODE_REMOTE:'true'});
  assert.equal(first.status,0,first.stderr);
  // dockerd runs detached; give it a moment to write its call.
  for(let i=0;i<50&&!existsSync(join(m.dir,'dockerd-started'));i++) await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(m.calls().some(call=>call.startsWith('dockerd')),m.calls().join('\n'));
  assert.deepEqual(m.calls().filter(call=>call.startsWith('npm')),['npm ci --no-audit --no-fund']);
  // The same lockfile again: nothing is installed, and a running daemon is not started twice.
  const again=m.run([],{CLAUDE_CODE_REMOTE:'true'});
  assert.equal(again.status,0,again.stderr);
  assert.equal(m.calls().filter(call=>call.startsWith('npm')).length,1);
  assert.equal(m.calls().filter(call=>call.startsWith('dockerd')).length,1);
  // A changed lockfile installs again.
  writeFileSync(join(m.dir,'package-lock.json'),'{"lockfileVersion":3,"changed":true}\n');
  assert.equal(m.run([],{CLAUDE_CODE_REMOTE:'true'}).status,0);
  assert.equal(m.calls().filter(call=>call.startsWith('npm')).length,2);
  // A missing node_modules installs again too, whatever the stamp says.
  rmSync(join(m.dir,'node_modules'),{recursive:true,force:true});
  assert.equal(m.run(['deps']).status,0);
  assert.equal(m.calls().filter(call=>call.startsWith('npm')).length,3);
 } finally { m.done(); }
});

test('`docker` waits for the daemon it started, and names the failure when none can start',()=>{
 const m=machine();
 try {
  const result=m.run(['docker']);
  assert.equal(result.status,0,result.stderr);
  assert.ok(m.calls().some(call=>call.startsWith('dockerd')));
  // No dockerd on this machine: one line says so.
  rmSync(join(m.dir,'dockerd-started'));
  rmSync(join(m.dir,'bin/dockerd'));
  const none=m.run(['docker']);
  assert.notEqual(none.status,0);
  assert.match(none.stderr,/no Docker daemon answers and dockerd is not installed/);
 } finally { m.done(); }
});

test('`browser` installs Chromium only when the Playwright build it needs is missing',()=>{
 const m=machine();
 try {
  // A machine where Playwright finds its browser: nothing is installed.
  writeFileSync(join(m.dir,'bin/node'),'#!/usr/bin/env bash\nexit 0\n'); chmodSync(join(m.dir,'bin/node'),0o755);
  writeFileSync(join(m.dir,'bin/npx'),`#!/usr/bin/env bash\necho "npx $*" >> "${m.dir}/calls.log"\n`); chmodSync(join(m.dir,'bin/npx'),0o755);
  assert.equal(m.run(['browser']).status,0);
  assert.deepEqual(m.calls(),[]);
  // One where it does not: the pinned Chromium is installed.
  writeFileSync(join(m.dir,'bin/node'),'#!/usr/bin/env bash\nexit 1\n');
  const result=m.run(['browser']);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(m.calls(),['npx --no-install playwright install chromium']);
 } finally { m.done(); }
});

test('the repo settings run the hook at session start and keep the plugin settings',()=>{
 const settings=json('.claude/settings.json');
 assert.deepEqual(settings.enabledPlugins,{'mattpocock-skills@mattpocock':true});
 assert.deepEqual(settings.extraKnownMarketplaces.mattpocock.source,{source:'github',repo:'mattpocock/skills'});
 const commands=settings.hooks.SessionStart.flatMap(entry=>entry.hooks).map(hook=>hook.command);
 assert.deepEqual(commands,['bash "$CLAUDE_PROJECT_DIR/scripts/cloud-session-setup.sh"']);
});

test('one command brings the app up, one checks the journey, one stops it; the steps are written down',()=>{
 const {scripts}=json('package.json');
 assert.equal(scripts['cloud:up'],'bash scripts/cloud-up.sh');
 assert.equal(scripts['cloud:down'],'bash scripts/cloud-up.sh --down');
 assert.equal(scripts['cloud:verify'],'node scripts/cloud-verify.mjs');
 for(const file of ['scripts/cloud-up.sh','scripts/cloud-verify.mjs','scripts/cloud-hermes.mjs','docs/agents/cloud-verify.md']) assert.ok(existsSync(join(root,file)),file);
 assert.match(readFileSync(join(root,'AGENTS.md'),'utf8'),/docs\/agents\/cloud-verify\.md/);
 // An unknown argument is refused before anything starts.
 const refused=spawnSync('bash',['scripts/cloud-up.sh','--nonsense'],{cwd:root,encoding:'utf8'});
 assert.equal(refused.status,2);
 assert.match(refused.stderr,/usage: npm run cloud:up/);
});
