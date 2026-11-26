import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

// `gtmworks company add` (#382, ADR 0018): the installer makes one Engine from the template with its own folder, volume,
// key and network, waits until it is healthy, joins the app and the worker to its network, then makes the Company through
// the web container. A failure removes everything it made and says so in one plain line; nothing of the command prints a
// key. The real Engine and database run in CI's install job.
const fakeDocker=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
  *'.State.Health.Status'*) echo healthy;;
  *'exec -u hermes '*' ssh '*) if [ -n "\${SSH_EXIT_FILE:-}" ] && [ -f "$SSH_EXIT_FILE" ]; then exit 1; fi; exit "\${SSH_EXIT:-0}";;
  *'/data/ssh/id_ed25519'*) printf 'client ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIclient\nhost ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIhost\n';;
 *'company-add.mjs check'*) printf '%s\\n' "\${SLUG:-second-company-0000abcd}"; exit "\${CHECK_EXIT:-0}";;
 *'company-add.mjs add'*)
  if [ "\${KILL_ON_ADD:-}" = 1 ]; then kill -TERM "$PPID"; exit 1; fi
  exit "\${ADD_EXIT:-0}";;
 *'company-add.mjs drop'*) printf '%s\\n' "\${DROP_OUTPUT:-removed}"; exit "\${DROP_EXIT:-0}";;
 *'company-list.mjs'*) printf 'Company "Second Company": Engine http://gtmworks-engine-second-company-0000abcd:8642 (healthy)\\n';;
 *' ps -q web'*) echo web-id;;
 *' ps -q worker'*) echo worker-id;;
 *'network inspect '*) exit 1;;
 # A Company made by this release has no work folder from a previous release (#507).
 *'volume inspect gtmworks-work-'*) exit 1;;
 *' up -d '*)
  printf 'limits memory=%s cpus=%s\\n' "\${SANDBOX_MEMORY:-}" "\${SANDBOX_CPUS:-}" >> "$COMMANDS"
  if [ "\${KILL_ON_UP:-}" = 1 ]; then kill -TERM "$PPID"; exit 1; fi
  case "$*" in *' sandbox')
   # A sandbox that starts only with some limits: SANDBOX_UP_FAIL_CPUS names the CPUs it does not start with.
   if [ -n "\${SANDBOX_UP_FAIL_CPUS:-}" ] && [ "\${SANDBOX_CPUS:-}" = "\${SANDBOX_UP_FAIL_CPUS}" ]; then exit 1; fi
   exit "\${SANDBOX_UP_EXIT:-0}";; esac
  exit "\${ENGINE_EXIT:-0}";;
 *'exec -T db psql'*) printf '%s\\n' "\${COMPANY_ROW-http://gtmworks-engine-second-company-0000abcd:8642|Second Company}";;
 *'ps -aq --filter name=^gtmworks-sandbox-'*) echo sandbox-id;;
 *'{{.State.Running}}'*) echo true;;
 *'.HostConfig.Memory'*) echo "2147483648 1500000000 \${DISK_LABEL:-10g}";;
 # The work disk's helper (#507): a size the disk does not hold is refused with what it holds (WORK_DISK_REFUSE_FILE).
 *'/usr/local/bin/work-disk '*' mount '*' 2g') if [ -n "\${WORK_DISK_REFUSE_FILE:-}" ] && [ -f "$WORK_DISK_REFUSE_FILE" ]; then echo 'used 3000'; exit 4; fi;;
esac
exit 0
`;
function install(t,{env}={}) {
 const directory=mkdtempSync(join(tmpdir(),'gtmworks-company-add-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const folder of ['scripts','bin']) mkdirSync(join(directory,folder),{recursive:true});
 copyFileSync('scripts/install.sh',join(directory,'scripts/install.sh'));
 copyFileSync('scripts/engine-template.yml',join(directory,'scripts/engine-template.yml'));
 writeFileSync(join(directory,'.env.install'),`HERMES_API_KEY=${'k'.repeat(64)}\nHERMES_ADDRESS=http://gtmworks-engine-first:8642\n`);
 // The image every Company's sandbox runs, as an install records it (#392); `company add` makes a sandbox with its Engine.
 writeFileSync(join(directory,'.work-sandbox-image'),'gtmworks-work-sandbox:local\n');
 writeFileSync(join(directory,'bin/docker'),fakeDocker,{mode:0o755});
 const commands=join(directory,'commands');
 const run=(...args)=>spawnSync('sh',['scripts/install.sh',...args],{cwd:directory,env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,...env},encoding:'utf8'});
 const lines=()=>existsSync(commands)?readFileSync(commands,'utf8').trimEnd().split('\n'):[];
 return {directory,run,lines,commandsFile:commands,envFile:slug=>join(directory,`.engines/${slug}/.env`)};
}

