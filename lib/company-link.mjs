import { createHash, randomBytes } from 'node:crypto';

// The one shape of every link that lets a person into a Company (#383, #950, ADR 0019): a 256-bit secret after `#` in
// the address, as the setup link does (#50), so no request, proxy or server log receives it. Only its sha256 is stored,
// in tables only server code reads; the page reads the secret from the fragment with setupCodeFromHash and sends it in
// a form body. This file runs on the server only.
export const linkSecretShape=/^[a-f0-9]{64}$/;
export const generateLinkSecret=()=>randomBytes(32).toString('hex');
export const linkSecretHash=secret=>createHash('sha256').update(secret).digest('hex');
// An Invite link (#950): the page a new Person opens to join the Company it names.
export const inviteLink=(origin,secret)=>`${origin}/join#code=${secret}`;
