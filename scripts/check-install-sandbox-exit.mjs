// The install job runs this inside a Company's work sandbox, over the Engine's own ssh login as an Agent's command runs
// (scripts/ci-install-check.sh, #394), with its one argument a base64 JSON of what to probe. It proves what code an Agent
// runs there can reach:
//   - directly, nothing: no install service, no Engine listener, no other Company's sandbox or Engine, no public host on
//     any port, and no name of the internet resolves (the sandbox's network routes nowhere);
//   - through its Company's exit, only HTTP and HTTPS to a public address: a private, shared, link-local, loopback or
//     cloud metadata address is refused by the exit itself, by number and by a name that resolves to it; a port that is
//     not HTTP's or HTTPS's is refused; a tunnel whose first bytes are not TLS is closed before anything leaves;
//   - a stand-in public host outside the install's networks answers through the exit over HTTP and HTTPS, from the
//     shell (Python, and curl where the image has it) and from Chromium, which reach the exit by the environment every
//     session gets.
// It prints one line per proof and fails on the first that does not hold.
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { lookup } from 'node:dns/promises';
import { createSocket } from 'node:dgram';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config=JSON.parse(Buffer.from(process.argv[2]||'','base64').toString('utf8')||'{}');
const exitHost='exit', exitPort=3128, timeout=4000;
const bracket=host=>host.includes(':')?`[${host}]`:host;

/** True when a TCP connection to host:port opens from here, with no proxy. */
const reachable=(host,port)=>new Promise(resolve=>{
 const socket=connect({host,port});
 const done=answer=>{ socket.destroy(); resolve(answer); };
 socket.setTimeout(timeout,()=>done(false));
 socket.once('connect',()=>done(true));
 socket.once('error',()=>done(false));
});

/** Everything the exit sends back on one connection until it closes (or the time runs out), after `request`. */
const through=(request,{wait=15000}={})=>new Promise((resolve,reject)=>{
 const socket=connect({host:exitHost,port:exitPort});
 const chunks=[];
 socket.setTimeout(wait,()=>{ socket.destroy(); resolve({text:Buffer.concat(chunks).toString('latin1'),closed:false}); });
 socket.once('connect',()=>socket.write(request));
 socket.on('data',chunk=>chunks.push(chunk));
 socket.once('close',()=>resolve({text:Buffer.concat(chunks).toString('latin1'),closed:true}));
 socket.once('error',reject);
});
const statusOf=text=>Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1]||0);
const refusedByExit=text=>statusOf(text)===403&&/\r\nX-Gtmworks-Exit: refused\r\n/i.test(text.split('\r\n\r\n')[0]+'\r\n');

/** A plain HTTP request through the exit, in the absolute form a proxy client sends. */
const httpGet=(host,port=80)=>{
 const authority=port===80?bracket(host):`${bracket(host)}:${port}`;
 return through(`GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`);
};

/** A CONNECT through the exit: the exit's answer, and the socket left open when it said 200. */
const tunnelTo=(host,port)=>new Promise((resolve,reject)=>{
 const socket=connect({host:exitHost,port:exitPort});
 let head=Buffer.alloc(0);
 socket.setTimeout(15000,()=>{ socket.destroy(); reject(new Error(`the exit did not answer CONNECT ${host}:${port}`)); });
 socket.once('connect',()=>socket.write(`CONNECT ${bracket(host)}:${port} HTTP/1.1\r\nHost: ${bracket(host)}:${port}\r\n\r\n`));
 const onData=chunk=>{
  head=Buffer.concat([head,chunk]);
  const end=head.indexOf('\r\n\r\n');
  if(end<0) return;
  socket.off('data',onData);
  socket.setTimeout(0);
  const text=head.subarray(0,end+4).toString('latin1');
  if(statusOf(text)!==200) { socket.destroy(); resolve({text,socket:null}); }
  else resolve({text,socket});
 };
 socket.on('data',onData);
 socket.once('error',reject);
 socket.once('close',()=>resolve({text:head.toString('latin1'),socket:null}));
});

