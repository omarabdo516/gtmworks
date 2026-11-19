import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord, registerEngine, attachEngine, removeEngine, settleInstallEngine } from '../lib/engine-record.mjs';
import { decryptSecret } from '../lib/agent-crypto.mjs';
import { readFileSync } from 'node:fs';

// The Engine record's module (#380, #382, ADR 0018): it writes an Engine's key encrypted with the install's
// WEBHOOK_ENCRYPTION_KEY, returns only the decrypted address and key to server code, and never carries the ciphertext or
// the key in an answer. A key this install cannot decrypt is no Engine, not an exception. A Company names the record it
// is made on; a record with no Company waits.
const encryptionKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const key='install-engine-key-'.repeat(3);

// A service-role client keeping the rows the database would: insert adds one, update changes it, delete removes one, and
// a Company names its Engine in `companies.engine_id` (#378, T3). A read is a chain that is awaited (`.limit`) or ends in
// `.maybeSingle()`.
const store=(rows=[],companies=[])=>{
 let next=0;
 const list=name=>name==='companies'?companies:rows;
 const query=name=>{
  let column,value,is,limit;
  const filter=row=>is?row[is[0]]===is[1]:row[column]===value;
  const q={
   select:()=>q,
   eq:(c,v)=>{column=c;value=v;return q;},
   is:(c,v)=>{is=[c,v];return q;},
   limit:n=>{limit=n;return q;},
   maybeSingle:async()=>({data:list(name).find(filter)??null,error:null}),
   then:resolve=>{ let found=list(name).filter(filter); if(limit!==undefined) found=found.slice(0,limit); resolve({data:found,error:null}); },
  };
  return q;
 };
 const table=name=>({
  ...query(name),
  insert:written=>({select:()=>({single:async()=>{ const row={...written,id:`engine-${++next}`}; rows.push(row); return {data:row,error:null}; }})}),
  update:change=>({eq:async(column,value)=>{ const row=list(name).find(found=>found[column]===value); if(row) Object.assign(row,change); return {error:null}; }}),
  delete:()=>({eq:async(column,value)=>{ const at=rows.findIndex(row=>row[column]===value); if(at>=0) rows.splice(at,1); return {error:null}; }}),
 });
 return {rows,companies,from:table};
};

