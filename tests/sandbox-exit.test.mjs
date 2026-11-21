import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';

// A Company's work sandbox reaches the internet through one exit (#394, ADR 0018): sandbox/exit.py, run by the Company's
// template from the work sandbox image. These tests run the program itself on loopback: what it refuses by the address a
// name resolves to, the ports and protocols it refuses, and what it answers. The install job proves the same from inside a
// real sandbox, with a stand-in public host it does reach (scripts/check-install-sandbox-exit.mjs), and proves by docker
// inspect how the Company's template runs the exit: its image, privileges, mounts and networks.

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
  '::a00:1':'an IPv4-compatible address','::8.8.8.8':'an IPv4-compatible address','::ffff:0:a00:1':'a translated address','::ffff:0:808:808':'a translated address',
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

/** What the exit answers on one connection to `request`, until it closes; `then` is written after its first answer;
 * `at` is the exit's port. */
const ask=(request,then,at=port)=>new Promise((resolve,reject)=>{
 const socket=connect({host:'127.0.0.1',port:at});
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
 // A tunnel opens to HTTPS's port alone and a plain request goes to HTTP's alone: every other port, high ones too, is
 // refused before the exit resolves or connects anywhere.
 for(const blocked of [22,25,53,80,445,1023,1024,2525,6379,8443,65535]) assert.match(refusal(await ask(`CONNECT 1.1.1.1:${blocked} HTTP/1.1\r\n\r\n`)),new RegExp(`refuses port ${blocked}`));
 for(const blocked of [25,443,6379,8080]) assert.match(refusal(await ask(`GET http://1.1.1.1:${blocked}/ HTTP/1.1\r\n\r\n`)),new RegExp(`refuses port ${blocked}`));
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

test('a tunnel opens only behind a whole TLS ClientHello record header, never behind two TLS-looking bytes', async () => {
 // Each stream starts as a TLS record would, then is not one: a wrong version, an impossible length, or a record that
 // is not a ClientHello (the Redis command below is what a two-byte check let through to a high port).
 const streams=['\x16\x03\x01\r\nCONFIG GET *\r\n','\x16\x03\x05\x00\x40\x01probe','\x16\x03\x01\x00\x00\x01probe','\x16\x03\x01\xff\xff\x01probe','\x16\x03\x03\x00\x40\x02probe'];
 for(const [index,stream] of streams.entries()) {
  const host=`203.0.113.${20+index}`;
  assert.equal(await ask(`CONNECT ${host}:443 HTTP/1.1\r\n\r\n`,Buffer.from(stream,'latin1')),'HTTP/1.1 200 Connection Established\r\n\r\n');
  for(let attempt=0;attempt<50&&!logged.includes(`refused (not TLS) ${host}:443`);attempt++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.match(logged,new RegExp(`exit: refused \\(not TLS\\) ${host.replaceAll('.','\\.')}:443`));
 }
});

// The exit's own program, with the two things outside it a test cannot control stood in for: the DNS answer for the
// names below, and the outbound connection, which prints the address it was asked for and fails.
const resolverStandIn=`import asyncio, runpy, socket, sys
answers = {'mixed.exit.test': ['10.0.0.1', '203.0.113.7', '127.0.0.1'], 'refused.exit.test': ['10.0.0.1', '127.0.0.1']}
real = socket.getaddrinfo
def getaddrinfo(host, port, *rest, **named):
    if host in answers:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, port)) for address in answers[host]]
    return real(host, port, *rest, **named)
async def open_connection(host, port, **named):
    print(f'upstream {host}:{port}', flush=True)
    raise OSError('no route in the test')
socket.getaddrinfo = getaddrinfo
asyncio.open_connection = open_connection
runpy.run_path(sys.argv[1], run_name='__main__')`;

test('a name that resolves to a public and a refused address is reached only at the public one, and a name with none is refused', async () => {
 const standInPort=await freePort();
 const standIn=spawn('python3',['-c',resolverStandIn,exitProgram],{env:{...process.env,EXIT_LISTEN:'127.0.0.1',EXIT_PORT:String(standInPort)},stdio:['ignore','pipe','pipe']});
 let said='';
 standIn.stdout.on('data',chunk=>{ said+=chunk; });
 standIn.stderr.on('data',chunk=>{ said+=chunk; });
 try {
  for(let attempt=0;attempt<100&&!said.includes('listening');attempt++) await new Promise(resolve=>setTimeout(resolve,50));
  assert.match(await ask('GET http://mixed.exit.test/ HTTP/1.1\r\n\r\n',undefined,standInPort),/^HTTP\/1\.1 502 /);
  const hello=Buffer.from([0x16,0x03,0x01,0x00,0x40,0x01]);
  assert.equal(await ask('CONNECT mixed.exit.test:443 HTTP/1.1\r\n\r\n',hello,standInPort),'HTTP/1.1 200 Connection Established\r\n\r\n');
  for(let attempt=0;attempt<50&&!said.includes('unreachable mixed.exit.test:443');attempt++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(said.match(/^upstream .*$/gm),['upstream 203.0.113.7:80','upstream 203.0.113.7:443']);
  assert.match(refusal(await ask('CONNECT refused.exit.test:443 HTTP/1.1\r\n\r\n',undefined,standInPort)),/it is a private address/);
  assert.equal(said.match(/^upstream .*$/gm).length,2,'a name with no public address is never connected to');
 } finally { standIn.kill(); }
});
