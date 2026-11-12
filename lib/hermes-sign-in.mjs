import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Part of the Hermes driver (ADR 0009): a company connects its own model subscription through Hermes's own sign-in, run
// by the `hermes` command in that company's Hermes home (#3). gtmworks never reads, copies, logs or shows the credential:
// it starts `hermes auth add <provider> --type oauth --no-browser`, passes on only the link and the code the person
// needs, and learns whether the company is connected from which providers `hermes auth list` names. Disconnecting is
// `hermes auth remove <provider>`. Outcomes are values, never thrown: pending (with the link and the code), connected,
// disconnected or failed.
//
// HERMES_COMPANY_HOMES is the folder that holds one Hermes home per company, named by the company id; HERMES_COMMAND is
// the program and its leading arguments, split on spaces (`hermes` by default). Without HERMES_COMPANY_HOMES there is no
// company home, and nothing is run.

export const signInProviders=['openai-codex','anthropic'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const outputLimit=16384, answerWait=20000, codeWait=1000, signInLifetime=15*60*1000;
/** @type {Map<string,{child:import('node:child_process').ChildProcess,ready:Promise<SignInState>,shown:SignInState|null}>} */
const pending=new Map();

/** @typedef {{state:'pending',link:string,code:string|null}|{state:'connected'|'disconnected'|'failed'}} SignInState */

/** @param {string} company @param {Record<string,string|undefined>} env @returns {string|null} */
export function companyHermesHome(company,env=process.env) {
 return env.HERMES_COMPANY_HOMES&&typeof company==='string'&&uuid.test(company)?join(env.HERMES_COMPANY_HOMES,company.toLowerCase()):null;
}

const plain=(/** @type {string} */ text)=>text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g,'');
const linkIn=(/** @type {string} */ text)=>plain(text).match(/https:\/\/[^\s"'<>]+/)?.[0]||null;
const codeIn=(/** @type {string} */ text)=>plain(text).match(/[Cc]ode\b[^\n]*?\b([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\b/)?.[1]||null;
const names=(/** @type {string} */ output,/** @type {string} */ provider)=>plain(output).split('\n').some(line=>new RegExp(`(^|[^\\w-])${provider}($|[^\\w-])`).test(line));

/** @param {{home:string,env?:Record<string,string|undefined>}} options */
export function hermesSignIn({home,env=process.env}) {
 const [program,...leading]=(env.HERMES_COMMAND||'hermes').trim().split(/\s+/);
 // Hermes gets the company home and nothing of gtmworks's own settings, so none of its secrets reach the sign-in.
 const childEnv=Object.fromEntries(Object.entries({PATH:env.PATH,LANG:env.LANG,HOME:home,HERMES_HOME:home}).filter(([,value])=>value));
 const launch=(/** @type {string[]} */ args)=>{ mkdirSync(home,{recursive:true,mode:0o700}); return spawn(program,[...leading,...args],{env:childEnv,stdio:['ignore','pipe','pipe']}); };
 /** @param {string[]} args @returns {Promise<{ok:boolean,output:string}>} */
 const run=args=>new Promise(resolve=>{
  let output=''; const child=launch(args); const timer=setTimeout(()=>child.kill('SIGKILL'),answerWait);
  for(const stream of [child.stdout,child.stderr]) stream?.on('data',chunk=>{ if(output.length<outputLimit) output+=chunk; });
  child.on('error',()=>{ clearTimeout(timer); resolve({ok:false,output:''}); });
  child.on('close',code=>{ clearTimeout(timer); resolve({ok:code===0,output}); });
 });
 /** @param {string} provider @returns {Promise<SignInState>} */
 const listed=async provider=>{ const {ok,output}=await run(['auth','list']); return ok?{state:names(output,provider)?'connected':'disconnected'}:{state:'failed'}; };
 const entryOf=(/** @type {string} */ provider)=>pending.get(`${home}\0${provider}`);

 /** @param {string} provider @returns {Promise<SignInState>} */
 async function state(provider) {
  if(!signInProviders.includes(provider)) return {state:'failed'};
  const entry=entryOf(provider);
  if(entry) return entry.shown||await entry.ready;
  return listed(provider);
 }

 /** @param {string} provider @returns {Promise<SignInState>} */
 async function start(provider) {
  if(!signInProviders.includes(provider)) return {state:'failed'};
  const waiting=entryOf(provider); if(waiting) return waiting.shown||await waiting.ready;
  const now=await listed(provider); if(now.state!=='disconnected') return now;
  const key=`${home}\0${provider}`; let output='';
  const child=launch(['auth','add',provider,'--type','oauth','--no-browser']);
  /** @type {{child:typeof child,ready:Promise<SignInState>,shown:SignInState|null}} */
  const entry={child,ready:Promise.resolve({state:'failed'}),shown:null};
  entry.ready=new Promise(resolve=>{
   const show=()=>{ const link=linkIn(output); if(!link) return; entry.shown={state:'pending',link,code:codeIn(output)}; clearTimeout(answer); resolve(entry.shown); };
   let grace=/** @type {NodeJS.Timeout|undefined} */(undefined);
   const answer=setTimeout(()=>{ child.kill('SIGKILL'); resolve({state:'failed'}); },answerWait);
   const lifetime=setTimeout(()=>child.kill('SIGKILL'),signInLifetime); lifetime.unref();
   for(const stream of [child.stdout,child.stderr]) stream?.on('data',chunk=>{
    if(entry.shown||output.length>=outputLimit) return; output+=chunk;
    if(linkIn(output)&&codeIn(output)) { clearTimeout(grace); show(); }
    else if(linkIn(output)&&!grace) grace=setTimeout(show,codeWait);
   });
   const end=()=>{ clearTimeout(answer); clearTimeout(grace); clearTimeout(lifetime); if(pending.get(key)===entry) pending.delete(key); resolve({state:'failed'}); };
   child.on('error',end); child.on('close',end);
  });
  pending.set(key,entry);
  return entry.ready;
 }

 /** @param {string} provider @returns {Promise<SignInState>} */
 async function disconnect(provider) {
  if(!signInProviders.includes(provider)) return {state:'failed'};
  const entry=entryOf(provider);
  if(entry) { pending.delete(`${home}\0${provider}`); entry.child.kill('SIGKILL'); }
  const now=await listed(provider); if(now.state!=='connected') return now;
  const removed=await run(['auth','remove',provider]);
  return removed.ok?listed(provider):{state:'failed'};
 }

 return {start,state,disconnect};
}
