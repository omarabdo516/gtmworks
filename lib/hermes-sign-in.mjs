import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Part of the Hermes driver (ADR 0009): a company connects its own model subscription through Hermes's own sign-in, run
// by the `hermes` command in that company's Hermes home (#3). gtmworks never reads, copies, logs or shows the credential:
// it starts `hermes auth add <provider> --type oauth --no-browser`, passes on only the link and the code the person
// needs, and learns whether the company is connected from the `<provider> (N credentials):` header `hermes auth list
// <provider>` prints (it never prints a credential value). Disconnecting removes every credential that list shows, one
// `hermes auth remove <provider> <id>` each, by its opaque id. Outcomes are values, never thrown: pending (with the link
// and the code), connected, disconnected or failed.
//
// ChatGPT (openai-codex) signs in by device code: Hermes polls until the person approves, and reads no input. Claude
// (anthropic) shows the person an authorization code after they approve, and Hermes reads it as one line of input; so
// its sign-in is pending with `needsCode`, and `complete` writes the code the Owner pastes to that sign-in's input. The
// code goes only there: never into the arguments, the environment, a log, a store or an answer.
//
// HERMES_COMPANY_HOMES is the folder that holds one Hermes home per company, named by the company id; HERMES_COMMAND is
// the path of the program, taken whole and never split (`hermes` by default). Without HERMES_COMPANY_HOMES there is no
// company home, and nothing is run.
//
// One sign-in at a time per home and provider: it is reserved before anything is awaited, so two connects at once share
// it, and a disconnect waits until its child has ended before it reads or removes anything.