test('company add makes one Engine from the template, joins it, then makes the Company with that Engine', t => {
 const installDir=install(t);
 const result=installDir.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.equal(result.status,0,result.stderr);
 const commands=installDir.lines();
 assert.ok(commands.some(line=>line.includes('company-add.mjs check --name Second Company --owner person@example.com')),commands.join('\n'));
 assert.ok(commands.some(line=>/^compose --project-name gtmworks-engine-second-company-0000abcd --env-file \.engines\/second-company-0000abcd\/\.env -f scripts\/engine-template\.yml up -d --wait --wait-timeout 300$/.test(line)),commands.join('\n'));
 assert.ok(commands.includes('network connect --alias web gtmworks-engine-second-company-0000abcd web-id'));
 assert.ok(commands.includes('network connect gtmworks-engine-second-company-0000abcd worker-id'));
 const addLine=commands.find(line=>line.includes('company-add.mjs add --name Second Company'));
 assert.ok(addLine&&addLine.includes('--address http://gtmworks-engine-second-company-0000abcd:8642')&&addLine.includes('--owner person@example.com'),commands.join('\n'));
 // The Engine's key reaches the script from the environment, by name: it is never on the command line (#378, X4).
 assert.ok(addLine.includes('-e ENGINE_KEY')&&!addLine.includes('ENGINE_KEY='),addLine);
 // The Engine's own folder holds its own generated key, its volume and its network, readable by its owner alone.
 const env=readFileSync(installDir.envFile('second-company-0000abcd'),'utf8');
 assert.match(env,/^ENGINE_KEY=[a-f0-9]{64}$/m);
 assert.match(env,/^ENGINE_VOLUME=gtmworks-engine-second-company-0000abcd$/m);
 assert.match(env,/^ENGINE_NETWORK=gtmworks-engine-second-company-0000abcd$/m);
 assert.equal(statSync(installDir.envFile('second-company-0000abcd')).mode&0o777,0o600);
 assert.ok(!result.stdout.includes(env.match(/^ENGINE_KEY=(.*)$/m)[1]),'the command prints no key');
 assert.equal(result.stdout.trim(),'Company "Second Company" is made on its own Engine (gtmworks-engine-second-company-0000abcd). Its Owner is person@example.com.');
});

