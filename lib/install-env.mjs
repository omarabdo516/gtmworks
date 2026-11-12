import { randomBytes, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkSettings } from './settings.mjs';
import { generateSetupCode, isSetupCode } from './setup-code.mjs';

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
  SUPABASE_PUBLIC_URL:'http://localhost:3000',NEXT_PUBLIC_SUPABASE_URL:'http://gateway:8080',...setupCode(),...hermesKey()};
}
// The key the worker uses for the bundled Hermes (ADR 0010); Hermes reads it from the same file.
const hermesKey=()=>({HERMES_API_KEY:randomBytes(32).toString('hex')});
// The one-time code in the setup link the installer prints (issue #50); only the app reads it.
const setupCode=()=>({SETUP_CODE:generateSetupCode()});
// What an install made before a value existed lacks, generated now so `install.sh update` keeps it upgradable.
export function missingInstallEnv(env) {
 return Object.fromEntries(Object.entries({...setupCode(),...hermesKey()}).filter(([name])=>!env[name]));
}
// The installer's last line: the setup link while first run is open, the sign-in address after. Nothing else prints the code.
export function readyLine(env,setup) {
 return setup==='open'?`Set up gtmworks with this one-time link: ${env.APP_ORIGIN}/first-run?code=${env.SETUP_CODE}`
  :`gtmworks is ready: ${env.APP_ORIGIN}/sign-in`;
}

// The containers, and the installer before ADR 0010 (whose update runs this file once downloaded), accept an install
// with no Hermes key yet; `complete` (this installer, after adding what is missing) requires it. A present key is
// always checked.
export function validateInstallEnv(env,{complete=false}={}) {
 for(const name of ['POSTGRES_PASSWORD','PGSODIUM_ROOT_KEY','SUPABASE_JWT_SECRET','HERMES_API_KEY']) {
  if(name==='HERMES_API_KEY'&&!complete&&env[name]===undefined) continue;
  if(!/^[a-f0-9]{64}$/.test(env[name] || '') || /^(.)\1+$/.test(env[name])) throw new Error(`${name} must be an install-generated secret`);
 }
 if((complete || env.SETUP_CODE!==undefined) && !isSetupCode(env.SETUP_CODE)) throw new Error('SETUP_CODE must be an install-generated secret');
 for(const [name,role] of [['NEXT_PUBLIC_SUPABASE_ANON_KEY','anon'],['SUPABASE_SERVICE_ROLE_KEY','service_role']]) {
  const [header,payload,mac,...extra]=(env[name] || '').split('.');
  let valid=false;
  try {
   const claims=JSON.parse(Buffer.from(payload,'base64url'));
   valid=!extra.length && JSON.parse(Buffer.from(header,'base64url')).alg==='HS256' && claims.role===role && claims.exp>Date.now()/1000 && mac===signature(`${header}.${payload}`,env.SUPABASE_JWT_SECRET);
  } catch { valid=false; }
  if(!valid) throw new Error(`${name} must be signed with SUPABASE_JWT_SECRET for ${role}`);
 }
 if(new Set(Buffer.from(env.WEBHOOK_ENCRYPTION_KEY || '', 'base64')).size<2) throw new Error('WEBHOOK_ENCRYPTION_KEY must be an install-generated secret');
 checkSettings({...env,NODE_ENV:'production',GTMWORKS_SELF_HOSTED:'true'});
 const publicUrl=new URL(env.SUPABASE_PUBLIC_URL);
 if(publicUrl.origin!==env.APP_ORIGIN || publicUrl.href!==`${env.APP_ORIGIN}/`) throw new Error('SUPABASE_PUBLIC_URL must equal APP_ORIGIN');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  if(process.argv[2]==='generate') console.log(Object.entries(generateInstallEnv()).map(([name,value])=>`${name}=${value}`).join('\n'));
  else if(process.argv[2]==='missing') Object.entries(missingInstallEnv(process.env)).forEach(([name,value])=>console.log(`${name}=${value}`));
  else if(process.argv[2]==='validate'&&[undefined,'complete'].includes(process.argv[3])) validateInstallEnv(process.env,{complete:process.argv[3]==='complete'});
  else if(process.argv[2]==='ready') console.log(readyLine(process.env,process.argv[3]));
  else throw new Error('usage: install-env.mjs generate | missing | validate [complete] | ready [open]');
 } catch(error) { console.error(error.message); process.exitCode=1; }
}
