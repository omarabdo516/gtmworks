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

// A copy of the hook script in a folder of its own, with stand-ins for npm, docker, dockerd, pgrep and ps that write each
// call to calls.log: what the script would run, with nothing installed or started. Its Docker run folder is run/ (the
// machine's /var/run), and proc/<pid> holds the name of each process the stand-in ps reports as running.
function machine() {
 const dir=mkdtempSync(join(tmpdir(),'cloud-session-'));
 mkdirSync(join(dir,'scripts')); mkdirSync(join(dir,'bin'));
 copyFileSync(join(root,'scripts/cloud-session-setup.sh'),join(dir,'scripts/cloud-session-setup.sh'));
 writeFileSync(join(dir,'package-lock.json'),'{"lockfileVersion":3}\n');
 const stub=(name,body)=>{ writeFileSync(join(dir,'bin',name),`#!/usr/bin/env bash\necho "${name} $*" >> "${dir}/calls.log"\n${body}\n`); chmodSync(join(dir,'bin',name),0o755); };
 // Only the tools the script needs, so a machine without dockerd is one where the stand-in is gone; each the system's
 // own, not a wrapper an agent session puts first on its PATH.
 for(const tool of ['bash','cat','cut','dirname','id','mkdir','nohup','seq','rm','setsid','sha256sum','sleep','tail','touch','tr']) symlinkSync(execFileSync('bash',['-c',`command -v ${tool}`],{encoding:'utf8',env:{PATH:'/usr/local/bin:/usr/bin:/bin'}}).trim(),join(dir,'bin',tool));
 stub('npm','mkdir -p node_modules');
 // No daemon answers until the stand-in dockerd has run once.
 stub('docker',`[[ -f "${dir}/dockerd-started" ]]`);
 stub('dockerd',`touch "${dir}/dockerd-started"`);
 stub('pgrep',`[[ -f "${dir}/dockerd-started" ]]`);
 // \`ps -o comm= -p <pid>\` prints the process's name, or fails when no such process runs.
 stub('ps',`[[ -f "${dir}/proc/\${@: -1}" ]] && cat "${dir}/proc/\${@: -1}"`);
 mkdirSync(join(dir,'run/docker/containerd'),{recursive:true}); mkdirSync(join(dir,'proc'));
 const run=(args=[],env={})=>spawnSync('bash',[join(dir,'scripts/cloud-session-setup.sh'),...args],{cwd:dir,encoding:'utf8',
  env:{PATH:join(dir,'bin'),HOME:dir,TMPDIR:dir,GTMWORKS_DOCKER_RUN_DIR:join(dir,'run'),...env}});
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

// #522: a restored VM keeps the pid files of the daemons that ran before it stopped, and their pid (180 in every report)
// can belong to another process by then. dockerd and its containerd take any live pid as theirs still running and never
// start, so the start removes a pid file whose process is not a running containerd or dockerd, and containerd's sockets.
const containerdFiles=['containerd.pid','containerd.sock','containerd.sock.ttrpc','containerd-debug.sock'];
// A machine whose containerd.pid says 180 and docker.pid 181; `processes` names what runs under each pid now.
function withStalePids(processes,check) {
 const m=machine();
 const containerd=join(m.dir,'run/docker/containerd');
 for(const file of containerdFiles) writeFileSync(join(containerd,file),file==='containerd.pid'?'180\n':'');
 writeFileSync(join(containerd,'containerd.toml'),'');
 writeFileSync(join(m.dir,'run/docker.pid'),'181');
 for(const [pid,name] of Object.entries(processes)) writeFileSync(join(m.dir,'proc',pid),`${name}\n`);
 const containerdLeft=()=>containerdFiles.filter(file=>existsSync(join(containerd,file)));
 const dockerPidLeft=()=>existsSync(join(m.dir,'run/docker.pid'));
 try { check({...m,containerd,containerdLeft,dockerPidLeft}); } finally { m.done(); }
}

test('`docker` removes pid files whose pid is another process, and containerd\'s sockets, before it starts dockerd',()=>{
 // 180 is now the session's worker, 181 runs nothing at all.
 for(const processes of [{180:'claude'},{180:'claude',181:'node'},{}]) withStalePids(processes,m=>{
  const result=m.run(['docker']);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(m.containerdLeft(),[],JSON.stringify(processes));
  assert.equal(m.dockerPidLeft(),false);
  assert.ok(existsSync(join(m.containerd,'containerd.toml')),'only the pid file and the sockets go');
  assert.ok(m.calls().some(call=>call.startsWith('dockerd')));
  assert.match(result.stdout,/Removing the stale .*containerd\.pid \(pid 180 is (claude|not running)\)/);
 });
 // The hook's start, in a cloud session, clears them the same way.
 withStalePids({180:'claude'},m=>{
  assert.equal(m.run([],{CLAUDE_CODE_REMOTE:'true'}).status,0);
  assert.deepEqual(m.containerdLeft(),[]);
  assert.equal(m.dockerPidLeft(),false);
 });
});

test('`docker` leaves the pid files of a containerd or dockerd that really runs',()=>{
 withStalePids({180:'containerd',181:'dockerd'},m=>{
  assert.equal(m.run(['docker']).status,0);
  assert.deepEqual(m.containerdLeft(),containerdFiles);
  assert.equal(m.dockerPidLeft(),true);
 });
 // A live containerd keeps its files while a stale docker.pid still goes.
 withStalePids({180:'containerd',181:'bash'},m=>{
  assert.equal(m.run(['docker']).status,0);
  assert.deepEqual(m.containerdLeft(),containerdFiles);
  assert.equal(m.dockerPidLeft(),false);
 });
 // A daemon that answers: nothing is looked at or removed.
 withStalePids({},m=>{
  writeFileSync(join(m.dir,'dockerd-started'),'');
  assert.equal(m.run(['docker']).status,0);
  assert.deepEqual(m.containerdLeft(),containerdFiles);
  assert.equal(m.dockerPidLeft(),true);
 });
});

test('outside a cloud session the hook leaves stale pid files alone',()=>{
 withStalePids({},m=>{
  assert.equal(m.run([]).status,0);
  assert.deepEqual(m.containerdLeft(),containerdFiles);
  assert.equal(m.dockerPidLeft(),true);
  assert.deepEqual(m.calls(),[]);
 });
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

// The skills themselves are vendored into .claude/skills/ (#473, tests/matt-skills.test.mjs).
test('the repo settings run the hook at session start',()=>{
 const settings=json('.claude/settings.json');
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
