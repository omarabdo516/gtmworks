import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { generateInstallEnv } from '../lib/install-env.mjs';

// Hermes must never receive gtmworks's own secrets (#2): not through its environment, an env file or a mounted file.
// Only the install key it serves with (HERMES_API_KEY) is passed to it.
const secretNames=Object.keys(generateInstallEnv()).filter(name=>name!=='HERMES_API_KEY');
function hermesSecretLeaks(compose) {
 const hermes=compose.services.hermes; const leaks=[];
 if(hermes.env_file!==undefined) leaks.push('env_file');
 for(const [key,value] of Object.entries(hermes.environment||{})) {
  if(secretNames.includes(key)) leaks.push(key);
  for(const [,name] of String(value).matchAll(/\$\{?([A-Z0-9_]+)/g)) if(secretNames.includes(name)) leaks.push(name);
 }
 for(const volume of hermes.volumes||[]) if(!/^hermes:\/opt\/data$/.test(String(volume))) leaks.push(`volume ${volume}`);
 return leaks;
}

test('the compose file passes none of gtmworks\'s secrets to Hermes, and the check sees one injected', () => {
 const compose=load(readFileSync('docker-compose.install.yml','utf8'));
 assert.deepEqual(hermesSecretLeaks(compose),[]);
 for(const name of ['SUPABASE_SERVICE_ROLE_KEY','WEBHOOK_ENCRYPTION_KEY','SUPABASE_JWT_SECRET','POSTGRES_PASSWORD','SETUP_CODE']) {
  const injected=structuredClone(compose);
  injected.services.hermes.environment.EXTRA=`\${${name}}`;
  assert.deepEqual(hermesSecretLeaks(injected),[name]);
 }
 const mounted=structuredClone(compose); mounted.services.hermes.volumes.push('./.env.install:/opt/data/.env:ro');
 assert.equal(hermesSecretLeaks(mounted).length,1);
 const filed=structuredClone(compose); filed.services.hermes.env_file='.env.install';
 assert.deepEqual(hermesSecretLeaks(filed),['env_file']);
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

test('the install job runs the scan inside the bundled Hermes with the real secrets, never printing them', () => {
 const install=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.map(step=>step.run||'').join('\n');
 const line=install.split('\n').find(text=>text.includes('check-hermes-keys.py'));
 assert.ok(line,'the scan runs');
 for(const name of ['POSTGRES_PASSWORD','PGSODIUM_ROOT_KEY','SUPABASE_JWT_SECRET','SUPABASE_SERVICE_ROLE_KEY','WEBHOOK_ENCRYPTION_KEY','SETUP_CODE']) assert.ok(line.includes(name),name);
 assert.match(line,/\.env\.install \| compose exec -T -u hermes hermes/);
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