export const signInProviders=['openai-codex','anthropic'];
// The providers whose sign-in ends with a code the person pastes back.
const pastedCode=new Set(['anthropic']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const outputLimit=16384, answerWait=20000, codeWait=1000, signInLifetime=15*60*1000, codeLimit=512;
/** @typedef {{child:import('node:child_process').ChildProcess|null,cancelled:boolean,ready:Promise<SignInState>,ended:Promise<void>,shown:SignInState|null}} Entry */
/** @type {Map<string,Entry>} */
const pending=new Map();

// How many sign-ins wait for a person, across every home, so their number can be bounded (lib/subscription-sign-in.mjs).
export const signInsWaiting=()=>pending.size;

// `unavailable`: the bundled Engine cannot connect this provider for the company (lib/hermes.mjs, ADR 0012).
/** @typedef {{state:'pending',link:string,code:string|null,needsCode?:true}|{state:'connected'|'disconnected'|'failed'|'unavailable'}} SignInState */

/** @param {string} company @param {Record<string,string|undefined>} env @returns {string|null} */
export function companyHermesHome(company,env=process.env) {
 return env.HERMES_COMPANY_HOMES&&typeof company==='string'&&uuid.test(company)?join(env.HERMES_COMPANY_HOMES,company.toLowerCase()):null;
}

const plain=(/** @type {string} */ text)=>text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g,'');
const linkIn=(/** @type {string} */ text)=>plain(text).match(/https:\/\/[^\s"'<>]+/)?.[0]||null;
/** The device code after the word "code", on the same line or on a later one. @param {string} text @returns {string|null} */
export const deviceCode=text=>plain(text).match(/[Cc]ode\b[^\n]*?[:\s]\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\b/)?.[1]||null;
const codeIn=deviceCode;
const header=(/** @type {string} */ provider)=>new RegExp(`^${provider} \\(\\d+ credentials?\\):`);
/**
 * The opaque ids of a provider's credentials in `hermes auth list` output, or null when its header is missing.
 * @param {string} output @param {string} provider @returns {string[]|null}
 */
export function credentialIds(output,provider) {
 const lines=plain(output).replace(/\r/g,'').split('\n'); const start=lines.findIndex(line=>header(provider).test(line));
 if(start<0) return null;
 const ids=[];
 for(const line of lines.slice(start+1)) { if(!line.trim()) break; const id=line.match(/\bid=([A-Za-z0-9_-]+)/)?.[1]; if(id) ids.push(id); }
 return ids;
}
/** A pasted authorization code, trimmed, or null when it is empty, too long or more than one line. @param {unknown} code */
const acceptedCode=code=>{ if(typeof code!=='string'||code.length>codeLimit) return null; const trimmed=code.trim(); return trimmed&&!/[\r\n]/.test(trimmed)?trimmed:null; };

/** @param {{home:string,env?:Record<string,string|undefined>}} options */
export function hermesSignIn({home,env=process.env}) {
 const program=env.HERMES_COMMAND||'hermes';
 // Hermes gets the company home and nothing of gtmworks's own settings, so none of its secrets reach the sign-in.
 const childEnv=Object.fromEntries(Object.entries({PATH:env.PATH,LANG:env.LANG,HOME:home,HERMES_HOME:home}).filter(([,value])=>value));
 const launch=(/** @type {string[]} */ args,input=false)=>{ mkdirSync(home,{recursive:true,mode:0o700}); return spawn(program,args,{env:childEnv,stdio:[input?'pipe':'ignore','pipe','pipe']}); };
 /** @param {string[]} args @returns {Promise<{ok:boolean,output:string}>} */
 const run=args=>new Promise(resolve=>{
  let output=''; const child=launch(args); const timer=setTimeout(()=>child.kill('SIGKILL'),answerWait);
  for(const stream of [child.stdout,child.stderr]) stream?.on('data',chunk=>{ if(output.length<outputLimit) output+=chunk; });
  child.on('error',()=>{ clearTimeout(timer); resolve({ok:false,output:''}); });
  child.on('close',code=>{ clearTimeout(timer); resolve({ok:code===0,output}); });
 });
 /** @param {string} provider @returns {Promise<SignInState>} */
 const listed=async provider=>{ const {ok,output}=await run(['auth','list',provider]); return ok?{state:credentialIds(output,provider)?'connected':'disconnected'}:{state:'failed'}; };
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
  // Reserved now, before the first await, so a second connect finds this one instead of starting its own.
  const key=`${home}\0${provider}`; let ended=()=>{};
  /** @type {Entry} */
  const entry={child:null,cancelled:false,ready:Promise.resolve({state:'failed'}),ended:new Promise(resolve=>{ ended=resolve; }),shown:null};
  pending.set(key,entry);
  const release=()=>{ if(pending.get(key)===entry) pending.delete(key); ended(); };
  entry.ready=listed(provider).then(now=>{
   if(entry.cancelled||now.state!=='disconnected') { release(); return now; }
   let output='';
   const asks=pastedCode.has(provider);
   const child=entry.child=launch(['auth','add',provider,'--type','oauth','--no-browser'],asks);
   // Writing to an input Hermes has already closed must not bring the app down.
   child.stdin?.on('error',()=>{});
   return new Promise(resolve=>{
    const show=()=>{ const link=linkIn(output); if(!link) return; entry.shown=asks?{state:'pending',link,code:null,needsCode:true}:{state:'pending',link,code:codeIn(output)}; clearTimeout(answer); resolve(entry.shown); };
    let grace=/** @type {NodeJS.Timeout|undefined} */(undefined);
    const answer=setTimeout(()=>{ child.kill('SIGKILL'); resolve({state:'failed'}); },answerWait);
    const lifetime=setTimeout(()=>child.kill('SIGKILL'),signInLifetime); lifetime.unref();
    for(const stream of [child.stdout,child.stderr]) stream?.on('data',chunk=>{
     if(entry.shown||output.length>=outputLimit) return; output+=chunk;
     if(linkIn(output)&&(asks?/authorization code:/i.test(plain(output)):codeIn(output))) { clearTimeout(grace); show(); }
     else if(linkIn(output)&&!grace) grace=setTimeout(show,codeWait);
    });
    const end=()=>{ clearTimeout(answer); clearTimeout(grace); clearTimeout(lifetime); release(); resolve({state:'failed'}); };
    child.on('error',end); child.on('close',end);
   });
  }).catch(()=>{ release(); return /** @type {SignInState} */({state:'failed'}); });
  return entry.ready;
 }

 /** @param {string} provider @returns {Promise<SignInState>} */
 async function disconnect(provider) {
  if(!signInProviders.includes(provider)) return {state:'failed'};
  const entry=entryOf(provider);
  // A sign-in under way is stopped, and nothing is read until its child has ended, so none is left running untracked.
  if(entry) { entry.cancelled=true; pending.delete(`${home}\0${provider}`); entry.child?.kill('SIGKILL'); await entry.ended; }
  const {ok,output}=await run(['auth','list',provider]); if(!ok) return {state:'failed'};
  // Each credential is removed by its id, the target `auth remove` requires; the value itself is never seen.
  for(const id of credentialIds(output,provider)||[]) if(!(await run(['auth','remove',provider,id])).ok) return {state:'failed'};
  const after=await listed(provider);
  return after.state==='connected'?{state:'failed'}:after;
 }

 /**
  * Hands the authorization code the Owner pasted to the Claude sign-in waiting for it, then reports where it stands.
  * @param {string} provider @param {unknown} authorizationCode @returns {Promise<SignInState>}
  */
 async function complete(provider,authorizationCode) {
  const code=acceptedCode(authorizationCode); const entry=entryOf(provider);
  if(!pastedCode.has(provider)||!code||!entry?.child?.stdin?.writable||!entry.shown) return {state:'failed'};
  entry.child.stdin.end(`${code}\n`);
  let timer=/** @type {NodeJS.Timeout|undefined} */(undefined);
  const finished=await Promise.race([entry.ended.then(()=>true),new Promise(resolve=>{ timer=setTimeout(resolve,answerWait,false); })]);
  clearTimeout(timer);
  if(!finished) return entry.shown;
  const now=await listed(provider);
  return now.state==='connected'?now:{state:'failed'};
 }

 return {start,state,disconnect,complete};
}
