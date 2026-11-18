import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export const fingerprint = (method, path, body) => createHash('sha256').update(`${method}:${path}:${body}`).digest('hex');
const cipherKey = secret => { if (!secret || Buffer.from(secret,'base64').length!==32) throw new Error('WEBHOOK_ENCRYPTION_KEY must be 32 bytes in base64'); return Buffer.from(secret,'base64'); };
export function encryptSecret(value, key) { const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',cipherKey(key),iv); const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.'); }
export function decryptSecret(value,key) { const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url')); const decipher=createDecipheriv('aes-256-gcm',cipherKey(key),iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'); }
