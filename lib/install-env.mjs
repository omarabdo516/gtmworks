import { randomBytes, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkSettings } from './settings.mjs';
import { generateSetupCode, isSetupCode } from './setup-code.mjs';
import { setupLink } from './setup-link.mjs';

const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const signature=(body,secret)=>createHmac('sha256',secret).update(body).digest('base64url');
export function generateInstallEnv() {
 const secret=randomBytes(32).toString('hex');
 const token=role=>{
  const body=`${encode({alg:'HS256',typ:'JWT'})}.${encode({role,iss:'supabase',exp:4102444800})}`;
  return `${body}.${signature(body,secret)}`;
 };
 return {POSTGRES_PASSWORD:randomBytes(32).toString('hex'),PGSODIUM_ROOT_KEY:randomBytes(32).toString('hex'),SUPABASE_JWT_SECRET:secret,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:token('anon'),SUPABASE_SERVICE_ROLE_KEY:token('service_role'),
  WEBHOOK_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'http://localhost:3000',
  SUPABASE_PUBLIC_URL:'http://localhost:3000',NEXT_PUBLIC_SUPABASE_URL:'http://gateway:8080',...setupCode()};
}
// An Engine's key (ADR 0018): the installer makes it into the Engine's own file (.engines/first/.env), where only that
// Engine and the installer read it. It never sits in .env.install, the file the app and the worker read their
// environment from (#385).
export const generateEngineKey=()=>randomBytes(32).toString('hex');
// The one-time code in the setup link the installer prints (issue #50); only the app reads it.
const setupCode=()=>({SETUP_CODE:generateSetupCode()});
// What an install made before a value existed lacks, generated now so `install.sh update` keeps it upgradable.
export function missingInstallEnv(env) {
 return Object.fromEntries(Object.entries(setupCode()).filter(([name])=>!env[name]));
}
// The installer's last line: the setup link while first run is open, the sign-in address after. Nothing else prints the code.
export function readyLine(env,setup) {
 return setup==='open'?`Set up gtmworks with this one-time link: ${setupLink(env.APP_ORIGIN,env.SETUP_CODE)}`
  :`gtmworks is ready: ${env.APP_ORIGIN}/sign-in`;
}

// The containers, and the installer before ADR 0010 (whose update runs this file once downloaded), accept an install
// with no Hermes key yet; `complete` (this installer, after adding what is missing) requires a setup code. A key found
// here is always checked: an install made before ADR 0018 still holds the Engine's key as HERMES_API_KEY until the
// installer moves it into the Engine's own file (#385), and a wrong one is never adopted.
export function validateInstallEnv(env,{complete=false}={}) {
 for(const name of ['POSTGRES_PASSWORD','PGSODIUM_ROOT_KEY','SUPABASE_JWT_SECRET']) {
  if(!/^[a-f0-9]{64}$/.test(env[name] || '') || /^(.)\1+$/.test(env[name])) throw new Error(`${name} must be an install-generated secret`);
 }
 if(env.HERMES_API_KEY!==undefined && (!/^[a-f0-9]{64}$/.test(env.HERMES_API_KEY) || /^(.)\1+$/.test(env.HERMES_API_KEY))) throw new Error('HERMES_API_KEY must be an install-generated secret');
 if((complete || env.SETUP_CODE!==undefined) && !isSetupCode(env.SETUP_CODE)) throw new Error('SETUP_CODE must be an install-generated secret');
 for(const [name,role] of KEY_ROLES) if(!supabaseKey(env[name],role,env.SUPABASE_JWT_SECRET)) throw new Error(`${name} must be signed with SUPABASE_JWT_SECRET for ${role}`);
 checkSharedValues(env);
 checkPublicUrl(env);
}

