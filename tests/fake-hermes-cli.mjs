#!/usr/bin/env node
// A stand-in for the `hermes` command's sign-in subcommands (#3), run in the home HERMES_HOME names, as the real one is.
// `auth add <provider> --type oauth --no-browser` prints a link and a code, then waits until the person finishes: a test
// finishes by creating `<home>/.finish-<provider>`. The credential is then stored in `<home>/auth.json`. `auth list`
// prints every stored provider with its whole credential, so a caller that passes the output on is caught leaking it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const home=process.env.HERMES_HOME; const [area,action,provider,...options]=process.argv.slice(2);
if(!home||area!=='auth') { console.error('usage: hermes auth add|list|remove'); process.exit(2); }
mkdirSync(home,{recursive:true});
const file=join(home,'auth.json');
const stored=()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
// What the fake was started with, apart from the credential, so a test can see the environment a sign-in ran in.
writeFileSync(join(home,`.env-${action}`),JSON.stringify(Object.keys(process.env)));
if(action==='list') { for(const [name,credential] of Object.entries(stored())) console.log(`${name} (oauth) ${credential.access_token}`); process.exit(0); }
if(action==='remove') { const all=stored(); if(!all[provider]) { console.error(`No credential for ${provider}`); process.exit(1); } delete all[provider]; writeFileSync(file,JSON.stringify(all)); console.log(`Removed ${provider}`); process.exit(0); }
if(action!=='add'||!['openai-codex','anthropic'].includes(provider)||options.join(' ')!=='--type oauth --no-browser') { console.error('unsupported'); process.exit(2); }
const code=provider==='anthropic'?'CLDE-7Q2P':'WXYZ-4K8M';
console.log(`\u001b[1mSign in to ${provider}\u001b[0m\nOpen this link in a browser: https://auth.example.test/device?provider=${provider}\nThen enter this code: ${code}\nWaiting for you to finish...`);
const finish=join(home,`.finish-${provider}`);
const wait=setInterval(()=>{
 if(!existsSync(finish)) return;
 clearInterval(wait); rmSync(finish);
 writeFileSync(file,JSON.stringify({...stored(),[provider]:{access_token:`fake-subscription-secret-${randomUUID()}`}}),{mode:0o600});
 console.log('Signed in.'); process.exit(0);
},50);
