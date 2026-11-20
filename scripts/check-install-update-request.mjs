// Update now (#443) on a real install: the first run's Owner, signed in with their password through the gateway, asks for
// an update exactly as /api/install-update does (request_install_update, as that person). Run with node from the install
// machine's network: `request` asks and prints the state it left; `refused` expects the switch to refuse it; `read`
// prints the state an Owner reads. A request that tries to name a version is refused by the database, whatever it says.
import assert from 'node:assert/strict';

const origin=process.env.APP_ORIGIN||'http://localhost:3000';
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(anon,'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const signIn=await fetch(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:anon,'content-type':'application/json'},
 body:JSON.stringify({email:'proxy-owner@example.com',password:'proxy-owner-password'})});
assert.equal(signIn.status,200,'the Owner signs in');
const {access_token:token}=await signIn.json();
const rpc=(name,body={})=>fetch(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:anon,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
const step=process.argv[2];
if(step==='request') {
 const named=await rpc('request_install_update',{version:'v0.0.0',channel:'main'});
 assert.ok(named.status>=400,`a request that names a version is refused (${named.status})`);
 const asked=await rpc('request_install_update');
 assert.equal(asked.status,200,`the Owner's request is recorded (${asked.status})`);
 console.log(await asked.json());
} else if(step==='refused') {
 const asked=await rpc('request_install_update');
 assert.equal(asked.status,403,`the request is refused (${asked.status})`);
 assert.match(await asked.text(),/updateButtonOff/);
 console.log('refused');
} else if(step==='read') {
 const read=await rpc('install_update');
 assert.equal(read.status,200);
 const state=await read.json();
 console.log(`${state.state} ${state.version??''} ${state.button?'button-on':'button-off'}`);
} else throw new Error(`usage: request | refused | read, not ${step}`);