const KEY_ROLES=[['NEXT_PUBLIC_SUPABASE_ANON_KEY','anon'],['SUPABASE_SERVICE_ROLE_KEY','service_role']];
// A Supabase key of the install: an unexpired HS256 token for its role and, given the secret that signed it, signed by it.
function supabaseKey(value,role,secret) {
 const [header,payload,mac,...extra]=(value || '').split('.');
 try {
  const claims=JSON.parse(Buffer.from(payload,'base64url'));
  return !extra.length && !!mac && JSON.parse(Buffer.from(header,'base64url')).alg==='HS256' && claims.role===role && claims.exp>Date.now()/1000
   && (secret===undefined || mac===signature(`${header}.${payload}`,secret));
 } catch { return false; }
}
function checkSharedValues(env) {
 if(new Set(Buffer.from(env.WEBHOOK_ENCRYPTION_KEY || '', 'base64')).size<2) throw new Error('WEBHOOK_ENCRYPTION_KEY must be an install-generated secret');
 checkSettings({...env,NODE_ENV:'production',GTMWORKS_SELF_HOSTED:'true'});
}
function checkPublicUrl(env) {
 const publicUrl=new URL(env.SUPABASE_PUBLIC_URL);
 if(publicUrl.origin!==env.APP_ORIGIN || publicUrl.href!==`${env.APP_ORIGIN}/`) throw new Error('SUPABASE_PUBLIC_URL must equal APP_ORIGIN');
}

// What the web app and the worker get from .env.install, and nothing more (#446): docker-compose.install.yml names each
// value by its own name, and tests/container-env.test.mjs holds the file to these lists. The database password,
// pgsodium's root key and the JWT secret stay with the installer and the database, auth, REST and storage containers:
// the app never reads them, and with them a break-in into the app could sign in to the database as `postgres` or mint a
// token for anyone, past every grant and row-level policy.
const SHARED_ENV=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','WEBHOOK_ENCRYPTION_KEY','APP_ORIGIN'];
export const CONTAINER_ENV={web:[...SHARED_ENV,'SUPABASE_PUBLIC_URL','SETUP_CODE'],worker:SHARED_ENV};
// Values an install may add when it wants what they unlock, each by its own name and empty when not set: the install's
// own Meta app for Meta Ads (#914, docs/connect-meta-ads.md), read by the web app only, on the server.
export const OPTIONAL_ENV={web:['META_ADS_CLIENT_ID','META_ADS_CLIENT_SECRET'],worker:[]};
export const HOST_ONLY_ENV=['POSTGRES_PASSWORD','PGSODIUM_ROOT_KEY','SUPABASE_JWT_SECRET'];
// The check each container runs before it starts: its own values are there and well formed, and no host-only secret
// reached it. The keys' signatures are the installer's check (`validate complete`), since checking one needs the secret.
export function validateContainerEnv(env,service) {
 if(!Object.hasOwn(CONTAINER_ENV,service)) throw new Error('validate names the web or worker container');
 for(const name of HOST_ONLY_ENV) if(env[name]!==undefined) throw new Error(`${name} belongs to the installer and the database, not the ${service} container`);
 for(const name of CONTAINER_ENV[service]) if(!env[name]?.trim()) throw new Error(`${name} must be set`);
 for(const [name,role] of KEY_ROLES) if(!supabaseKey(env[name],role)) throw new Error(`${name} must be an install key for ${role}`);
 checkSharedValues(env);
 if(service==='web') {
  if(!isSetupCode(env.SETUP_CODE)) throw new Error('SETUP_CODE must be an install-generated secret');
  checkPublicUrl(env);
 }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  if(process.argv[2]==='generate') console.log(Object.entries(generateInstallEnv()).map(([name,value])=>`${name}=${value}`).join('\n'));
  else if(process.argv[2]==='engine-key') console.log(generateEngineKey());
  else if(process.argv[2]==='missing') Object.entries(missingInstallEnv(process.env)).forEach(([name,value])=>console.log(`${name}=${value}`));
  else if(process.argv[2]==='validate'&&[undefined,'complete'].includes(process.argv[3])) validateInstallEnv(process.env,{complete:process.argv[3]==='complete'});
  else if(process.argv[2]==='validate'&&Object.hasOwn(CONTAINER_ENV,process.argv[3])) validateContainerEnv(process.env,process.argv[3]);
  else if(process.argv[2]==='ready') console.log(readyLine(process.env,process.argv[3]));
  else throw new Error('usage: install-env.mjs generate | engine-key | missing | validate [complete | web | worker] | ready [open]');
 } catch(error) { console.error(error.message); process.exitCode=1; }
}
