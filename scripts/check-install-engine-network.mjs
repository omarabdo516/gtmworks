// CI runs this in a Node container attached to the first Engine's network only (scripts/install.sh, ADR 0018). It proves
// what an Engine can reach: the app and the worker join this network, and nothing else of the install does. An Engine has
// no route to the database, auth, REST, storage or the public gateway, so a fault in one Engine stays in its Company. A
// request from this network to the app cannot name its own visitor address or buy any trust a request from the internet
// would not get: the same request with forged forwarding headers is answered exactly as without them.
import assert from 'node:assert/strict';
import { connect } from 'node:net';

const timeout=2000;
const reachable=(host,port)=>new Promise(resolve=>{
 const socket=connect({host,port});
 const done=answer=>{ socket.destroy(); resolve(answer); };
 socket.setTimeout(timeout,()=>done(false));
 socket.once('connect',()=>done(true));
 socket.once('error',()=>done(false));
});

// The services an Engine must not reach, by the names they have on the install network. A name does not resolve from an
// Engine's network, so the installer also passes each service's own address on the install network (docker inspect in
// CI): a network that resolves nothing but still routes to an address would be caught here.
const ports={db:5432,auth:9999,rest:3000,storage:5000,gateway:8080};
for(const [host,port] of Object.entries(ports)) {
 assert.equal(await reachable(host,port),false,`${host}:${port} is reachable from the Engine's network`);
}
for(const pair of (process.env.INSTALL_SERVICE_IPS||'').split(',').filter(Boolean)) {
 const [service,address]=pair.split('=');
 const port=ports[service];
 assert.ok(address&&port,`the install service address ${pair}`);
 assert.equal(await reachable(address,port),false,`${service} at ${address}:${port} is reachable from the Engine's network`);
}
console.log('The Engine network reaches none of db, auth, rest, storage or gateway, by name or by address');

const app='http://web:3000';
const forged={'X-Forwarded-For':'203.0.113.10','X-Real-IP':'203.0.113.10','X-Forwarded-Host':'engine.example','Forwarded':'for=203.0.113.10'};
const answer=async (path,init={})=>{
 const response=await fetch(`${app}${path}`,{...init,signal:AbortSignal.timeout(5000)});
 return {status:response.status,body:await response.text(),cookie:response.headers.get('set-cookie')};
};
const forgedAnswer=async (path,init={})=>{
 const response=await fetch(`${app}${path}`,{...init,headers:{...init.headers,...forged},signal:AbortSignal.timeout(5000)});
 return {status:response.status,body:await response.text(),cookie:response.headers.get('set-cookie')};
};

// The app is on the Engine's network, as the app joins every Engine's network.
const health=await fetch(`${app}/api/health`,{signal:AbortSignal.timeout(5000)});
assert.equal(health.status,200,'the app answers on the Engine network');

// A request that reaches the app from this network gets the internet's answer, whatever address it names. The route needs
// a signed-in person (a request from the internet has none), so the signed-out answer is the one both receive.
for(const [path,init] of [
 ['/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company:'00000000-0000-4000-8000-000000000001',conversation:'00000000-0000-4000-8000-000000000002',sendKey:'00000000-0000-4000-8000-000000000003',message:'مرحباً'})}],
 ['/api/conversations',{method:'GET'}],
 ['/api/company-name',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company:'00000000-0000-4000-8000-000000000001',name:'Forged'})}]
]) {
 const plain=await answer(path,init), named=await forgedAnswer(path,init);
 assert.deepEqual(named,plain,`${path} answers a forged visitor address differently`);
 assert.ok(plain.status>=400,`${path} gives a signed-out request no access (HTTP ${plain.status})`);
}
console.log('A request from the Engine network buys nothing with a forged visitor address');
