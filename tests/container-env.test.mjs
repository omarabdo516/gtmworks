import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { CONTAINER_ENV, HOST_ONLY_ENV, generateInstallEnv, validateContainerEnv } from '../lib/install-env.mjs';
import { checkSettings } from '../lib/settings.mjs';

// #446: the web app and the worker get only the values they read, never the whole .env.install. The database password,
// pgsodium's root key and the JWT secret stay with the database, auth, REST and storage containers and the installer.
const compose=load(readFileSync('docker-compose.install.yml','utf8'));
const container=(env,service)=>Object.fromEntries(CONTAINER_ENV[service].map(name=>[name,env[name]]));

test('the web and worker containers name each value they get, and none of the host-only secrets', () => {
 for(const service of ['web','worker']) {
  const definition=compose.services[service];
  assert.equal(definition.env_file,undefined,`${service} reads no env_file: it would hand it every value in .env.install`);
  const environment=definition.environment;
  assert.deepEqual(Object.keys(environment).sort(),[...CONTAINER_ENV[service],'GTMWORKS_SELF_HOSTED'].sort(),`${service} gets exactly its list`);
  for(const name of CONTAINER_ENV[service]) assert.equal(environment[name],`\${${name}:?Run scripts/install.sh}`,`${service} takes ${name} from .env.install by its own name`);
  for(const name of HOST_ONLY_ENV) {
   assert.equal(Object.hasOwn(environment,name),false,`${service} is not given ${name}`);
   assert.doesNotMatch(JSON.stringify(environment),new RegExp(`\\$\\{${name}\\b`),`${service} interpolates no ${name}`);
  }
  assert.match(definition.command.join(' '),new RegExp(`install-env\\.mjs validate ${service} &&`),`${service} checks its own list before it starts`);
 }
 // The worker reads no setup code and serves no browser, so it has neither the setup code nor the public address.
 assert.equal(CONTAINER_ENV.worker.includes('SETUP_CODE'),false);
 assert.equal(CONTAINER_ENV.worker.includes('SUPABASE_PUBLIC_URL'),false);
 // The services that do need the host-only secrets still get them.
 assert.match(JSON.stringify(compose.services.db.environment),/POSTGRES_PASSWORD/);
 assert.match(JSON.stringify(compose.services.auth.environment),/SUPABASE_JWT_SECRET/);
});

test('a container accepts its own list of install values and refuses a host-only secret', () => {
 const env=generateInstallEnv();
 for(const service of ['web','worker']) {
  assert.doesNotThrow(()=>validateContainerEnv(container(env,service),service));
  for(const name of HOST_ONLY_ENV) {
   assert.throws(()=>validateContainerEnv({...container(env,service),[name]:env[name]},service),new RegExp(`${name} belongs to the installer`));
  }
  for(const name of CONTAINER_ENV[service]) {
   const missing=container(env,service); delete missing[name];
   assert.throws(()=>validateContainerEnv(missing,service),new RegExp(name),`${service} without ${name}`);
  }
 }
 // A key with the wrong role, or one that expired, is refused even without the secret that signed it.
 const swapped={...container(env,'web'),SUPABASE_SERVICE_ROLE_KEY:env.NEXT_PUBLIC_SUPABASE_ANON_KEY};
 assert.throws(()=>validateContainerEnv(swapped,'web'),/SUPABASE_SERVICE_ROLE_KEY/);
 const [header,,mac]=env.SUPABASE_SERVICE_ROLE_KEY.split('.');
 const expired=`${header}.${Buffer.from(JSON.stringify({role:'service_role',exp:1})).toString('base64url')}.${mac}`;
 assert.throws(()=>validateContainerEnv({...container(env,'worker'),SUPABASE_SERVICE_ROLE_KEY:expired},'worker'),/SUPABASE_SERVICE_ROLE_KEY/);
 assert.throws(()=>validateContainerEnv({...container(env,'web'),SETUP_CODE:'replace-me'},'web'),/SETUP_CODE/);
 assert.throws(()=>validateContainerEnv(container(env,'web'),'gateway'),/web or worker/);
});

test('the containers\' check runs from the command line, as their compose command runs it', () => {
 const env=generateInstallEnv();
 const run=(args,values)=>spawnSync(process.execPath,['lib/install-env.mjs',...args],{encoding:'utf8',env:{PATH:process.env.PATH,...values}});
 assert.equal(run(['validate','web'],container(env,'web')).status,0);
 assert.equal(run(['validate','worker'],container(env,'worker')).status,0);
 const held=run(['validate','web'],{...container(env,'web'),POSTGRES_PASSWORD:env.POSTGRES_PASSWORD});
 assert.equal(held.status,1);
 assert.match(held.stderr,/POSTGRES_PASSWORD belongs to the installer/);
 assert.doesNotMatch(held.stderr+held.stdout,new RegExp(env.POSTGRES_PASSWORD),'the refusal names the value, never prints it');
 // The installer's own check of the whole file is unchanged.
 assert.equal(run(['validate','complete'],env).status,0);
});

test('the app\'s production settings do not ask for the JWT secret it never reads', () => {
 const env=generateInstallEnv();
 assert.doesNotThrow(()=>checkSettings({...container(env,'web'),NODE_ENV:'production',GTMWORKS_SELF_HOSTED:'true'}));
 assert.doesNotThrow(()=>checkSettings({...container(env,'worker'),NODE_ENV:'production',GTMWORKS_SELF_HOSTED:'true'}));
});