test('company add has one add path and the installer has one Engine name and one list of Engines (#378, T5)', () => {
 const install=readFileSync('scripts/install.sh','utf8');
 // The named-Owner and no-Owner paths make the Company in one call, and clean up a failure in one place.
 assert.equal((install.match(/company-add\.mjs add/g)||[]).length,1);
 assert.match(install,/set -- --name "\$company_name"/);
 assert.match(install,/node scripts\/company-add\.mjs add "\$@"/);
 assert.match(install,/node scripts\/company-add\.mjs check "\$@"/);
 // One name for an Engine's Compose project, container, volume and network; the first Engine starts by a name that says so.
 assert.doesNotMatch(install,/engine_container/);
 assert.match(install,/first_engine_up\(\)/);
 assert.doesNotMatch(install,/^engine_up\(\)/m);
 // Every loop over the install's Engines reads the one lister (the restore's key loop reads the keys' own folder list
 // out of the archive instead, before any .engines/ exists, #378 X2), and every network the one reader.
 assert.equal((install.match(/for folder in \.engines\/\*\//g)||[]).length,1);
 // A restore reads each Engine's key from the archive's checked folders, never from files it extracted.
 assert.equal((install.match(/for name in \$engine_key_folders; do/g)||[]).length,2);
 assert.match(install,/join_engine_network "\$\(engine_network_of "\$name"\)"/);
});

test('a refused Owner or a failed Engine leaves nothing and says so in one plain line, and the same command can run again', t => {
 // The Owner is checked in the database before an Engine is made: the check's own refusal is the only line.
 const refused=install(t,{env:{CHECK_EXIT:'1'}});
 const unknown=refused.run('company','add','--name','Second Company','--owner','nobody@example.com');
 assert.notEqual(unknown.status,0);
 assert.equal(existsSync(join(refused.directory,'.engines')),false,'the refused add made no Engine folder');
 assert.equal(refused.lines().some(line=>line.includes(' up -d ')),false,'the refused add started no Engine');
 // The Engine did not become healthy: the command removes its Engine and says so in one line, making no Company.
 const failing=install(t,{env:{ENGINE_EXIT:'1'}});
 const failed=failing.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.notEqual(failed.status,0);
 assert.deepEqual(failed.stdout.trim().split('\n'),['Company "Second Company" was not made: its Engine or its work sandbox did not start. Nothing was left behind; run the same command again.']);
 const cleanup=failing.lines().join('\n');
 assert.match(cleanup,/down -v/);
 assert.match(cleanup,/rm -f gtmworks-engine-second-company-0000abcd/);
 assert.match(cleanup,/volume rm gtmworks-engine-second-company-0000abcd/);
 assert.match(cleanup,/network rm gtmworks-engine-second-company-0000abcd/);
 assert.equal(existsSync(join(failing.directory,'.engines/second-company-0000abcd')),false,'the failed add left no Engine folder');
 assert.equal(cleanup.includes('company-add.mjs add'),false,'the failed add made no Company');
 // Running it again on a healthy Engine succeeds.
 const again=install(t);
 assert.equal(again.run('company','add','--name','Second Company','--owner','person@example.com').status,0);
 assert.ok(existsSync(again.envFile('second-company-0000abcd')));
});

test("company list and the Engine report are the installer's own, so gtmworks shows each Company its Engine", t => {
 const installDir=install(t);
 const listed=installDir.run('company','list');
 assert.equal(listed.status,0,listed.stderr);
 assert.equal(listed.stdout.trim(),'Company "Second Company": Engine http://gtmworks-engine-second-company-0000abcd:8642 (healthy)');
 assert.ok(installDir.lines().some(line=>line.includes('company-list.mjs companies')));
 const engines=installDir.run('engines');
 assert.equal(engines.status,0,engines.stderr);
 assert.ok(installDir.lines().some(line=>line.includes('company-list.mjs engines')));
});

test('company add with no Owner makes the Engine and holds the Company behind the first-Owner link the script prints', t => {
 const installDir=install(t);
 const result=installDir.run('company','add','--name','Held Company');
 assert.equal(result.status,0,result.stderr);
 const commands=installDir.lines();
 // The name is checked, and the record is registered, with no Owner email any step could require.
 assert.ok(commands.some(line=>line.endsWith('company-add.mjs check --name Held Company')),commands.join('\n'));
 const add=commands.find(line=>line.includes('company-add.mjs add --name Held Company'));
 assert.ok(add&&!add.includes('--owner'),commands.join('\n'));
 assert.ok(add.includes('--address http://gtmworks-engine-second-company-0000abcd:8642'),add);
 assert.ok(add.includes('-e ENGINE_KEY')&&!add.includes('ENGINE_KEY='),'the key is passed by name, never on the command line');
 // The Engine is the same template the named-Owner path makes, and the closing line says where its link is.
 assert.ok(commands.some(line=>/^compose --project-name gtmworks-engine-second-company-0000abcd --env-file \.engines\/second-company-0000abcd\/\.env -f scripts\/engine-template\.yml up -d --wait --wait-timeout 300$/.test(line)));
 assert.deepEqual(result.stdout.trim().split('\n'),['Company "Held Company" is waiting for its Owner on its own Engine (gtmworks-engine-second-company-0000abcd). Send the first-Owner link above; it works once.']);
});

test('company link asks the web container for a fresh first-Owner link for a Company still waiting, and prints only that', t => {
 const installDir=install(t);
 const result=installDir.run('company','link','Held Company');
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(installDir.lines(),['compose --env-file .env.install -f docker-compose.install.yml exec -T web node scripts/company-add.mjs link --name Held Company']);
 assert.equal(installDir.lines().some(line=>line.includes(' up -d ')),false,'a fresh link makes no Engine');
});

// A failed add must not describe as "nothing was left behind" a Company that was made (#378, C11): the script's drop
// answer says whether a Company holds the Engine record, and an Engine a Company holds is never destroyed.
test('a failed add says what the install holds: a made Company keeps its Engine, and only a waiting record is taken back', t => {
 // The Engine's record is held by a Company: the Company was made, and its Engine stays.
 const held=install(t,{env:{ADD_EXIT:'1',DROP_OUTPUT:'held'}});
 const made=held.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.notEqual(made.status,0);
 const madeOutput=made.stdout+made.stderr;
 assert.match(madeOutput,/Company "Second Company" was made on its own Engine \(gtmworks-engine-second-company-0000abcd\): its Engine stays\./);
 assert.doesNotMatch(madeOutput,/Nothing was left behind/);
 assert.ok(existsSync(held.envFile('second-company-0000abcd')),'the Engine a Company was made on stays');
 assert.doesNotMatch(held.lines().join('\n'),/ down -v| volume rm| network rm/);
 // A waiting record only: nothing of the command stays, and the line says so.
 const waiting=install(t,{env:{ADD_EXIT:'1'}});
 const removed=waiting.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.notEqual(removed.status,0);
 assert.match(removed.stdout,/Company "Second Company" was not made\. Nothing was left behind; run the same command again\./);
 assert.doesNotMatch(removed.stdout,/was made on its own Engine/);
 assert.equal(existsSync(waiting.envFile('second-company-0000abcd')),false);
 // The answer could not be read at all: the Engine stays too, and the line says what is known.
 const unknown=install(t,{env:{ADD_EXIT:'1',DROP_EXIT:'1'}});
 const unread=unknown.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.notEqual(unread.status,0);
 assert.match(unread.stdout,/could not be read back after a failure, so its Engine \(gtmworks-engine-second-company-0000abcd\) stays\./);
 assert.doesNotMatch(unread.stdout,/Nothing was left behind/);
 assert.ok(existsSync(unknown.envFile('second-company-0000abcd')));
});

// `company-add.mjs drop` answers `held` for an Engine record a Company names, and `removed` after it removed one that
// waits (#378, C11): the installer reads that answer, so it must be true of the database.
test('company-add.mjs drop reports whether a Company holds the Engine record', async t => {
 const requests=[];
 let held=false;
 const server=createServer((request,response)=>{
  requests.push(`${request.method} ${request.url}`);
  response.setHeader('Content-Type','application/json');
  // As the database does: companies.engine_id is a foreign key, so a record a Company names refuses its delete.
  if(request.method==='DELETE') {
   if(held) { response.writeHead(409); return response.end(JSON.stringify({code:'23503',message:'still referenced from table companies'})); }
   response.writeHead(204); return response.end();
  }
  if(String(request.url).startsWith('/rest/v1/company_engines')) return response.end(JSON.stringify([{id:'e1'}]));
  if(String(request.url).startsWith('/rest/v1/companies')) return response.end(JSON.stringify(held?[{id:'c1'}]:[]));
  return response.end('[]');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{ server.closeAllConnections(); server.close(resolve); }));
 const url=`http://127.0.0.1:${server.address().port}`;
 // The server runs in this process, so the script is run without blocking the event loop it needs to answer.
 const drop=()=>new Promise(resolve=>{
  const child=spawn(process.execPath,['scripts/company-add.mjs','drop','--address','http://gtmworks-engine-second-company:8642'],
   {env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'service-role',WEBHOOK_ENCRYPTION_KEY:'k'}});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{ stdout+=chunk; });
  child.stderr.on('data',chunk=>{ stderr+=chunk; });
  child.on('exit',status=>resolve({status,stdout,stderr}));
 });
 const waiting=await drop();
 assert.equal(waiting.status,0,waiting.stderr);
 assert.equal(waiting.stdout,'removed\n');
 assert.ok(requests.some(request=>request.startsWith('DELETE /rest/v1/company_engines')),requests.join('\n'));
 // A Company names the record, even one committed just before: its delete is refused by the foreign key, and the
 // answer says the record is held (#378, C10/C11).
 held=true;
 requests.length=0;
 const named=await drop();
 assert.equal(named.status,0,named.stderr);
 assert.equal(named.stdout,'held\n');
 assert.ok(requests.some(request=>request.startsWith('DELETE /rest/v1/company_engines')),requests.join('\n'));
});

// A versioned restore replaces the install over several installer runs and holds install.sh's own restore marker while
// it does (#378, C5): a Company made in the middle would be lost without being in its safety backup, so `company add`
// refuses until the restore has finished.
test('company add refuses while a restore runs, before it makes anything', async t => {
 const installDir=install(t);
 const holder=spawn('sh',['-c','exec 8>>.install-restore; flock -n 8 || exit 1; echo held; exec sleep 60'],{cwd:installDir.directory});
 t.after(()=>{ holder.kill('SIGKILL'); holder.stdout.destroy(); holder.unref(); });
 await new Promise(resolve=>holder.stdout.once('data',resolve));
 const refused=installDir.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.equal(refused.status,1,refused.stderr);
 assert.match(refused.stderr,/^A restore is running: wait for it to finish, then run this again\.$/m);
 assert.equal(existsSync(join(installDir.directory,'.engines/second-company-0000abcd')),false,'the refused add made no Engine folder');
 assert.deepEqual(installDir.lines(),[],'the refused add asked Docker for nothing');
});

// An interrupt during the Engine's start takes back everything the command made (#378, C10): the rollback is registered
// before the Engine's folder exists, so a TERM leaves no container, volume, network, folder or waiting record behind.
test('an interrupt while the Engine starts removes the container, volume, network, folder and waiting record', t => {
 const installDir=install(t,{env:{KILL_ON_UP:'1'}});
 const interrupted=installDir.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.notEqual(interrupted.status,0,interrupted.stdout);
 const commands=installDir.lines().join('\n');
 assert.match(commands,/company-add\.mjs drop --address http:\/\/gtmworks-engine-second-company-0000abcd:8642/);
 assert.match(commands,/down -v --remove-orphans/);
 assert.match(commands,/rm -f gtmworks-engine-second-company-0000abcd/);
 assert.match(commands,/volume rm gtmworks-engine-second-company-0000abcd/);
 assert.match(commands,/network rm gtmworks-engine-second-company-0000abcd/);
 assert.equal(existsSync(join(installDir.directory,'.engines/second-company-0000abcd')),false,'the interrupted add left no Engine folder');
 // It made no Company and printed no closing line.
 assert.doesNotMatch(interrupted.stdout,/is made on its own Engine/);
 assert.equal(commands.includes('company-add.mjs add'),false,'the interrupted add made no Company');
});

// An interrupt that comes after the Company was made never takes its Engine back (#378, C10/C11 follow-up): the rollback
// asks whether a Company holds the record, keeps the Engine when one does or when it cannot tell, and says so.
test('an interrupt after the Company is made keeps its Engine and says so', t => {
 for(const answer of ['held','']) {
  const installDir=install(t,{env:{KILL_ON_UP:'1',DROP_OUTPUT:answer,...(answer?{}:{DROP_EXIT:'1'})}});
  const interrupted=installDir.run('company','add','--name','Second Company','--owner','person@example.com');
  assert.notEqual(interrupted.status,0,interrupted.stdout);
  const commands=installDir.lines().join('\n');
  assert.match(commands,/company-add\.mjs drop --address/);
  assert.doesNotMatch(commands,/down -v --remove-orphans|volume rm |network rm /,answer||'unknown');
  assert.match(interrupted.stderr,/The Engine gtmworks-engine-second-company-0000abcd stays: a Company may already be made on it\./);
 }
});

// A first-Owner link written between a restore's safety backup and its replacement would stop working, or bring back an
// older one from the archive (#378, C5 follow-up): `company link` refuses while a restore holds its marker, as add does.
test('company link refuses while a restore runs, before it writes anything', async t => {
 const installDir=install(t);
 const holder=spawn('sh',['-c','exec 8>>.install-restore; flock -n 8 || exit 1; echo held; exec sleep 60'],{cwd:installDir.directory});
 t.after(()=>{ holder.kill('SIGKILL'); holder.stdout.destroy(); holder.unref(); });
 await new Promise(resolve=>holder.stdout.once('data',resolve));
 const refused=installDir.run('company','link','Second Company');
 assert.equal(refused.status,1,refused.stderr);
 assert.match(refused.stderr,/^A restore is running: wait for it to finish, then run this again\.$/m);
 assert.deepEqual(installDir.lines(),[],'the refused link asked Docker for nothing');
});

// A lost answer from the call that makes the Company may hide a Company that was made, so the script never says nothing
// was made: it says the outcome could not be confirmed, and the installer reads the record and says what is there.
test('company-add.mjs says an add it cannot confirm is unconfirmed, never that nothing was made', async t => {
 const server=createServer((request,response)=>{
  response.setHeader('Content-Type','application/json');
  const url=String(request.url);
  if(url.startsWith('/auth/v1/admin/users')) return response.end(JSON.stringify({users:[{id:'u1',email:'person@example.com'}]}));
  if(url.startsWith('/rest/v1/people')) return response.end(JSON.stringify({id:'u1'}));
  if(url.startsWith('/rest/v1/rpc/create_company_with_owner')) { response.writeHead(502); return response.end(JSON.stringify({message:'upstream lost'})); }
  if(request.method==='POST'&&url.startsWith('/rest/v1/company_engines')) { response.writeHead(201); return response.end(JSON.stringify({id:'e1',address:'http://gtmworks-engine-second-company:8642'})); }
  if(url.startsWith('/rest/v1/companies')) return response.end('[]');
  if(request.method==='DELETE') { response.writeHead(204); return response.end(); }
  return response.end('[]');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{ server.closeAllConnections(); server.close(resolve); }));
 const url=`http://127.0.0.1:${server.address().port}`;
 const result=await new Promise(resolve=>{
  const child=spawn(process.execPath,['scripts/company-add.mjs','add','--name','Second Company','--owner','person@example.com','--address','http://gtmworks-engine-second-company:8642','--slug','second-company'],
   {env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'service-role',WEBHOOK_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),ENGINE_KEY:'a1'.repeat(32)}});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{ stdout+=chunk; });
  child.stderr.on('data',chunk=>{ stderr+=chunk; });
  child.on('exit',status=>resolve({status,stdout,stderr}));
 });
 assert.notEqual(result.status,0,result.stdout);
 assert.match(result.stderr,/The Company "Second Company" could not be confirmed:/);
 assert.doesNotMatch(result.stderr+result.stdout,/was not made|Nothing was left behind/);
});

