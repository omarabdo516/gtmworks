import { generateLinkSecret, linkSecretHash } from './company-link.mjs';

// The first-Owner link (#383, ADR 0019) is one of the Company links (lib/company-link.mjs): its secret sits after `#`
// and only its hash is stored, in a table only server code reads. This file runs on the server (the installer's script
// and the claim route); a page reads the secret from the fragment with setupCodeFromHash.
export const generateOwnerSecret=generateLinkSecret;
export const ownerSecretHash=linkSecretHash;
export const ownerLink=(origin,secret)=>`${origin}/first-owner#code=${secret}`;
