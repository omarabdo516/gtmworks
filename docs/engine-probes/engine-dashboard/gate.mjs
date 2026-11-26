// The gate in front of a Company's Engine dashboard, for Probe B of spec #822 (#826). Not part of the product: it
// stands in for the check the Owner's dashboard spec builds into gtmworks. nginx's auth_request asks it about every
// request, the WebSocket upgrades included; it answers 204 only when the request carries the gtmworks sign-in of a
// person who is an active Owner of the Company the path names, by gtmworks's own rule (public.is_company_owner, asked
// with that person's own session), and 401 otherwise, which the gateway turns into the missing-page answer.
import {createServer} from 'node:http';

const supabase=process.env.SUPABASE_URL;
const anon=process.env.SUPABASE_ANON_KEY;
const decisions=[];

// The session the app's @supabase/ssr client keeps: sb-<ref>-auth-token, possibly split into .0, .1, …, holding
// "base64-" and the base64url of the session JSON.
function session(cookieHeader='') {
 const jar=Object.fromEntries(cookieHeader.split(/;\s*/).filter(Boolean).map(pair=>{ const at=pair.indexOf('='); return [pair.slice(0,at),decodeURIComponent(pair.slice(at+1))]; }));
 const base=Object.keys(jar).map(name=>name.replace(/\.\d+$/,'')).find(name=>/^sb-.+-auth-token$/.test(name));
 if(!base) return null;
 const value=jar[base]??Object.keys(jar).filter(name=>name.startsWith(`${base}.`)).sort((a,b)=>Number(a.split('.').pop())-Number(b.split('.').pop())).map(name=>jar[name]).join('');
 try {
  const raw=value.startsWith('base64-')?Buffer.from(value.slice(7),'base64url').toString('utf8'):value;
  return JSON.parse(raw)?.access_token||null;
 } catch { return null; }
}
const rest=(path,token,init={})=>fetch(`${supabase}/rest/v1/${path}`,{...init,headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(5000)});

const companyOf=path=>/^\/engine\/([a-z0-9-]+)(\/|$)/.exec(path||'')?.[1];
async function owner(uri,cookie,referer) {
 // The bundle's own code at /assets/ belongs to the dashboard page that asked for it.
 const slug=companyOf(uri)??(uri?.startsWith('/assets/')&&referer?companyOf(new URL(referer).pathname):undefined);
 const token=session(cookie);
 if(!slug||!token) return {allowed:false,why:slug?'no gtmworks sign-in':'no Company in the path'};
 const companies=await rest(`companies?slug=eq.${slug}&select=id`,token);
 const [company]=companies.ok?await companies.json():[];
 if(!company) return {allowed:false,why:`no Company ${slug} for this person (${companies.status})`};
 const asked=await rest('rpc/is_company_owner',token,{method:'POST',body:JSON.stringify({c:company.id})});
 const answer=asked.ok?await asked.json():false;
 return {allowed:answer===true,why:`is_company_owner(${slug}) ${asked.status} ${JSON.stringify(answer)}`};
}

createServer(async(request,response)=>{
 if(request.url==='/decisions') { response.writeHead(200,{'Content-Type':'application/json'}); return response.end(JSON.stringify(decisions)); }
 const uri=request.headers['x-original-uri'];
 let decision;
 try { decision=await owner(uri,request.headers.cookie,request.headers['x-referer']); } catch(error) { decision={allowed:false,why:`gate error: ${error.message}`}; }
 decisions.push({at:Date.now(),uri,upgrade:request.headers['x-upgrade']||'',...decision});
 if(decisions.length>2000) decisions.splice(0,1000);
 response.writeHead(decision.allowed?204:401);
 response.end();
}).listen(8080,'0.0.0.0');