// An interrupt while the web container makes the Company can come before or after that Company commits, and the
// interrupted command cannot tell (#378, C10/C11): from the moment the add starts, its Engine is never taken back, and
// the line says to read `company list`.
test('an interrupt while the Company is being made keeps its Engine and says to read company list', t => {
 const installDir=install(t,{env:{KILL_ON_ADD:'1'}});
 const interrupted=installDir.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.notEqual(interrupted.status,0,interrupted.stdout);
 const commands=installDir.lines().join('\n');
 assert.match(commands,/company-add\.mjs add/);
 assert.doesNotMatch(commands,/company-add\.mjs drop|down -v --remove-orphans|volume rm |network rm /);
 assert.match(interrupted.stderr,/The Engine gtmworks-engine-second-company-0000abcd stays: its Company may be made\. Run gtmworks company list to see its state\./);
 assert.ok(existsSync(join(installDir.directory,'.engines/second-company-0000abcd/.env')),'the Engine folder stays');
});

// A Company's sandbox limits (#396): `company add` takes a memory and a CPU limit, keeps them with the Company's own
// files and gives Compose those, never a value left in the shell, so an update, a restore or a recreate gives the
// sandbox the limits its Company was given. With none, the Company's file holds none and the template's default applies.
test('company add keeps the limits it was given with the Company, and its sandbox starts with them whatever the shell holds', t => {
 const installDir=install(t,{env:{SANDBOX_MEMORY:'8g',SANDBOX_CPUS:'4'}});
 const result=installDir.run('company','add','--name','Second Company','--owner','person@example.com','--memory','2g','--cpus','1.5');
 assert.equal(result.status,0,result.stderr);
 const env=readFileSync(installDir.envFile('second-company-0000abcd'),'utf8');
 assert.match(env,/^SANDBOX_MEMORY=2g$/m);
 assert.match(env,/^SANDBOX_CPUS=1\.5$/m);
 assert.ok(installDir.lines().includes('limits memory=2g cpus=1.5'),installDir.lines().join('\n'));
 // No limit given: the Company's file names none and Compose gets none, so the template's default is the sandbox's.
 const plain=install(t,{env:{SANDBOX_MEMORY:'8g'}});
 assert.equal(plain.run('company','add','--name','Second Company','--owner','person@example.com').status,0);
 assert.doesNotMatch(readFileSync(plain.envFile('second-company-0000abcd'),'utf8'),/SANDBOX_/);
 assert.ok(plain.lines().includes('limits memory= cpus='),plain.lines().join('\n'));
});

