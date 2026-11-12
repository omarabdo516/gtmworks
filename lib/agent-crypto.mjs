import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
export const hashKey = key => createHash('sha256').update(key).digest('hex');
// A key shows its kind in its prefix and is stored only as a hash. The server shows the key once.
export const newKey = kind => { const key = `${kind === 'run' ? 'gtmw_run_' : 'gtmw_agt_'}${randomBytes(32).toString('base64url')}`; return { key, hash: hashKey(key) }; };
export const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const fingerprint = (method, path, body) => createHash('sha256').update(`${method}:${path}:${body}`).digest('hex');
export const signature = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const cipherKey = secret => { if (!secret || Buffer.from(secret,'base64').length!==32) throw new Error('WEBHOOK_ENCRYPTION_KEY must be 32 bytes in base64'); return Buffer.from(secret,'base64'); };
export function encryptSecret(value, key) { const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',cipherKey(key),iv); const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.'); }
export function decryptSecret(value,key) { const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url')); const decipher=createDecipheriv('aes-256-gcm',cipherKey(key),iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'); }
export function retryAt(createdAt, attempts, now=Date.now()) { const deadline=new Date(createdAt).getTime()+86400000; const next=now+Math.min(3600000, 1000*2**Math.min(attempts,12)); return next >= deadline ? null : new Date(next).toISOString(); }
export function rateWindow(start, count, now) { return now-start>=60000 ? {start:now,count:1,limited:false} : {start,count:count+1,limited:count+1>120}; }
