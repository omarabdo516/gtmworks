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
  // The Company names its Engine (#378, T3): its row holds the record's id, and the record holds the address and key.
  const {data:named,error:namedError}=await db.from('companies').select('engine_id').eq('id',company).maybeSingle();
  if(namedError||!named?.engine_id) return null;
  const {data,error}=await db.from('company_engines').select('address,key_encrypted').eq('id',named.engine_id).maybeSingle();
  if(error||!data?.address||!data?.key_encrypted) return null;
  return {address:data.address,key:decryptSecret(data.key_encrypted,process.env.WEBHOOK_ENCRYPTION_KEY)};
 } catch {
  // A missing encryption key, a ciphertext this install did not write, or a database that does not answer: no Engine.
  return null;
 }
}

/** Registers one waiting Engine record, its key encrypted. A Company names its id in `companies.engine_id` when it is
 * made (#382); a record no Company names waits for the Company that will name it. Returns only what is safe to show: its
 * id and the address.
 * @param {any} db a service-role client
 * @param {{address:string,key:string}} engine
 * @returns {Promise<{id:string,company:null,address:string}>} */
export async function registerEngine(db,{address,key}) {
 if(!db||!address||!key) throw new Error('An Engine needs an address and a key');
 const key_encrypted=encryptSecret(key,process.env.WEBHOOK_ENCRYPTION_KEY);
 const {data,error}=await db.from('company_engines').insert({address,key_encrypted}).select('id,address').single();
 if(error||!data) throw new Error('The Engine record could not be saved');
 return {id:data.id,company:null,address:data.address};
}

/** Names a waiting Engine record as a Company's Engine (#382). The database refuses a record another Company holds.
 * @param {any} db a service-role client
 * @param {{id:string,company:string}} attach */
export async function attachEngine(db,{id,company}) {
 if(!db||!id||!company) throw new Error('An Engine record and a Company are needed to attach one');
 const {error}=await db.from('companies').update({engine_id:id}).eq('id',company);
 if(error) throw new Error('The Engine record could not be attached');
}

/** Adopts the Engine an install made by the release before this one already runs (#378): the record is written and the
 * Company that has no Engine names it, in one transaction. Answers the new record's id, or null when every Company
 * already names its Engine. A second Company without one is refused by the database rather than put on the same Engine.
 * @param {any} db a service-role client
 * @param {{address:string,key:string}} engine
 * @returns {Promise<string|null>} */
export async function adoptEngine(db,{address,key}) {
 if(!db||!address||!key) throw new Error('An Engine needs an address and a key');
 const {data,error}=await db.rpc('adopt_engine',{address,key_encrypted:encryptSecret(key,process.env.WEBHOOK_ENCRYPTION_KEY)});
 if(error) throw new Error('The adopted Engine record could not be saved');
 return data??null;
}

/** What an install's Engine records need after `compose up` (ADR 0018): a fresh install leaves one record waiting for
 * first run's Company; an install the release before this one made gets the Engine it already ran as its one Company's
 * Engine; an install this release made is left as it is. Answers the count of records written and adopted.
 * @param {any} db a service-role client
 * @param {{address:string,key:string}} engine
 * @returns {Promise<{registered:number,adopted:number}>} */
export async function settleInstallEngine(db,{address,key}) {
 const {data:missing,error:missingError}=await db.from('companies').select('id').is('engine_id',null).limit(2);
 if(missingError) throw new Error('The Companies of this install could not be read');
 if(missing.length>0) {
  // The update refuses an install with more than one Company before this runs; one Company is adopted here.
  if(missing.length>1) throw new Error('An install with more than one Company cannot adopt one Engine');
  return {registered:0,adopted:(await adoptEngine(db,{address,key}))?1:0};
 }
 const {data:records,error:recordsError}=await db.from('company_engines').select('id').limit(1);
 if(recordsError) throw new Error('The Engine records of this install could not be read');
 if(records.length>0) return {registered:0,adopted:0};
 await registerEngine(db,{address,key});
 return {registered:1,adopted:0};
}

/** Removes a waiting Engine record a failed `company add` made, before its Company exists (#382), and answers what
 * happened. The delete itself decides: companies.engine_id is a foreign key to the record, so a record a Company names,
 * even one committed a moment ago, refuses the delete (23503) and the answer is `held`; a record removed, or already
 * gone, is `removed`. Any other failure throws, and the caller keeps the Engine.
 * @param {any} db a service-role client
 * @param {{id:string}} engine
 * @returns {Promise<'held'|'removed'>} */
export async function removeEngine(db,{id}) {
 if(!db||!id) throw new Error('An Engine record is needed');
 const {error}=await db.from('company_engines').delete().eq('id',id);
 if(error?.code==='23503') return 'held';
 if(error) throw new Error('The Engine record could not be removed');
 return 'removed';
}