test('a limit that is not a size or a number of CPUs is refused before anything is made', t => {
 for(const [option,value,line] of [['--memory','lots','The memory limit is a whole number of megabytes or gigabytes, such as 512m or 2g, not lots.'],
  ['--cpus','0','The CPU limit is a number of CPUs above 0, such as 1 or 1.5, not 0.']]) {
  const installDir=install(t);
  const refused=installDir.run('company','add','--name','Second Company','--owner','person@example.com',option,value);
  assert.notEqual(refused.status,0);
  assert.equal(refused.stderr.trim(),line);
  assert.deepEqual(installDir.lines(),[],'the refused add asked Docker for nothing');
 }
});

// `company add` checks its Engine reaches the sandbox, with the Engine's own key and pinned host key, before it says
// anything: a sandbox the Engine cannot reach is taken back with the rest.
test('a sandbox its Engine cannot reach takes the whole add back, in one plain line', t => {
 const installDir=install(t,{env:{SSH_EXIT:'255'}});
 const failed=installDir.run('company','add','--name','Second Company','--owner','person@example.com');
 assert.notEqual(failed.status,0);
 assert.deepEqual(failed.stdout.trim().split('\n'),['Company "Second Company" was not made: its work sandbox could not be reached from its Engine. Nothing was left behind; run the same command again.']);
 const commands=installDir.lines().join('\n');
 assert.match(commands,/exec -u hermes gtmworks-engine-second-company-0000abcd ssh .*pn@sandbox true/);
 assert.match(commands,/down -v/);
 assert.match(commands,/rm -f gtmworks-engine-second-company-0000abcd gtmworks-sandbox-second-company-0000abcd gtmworks-exit-second-company-0000abcd/);
 assert.equal(commands.includes('company-add.mjs add'),false,'no Company was made');
 assert.equal(existsSync(join(installDir.directory,'.engines/second-company-0000abcd')),false);
 // A sandbox that does not start at all is the same: nothing stays.
 const notStarted=install(t,{env:{ENGINE_EXIT:'1'}});
 const result=notStarted.run('company','add','--name','Second Company','--owner','person@example.com','--cpus','512');
 assert.deepEqual(result.stdout.trim().split('\n'),['Company "Second Company" was not made: its Engine or its work sandbox did not start. Nothing was left behind; run the same command again.']);
});

