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

/** Registers one Engine record, its key encrypted. `company` null leaves it waiting for the Company that will claim it.
 * Returns only what is safe to show: its id, the Company and the address.
 * @param {any} db a service-role client
 * @param {{company?:string|null,address:string,key:string}} engine
 * @returns {Promise<{id:string,company:string|null,address:string}>} */
export async function registerEngine(db,{company=null,address,key}) {
 if(!db||!address||!key) throw new Error('An Engine needs an address and a key');
 if(company!==null&&typeof company!=='string') throw new Error('An Engine record needs a Company id or none');
 const key_encrypted=encryptSecret(key,process.env.WEBHOOK_ENCRYPTION_KEY);
 const {data,error}=await db.from('company_engines').insert({company_id:company,address,key_encrypted}).select('id,company_id,address').single();
 if(error||!data) throw new Error('The Engine record could not be saved');
 return {id:data.id,company:data.company_id,address:data.address};
}

/** Attaches a waiting Engine record to a Company (an install updated before #380 attaches every Company it has).
 * @param {any} db a service-role client
 * @param {{id:string,company:string}} attach */
export async function attachEngine(db,{id,company}) {
 if(!db||!id||!company) throw new Error('An Engine record and a Company are needed to attach one');
 const {error}=await db.from('company_engines').update({company_id:company}).eq('id',id);
 if(error) throw new Error('The Engine record could not be attached');
}
