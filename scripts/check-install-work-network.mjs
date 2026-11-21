// CI runs this in a Node container attached to a Company's work network (scripts/ci-install-check.sh, #393): the network
// its sandbox sits on and its Agents' code runs in. It proves what that leg can reach: nothing of the install (the app,
// the database, auth, REST, storage or the gateway) and no listener of any Engine, which binds its Run API and management
// listener to its install-network address only (docs/engine-probes/work-sandbox-ssh.md, section 6). A Company's work
// network is its own: another Engine is not reachable from it either.
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

// The install services, by the names they have on the install network and by the addresses the installer read from
// Docker. Names do not resolve on a work network and a route alone would not be caught by DNS, so both are checked.
const ports={db:5432,auth:9999,rest:3000,storage:5000,gateway:8080,web:3000};
for(const [host,port] of Object.entries(ports)) {
 assert.equal(await reachable(host,port),false,`${host}:${port} is reachable from the work network`);
}
for(const pair of (process.env.INSTALL_SERVICE_IPS||'').split(',').filter(Boolean)) {
 const [service,address]=pair.split('=');
 const port=ports[service];
 assert.ok(address&&port,`the install service address ${pair}`);
 assert.equal(await reachable(address,port),false,`${service} at ${address}:${port} is reachable from the work network`);
}
console.log('The work network reaches none of the install services, by name or by address');

// The Engine of this network is reachable over ssh (that is the point of the network), and its own listeners are not:
// they bind the address the install network gave it, so its work-network address refuses every port it listens on. The
// ports are read from inside the Engine by the install job (scripts/ci-install-lib.sh engine_listen_ports), so a listener
// on a port the job does not name by hand is checked too.
const engineAddress=process.env.ENGINE_WORK_IP||'';
assert.ok(engineAddress,'the Engine work-network address');
const enginePorts=(process.env.ENGINE_WORK_PORTS||'8642,9119').split(',').filter(Boolean).map(Number);
assert.ok(enginePorts.length>0&&enginePorts.every(port=>Number.isInteger(port)&&port>0),'the ports the Engine listens on');
for(const port of enginePorts) assert.equal(await reachable(engineAddress,port),false,`the Engine answers on its work-network address at ${port}`);
console.log(`The Engine answers on its install-network address only, never on the work network (${enginePorts.join(', ')})`);

// A network is one Company's: another Engine, named as a service would name a host, resolves nowhere here.
for(const other of (process.env.OTHER_ENGINES||'').split(',').filter(Boolean)) {
 for(const port of [8642,9119]) assert.equal(await reachable(other,port),false,`${other}:${port} is reachable from the work network`);
}