// `company limits` changes an existing Company's limits: the Company's file holds the new ones, only that Company's
// sandbox is started again with them (no Engine, exit or other Company), and its Engine reaches it before the command
// says so. A limit not named keeps its value.
function withCompany(t,env={}) {
 const installDir=install(t,{env});
 assert.equal(installDir.run('company','add','--name','Second Company','--owner','person@example.com','--memory','2g','--cpus','1.5').status,0);
 writeFileSync(installDir.commandsFile,'');
 return installDir;
}
test('company limits changes one Company\'s limits and starts only its sandbox again', t => {
 const installDir=withCompany(t,{SANDBOX_MEMORY:'8g'});
 const result=installDir.run('company','limits','Second Company','--memory','3g');
 assert.equal(result.status,0,result.stderr);
 const env=readFileSync(installDir.envFile('second-company-0000abcd'),'utf8');
 assert.match(env,/^SANDBOX_MEMORY=3g$/m);
 assert.match(env,/^SANDBOX_CPUS=1\.5$/m);
 assert.match(env,/^ENGINE_KEY=[a-f0-9]{64}$/m,'the Engine keeps its key');
 const commands=installDir.lines();
 const ups=commands.filter(line=>line.includes(' up -d '));
 assert.equal(ups.length,1,commands.join('\n'));
 assert.match(ups[0],/^compose --project-name gtmworks-engine-second-company-0000abcd .* up -d --no-deps --wait --wait-timeout \d+ sandbox$/);
 assert.ok(commands.includes('limits memory=3g cpus=1.5'),commands.join('\n'));
 assert.ok(commands.some(line=>/exec -u hermes gtmworks-engine-second-company-0000abcd ssh .*pn@sandbox true/.test(line)));
 assert.equal(result.stdout.trim(),'Company "Second Company": its work sandbox now has 2048 MiB of memory, 1.5 CPUs and a 10g work disk.');
 // A limit not named keeps its value: the work disk is left at its size, and the Engine is not stopped.
 assert.ok(commands.some(line=>/work-disk .* mount \S+\/\.work-disks\/second-company-0000abcd 10g$/.test(line)),commands.join('\n'));
 assert.equal(commands.some(line=>line.startsWith('stop ')),false,commands.join('\n'));
});

