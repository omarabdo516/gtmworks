'use client';
// The Owner's sign-in to an app for one Agent, as Settings, Apps runs it (#30): the vendor's window opens at the press
// (before the answer, so the browser lets it open) and is pointed at the vendor's page once gtmworks has it, never
// knowing this page; the sign-in is then followed through /api/company-apps until it connects, fails or is stopped,
// and a stopped one is cancelled and its window closed. The route checks the Owner again for every step, and the
// connect is logged there once. Used by an Agent's connect card (#203) and its details' Connect (#204).
//
// An app that needs a value gtmworks cannot ask for here (a token, or a field the Engine's catalogue declares) answers
// `needs: 'details'`: the Connect apps sheet opens at that app's own page, where the Owner types it. An app with no
// sign-in answers with its state alone and is connected at the press, with no vendor window.
export type SignInOutcome={state:'connected'}|{state:'manual'}|{error:'connectBlocked'|'connectFailed'};

// Each request, its answer's body included, ends within its own deadline (cut to the time the caller has left) or
// when the caller stops, already stopped included, so the caller is always settled; the request is then aborted.
const askFor=30*1000;
type Answer={ok:boolean,body:Record<string,unknown>};
async function ask(body:Record<string,unknown>,signal?:AbortSignal,within=askFor):Promise<Answer> {
 const ended=new AbortController(); const end=()=>ended.abort();
 const timer=setTimeout(end,Math.min(askFor,within)); signal?.addEventListener('abort',end,{once:true});
 const failed:Answer={ok:false,body:{}};
 const given=new Promise<Answer>(resolve=>ended.signal.addEventListener('abort',()=>resolve(failed),{once:true}));
 if(signal?.aborted) end();
 const asked=(async()=>{ try {
  const response=await fetch('/api/company-apps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ended.signal});
  return {ok:response.ok,body:await response.json().catch(()=>({})) as Record<string,unknown>};
 } catch { return failed; } })();
 try { return await Promise.race([asked,given]); } finally { clearTimeout(timer); signal?.removeEventListener('abort',end); end(); }
}
// A sign-in the Engine keeps for fifteen minutes is followed at most that long.
const pollEvery=2000, pollFor=15*60*1000;

export async function signInToApp({company,agent,app,signal,openApp}:{company:string,agent:string,app:string,signal?:AbortSignal,openApp?:(app:string)=>void}):Promise<SignInOutcome> {
 const opened=window.open('about:blank','_blank');
 if(!opened) return {error:'connectBlocked'};
 // Every outcome but connected cancels the sign-in, in case one was made, and closes its window, once.
 let stopped=false;
 const stop=()=>{ if(stopped) return; stopped=true; void fetch('/api/company-apps',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({company,agent,app,action:'cancel'})}).catch(()=>{}); opened.close(); };
 signal?.addEventListener('abort',stop,{once:true});
 try {
  const started=await ask({company,agent,app,action:'connect'},signal);
  if(signal?.aborted) { stop(); return {error:'connectFailed'}; }
  // A token or a declared field is typed in the app's own page, not guessed here.
  if(started.ok&&started.body.needs==='details') { opened.close(); openApp?.(app); return {state:'manual'}; }
  // A token or no-sign-in app is turned on at the press: its answer is the state, and no vendor window follows. One the
  // Engine cannot reach (attention) did not connect, so it says so.
  if(started.ok&&started.body.status==='connected') { opened.close(); return {state:'connected'}; }
  if(started.ok&&started.body.status==='attention') { opened.close(); return {error:'connectFailed'}; }
  if(!started.ok||typeof started.body.url!=='string') { stop(); return {error:'connectFailed'}; }
  opened.opener=null; opened.location.href=started.body.url;
  // The last wait and poll are cut to the time left, so the caller settles at fifteen minutes, not after.
  for(const until=Date.now()+pollFor;Date.now()<until;) {
   await new Promise(resolve=>setTimeout(resolve,Math.min(pollEvery,until-Date.now())));
   if(signal?.aborted||Date.now()>=until) break;
   const polled=await ask({company,agent,app,action:'poll'},signal,until-Date.now());
   if(signal?.aborted) break;
   if(polled.ok&&polled.body.status==='connected') return {state:'connected'};
   if(!(polled.ok&&polled.body.status==='waiting')) break;
  }
  stop(); return {error:'connectFailed'};
 } finally { signal?.removeEventListener('abort',stop); }
}
