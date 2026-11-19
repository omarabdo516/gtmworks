import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord, registerEngine, attachEngine, readdressEngine } from '../lib/engine-record.mjs';
import { decryptSecret } from '../lib/agent-crypto.mjs';

// The Engine record's module (#380, ADR 0018): it writes an Engine's key encrypted with the install's
// WEBHOOK_ENCRYPTION_KEY, returns only the decrypted address and key to server code, and never carries the ciphertext or
// the key in an answer. A key this install cannot decrypt is no Engine, not an exception.
const encryptionKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const company='10000000-0000-0000-0000-000000000001';
const key='install-engine-key-'.repeat(3);

// A service-role client keeping the rows the database would: insert adds one, update changes it by id, and a Company's
// record reads back by company_id as `maybeSingle` does.
const store=(rows=[])=>{
 let next=0;
 return {
  rows,
  from:()=>({
   select:()=>({eq:(column,value)=>({maybeSingle:async()=>({data:rows.find(row=>row[column]===value)??null,error:null})})}),
   insert:written=>({select:()=>({single:async()=>{ const row={...written,id:`engine-${++next}`}; rows.push(row); return {data:row,error:null}; }})}),
   update:change=>({eq:async(column,value)=>{ const row=rows.find(found=>found[column]===value); if(row) Object.assign(row,change); return {error:null}; }}),
  }),
 };
};

test('an Engine is stored with its key encrypted, and its record answers only the address and the key', async () => {
 const saved=process.env.WEBHOOK_ENCRYPTION_KEY;
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 try {
  const db=store();
  const written=await registerEngine(db,{company,address:'http://hermes:8642',key});
  assert.deepEqual(written,{id:'engine-1',company,address:'http://hermes:8642'});
  const row=db.rows[0];
  assert.notEqual(row.key_encrypted,key,'the key is never stored as written');
  assert.equal(JSON.stringify(written).includes(key),false,'the key is never returned');
  assert.equal(JSON.stringify(written).includes(row.key_encrypted),false,'the ciphertext is never returned');
  assert.equal(decryptSecret(row.key_encrypted,encryptionKey),key,'only the install can read the key back');
  assert.deepEqual(await engineRecord(db,company),{address:'http://hermes:8642',key});
  // Another install's key decrypts nothing here: the Company has no Engine, and nothing throws.
  process.env.WEBHOOK_ENCRYPTION_KEY='BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
  assert.equal(await engineRecord(db,company),null);
 } finally {
  if(saved===undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY=saved;
 }
});

test('a waiting Engine record is attached to the Company an existing install makes it for', async () => {
 const saved=process.env.WEBHOOK_ENCRYPTION_KEY;
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 try {
  const db=store();
  const waiting=await registerEngine(db,{address:'http://hermes:8642',key});
  assert.equal(waiting.company,null,'a fresh install leaves the record waiting for first run');
  assert.equal(await engineRecord(db,company),null);
  await attachEngine(db,{id:waiting.id,company});
  assert.deepEqual(await engineRecord(db,company),{address:'http://hermes:8642',key});
  // The template's first Engine gives the same record a new address; its encrypted key is untouched.
  const before=db.rows[0].key_encrypted;
  await readdressEngine(db,{id:waiting.id,address:'http://gtmworks-engine-first:8642'});
  assert.equal(db.rows[0].key_encrypted,before);
  assert.deepEqual(await engineRecord(db,company),{address:'http://gtmworks-engine-first:8642',key});
 } finally {
  if(saved===undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY=saved;
 }
});
