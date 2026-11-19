import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// `gtmworks company add` (#382, ADR 0018): the installer makes one Engine from the template with its own folder, volume,
// key and network, waits until it is healthy, joins the app and the worker to its network, then makes the Company through
// the web container. A failure removes everything it made and says so in one plain line; nothing of the command prints a
// key. The real Engine and database run in CI's install job.
const fakeDocker=`#!/bin/sh
printf '%s\\n' "$*" >> "$COMMANDS"
case "$*" in
 *'company-add.mjs check'*) printf '%s\\n' "\${SLUG:-second-company-0000abcd}"; exit "\${CHECK_EXIT:-0}";;
 *'company-add.mjs add'*) exit "\${ADD_EXIT:-0}";;
 *'company-add.mjs drop'*) exit 0;;
 *'company-list.mjs'*) printf 'Company "Second Company": Engine http://gtmworks-engine-second-company-0000abcd:8642 (healthy)\\n';;
 *' ps -q web'*) echo web-id;;
 *' ps -q worker'*) echo worker-id;;
 *'network inspect '*) exit 1;;
 *' up -d --wait '*) exit "\${ENGINE_EXIT:-0}";;
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
 writeFileSync(join(directory,'bin/docker'),fakeDocker,{mode:0o755});
 const commands=join(directory,'commands');
 const run=(...args)=>spawnSync('sh',['scripts/install.sh',...args],{cwd:directory,env:{...process.env,PATH:`${directory}/bin:${process.env.PATH}`,COMMANDS:commands,...env},encoding:'utf8'});
 const lines=()=>existsSync(commands)?readFileSync(commands,'utf8').trimEnd().split('\n'):[];
 return {directory,run,lines,envFile:slug=>join(directory,`.engines/${slug}/.env`)};
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
 // Every loop over the install's Engines reads the one lister, and every network the one reader.
 assert.equal((install.match(/for folder in \.engines\/\*\//g)||[]).length,1);
 assert.equal((install.match(/for name in \$\(engine_names\)/g)||[]).length,5);
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
 assert.deepEqual(failed.stdout.trim().split('\n'),['Company "Second Company" was not made: its Engine did not become healthy. Nothing was left behind; run the same command again.']);
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
