import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// A Company's work sandbox reaches the internet through one exit (#394, ADR 0018): sandbox/exit.py, run by the Company's
// template from the work sandbox image. These tests run the program itself on loopback: what it refuses by the address a
// name resolves to, the ports and protocols it refuses, and what it answers. The install job proves the same from inside a
// real sandbox, with a stand-in public host it does reach (scripts/check-install-sandbox-exit.mjs).

const exitProgram='sandbox/exit.py';
const verdicts=(...addresses)=>spawnSync('python3',[exitProgram,'--verdict',...addresses],{encoding:'utf8'}).stdout.trim().split('\n');

test('the exit refuses private, shared, link-local, loopback, metadata and reserved addresses, and allows public ones', () => {
 const refused={
  '10.1.2.3':'a private address','172.16.0.1':'a private address','172.31.255.254':'a private address','192.168.1.1':'a private address',
  'fd00::1':'a private address','fc00::1':'a private address','100.64.0.1':'a shared address','100.100.100.200':'a shared address',
  '169.254.1.1':'a link-local address','fe80::1':'a link-local address','fe80::1%eth0':'a link-local address',
  '127.0.0.1':'loopback','127.8.9.10':'loopback','::1':'loopback','0.0.0.0':'this network','::':'this network',
  '169.254.169.254':'cloud metadata','fd00:ec2::254':'cloud metadata',
  // An IPv4 address written as IPv6, or wrapped in a tunnel or a translation prefix, is never a way round the rules.
  '::ffff:127.0.0.1':'loopback','::ffff:169.254.169.254':'cloud metadata','::ffff:10.0.0.1':'a private address',
  '64:ff9b::a00:1':'a translated address','2002:a00:1::1':'a tunnelled address','2001:0:a00:1::1':'a tunnelled address',
  '224.0.0.1':'a multicast address','ff02::1':'a multicast address','240.0.0.1':'a reserved address','255.255.255.255':'a reserved address',
  'not-an-address':'not an address',
 };
 assert.deepEqual(verdicts(...Object.keys(refused)),Object.values(refused).map(reason=>`refused ${reason}`));
 // Public addresses pass, and so do the ranges reserved for documentation, which route nowhere on the internet: the
 // install job's stand-in public host sits on one, outside every network of the install.
 assert.deepEqual(verdicts('1.1.1.1','8.8.8.8','2606:4700:4700::1111','203.0.113.80'),['allowed','allowed','allowed','allowed']);
});

