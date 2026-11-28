import { createHmac } from 'node:crypto';
// The current six-digit code for an authenticator secret (RFC 6238, SHA-1, 30 seconds).
export function totp(secret:string) {
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=''; for(const c of secret.replace(/=+$/,'').toUpperCase()) bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');
 const key=Buffer.from(bits.match(/.{8}/g)?.map(b=>parseInt(b,2)) || []); const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000))); const hash=createHmac('sha1',key).update(counter).digest(); const offset=hash[19]&15; return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
// A code that is not the current one.
export const wrongCode=(secret:string)=>totp(secret)==='000000'?'111111':'000000';
