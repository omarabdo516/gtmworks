import { inflateRawSync, gunzipSync } from 'node:zlib';
import { Transform } from 'node:stream';

// Whether bytes on their way to a browser hold a secret (#871, spec #866): the Engine's own key, which is in the Engine's
// environment and in every profile's .env (lib/engine/agents.mjs), so any of the Engine's dashboard routes that reads a
// file, a log or a dump could carry it. The secret is found as it is written, in base64 or base64url at any of the three
// places a run of bytes can start in a base64 text (a file read as a data URL), and inside a zip or gzip archive, read
// through to what it holds (a backup archive holds the profiles' .env, hermes_cli/backup.py). An archive that cannot be
// read through (another compression, a cut or damaged one, one too large) counts as holding it: what cannot be read is
// never let through. A socket's frames are read for it too, as they come (secretFrames, #892).

const archiveLimit=256*1024*1024;
const depthLimit=3;

/** The forms the secret takes in a text: itself, and the part of its base64 that is the same wherever it starts.
 * @param {string} secret @returns {Buffer[]} */
function secretForms(secret) {
 const raw=Buffer.from(secret);
 const forms=[raw];
 for(let shift=0;shift<3;shift++) {
  const text=Buffer.concat([Buffer.alloc(shift),raw]).toString('base64');
  // The first group mixes the bytes before the secret when it does not start a group, and the last one the bytes after.
  const middle=text.slice(shift?4:0,Math.floor((shift+raw.length)/3)*4);
  if(middle.length>=8) forms.push(Buffer.from(middle),Buffer.from(middle.replaceAll('+','-').replaceAll('/','_')));
 }
 return forms;
}

/** @param {Buffer} bytes @param {Buffer[]} forms */
const plainHolds=(bytes,forms)=>forms.some(form=>bytes.includes(form));

/** The files a zip holds, each read whole, or null when it cannot be read through. @param {Buffer} zip @returns {Buffer[]|null} */
function zipEntries(zip) {
 const from=Math.max(0,zip.length-65557);
 let end=-1;
 for(let at=zip.length-22;at>=from;at--) if(zip.readUInt32LE(at)===0x06054b50) { end=at; break; }
 if(end<0) return null;
 const count=zip.readUInt16LE(end+10);
 let at=zip.readUInt32LE(end+16);
 /** @type {Buffer[]} */
 const entries=[];
 let total=0;
 for(let index=0;index<count;index++) {
  if(at+46>zip.length||zip.readUInt32LE(at)!==0x02014b50) return null;
  const method=zip.readUInt16LE(at+10), flags=zip.readUInt16LE(at+8), packed=zip.readUInt32LE(at+20), size=zip.readUInt32LE(at+24);
  const local=zip.readUInt32LE(at+42);
  at+=46+zip.readUInt16LE(at+28)+zip.readUInt16LE(at+30)+zip.readUInt16LE(at+32);
  // Encrypted, or sizes kept elsewhere (ZIP64): not read through.
  if(flags&1||packed===0xffffffff||size===0xffffffff) return null;
  if(local+30>zip.length||zip.readUInt32LE(local)!==0x04034b50) return null;
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  if(start+packed>zip.length) return null;
  total+=size; if(total>archiveLimit) return null;
  const data=zip.subarray(start,start+packed);
  if(method===0) entries.push(data);
  else if(method===8) entries.push(inflateRawSync(data,{maxOutputLength:archiveLimit}));
  else return null;
 }
 return entries;
}

/**
 * Whether the bytes hold the secret, as written, in base64, or inside an archive they are.
 * @param {Buffer} bytes @param {string} secret @param {number} [depth]
 * @returns {boolean}
 */
export function holdsSecret(bytes,secret,depth=0) {
 if(!secret) return false;
 if(plainHolds(bytes,secretForms(secret))) return true;
 const zip=bytes.length>=4&&bytes.readUInt32LE(0)===0x04034b50;
 const gzip=bytes.length>=2&&bytes[0]===0x1f&&bytes[1]===0x8b;
 if(!zip&&!gzip) return false;
 if(depth>=depthLimit) return true;
 try {
  const inner=zip?zipEntries(bytes):[gunzipSync(bytes,{maxOutputLength:archiveLimit})];
  return inner===null||inner.some(entry=>holdsSecret(entry,secret,depth+1));
 } catch { return true; }
}

// The most of one socket frame read whole before it goes on (#892): the same as an answer read whole.
const frameLimit=128*1024*1024;

/**
 * The frames a server sends on a WebSocket (RFC 6455), each read whole and passed on as it came, until one would carry
 * the secret: the message text of every frame is read as one run, so the secret is found as written or in base64 in one
 * frame, in the fragments of one message or over several messages, and the frame that would finish it is never passed
 * on; the stream ends with an error there. A frame that cannot be read (compressed by an extension, or past the limit)
 * counts as holding it. For a socket's way to the browser (the Owner's Engine dashboard).
 * @param {string} secret @returns {Transform}
 */
export function secretFrames(secret) {
 const forms=secretForms(secret);
 const keep=Math.max(...forms.map(form=>form.length))-1;
 let pending=Buffer.alloc(0), said=Buffer.alloc(0);
 return new Transform({
  transform(chunk,_encoding,done) {
   pending=Buffer.concat([pending,chunk]);
   /** @type {Buffer[]} */
   const passed=[];
   for(;;) {
    if(pending.length<2) break;
    const first=pending[0], second=pending[1];
    let size=second&0x7f, at=2;
    if(size===126) { if(pending.length<4) break; size=pending.readUInt16BE(2); at=4; }
    else if(size===127) { if(pending.length<10) break; const big=pending.readBigUInt64BE(2); size=big>BigInt(frameLimit)?frameLimit+1:Number(big); at=10; }
    if(first&0x70||size>frameLimit) { done(new Error('a socket frame that cannot be read')); return; }
    const mask=second&0x80?pending.subarray(at,at+4):null;
    if(mask) at+=4;
    if(pending.length<at+size) break;
    const payload=Buffer.from(pending.subarray(at,at+size));
    if(mask) for(let index=0;index<payload.length;index++) payload[index]^=mask[index%4];
    const joined=Buffer.concat([said,payload]);
    if(plainHolds(joined,forms)) { done(new Error('the frame holds a secret')); return; }
    said=joined.subarray(Math.max(0,joined.length-keep));
    passed.push(pending.subarray(0,at+size));
    pending=pending.subarray(at+size);
   }
   done(null,passed.length?Buffer.concat(passed):undefined);
  },
 });
}

/**
 * A stream that passes bytes on until the secret, as written or in base64, would pass, and then ends with an error
 * before any of it has: for an answer read as it comes (an event stream), which cannot be read whole first.
 * @param {string} secret @returns {Transform}
 */
export function secretCut(secret) {
 const forms=secretForms(secret);
 const keep=Math.max(...forms.map(form=>form.length))-1;
 let held=Buffer.alloc(0);
 return new Transform({
  transform(chunk,_encoding,done) {
   const joined=Buffer.concat([held,chunk]);
   if(plainHolds(joined,forms)) { done(new Error('the answer holds a secret')); return; }
   const passed=Math.max(0,joined.length-keep);
   held=joined.subarray(passed);
   done(null,joined.subarray(0,passed));
  },
  flush(done) { done(null,held); },
 });
}