test('an Engine is stored with its key encrypted, and its record answers only the address and the key', async () => {
 const saved=process.env.WEBHOOK_ENCRYPTION_KEY;
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 try {
  const db=store([],[{id:company,engine_id:null}]);
  const waiting=await registerEngine(db,{address:'http://hermes:8642',key});
  assert.equal(waiting.company,null,'a fresh install leaves the record waiting for first run');
  await attachEngine(db,{id:waiting.id,company});
  const row=db.rows[0];
  assert.notEqual(row.key_encrypted,key,'the key is never stored as written');
  assert.equal(JSON.stringify(waiting).includes(key),false,'the key is never returned');
  assert.equal(JSON.stringify(waiting).includes(row.key_encrypted),false,'the ciphertext is never returned');
  assert.equal(decryptSecret(row.key_encrypted,encryptionKey),key,'only the install can read the key back');
  assert.deepEqual(await engineRecord(db,company),{address:'http://hermes:8642',key});
  // Another install's key decrypts nothing here: the Company has no Engine, and nothing throws.
  process.env.WEBHOOK_ENCRYPTION_KEY='BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
  assert.equal(await engineRecord(db,company),null);
 } finally {
  if(saved===undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY=saved;
 }
});

test('a Company names the one record it is made on, and a failed add removes only a waiting record', async () => {
 const saved=process.env.WEBHOOK_ENCRYPTION_KEY;
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 try {
  const db=store([],[{id:company,engine_id:null}]);
  const waiting=await registerEngine(db,{address:'http://hermes:8642',key});
  assert.equal(await engineRecord(db,company),null);
  await attachEngine(db,{id:waiting.id,company});
  assert.deepEqual(await engineRecord(db,company),{address:'http://hermes:8642',key});
  // A record a Company names is not removed by a failed add's cleanup; a waiting one is.
  await removeEngine(db,{id:waiting.id});
  assert.deepEqual(await engineRecord(db,company),{address:'http://hermes:8642',key});
  const lost=await registerEngine(db,{address:'http://gtmworks-engine-lost:8642',key:'k'.repeat(64)});
  await removeEngine(db,{id:lost.id});
  assert.equal(db.rows.some(row=>row.id===lost.id),false,'a waiting record a failed add made is removed');
 } finally {
  if(saved===undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY=saved;
 }
});

// The release before this one had no Engine records (#378, S1): the installer adopts the Engine that install already
// runs as its one Company's Engine, in one transaction. A fresh install leaves one record waiting, an install of this
// release is left alone, and more than one Company with no Engine is refused rather than put on the same one.
test('nothing keeps a released install\'s old Engine address: the one-adopt path is the only move (#378, T6)', async () => {
 const api=await import('../lib/engine-record.mjs');
 assert.equal(Object.hasOwn(api,'readdressEngine'),false,'no second way to move a record');
 const script=readFileSync(new URL('../scripts/install-engine.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(script,/hermes:8642/,'no legacy address is special-cased');
 assert.match(script,/settleInstallEngine\(/);
});

test('an install made before the Engine records adopts its one Company\'s Engine, and a fresh one waits', async () => {
 const saved=process.env.WEBHOOK_ENCRYPTION_KEY;
 process.env.WEBHOOK_ENCRYPTION_KEY=encryptionKey;
 try {
  const database=(companies,records)=>{
   const asked=[];
   const db={asked,from:name=>({select:()=>({is:(column,value)=>({limit:async()=>({data:companies.filter(company=>company[column]===value).slice(0,2),error:null})}),
     limit:async()=>({data:records.slice(0,2),error:null})}),
     insert:written=>({select:()=>({single:async()=>{ const row={...written,id:`engine-${records.length+1}`}; records.push(row); return {data:row,error:null}; }})})}),
    rpc:async(name,args)=>{ asked.push({name,args});
     if(name!=='adopt_engine') return {data:null,error:{message:'unexpected'}};
     const waiting=companies.find(company=>company.engine_id===null);
     const row={id:'engine-adopted',...args}; records.push(row); waiting.engine_id=row.id;
     return {data:row.id,error:null};
    }};
   return db;
  };
  // A previous-release install: one Company with no Engine, and no record at all. The adopted record is that Engine and
  // the Company names it; its key is encrypted with the install's key, never stored as written.
  const companies=[{id:company,engine_id:null}], rows=[];
  const previous=database(companies,rows);
  assert.deepEqual(await settleInstallEngine(previous,{address:'http://gtmworks-engine-first:8642',key}),{registered:0,adopted:1});
  assert.equal(companies[0].engine_id,'engine-adopted');
  assert.equal(rows.length,1);
  assert.notEqual(rows[0].key_encrypted,key);
  assert.equal(JSON.stringify(previous.asked).includes(key),false,'the key is never put in an answer');
  // A fresh install: no Company yet, so one record waits for first run's Company.
  const freshRows=[];
  assert.deepEqual(await settleInstallEngine(database([],freshRows),{address:'http://gtmworks-engine-first:8642',key}),{registered:1,adopted:0});
  assert.equal(freshRows.length,1);
  assert.equal(freshRows[0].address,'http://gtmworks-engine-first:8642');
  assert.equal('company_id' in freshRows[0],false,'the record names no Company (#378, T3)');
  // An install of this release: every Company names its Engine and a record exists, so nothing is written.
  const attachedRows=[{id:'engine-1'}];
  assert.deepEqual(await settleInstallEngine(database([{id:company,engine_id:'engine-1'}],attachedRows),{address:'http://gtmworks-engine-first:8642',key}),{registered:0,adopted:0});
  assert.equal(attachedRows.length,1);
  // Two Companies with no Engine cannot share one Engine: refused before anything is written.
  const severalRows=[];
  await assert.rejects(()=>settleInstallEngine(database([{id:company,engine_id:null},{id:other,engine_id:null}],severalRows),{address:'http://gtmworks-engine-first:8642',key}),/more than one Company/);
  assert.deepEqual(severalRows,[]);
 } finally {
  if(saved===undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY=saved;
 }
});