// A Company's work disk (#507, ADR 0032): its size is a limit like memory and CPUs, kept with the Company's files and
// given to the one-off helper that makes, resizes and mounts the disk, never a value left in the shell.
test('company add keeps the disk limit it was given, and the helper makes the disk at that size', t => {
 const installDir=install(t,{env:{SANDBOX_DISK:'50g'}});
 const result=installDir.run('company','add','--name','Second Company','--owner','person@example.com','--disk','5g');
 assert.equal(result.status,0,result.stderr);
 assert.match(readFileSync(installDir.envFile('second-company-0000abcd'),'utf8'),/^SANDBOX_DISK=5g$/m);
 const commands=installDir.lines();
 const helper=commands.find(line=>line.includes('--entrypoint /usr/local/bin/work-disk'));
 // The helper: privileged for its loop device, the host's process table for the Docker daemon's mount namespace, no
 // network, this Company's folder alone, the image the install recorded, and a fixed command.
 assert.match(helper,/^run --rm --privileged --pid host --network none --user 0 --entrypoint \/usr\/local\/bin\/work-disk -v (\S+)\/\.work-disks\/second-company-0000abcd:\/disk gtmworks-work-sandbox:local mount \1\/\.work-disks\/second-company-0000abcd 5g$/);
 // The work folder and the home bind the mounted disk's folders, made before the sandbox starts.
 const folder=`${installDir.directory}/.work-disks/second-company-0000abcd/fs`;
 const at=line=>commands.findIndex(command=>command.includes(line));
 assert.ok(at(`volume create --driver local --opt type=none --opt o=bind --opt device=${folder}/work gtmworks-folder-second-company-0000abcd`)>at('work-disk'),commands.join('\n'));
 assert.ok(at(`volume create --driver local --opt type=none --opt o=bind --opt device=${folder}/home gtmworks-home-second-company-0000abcd`)>at('work-disk'),commands.join('\n'));
 assert.ok(at(`volume create --driver local --opt type=none`)<at(' up -d '),commands.join('\n'));
 // No disk named: the template's default, never the shell's.
 const plain=install(t,{env:{SANDBOX_DISK:'50g'}});
 assert.equal(plain.run('company','add','--name','Second Company','--owner','person@example.com').status,0);
 assert.doesNotMatch(readFileSync(plain.envFile('second-company-0000abcd'),'utf8'),/SANDBOX_DISK/);
 assert.ok(plain.lines().some(line=>/work-disk .* mount \S+ 10g$/.test(line)),plain.lines().join('\n'));
});

test('a disk limit that is not a size of at least a gigabyte is refused before anything is made', t => {
 for(const value of ['lots','512m','0g']) {
  const installDir=install(t);
  const refused=installDir.run('company','add','--name','Second Company','--owner','person@example.com','--disk',value);
  assert.notEqual(refused.status,0);
  assert.equal(refused.stderr.trim(),`The disk limit is a whole number of megabytes or gigabytes of at least 1g, such as 5g or 20g, not ${value}.`);
  assert.deepEqual(installDir.lines(),[],'the refused add asked Docker for nothing');
 }
});

test('company limits --disk resizes the Company\'s work disk and starts its sandbox again', t => {
 const installDir=withCompany(t);
 const result=installDir.run('company','limits','Second Company','--disk','20g');
 assert.equal(result.status,0,result.stderr);
 assert.match(readFileSync(installDir.envFile('second-company-0000abcd'),'utf8'),/^SANDBOX_DISK=20g$/m);
 const commands=installDir.lines();
 assert.ok(commands.some(line=>/work-disk .* mount \S+ 20g$/.test(line)),commands.join('\n'));
 assert.ok(commands.includes('limits memory=2g cpus=1.5'),'memory and CPUs keep their values');
});

