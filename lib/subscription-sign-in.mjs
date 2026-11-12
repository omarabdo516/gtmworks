import { bundledHermesManagement } from './bundled-hermes.mjs';
import { engineSignIn, engineSignInsWaiting } from './hermes.mjs';
import { companyHermesHome, hermesSignIn, signInProviders, signInsWaiting } from './hermes-sign-in.mjs';

// Where a company's subscription sign-in runs (#3), and how much Engine work it may cause.
//
// The bundled Engine's management listener (ADR 0012) when the web app is wired to it; otherwise the `hermes` command
// in the company's own home (HERMES_COMPANY_HOMES); otherwise nowhere, and the route says it is not available.
//
// Each read asks the Engine (a `hermes auth list` child, or management calls), so reads are bounded: reads of one
// company and provider share the answer being asked and keep it a few seconds; new reads and actions (connect,
// disconnect, complete) each have a global limit, every caller (person) a limit of their own across both, and sign-ins
// still waiting for a person a global limit. Past a limit the caller gets `busy` and nothing more starts.

/** @param {string} company @param {Record<string,string|undefined>} env */
export function signInFor(company,env=process.env) {
 const engine=bundledHermesManagement(env);
 if(engine) return {kind:'engine',...engineSignIn(engine,company)};
 const home=companyHermesHome(company,env);
 return home?{kind:'home',...hermesSignIn({home,env})}:null;
}

export const busy=Object.freeze({state:'busy'});
const failed=Object.freeze({state:'failed'});
/** @param {{reads?:number,actions?:number,perCaller?:number,waiting?:number,fresh?:number}} [options] */
export function signInLimits({reads=4,actions=2,perCaller=3,waiting=16,fresh=3000}={}) {
 /** @type {Map<string,{at:number,value:any}>} */ const kept=new Map();
 /** @type {Map<string,Promise<any>>} */ const asking=new Map();
 /** @type {Map<string,number>} */ const callers=new Map(); /** @type {Map<string,number>} */ const changed=new Map();
 const running={reads:0,actions:0};
 const take=(/** @type {'reads'|'actions'} */ kind,/** @type {string} */ caller)=>{ running[kind]++; callers.set(caller,(callers.get(caller)||0)+1); };
 const give=(/** @type {'reads'|'actions'} */ kind,/** @type {string} */ caller)=>{ running[kind]--; const left=(callers.get(caller)||1)-1; if(left) callers.set(caller,left); else callers.delete(caller); };
 const full=(/** @type {'reads'|'actions'} */ kind,/** @type {string} */ caller)=>running[kind]>=(kind==='reads'?reads:actions)||(callers.get(caller)||0)>=perCaller;
 return {
  /** @param {string} key @param {string} caller @param {()=>Promise<any>} work */
  read(key,caller,work) {
   const hit=kept.get(key); if(hit&&Date.now()-hit.at<fresh) return Promise.resolve(hit.value);
   const shared=asking.get(key); if(shared) return shared;
   if(full('reads',caller)) return Promise.resolve(busy);
   take('reads',caller); const version=changed.get(key)||0;
   const asked=Promise.resolve().then(work).then(value=>{
    // An answer asked before a connect or disconnect ended is not kept.
    if((changed.get(key)||0)===version) { if(kept.size>1000) for(const [old,{at}] of kept) if(Date.now()-at>=fresh) kept.delete(old); kept.set(key,{at:Date.now(),value}); }
    return value;
   }).finally(()=>{ give('reads',caller); asking.delete(key); });
   asking.set(key,asked); return asked;
  },
  /** @param {string} key @param {string} caller @param {()=>Promise<any>} work @param {{starts?:boolean}} [options] */
  async act(key,caller,work,{starts=false}={}) {
   if(full('actions',caller)||starts&&engineSignInsWaiting()+signInsWaiting()>=waiting) return busy;
   take('actions',caller);
   try { return await work(); }
   finally { give('actions',caller); changed.set(key,(changed.get(key)||0)+1); kept.delete(key); }
  },
 };
}
const shared=signInLimits();

/** Every provider's state for the company, or `busy`. @param {any} signIn @param {{company:string,caller:string,limits?:ReturnType<typeof signInLimits>}} options */
export async function subscriptionStates(signIn,{company,caller,limits=shared}) {
 const states=await Promise.all(signInProviders.map(provider=>limits.read(`${company}\0${provider}`,caller,()=>signIn.state(provider))));
 return states.includes(busy)?busy:{providers:Object.fromEntries(signInProviders.map((provider,index)=>[provider,states[index]]))};
}

/** @param {any} signIn @param {{company:string,caller:string,provider:string,intent:string,authorizationCode?:unknown,limits?:ReturnType<typeof signInLimits>}} options */
export async function subscriptionAction(signIn,{company,caller,provider,intent,authorizationCode,limits=shared}) {
 if(!signInProviders.includes(provider)||!['connect','disconnect','complete'].includes(intent)) return failed;
 return limits.act(`${company}\0${provider}`,caller,()=>intent==='connect'?signIn.start(provider):intent==='complete'?signIn.complete(provider,authorizationCode):signIn.disconnect(provider),{starts:intent==='connect'});
}
