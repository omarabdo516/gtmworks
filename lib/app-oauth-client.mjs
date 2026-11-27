// The install's own OAuth client for a vendor that refuses dynamic client registration (#914; Meta's Ads MCP). The
// catalogue entry names the install settings that hold it (lib/app-catalogue.mjs oauthClient); they are read here, on
// the server, and go only into the Engine's config for that server, never to a browser, a log or the database.
// `none`: the vendor registers clients itself. `missing`: it does not, and the install has no client yet, so nothing can
// connect until the install owner adds one (`guide` says how). `set`: the client to write.
/** @param {import('./app-catalogue.mjs').App|undefined} entry @param {Record<string,string|undefined>} [env]
 * @returns {{state:'none'}|{state:'missing',guide:string}|{state:'set',client:import('./app-catalogue.mjs').OAuthClient}} */
export function installClient(entry,env=process.env) {
 const declared=entry?.auth==='oauth'?entry.oauthClient:undefined;
 if(!declared) return {state:'none'};
 const id=env[declared.id]?.trim(); const secret=env[declared.secret]?.trim();
 // An app id is one line of printable text; anything else is not one, and the install owner is told to add it again.
 const usable=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
 if(!usable(id)) return {state:'missing',guide:declared.guide};
 return {state:'set',client:{id:/** @type {string} */(id),...(usable(secret)?{secret:/** @type {string} */(secret)}:{})}};
}