/** An HTTPS request in a tunnel through the exit; the stand-in's certificate is its own, so it is not verified here. */
const httpsGet=async(host,servername)=>{
 const {text,socket}=await tunnelTo(host,443);
 assert.ok(socket,`the exit opens a tunnel to ${host}:443 (it answered: ${text.split('\r\n')[0]||'nothing'})`);
 return await new Promise((resolve,reject)=>{
  const secure=tlsConnect({socket,servername:/^[\d.]+$|:/.test(servername)?undefined:servername,rejectUnauthorized:false});
  const chunks=[];
  secure.setTimeout(15000,()=>{ secure.destroy(); reject(new Error(`no HTTPS answer from ${host}`)); });
  secure.once('secureConnect',()=>secure.write(`GET / HTTP/1.1\r\nHost: ${bracket(servername)}\r\nConnection: close\r\n\r\n`));
  secure.on('data',chunk=>chunks.push(chunk));
  secure.once('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
  secure.once('close',()=>resolve(Buffer.concat(chunks).toString('utf8')));
  secure.once('error',reject);
 });
};

// The environment every ssh session of the Engine gets names the exit, and only the exit.
for(const name of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy']) assert.equal(process.env[name],'http://exit:3128',`${name} in the sandbox's session`);
console.log('Every session of the sandbox names its exit, http://exit:3128');

// Directly, nothing: the sandbox's network routes nowhere, and the install's names do not resolve on it.
for(const {host,port,label} of config.direct||[]) assert.equal(await reachable(host,port),false,`${label||host} (${host}:${port}) is reachable from the sandbox`);
console.log(`The sandbox reaches none of ${(config.direct||[]).length} install, Engine and public addresses directly`);
if(config.publicName) {
 const resolved=await lookup(config.publicName).then(answer=>answer.address,()=>null);
 assert.equal(resolved,null,`${config.publicName} resolves from the sandbox (${resolved}): a DNS query left it`);
 console.log(`No name of the internet resolves from the sandbox (${config.publicName})`);
}

// Through the exit, refused by the exit itself: by number and by a name that resolves to the address, for plain HTTP and
// for a tunnel to HTTPS's own port, so the refusal is the address and not the port.
for(const host of config.refused||[]) {
 const plain=await httpGet(host);
 assert.ok(refusedByExit(plain.text),`the exit refuses http://${bracket(host)}/ (it answered: ${plain.text.split('\r\n')[0]||'nothing'})`);
 const {text,socket}=await tunnelTo(host,443);
 socket?.destroy();
 assert.ok(refusedByExit(text),`the exit refuses CONNECT ${bracket(host)}:443 (it answered: ${text.split('\r\n')[0]||'nothing'})`);
}
console.log(`The exit refuses ${(config.refused||[]).length} private, link-local, loopback, metadata and install addresses, by number and by name`);

// Through the exit, never reached: a name the exit cannot resolve, or an address it refuses, never answers.
for(const {host,port} of config.unreached||[]) {
 const {text,socket}=await tunnelTo(host,port);
 socket?.destroy();
 assert.ok([403,502].includes(statusOf(text)),`CONNECT ${host}:${port} through the exit is answered ${text.split('\r\n')[0]||'nothing'}`);
 const plain=await httpGet(host,port);
 assert.ok([403,502].includes(statusOf(plain.text)),`http://${host}:${port}/ through the exit is answered ${plain.text.split('\r\n')[0]||'nothing'}`);
}
if(config.unreached?.length) console.log(`Through the exit, none of ${config.unreached.length} other Company and install names is reached`);

const standin=config.standin;
if(standin) {
 // A public address answers through the exit, over HTTP and over HTTPS, by number and by name.
 const token=standin.token;
 for(const host of standin.hosts) {
  const plain=await httpGet(host);
  assert.equal(statusOf(plain.text),200,`http://${host}/ through the exit (it answered: ${plain.text.split('\r\n')[0]||'nothing'})`);
  assert.ok(plain.text.includes(token),`http://${host}/ through the exit reaches the stand-in host`);
  assert.ok((await httpsGet(host,host)).includes(token),`https://${host}/ through the exit reaches the stand-in host`);
 }
 console.log(`A public address answers through the exit over HTTP and HTTPS (${standin.hosts.join(', ')})`);
 // From the shell, the way an Agent's command fetches a page: Python's own client and curl, which read the session's
 // proxy environment and are told nothing else.
 const name=standin.hosts.at(-1);
 const python='import ssl,sys,urllib.request\nprint(urllib.request.urlopen(sys.argv[1],context=ssl._create_unverified_context(),timeout=30).read().decode())';
 for(const scheme of ['http','https']) {
  const answer=execFileSync('sh',['-c','python3 -c "$1" "$2"','sh',python,`${scheme}://${name}/`],{encoding:'utf8',timeout:60000});
  assert.ok(answer.includes(token),`python3 fetches ${scheme}://${name}/ through the exit`);
  if(spawnSync('sh',['-c','command -v curl']).status===0) {
   const curled=execFileSync('sh',['-c','curl -fsS -k --max-time 30 "$1"','sh',`${scheme}://${name}/`],{encoding:'utf8',timeout:60000});
   assert.ok(curled.includes(token),`curl fetches ${scheme}://${name}/ through the exit`);
  }
 }
 console.log(`From the shell, ${name} answers over HTTP and HTTPS through the exit`);
 // From Chromium, the image's own browser, which finds the exit in the same environment.
 for(const scheme of ['http','https']) {
  const profile=mkdtempSync(join(tmpdir(),'exit-chromium-'));
  const drawn=spawnSync('sh',['-c','chromium --headless --disable-gpu --ignore-certificate-errors --user-data-dir="$1" --dump-dom "$2"','sh',profile,`${scheme}://${name}/`],{encoding:'utf8',timeout:90000});
  assert.ok(drawn.stdout.includes(token),`Chromium opens ${scheme}://${name}/ through the exit (${(drawn.stderr||'').trim().split('\n').slice(-3).join(' | ')})`);
 }
 console.log(`From Chromium, ${name} answers over HTTP and HTTPS through the exit`);

 // Nothing but HTTP and HTTPS leaves. Directly, no port of the public host is reachable and a datagram has no route;
 // through the exit, a well-known port that is not HTTP's or HTTPS's is refused, and a tunnel whose first bytes are not a
 // TLS handshake is closed before the exit connects anywhere. The job reads from the stand-in that nothing arrived.
 for(const port of [standin.rawPort,80,443]) assert.equal(await reachable(standin.address,port),false,`${standin.address}:${port} is reachable from the sandbox without the exit`);
 await new Promise(resolve=>{
  const datagram=createSocket('udp4');
  const done=()=>{ try { datagram.close(); } catch {} resolve(); };
  datagram.once('error',done);
  datagram.send(Buffer.from('udp-probe'),standin.udpPort,standin.address,done);
 });
 for(const port of [22,25,53]) {
  const {text,socket}=await tunnelTo(standin.address,port);
  socket?.destroy();
  assert.ok(refusedByExit(text),`the exit refuses CONNECT ${standin.address}:${port} (it answered: ${text.split('\r\n')[0]||'nothing'})`);
 }
 const {text,socket}=await tunnelTo(standin.address,standin.rawPort);
 assert.ok(socket,`the exit answers CONNECT ${standin.address}:${standin.rawPort} before reading the first bytes (${text.split('\r\n')[0]||'nothing'})`);
 const leftover=await new Promise(resolve=>{
  const chunks=[];
  socket.setTimeout(10000,()=>{ socket.destroy(); resolve({data:Buffer.concat(chunks),closed:false}); });
  socket.on('data',chunk=>chunks.push(chunk));
  socket.once('close',()=>resolve({data:Buffer.concat(chunks),closed:true}));
  socket.once('error',()=>{});
  socket.write('SSH-2.0-probe\r\n');
 });
 assert.ok(leftover.closed&&leftover.data.length===0,'the exit closes a tunnel whose first bytes are not TLS, and nothing answers');
 console.log('Nothing but HTTP and HTTPS leaves the sandbox: no direct port, no datagram, no other port and no other protocol through the exit');
}
