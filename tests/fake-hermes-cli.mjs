#!/usr/bin/env node
// A stand-in for the `hermes` command's sign-in subcommands (#3), run in the home HERMES_HOME names, as the real one is,
// and faithful to what Hermes v0.23.0 prints and accepts:
// - `auth add openai-codex --type oauth --no-browser` prints a link and, on its own line under its label, a device code,
//   then waits until the person finishes: a test finishes by creating `<home>/.finish-openai-codex`. It reads no input.
// - `auth add anthropic --type oauth --no-browser` prints an authorization link, asks for the code the person is shown
//   and reads one line from standard input. Only the accepted code (`fake-authorization-code-7Q2P`) signs in; another
//   code fails, and end of input without a line returns without saving, exiting non-zero.
// - `auth list [provider]` prints, per provider with credentials, a `<provider> (N credentials):` header, one row per
//   credential with its opaque `id=`, then a blank line, and finally the notice about external logins. It never prints a
//   credential value.
// - `auth remove <provider> <target>` needs both; the target is a credential's index, id or exact label. Without one it
//   exits 2, as argparse does.
// A credential is stored in `<home>/auth.json`.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const home=process.env.HERMES_HOME; const [area,action,...rest]=process.argv.slice(2);
const usage=(/** @type {string} */ message)=>{ console.error(`usage: hermes auth {add,list,remove} ...\nhermes: error: ${message}`); process.exit(2); };
if(!home||area!=='auth') usage('the following arguments are required: auth');
mkdirSync(home,{recursive:true});
const file=join(home,'auth.json');
/** @returns {Record<string,{id:string,label:string,access_token:string}[]>} */
const stored=()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
const save=(/** @type {ReturnType<typeof stored>} */ all)=>writeFileSync(file,JSON.stringify(all),{mode:0o600});
// What the fake was started with, so a test can see the environment and the arguments a run got.
writeFileSync(join(home,`.env-${action}`),JSON.stringify(Object.keys(process.env)));
appendFileSync(join(home,`.seen-${action}`),`${JSON.stringify({argv:process.argv.slice(2),env:process.env})}\n`);

if(action==='list') {
 const [only]=rest;
 for(const [provider,credentials] of Object.entries(stored())) {
  if(only&&provider!==only||!credentials.length) continue;
  console.log(`${provider} (${credentials.length} credential${credentials.length===1?'':'s'}):`);
  credentials.forEach((credential,index)=>console.log(`  #${index+1}  ${credential.label.padEnd(20)} oauth id=${credential.id} priority=0 ${provider==='anthropic'?'claude_oauth':'device_code'} ok ${index===0?'←':''}`));
  console.log('');
 }
 console.log('External CLI logins (Codex CLI, Claude Code) are not adopted: sign in with `hermes auth add` instead.');
 process.exit(0);
}

if(action==='remove') {
 const [provider,target]=rest;
 if(!provider||!target) usage('the following arguments are required: target');
 const all=stored(); const credentials=all[provider]||[];
 const index=credentials.findIndex((credential,at)=>credential.id===target||credential.label===target||String(at+1)===target.replace(/^#/,''));
 if(index<0) { console.error(`No credential matching '${target}' for ${provider}.`); process.exit(1); }
 credentials.splice(index,1);
 if(credentials.length) all[provider]=credentials; else delete all[provider];
 save(all); console.log(`Removed ${provider} credential #${index+1}`); process.exit(0);
}

const [provider,...options]=rest;
if(action!=='add'||!['openai-codex','anthropic'].includes(provider)||options.join(' ')!=='--type oauth --no-browser') usage('unsupported');
// Every sign-in started is counted, so a test can see that two connects at once start only one.
appendFileSync(join(home,'.adds'),`${provider}\n`);
const signedIn=()=>{
 const all=stored();
 all[provider]=[...(all[provider]||[]),{id:randomBytes(4).toString('hex'),label:`${provider}-oauth`,access_token:`fake-subscription-secret-${randomUUID()}`}];
 save(all); console.log('Signed in.'); process.exit(0);
};
// A sign-in nobody finishes gives up, so a failed test leaves no fake running to hold the test runner open.
setTimeout(()=>{ console.error('Timed out waiting for the sign-in.'); process.exit(1); },30000).unref();

if(provider==='anthropic') {
 console.log(`\u001b[1mSign in to Claude\u001b[0m\nOpen this link in a browser to authorize:\n  https://auth.example.test/oauth/authorize?provider=anthropic\n\nAfter authorizing, you will see a code. Paste it below.`);
 process.stdout.write('Authorization code: ');
 const lines=createInterface({input:process.stdin}); let answered=false;
 lines.once('line',line=>{
  answered=true; lines.close();
  if(line.trim()!=='fake-authorization-code-7Q2P') { console.error('Authorization failed: the code was not accepted.'); process.exit(1); }
  signedIn();
 });
 lines.once('close',()=>{ if(!answered) { console.log(''); process.exit(1); } });
} else {
 // The code is printed on its own line under its label, as a device sign-in prints it.
 console.log(`\u001b[1mSign in to ${provider}\u001b[0m\nOpen this link in a browser: https://auth.example.test/device?provider=${provider}\nEnter this code:\n    WXYZ-4K8M\nWaiting for you to finish...`);
 const finish=join(home,`.finish-${provider}`);
 const wait=setInterval(()=>{
  if(!existsSync(finish)) return;
  clearInterval(wait); rmSync(finish); signedIn();
 },50);
}
