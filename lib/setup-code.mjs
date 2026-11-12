import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// First-run setup opens only through the one-time link the installer prints (issue #50). The code lives in the install's
// own .env.install (SETUP_CODE), on the server; setup_is_open() closes first run for good once setup completes.
const format=/^[a-f0-9]{64}$/;
// 32 random bytes: 256 bits, as 64 hex characters.
export const generateSetupCode=()=>randomBytes(32).toString('hex');
export const isSetupCode=value=>format.test(value || '') && !/^(.)\1+$/.test(value);

const digest=value=>createHash('sha256').update(value).digest();
// Both sides are hashed to the same length, so the comparison takes the same time whatever the visitor sent.
export function setupCodeMatches(given,expected=process.env.SETUP_CODE) {
 if(typeof given!=='string' || !isSetupCode(expected)) return false;
 return timingSafeEqual(digest(given),digest(expected));
}
