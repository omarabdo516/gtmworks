// A Provider's id in the Providers list (#620, spec #611), shared by the page and the server: its kind and the Engine's
// own provider id, `sub-anthropic` for a subscription and `key-openrouter` for an API key. Nothing else names it, and
// nothing in it is a secret.
/** @param {'subscription'|'key'} kind @param {string} provider */
export const entryId=(kind,provider)=>`${kind==='subscription'?'sub':'key'}-${provider}`;
const entryPattern=/^(sub|key)-([a-z0-9][a-z0-9._-]{0,63})$/;
/** The Engine's provider id an entry names, or null for anything else. @param {unknown} entry */
export const providerOfEntry=entry=>{ const found=typeof entry==='string'?entryPattern.exec(entry):null; return found?found[2]:null; };
