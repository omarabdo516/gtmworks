'use client';
// The Owner's sign-in to an app for one Agent, as Settings, Apps runs it (#30): the vendor's window opens at the press
// (before the answer, so the browser lets it open) and is pointed at the vendor's page once gtmworks has it, never
// knowing this page; the sign-in is then followed through /api/company-apps until it connects, fails or is stopped,
// and a stopped one is cancelled and its window closed. The route checks the Owner again for every step, and the
// connect is logged there once. Used by an Agent's connect card (#203) and its details' Connect (#204).
export type SignInOutcome={state:'connected'}|{error:'connectBlocked'|'connectFailed'};

async function ask(body:Record<string,string>) {
 try {
  const response=await fetch('/api/company-apps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {ok:response.ok,body:await response.json().catch(()=>({})) as Record<string,unknown>};
 } catch { return {ok:false,body:{}}; }
}
// A sign-in the Engine keeps for fifteen minutes is followed at most that long.
const pollEvery=2000, pollFor=15*60*1000;

export async function signInToApp({company,agent,app,signal}:{company:string,agent:string,app:string,signal?:AbortSignal}):Promise<SignInOutcome> {
 const opened=window.open('about:blank','_blank');
 if(!opened) return {error:'connectBlocked'};
 const started=await ask({company,agent,app,action:'connect'});
 if(!started.ok||typeof started.body.url!=='string') { opened.close(); return {error:'connectFailed'}; }
 opened.opener=null; opened.location.href=started.body.url;
 const stop=()=>{ void fetch('/api/company-apps',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,app,action:'cancel'})}).catch(()=>{}); opened.close(); };
 signal?.addEventListener('abort',stop,{once:true});
 try {
  for(const until=Date.now()+pollFor;Date.now()<until;) {
   await new Promise(resolve=>setTimeout(resolve,pollEvery));
   if(signal?.aborted) return {error:'connectFailed'};
   const polled=await ask({company,agent,app,action:'poll'});
   if(signal?.aborted) return {error:'connectFailed'};
   if(polled.ok&&polled.body.status==='connected') return {state:'connected'};
   if(!(polled.ok&&polled.body.status==='waiting')) return {error:'connectFailed'};
  }
  return {error:'connectFailed'};
 } finally { signal?.removeEventListener('abort',stop); }
}