const freePort=()=>new Promise(resolve=>{ const server=createServer(); server.listen(0,'127.0.0.1',()=>{ const {port}=server.address(); server.close(()=>resolve(port)); }); });
let child, port, logged='';
before(async () => {
 port=await freePort();
 child=spawn('python3',[exitProgram],{env:{...process.env,EXIT_LISTEN:'127.0.0.1',EXIT_PORT:String(port)},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{ logged+=chunk; });
 child.stderr.on('data',chunk=>{ logged+=chunk; });
 for(let attempt=0;attempt<100&&!logged.includes('listening');attempt++) await new Promise(resolve=>setTimeout(resolve,50));
 assert.match(logged,/exit: listening on 127\.0\.0\.1:/);
});
after(() => child?.kill());

/** What the exit answers on one connection to `request`, until it closes; `then` is written after its first answer. */
const ask=(request,then)=>new Promise((resolve,reject)=>{
 const socket=connect({host:'127.0.0.1',port});
 const chunks=[];
 let followed=false;
 socket.setTimeout(10000,()=>{ socket.destroy(); reject(new Error('the exit kept the connection open')); });
 socket.once('connect',()=>socket.write(request));
 socket.on('data',chunk=>{ chunks.push(chunk); if(then&&!followed) { followed=true; socket.write(then); } });
 socket.once('close',()=>resolve(Buffer.concat(chunks).toString('latin1')));
 socket.once('error',reject);
});
const refusal=text=>{ assert.match(text,/^HTTP\/1\.1 403 /); assert.match(text,/\r\nX-Gtmworks-Exit: refused\r\n/); return text; };

test('a request to a refused address is answered by the exit itself, by number and by a name that resolves to it', async () => {
 assert.match(refusal(await ask('GET http://127.0.0.1/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')),/it is loopback/);
 assert.match(refusal(await ask('CONNECT 169.254.169.254:443 HTTP/1.1\r\n\r\n')),/it is cloud metadata/);
 assert.match(refusal(await ask('CONNECT [fd00:ec2::254]:443 HTTP/1.1\r\n\r\n')),/it is cloud metadata/);
 // A name is judged by the address it resolves to: localhost, and a number in another form, are loopback.
 assert.match(refusal(await ask('GET http://localhost/ HTTP/1.1\r\nHost: localhost\r\n\r\n')),/it is loopback/);
 assert.match(refusal(await ask('CONNECT 2130706433:443 HTTP/1.1\r\n\r\n')),/it is loopback/);
 assert.match(refusal(await ask('GET http://[::ffff:10.0.0.1]/ HTTP/1.1\r\n\r\n')),/it is a private address/);
 assert.match(logged,/exit: refused \(cloud metadata\) 169\.254\.169\.254:443/);
});

test('only HTTP and HTTPS leave: another port, another protocol and a tunnel that is not TLS are refused', async () => {
 for(const blocked of [22,25,53,445,1023]) assert.match(refusal(await ask(`CONNECT 1.1.1.1:${blocked} HTTP/1.1\r\n\r\n`)),new RegExp(`refuses port ${blocked}`));
 assert.match(refusal(await ask('GET http://1.1.1.1:25/ HTTP/1.1\r\n\r\n')),/refuses port 25/);
 assert.match(await ask('SSH-2.0-OpenSSH_9.6\r\n\r\n'),/^HTTP\/1\.1 400 /);
 assert.match(await ask('GET / HTTP/1.1\r\nHost: example.com\r\n\r\n'),/^HTTP\/1\.1 400 /);
 assert.match(await ask('GET https://example.com/ HTTP/1.1\r\n\r\n'),/^HTTP\/1\.1 400 /);
 assert.match(await ask('GET ftp://example.com/ HTTP/1.1\r\n\r\n'),/^HTTP\/1\.1 400 /);
 // A tunnel to an allowed address and port opens, and closes as soon as its first bytes are not a TLS handshake: the exit
 // reads them before it connects anywhere, so nothing reaches the address.
 const tunnel=await ask('CONNECT 203.0.113.9:443 HTTP/1.1\r\n\r\n','SSH-2.0-probe\r\n');
 assert.equal(tunnel,'HTTP/1.1 200 Connection Established\r\n\r\n');
 for(let attempt=0;attempt<50&&!logged.includes('refused (not TLS) 203.0.113.9:443');attempt++) await new Promise(resolve=>setTimeout(resolve,20));
 assert.match(logged,/exit: refused \(not TLS\) 203\.0\.113\.9:443/);
 assert.doesNotMatch(logged,/exit: tunnel 203\.0\.113\.9/);
});

test('the Company template runs the exit from the sandbox image, hardened, the one way from the work network out', () => {
 const template=load(readFileSync('scripts/engine-template.yml','utf8'));
 const exit=template.services.exit;
 assert.equal(exit.image,template.services.sandbox.image,'the exit runs the work sandbox image: no second image to load, pin and update');
 assert.equal(exit.container_name,'${EXIT_NAME:-gtmworks-exit}');
 assert.deepEqual(exit.entrypoint,['python3','/usr/local/lib/gtmworks/exit.py']);
 assert.deepEqual(exit.cap_drop,['ALL']);
 assert.deepEqual(exit.security_opt,['no-new-privileges:true']);
 for(const key of ['ports','expose','volumes','env_file','environment','user','network_mode','privileged','cap_add']) assert.equal(exit[key],undefined,`the exit sets no ${key}`);
 assert.deepEqual(JSON.parse(JSON.stringify(exit.networks)),{work:{aliases:['exit']},outbound:null});
 // The sandbox and the Engine stay on networks that route nowhere but through the exit.
 assert.deepEqual(Object.keys(template.services.sandbox.networks),['work']);
 assert.equal(template.networks.work.internal,true);
 assert.equal(template.networks.outbound.internal,undefined);
 assert.equal(template.networks.outbound.name,'${EXIT_NETWORK:-gtmworks-exit-first}');
 for(const [name,service] of Object.entries(template.services)) if(name!=='exit') assert.equal(Object.keys(service.networks||{}).includes('outbound'),false,`${name} is not on the exit's network`);
 // The image carries the program, and every session of the sandbox is pointed at the exit by the alias and port above.
 const dockerfile=readFileSync('sandbox/Dockerfile','utf8');
 assert.match(dockerfile,/^COPY exit\.py \/usr\/local\/lib\/gtmworks\/exit\.py$/m);
 for(const name of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy']) {
  assert.match(dockerfile,new RegExp(`^(?:ENV)?\\s+${name}=http://exit:3128 \\\\$`,'m'),`the image names the exit in ${name}`);
  assert.match(readFileSync('sandbox/sshd_config','utf8'),new RegExp(`^SetEnv .*\\b${name}=http://exit:3128\\b`,'m'),`every ssh session names the exit in ${name}`);
 }
 assert.match(readFileSync(exitProgram,'utf8'),/^PORT = int\(os\.environ\.get\('EXIT_PORT', '3128'\)\)$/m);
 // The installer names the exit and its network from the Company's folder, and removes both with the Company.
 const installer=readFileSync('scripts/install.sh','utf8');
 assert.match(installer,/EXIT_NAME=\$\(exit_container "\$slug"\)/);
 assert.match(installer,/EXIT_NETWORK=\$\(exit_network "\$slug"\)/);
 assert.match(installer,/docker rm -f .*"\$\(exit_container "\$slug"\)"/);
 assert.match(installer,/docker network rm .*"\$\(exit_network "\$slug"\)"/);
});
