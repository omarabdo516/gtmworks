import { decryptSecret, encryptSecret } from './agent-crypto.mjs';

// The Engine record (#380, ADR 0018): one row per Company's Engine, holding where it is reached and its key encrypted with
// the install's WEBHOOK_ENCRYPTION_KEY, as ADR 0008 kept a pasted Hermes's key. Only server code reads the table (the
// database grants it to service_role alone), so nothing this module returns is a value a person can read from their own
// session. A Company with no record, or one whose key this install cannot decrypt, has no Engine: the callers show that as
// their one named state, never an exception, and nothing here logs or returns the key or the ciphertext.

/** The decrypted Engine of one Company, or null when it has none this install can reach.
 * @param {any} db a service-role client
 * @param {string|null|undefined} company
 * @returns {Promise<{address:string,key:string}|null>} */
export async function engineRecord(db,company) {
 if(!db||!company) return null;
 try {
  const {data,error}=await db.from('company_engines').select('address,key_encrypted').eq('company_id',company).maybeSingle();
  if(error||!data?.address||!data?.key_encrypted) return null;
  return {address:data.address,key:decryptSecret(data.key_encrypted,process.env.WEBHOOK_ENCRYPTION_KEY)};
 } catch {
  // A missing encryption key, a ciphertext this install did not write, or a database that does not answer: no Engine.
  return null;
 }
}

/** Registers one waiting Engine record, its key encrypted. A Company names its id in `companies.engine_id` when it is
 * made (#382); a record with no Company waits for the Company that will name it. Returns only what is safe to show: its
 * id and the address.
 * @param {any} db a service-role client
 * @param {{address:string,key:string}} engine
 * @returns {Promise<{id:string,company:null,address:string}>} */
export async function registerEngine(db,{address,key}) {
 if(!db||!address||!key) throw new Error('An Engine needs an address and a key');
 const key_encrypted=encryptSecret(key,process.env.WEBHOOK_ENCRYPTION_KEY);
 const {data,error}=await db.from('company_engines').insert({company_id:null,address,key_encrypted}).select('id,company_id,address').single();
 if(error||!data) throw new Error('The Engine record could not be saved');
 return {id:data.id,company:data.company_id,address:data.address};
}

/** Names a waiting Engine record as a Company's Engine (#382). The database refuses a record another Company holds.
 * @param {any} db a service-role client
 * @param {{id:string,company:string}} attach */
export async function attachEngine(db,{id,company}) {
 if(!db||!id||!company) throw new Error('An Engine record and a Company are needed to attach one');
 const {error}=await db.from('companies').update({engine_id:id}).eq('id',company);
 if(error) throw new Error('The Engine record could not be attached');
}

/** Removes a waiting Engine record a failed `company add` made, before its Company exists (#382). A record a Company
 * names is never removed here.
 * @param {any} db a service-role client
 * @param {{id:string}} engine */
export async function removeEngine(db,{id}) {
 if(!db||!id) throw new Error('An Engine record is needed');
 const {error}=await db.from('company_engines').delete().eq('id',id).is('company_id',null);
 if(error) throw new Error('The Engine record could not be removed');
}

/** Moves an Engine's record to the address it is reached at now, keeping its encrypted key. An install updated from the
 * install-wide `hermes` service (#380) adopts that same Engine under the template's first name (#381, ADR 0018).
 * @param {any} db a service-role client
 * @param {{id:string,address:string}} move */
export async function readdressEngine(db,{id,address}) {
 if(!db||!id||!address) throw new Error('An Engine record and its new address are needed');
 const {error}=await db.from('company_engines').update({address}).eq('id',id);
 if(error) throw new Error('The Engine record could not be moved to its new address');
}
