import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { deflateRawSync, crc32 } from 'node:zlib';
import { holdsSecret, secretFrames } from '../lib/engine/secret-scan.mjs';
import { engineDashboardRequest, engineDashboardSocket } from '../lib/engine/transport.mjs';

// The key guard of the Owner's Engine dashboard (#871, #892, spec #866): what an archive holds is read within its limit,
// a socket's control frames are no part of a message, and the Engine's key goes only to the Engine.
const key='test-only-key';

/** A zip of the entries given, each with the size it declares (its real one unless `declared` says otherwise). */
function zip(entries) {
 const locals=[], centrals=[];
 let offset=0;
 for(const {name,data,deflate=true,declared} of entries) {
  const packed=deflate?deflateRawSync(data):data, nameBytes=Buffer.from(name), size=declared??data.length;
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(deflate?8:0,8); local.writeUInt32LE(crc32(data),14);
  local.writeUInt32LE(packed.length,18); local.writeUInt32LE(size,22); local.writeUInt16LE(nameBytes.length,26);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(deflate?8:0,10); central.writeUInt32LE(crc32(data),16);
  central.writeUInt32LE(packed.length,20); central.writeUInt32LE(size,24); central.writeUInt16LE(nameBytes.length,28);
  central.writeUInt32LE(offset,42);
  locals.push(local,nameBytes,packed); centrals.push(central,nameBytes);
  offset+=30+nameBytes.length+packed.length;
 }
 const directory=Buffer.concat(centrals), end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
 end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}

test('a zip is read through within its limit, and an entry whose real size is not the one it declares is refused', ()=>{
 assert.equal(holdsSecret(zip([{name:'notes.txt',data:Buffer.from('nothing here')}]),key),false,'an ordinary archive is let through');
 assert.equal(holdsSecret(zip([{name:'.env',data:Buffer.from(`HERMES_KEY=${key}\n`)}]),key),true,'the key inside is found');
 assert.equal(holdsSecret(zip([{name:'.env',data:Buffer.from(`HERMES_KEY=${key}\n`),deflate:false}]),key),true,'a stored entry is read');
 assert.equal(holdsSecret(zip([{name:'a',data:Buffer.from('nothing'),deflate:false},{name:'b',data:Buffer.from('here')}]),key),false,'every entry is read');
 // Declared empty, inflating to a megabyte: its declared size counts nothing against the limit, so it is never let through.
 const big=Buffer.alloc(1024*1024,0x61);
 assert.equal(holdsSecret(zip([{name:'a',data:big,declared:0}]),key),true,'an entry larger than it declares is refused');
 assert.equal(holdsSecret(zip([{name:'a',data:Buffer.from('short'),declared:100}]),key),true,'an entry smaller than it declares is refused');
 assert.equal(holdsSecret(zip([{name:'a',data:Buffer.from('short'),deflate:false,declared:0}]),key),true,'a stored entry that is not its declared size is refused');
});

/** One server frame, unmasked. @param {number} opcode @param {boolean} fin @param {string} text */
const frame=(opcode,fin,text)=>{ const payload=Buffer.from(text); return Buffer.concat([Buffer.from([(fin?0x80:0)|opcode,payload.length]),payload]); };
/** What a frame scan lets through of the frames, and whether it ended with an error. */
async function scanned(frames) {
 const scan=secretFrames(key), passed=[];
 scan.on('data',chunk=>passed.push(chunk));
 const ended=new Promise(resolve=>{ scan.on('error',()=>resolve('refused')); scan.on('end',()=>resolve('passed')); });
 for(const one of frames) scan.write(one);
 scan.end();
 return {ended:await ended,passed:Buffer.concat(passed)};
}

test('a ping between the fragments of a message does not hide the key the message spells', async()=>{
 const split=await scanned([frame(1,false,'test-'),frame(9,true,'!'),frame(0,true,'only-key')]);
 assert.equal(split.ended,'refused','the fragments around a ping still spell the key');
 assert.ok(!split.passed.includes(Buffer.from('only-key')),'the fragment that finishes it is not passed on');
 assert.equal((await scanned([frame(1,true,'test-'),frame(9,true,'only-key')])).ended,'passed','a ping is no part of the message');
 assert.equal((await scanned([frame(1,true,'hello'),frame(9,true,key)])).ended,'refused','a ping that holds the key is refused');
 assert.equal((await scanned([frame(1,false,'test-'),frame(0,true,'only-key')])).ended,'refused','fragments that spell it are refused');
});

/** A listener noting each request's path and its Authorization. */
async function listener() {
 const seen=[];
 const server=createServer((request,response)=>{ seen.push({url:request.url,authorization:request.headers.authorization}); response.end('{}'); });
 server.on('upgrade',(request,socket)=>{ seen.push({url:request.url,authorization:request.headers.authorization}); socket.destroy(); });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {seen,port:/** @type {any} */(server.address()).port,close:()=>new Promise(resolve=>{ server.closeAllConnections(); server.close(resolve); })};
}

test('the dashboard\'s requests and sockets carry the Engine\'s key to the Engine\'s own address only', async()=>{
 const engine=await listener(), other=await listener();
 try {
  const connection={address:`http://127.0.0.1:${engine.port}`,managementAddress:`http://127.0.0.1:${engine.port}`,key};
  const elsewhere=[`//127.0.0.1:${other.port}/leak`,`/\\127.0.0.1:${other.port}/leak`,`http://127.0.0.1:${other.port}/leak`];
  for(const path of elsewhere) {
   await assert.rejects(engineDashboardRequest(connection,{method:'GET',path,headers:{}}),`a request to ${path} is refused`);
   const browser=new PassThrough(), said=[];
   browser.on('data',chunk=>said.push(chunk));
   const socket=await engineDashboardSocket(connection,{path,headers:{connection:'Upgrade',upgrade:'websocket'},guard:{holds:()=>false,frames:new PassThrough()}},browser,Buffer.alloc(0));
   assert.equal(socket,null,`a socket to ${path} is refused`);
   assert.match(Buffer.concat(said).toString(),/^HTTP\/1\.1 502/,'the browser is answered that the Engine cannot be reached');
  }
  assert.deepEqual(other.seen,[],'nothing reached the other address');
  const answer=await engineDashboardRequest(connection,{method:'GET',path:'/api/status',headers:{}});
  answer.resume();
  assert.deepEqual(engine.seen,[{url:'/api/status',authorization:`Bearer ${key}`}],'an ordinary path still reaches the Engine');
 } finally { await engine.close(); await other.close(); }
});
