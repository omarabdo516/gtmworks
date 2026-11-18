// The install job's profile proof (#126) prints names, states and counts only, never a key or any other value of the
// install's environment (#2). Every line it writes goes through here, and only the fields named below are kept: a value
// a caller passes beside them, such as a credential or an environment entry, is never printed.

const fields=['step','companies','profiles','spaces','memory','skills','keys','capacity','company','profile','space','agent',
 'second','main','seconds','count','state','run','kind','made','ready','provider'];

/** @param {Record<string, unknown>} figures */
export function proof(figures) {
 const kept={};
 for(const field of fields) if(figures?.[field]!==undefined) kept[field]=figures[field];
 return `${JSON.stringify(kept)}\n`;
}

// A bare name the proof computed itself: a Company's or an Agent's Engine profile, printed for the install job to read.
/** @param {string} value */
export const proofName=value=>`${value}\n`;

// The script's only printers: a line of named fields, and a bare name.
/** @param {Record<string, unknown>} figures */
export const writeProof=figures=>process.stdout.write(proof(figures));
/** @param {string} value */
export const writeName=value=>process.stdout.write(proofName(value));