test('company limits --disk below what the disk holds is refused, and the disk is kept as it was', t => {
 const refuse=join(mkdtempSync(join(tmpdir(),'gtmworks-disk-refuse-')),'refuse');
 t.after(()=>rmSync(dirname(refuse),{recursive:true,force:true}));
 const installDir=withCompany(t,{WORK_DISK_REFUSE_FILE:refuse});
 writeFileSync(refuse,'');
 const result=installDir.run('company','limits','Second Company','--disk','2g');
 assert.notEqual(result.status,0);
 assert.equal(result.stdout.trim(),'The limits of Company "Second Company" were not changed: its work disk holds 3000 MiB, which does not fit in 2g. Its disk is kept as it was.');
 assert.doesNotMatch(readFileSync(installDir.envFile('second-company-0000abcd'),'utf8'),/SANDBOX_DISK/);
 // The Company runs again on the disk it had.
 assert.ok(installDir.lines().some(line=>/ up -d --no-deps .* sandbox$/.test(line)),installDir.lines().join('\n'));
});

test('company limits that the sandbox cannot start with puts the earlier limits back', t => {
 const installDir=withCompany(t,{SANDBOX_UP_FAIL_CPUS:'512'});
 const result=installDir.run('company','limits','Second Company','--cpus','512');
 assert.notEqual(result.status,0);
 assert.equal(result.stdout.trim(),'The limits of Company "Second Company" were not changed: its work sandbox did not start with them. It runs with its earlier limits.');
 const env=readFileSync(installDir.envFile('second-company-0000abcd'),'utf8');
 assert.match(env,/^SANDBOX_MEMORY=2g$/m);
 assert.match(env,/^SANDBOX_CPUS=1\.5$/m);
 assert.ok(installDir.lines().includes('limits memory=2g cpus=1.5'),'the sandbox is started again with its earlier limits');
});

test('company limits whose sandbox does not come back with the earlier limits says it is stopped or unreachable', t => {
 const installDir=withCompany(t,{SANDBOX_UP_EXIT:'1'});
 const result=installDir.run('company','limits','Second Company','--cpus','512');
 assert.notEqual(result.status,0);
 assert.doesNotMatch(result.stdout,/runs with its earlier limits/);
 assert.match(result.stderr,/The limits of Company "Second Company" were not changed, and its work sandbox did not come back with its earlier limits either: it is stopped or its Engine cannot reach it\./);
 const env=readFileSync(installDir.envFile('second-company-0000abcd'),'utf8');
 assert.match(env,/^SANDBOX_CPUS=1\.5$/m,'the earlier limits are kept for its next start');
 assert.ok(installDir.lines().includes('limits memory=2g cpus=1.5'),'a start with its earlier limits was tried');
});

test('company limits whose sandbox starts with the earlier limits but cannot be reached does not say it runs with them', t => {
 // The Engine reaches the sandbox while the Company is made, and no more once its limits change (SSH_EXIT_FILE).
 const unreachable=join(mkdtempSync(join(tmpdir(),'gtmworks-unreachable-')),'ssh-fails');
 t.after(()=>rmSync(dirname(unreachable),{recursive:true,force:true}));
 const installDir=withCompany(t,{SANDBOX_UP_FAIL_CPUS:'512',SSH_EXIT_FILE:unreachable});
 writeFileSync(unreachable,'');
 const result=installDir.run('company','limits','Second Company','--cpus','512');
 assert.notEqual(result.status,0);
 assert.doesNotMatch(result.stdout,/runs with its earlier limits/);
 assert.match(result.stderr,/it is stopped or its Engine cannot reach it\./);
 assert.ok(installDir.lines().includes('limits memory=2g cpus=1.5'),'the sandbox started again with its earlier limits');
});

test('company limits needs a known Company and a limit', t => {
 const installDir=withCompany(t);
 const none=installDir.run('company','limits','Second Company');
 assert.notEqual(none.status,0);
 assert.match(none.stderr,/Usage: gtmworks company add/);
 const unknown=install(t,{env:{COMPANY_ROW:''}});
 const missing=unknown.run('company','limits','Nobody','--memory','2g');
 assert.notEqual(missing.status,0);
 assert.equal(missing.stderr.trim(),"No Company in this install is named Nobody. Pass the Company's id or its exact name.");
 assert.equal(unknown.lines().some(line=>line.includes(' up -d ')),false);
});

test('company list shows each Company\'s sandbox and its state', t => {
 const installDir=withCompany(t);
 const listed=installDir.run('company','list');
 assert.equal(listed.status,0,listed.stderr);
 assert.deepEqual(listed.stdout.trim().split('\n'),['Company "Second Company": Engine http://gtmworks-engine-second-company-0000abcd:8642 (healthy)',
  'Sandbox gtmworks-sandbox-second-company-0000abcd: running (Company "Second Company")']);
});
