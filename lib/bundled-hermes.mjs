import { encryptSecret } from './agent-crypto.mjs';
import { testHermes } from './hermes.mjs';

// A self-hosted install ships Hermes inside (ADR 0010), on the compose network only. Its single gateway serves the
// `default` profile; the worker holds its address and the install-generated key, nobody pastes them.
/** @param {Record<string,string|undefined>} env @returns {{address:string,profile:string,key:string}|null} */
export function bundledHermes(env=process.env) {
 return env.GTMWORKS_SELF_HOSTED==='true'&&env.BUNDLED_HERMES_URL&&env.HERMES_API_KEY?{address:env.BUNDLED_HERMES_URL,profile:'default',key:env.HERMES_API_KEY}:null;
}

// The worker no longer calls this: each company now gets its own profile (lib/company-profiles.mjs, ADR 0014). It is
// kept with its tests as the previous version's provider, whose database function an update leaves in place.
// Each company with no Hermes yet gets a Connection to the bundled Hermes and a default agent on it, through the
// existing driver and encrypted-key storage (ADR 0008): the database owns the rows, the worker only tests Hermes and
// hands over the encrypted key. An untested or refusing Hermes is never provided (it fails closed, like a pasted one).
// `db` is a service-role client. Returns how many companies were provided for.
/** @param {any} db @param {{hermes:{address:string,profile:string,key:string}|null,encryptionKey:string|undefined,test?:typeof testHermes}} options */
export async function provideBundledHermes(db,{hermes,encryptionKey,test=testHermes}) {
 if(!hermes) return 0;
 const {data:waiting,error}=await db.rpc('bundled_hermes_waiting');
 if(error) throw new Error(error.message);
 if(!waiting) return 0;
 const status=await test(hermes);
 if(status.state!=='connected'||!status.features.includes('run_submission')) return 0;
 const {data:provided,error:refused}=await db.rpc('provide_bundled_hermes',{bundled_address:hermes.address,bundled_profile:hermes.profile,
  bundled_key:encryptSecret(hermes.key,encryptionKey),bundled_version:status.version,bundled_features:status.features});
 if(refused) throw new Error(refused.message);
 return provided||0;
}
