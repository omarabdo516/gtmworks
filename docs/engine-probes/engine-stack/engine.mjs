// What every probe of spec #822 shares: the throwaway Engine's two listeners, reached over HTTP from outside as gtmworks
// reaches them (lib/hermes.mjs), and a loud failure that prints the Engine's own answer. Nothing here opens a Hermes
// file or database.
export const engine={run:process.env.ENGINE_RUN,manage:process.env.ENGINE_MANAGE,key:process.env.ENGINE_KEY,
 container:process.env.ENGINE_CONTAINER,image:process.env.ENGINE_IMAGE};
if(!engine.run||!engine.manage||!engine.key) { console.error('run this through stack.sh run <name> ...: no ENGINE_RUN, ENGINE_MANAGE or ENGINE_KEY'); process.exit(2); }

export class EngineAnswer extends Error {}
export const fail=(step,answer)=>{ throw new EngineAnswer(`${step}: the Engine answered ${answer}`); };

const auth=(key=engine.key)=>key?{Authorization:`Bearer ${key}`}:{};
export async function call(root,path,{method='GET',body,key,timeout=30000,headers={}}={}) {
 const response=await fetch(`${root}${path}`,{method,headers:{...auth(key),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(timeout)});
 const text=await response.text();
 let json=null; try { json=JSON.parse(text); } catch {}
 return {status:response.status,text,json};
}
export const manage=(path,options)=>call(engine.manage,path,options);
export const api=(path,options)=>call(engine.run,path,options);
// A step that must answer 2xx; anything else stops the probe with the Engine's status and body.
export async function must(step,answer) {
 const got=await answer;
 if(got.status<200||got.status>=300) fail(step,`${got.status} ${got.text.slice(0,600)}`);
 return got.json??got.text;
}
export const runs=profile=>profile?`/p/${encodeURIComponent(profile)}/v1/runs`:'/v1/runs';

// A profile as lib/hermes.mjs makes one: made on the management listener, given the Engine's key for its Run API.
export async function makeProfile(name) {
 await must(`make profile ${name}`,manage('/api/profiles',{method:'POST',body:{name}}));
 await must(`give ${name} its Run key`,manage(`/api/env?profile=${encodeURIComponent(name)}`,{method:'PUT',body:{key:'API_SERVER_KEY',value:engine.key}}));
}
export const startRun=(profile,input,extra={})=>must(`start a Run on ${profile||'the default profile'}`,api(runs(profile),{method:'POST',body:{input,...extra}}));
export const readRun=(profile,run)=>must(`read Run ${run}`,api(`${runs(profile)}/${encodeURIComponent(run)}`));
export async function waitRun(profile,run,{timeout=120000}={}) {
 const until=Date.now()+timeout;
 for(;;) {
  const read=await readRun(profile,run);
  if(!['queued','started','running','claimed'].includes(read.status)) return read;
  if(Date.now()>until) fail(`Run ${run} ends within ${timeout/1000} s`,JSON.stringify(read).slice(0,400));
  await new Promise(resolve=>setTimeout(resolve,250));
 }
}

export const percentile=(values,p)=>{ const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1,Math.ceil(p/100*sorted.length)-1)]; };
export const ms=seconds=>`${Math.round(seconds*1000)} ms`;
export async function timed(fn) { const start=performance.now(); const value=await fn(); return {seconds:(performance.now()-start)/1000,value}; }
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const imageLine=()=>`${engine.image}`;

// A probe's main: a step that fails prints what the Engine said and exits non-zero.
export async function main(fn) {
 try { await fn(); }
 catch(error) { console.error(`PROBE FAILED: ${error instanceof EngineAnswer?error.message:error.stack||error}`); process.exit(1); }
}

// The host side a probe needs beside HTTP: restarting the Engine container and loading the host's cores. Neither reads
// anything of Hermes's.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {availableParallelism} from 'node:os';
export const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim();
export const cores=()=>availableParallelism();
export const loadAverage=()=>Number(readFileSync('/proc/loadavg','utf8').split(' ')[0]);
export async function restartEngine() {
 docker('restart',engine.container);
 const until=Date.now()+180000;
 for(;;) {
  const health=await api('/health').catch(()=>null);
  const profiles=await manage('/api/profiles').catch(()=>null);
  if(health?.status===200&&profiles?.status===200) return;
  if(Date.now()>until) fail('the Engine answers after a restart',`${health?.status} ${profiles?.status}`);
  await sleep(1000);
 }
}
// One busy loop per core in a container of this stack (stack.sh down removes it), until the 1-minute load average
// reaches the core count.
export async function loadCores({timeout=240000}={}) {
 const name=`${engine.container.replace(/-engine$/,'')}-load`;
 spawnSync('docker',['rm','-f',name]);
 docker('run','-d','--name',name,'--network','none','node:22.14.0-alpine3.21','sh','-c',
  `for i in $(seq ${cores()}); do node -e 'for(;;){}' & done; wait`);
 const until=Date.now()+timeout;
 while(loadAverage()<cores()) {
  if(Date.now()>until) fail('the host reaches a load average of its core count',`${loadAverage()} for ${cores()} cores`);
  await sleep(2000);
 }
 return ()=>spawnSync('docker',['rm','-f',name]);
}
