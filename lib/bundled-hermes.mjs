import { companyProfile } from './agent-levels.mjs';

// Hermes ships inside the install (ADR 0010), on the compose network only, and is the only Hermes (#342): the app and
// the worker hold its address and the install-generated key, nobody pastes them and no row keeps them.
/** @param {Record<string,string|undefined>} env @returns {{address:string,key:string}|null} */
export const hermesAt=(env=process.env)=>env.BUNDLED_HERMES_URL&&env.HERMES_API_KEY?{address:env.BUNDLED_HERMES_URL,key:env.HERMES_API_KEY}:null;

// The worker keeps the Company and Agent profiles in step on a self-hosted install only; its own gateway serves the
// `default` profile.
/** @param {Record<string,string|undefined>} env @returns {{address:string,profile:string,key:string}|null} */
export function bundledHermes(env=process.env) {
 const hermes=env.GTMWORKS_SELF_HOSTED==='true'?hermesAt(env):null;
 return hermes&&{...hermes,profile:'default'};
}

// A Run's target: the bundled Hermes on the profile the database pinned for it. A Company profile serves its own Company
// only (ADR 0014); an Agent's own profile is checked by the database against its Agent (ADR 0016). Null when there is no
// profile or no Hermes to reach.
/** @param {string|null|undefined} profile @param {string|null} [company] @param {{address:string,key:string}|null} [hermes] */
export function onProfile(profile,company=null,hermes=hermesAt()) {
 if(!hermes||!profile) return null;
 if(company&&/^co-[0-9a-f]{32}$/.test(profile)&&profile!==companyProfile(company)) return null;
 return {...hermes,profile};
}
