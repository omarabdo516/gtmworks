import { encryptSecret } from '../lib/agent-crypto.mjs';

// The local stacks (#69) point every seeded Engine record at the lane's fake Hermes and encrypt its key with the same
// WEBHOOK_ENCRYPTION_KEY scripts/web.sh gives the app, so the record is the only place the app and worker read it (#380).
// Prints one UPDATE for scripts/local-db.sh to run before it takes the seed snapshot; it prints no key.
const address=process.env.ENGINE_ADDRESS, key=process.env.ENGINE_KEY;
if(!address||!key) throw new Error('ENGINE_ADDRESS and ENGINE_KEY are needed');
const cipher=encryptSecret(key,process.env.WEBHOOK_ENCRYPTION_KEY);
const quote=value=>`$engine$${value}$engine$`;
process.stdout.write(`update public.company_engines set address=${quote(address)}, key_encrypted=${quote(cipher)};\n`);
