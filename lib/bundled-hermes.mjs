import { companyProfile } from './agent-levels.mjs';

// Hermes ships inside the install (ADR 0010), on the compose network only, and is the only Hermes (#342): the app and
// the worker hold its address and the install-generated key, nobody pastes them and no row keeps them.
/** @param {Record<string,string|undefined>} env @returns {{address:string,key:string}|null} */
export const hermesAt=(env=process.env)=>env.BUNDLED_HERMES_URL&&env.HERMES_API_KEY?{address:env.BUNDLED_HERMES_URL,key:env.HERMES_API_KEY}:null;

// One module answers "the Engine of this Company" (ADR 0018): the address its Hermes listens at and the key that opens
// it, which only the engine's driver is given. Every Hermes call the app and the worker make asks here for the Company
// it serves, so a Company on an Engine of its own is a change to this module alone. Until the install keeps an Engine
// record per Company (#380) the install's one Engine serves every Company, and its address and key are the install's
// own environment; a Company with no Engine answers null, which every caller shows as its one state (`noEngine`), never
// an exception.
/** @param {string|null|undefined} company @param {Record<string,string|undefined>} [env] @returns {{address:string,key:string}|null} */
export const engineOf=(company,env=process.env)=>hermesAt(env);

// The worker keeps the Company and Agent profiles in step on a self-hosted install only; its own gateway serves the
// `default` profile.
/** @param {Record<string,string|undefined>} env @returns {{address:string,profile:string,key:string}|null} */
export function bundledHermes(env=process.env) {
 const hermes=env.GTMWORKS_SELF_HOSTED==='true'?hermesAt(env):null;
 return hermes&&{...hermes,profile:'default'};
}

// A Run's target: the Engine of the Company the database pinned the Run to, on the profile it pinned for it. Every caller
// gives the Engine `engineOf` answered for that Company; without one there is no target. A Company profile serves its own
// Company only (ADR 0014); an Agent's own profile is checked by the database against its Agent (ADR 0016). Null when there
// is no profile or no Engine to reach.
/** @param {string|null|undefined} profile @param {string|null} [company] @param {{address:string,key:string}|null} hermes */
export function onProfile(profile,company=null,hermes=null) {
 if(!hermes||!profile) return null;
 if(company&&/^co-[0-9a-f]{32}$/.test(profile)&&profile!==companyProfile(company)) return null;
 return {...hermes,profile};
}
