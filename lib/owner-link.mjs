import { createHash, randomBytes } from 'node:crypto';

// The first-Owner link (#383, ADR 0019) carries its one-time secret after `#` in the address, as the setup link does
// (#50): a browser never sends a fragment in a request, so no proxy or server log receives it. Only its hash is stored,
// in a table only server code reads. This file runs on the server (the installer's script and the claim route); a page
// reads the secret from the fragment with setupCodeFromHash, which reads the same `#code=` shape.
export const generateOwnerSecret=()=>randomBytes(32).toString('hex');
export const ownerSecretHash=secret=>createHash('sha256').update(secret).digest('hex');
export const ownerLink=(origin,secret)=>`${origin}/first-owner#code=${secret}`;
