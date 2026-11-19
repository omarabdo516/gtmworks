import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv } from '../lib/install-env.mjs';

// An Engine must never receive gtmworks's own secrets (#2): not through its environment, an env file or a mounted file.
// Only the Engine's own key (ENGINE_KEY, made from HERMES_API_KEY) is passed to it.
const secretNames=Object.keys(generateInstallEnv()).filter(name=>name!=='HERMES_API_KEY');
function engineSecretLeaks(template) {
 const engine=template.services.engine; const leaks=[];
 if(engine.env_file!==undefined) leaks.push('env_file');
 for(const [key,value] of Object.entries(engine.environment||{})) {
  if(secretNames.includes(key)) leaks.push(key);
  for(const [,name] of String(value).matchAll(/\$\{?([A-Z0-9_]+)/g)) if(secretNames.includes(name)) leaks.push(name);
 }
 for(const volume of engine.volumes||[]) if(!/^data:\/opt\/data$/.test(String(volume))) leaks.push(`volume ${volume}`);
 return leaks;
}

test('the Engine template passes none of gtmworks\'s secrets to an Engine, and the check sees one injected', () => {
 const template=load(readFileSync('scripts/engine-template.yml','utf8'));
 assert.deepEqual(engineSecretLeaks(template),[]);
 for(const name of ['SUPABASE_SERVICE_ROLE_KEY','WEBHOOK_ENCRYPTION_KEY','SUPABASE_JWT_SECRET','POSTGRES_PASSWORD','SETUP_CODE']) {
  const injected=structuredClone(template);
  injected.services.engine.environment.EXTRA=`\${${name}}`;
  assert.deepEqual(engineSecretLeaks(injected),[name]);
 }
 const mounted=structuredClone(template); mounted.services.engine.volumes.push('./.env.install:/opt/data/.env:ro');
 assert.equal(engineSecretLeaks(mounted).length,1);
 const filed=structuredClone(template); filed.services.engine.env_file='.env.install';
 assert.deepEqual(engineSecretLeaks(filed),['env_file']);
});

test('the runtime scan finds a secret in the environment or a readable file, and prints no value', t => {
 const root=mkdtempSync(join(tmpdir(),'hermes-secrets-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'profiles/co-1/memories'),{recursive:true});
 writeFileSync(join(root,'profiles/co-1/memories/MEMORY.md'),'nothing secret here');
 const secrets='SUPABASE_SERVICE_ROLE_KEY=service-secret-value\nWEBHOOK_ENCRYPTION_KEY=webhook-secret-value\n';
 const scan=env=>spawnSync('python3',['scripts/check-hermes-keys.py',root],{input:secrets,encoding:'utf8',env:{PATH:process.env.PATH,...env}});
 const clean=scan({});
 assert.equal(clean.status,0,clean.stdout+clean.stderr);
 const named=scan({WEBHOOK_ENCRYPTION_KEY:'x'});
 assert.equal(named.status,1); assert.match(named.stdout,/names WEBHOOK_ENCRYPTION_KEY/);
 const held=scan({OTHER:'prefix service-secret-value'});
 assert.equal(held.status,1); assert.match(held.stdout,/holds the value of SUPABASE_SERVICE_ROLE_KEY/);
 writeFileSync(join(root,'profiles/co-1/.env'),'KEY=webhook-secret-value');
 const filed=scan({});
 assert.equal(filed.status,1); assert.match(filed.stdout,/co-1\/\.env holds the value of WEBHOOK_ENCRYPTION_KEY/);
 for(const result of [named,held,filed]) assert.doesNotMatch(result.stdout,/secret-value/);
 assert.equal(spawnSync('python3',['scripts/check-hermes-keys.py',root],{input:'',encoding:'utf8'}).status,2,'an empty list never passes');
});

test('the install job runs the scan inside the first Engine with the real secrets, never printing them', () => {
 const install=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.map(step=>step.run||'').join('\n');
 const line=install.split('\n').find(text=>text.includes('check-hermes-keys.py'));
 assert.ok(line,'the scan runs');
 for(const name of ['POSTGRES_PASSWORD','PGSODIUM_ROOT_KEY','SUPABASE_JWT_SECRET','SUPABASE_SERVICE_ROLE_KEY','WEBHOOK_ENCRYPTION_KEY','SETUP_CODE']) assert.ok(line.includes(name),name);
 assert.match(line,/\.env\.install \| docker exec -i -u hermes "\$name"/);
 // Every Engine's own folder is scanned, the first and each Company's.
 assert.match(install,/for folder in \.engines\/\*\/; do/);
 assert.match(install,/\[\[ \$engines_scanned -ge 2 \]\]/);
});

test('the runtime scan reads large files in chunks, also finding a value split across two chunks', t => {
 const root=mkdtempSync(join(tmpdir(),'hermes-large-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
 const secrets='SUPABASE_JWT_SECRET=jwt-secret-value-0123456789\n';
 const scan=env=>spawnSync('python3',['scripts/check-hermes-keys.py',root],{input:secrets,encoding:'utf8',env:{PATH:process.env.PATH,...env}});
 // A file larger than the 64 MiB the first version skipped, with the value at its very end.
 const large=Buffer.alloc(65*1024*1024,0x61); Buffer.from('jwt-secret-value-0123456789').copy(large,large.length-27);
 writeFileSync(join(root,'large.bin'),large);
 const found=scan({});
 assert.equal(found.status,1,found.stdout); assert.match(found.stdout,/large\.bin holds the value of SUPABASE_JWT_SECRET/);
 rmSync(join(root,'large.bin'));
 // With 16-byte chunks the value straddles a boundary.
 writeFileSync(join(root,'split.txt'),`${'x'.repeat(10)}jwt-secret-value-0123456789${'y'.repeat(10)}`);
 const split=scan({HERMES_KEYS_CHUNK:'16'});
 assert.equal(split.status,1,split.stdout); assert.match(split.stdout,/split\.txt holds the value of SUPABASE_JWT_SECRET/);
 rmSync(join(root,'split.txt'));
 assert.equal(scan({HERMES_KEYS_CHUNK:'16'}).status,0);
});
