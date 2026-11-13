import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { savedConnectionKey } from '../lib/connection-key.mjs';

// Testing a saved Connection decrypts its kept key with the service role, which sees every Company. The read is held to
// the Company the caller was already authorized in, so a Connection id from another Company never yields a key.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const rows=[
 {id:'c0000000-0000-0000-0000-00000000000a',company_id:'10000000-0000-0000-0000-00000000000a',key_encrypted:encryptSecret('key-a',encryptionKey)},
 {id:'c0000000-0000-0000-0000-00000000000b',company_id:'10000000-0000-0000-0000-00000000000b',key_encrypted:encryptSecret('key-b',encryptionKey)},
];
// A stand-in for the service-role client: it answers with the rows every filter matches, as PostgREST does.
function service() {
 const filters=[];
 const query={select:()=>query,eq:(column,value)=>{filters.push([column,value]);return query;},
  maybeSingle:async()=>({data:rows.find(row=>filters.every(([column,value])=>row[column]===value))??null,error:null})};
 return {filters,from:table=>{assert.equal(table,'hermes_connections');return query;}};
}

test('the kept key is read only within the authorized Company', async () => {
 assert.equal(await savedConnectionKey(service(),{id:rows[1].id,company:rows[0].company_id},encryptionKey),null,'another Company\'s Connection gives no key');
 const own=service();
 assert.equal(await savedConnectionKey(own,{id:rows[0].id,company:rows[0].company_id},encryptionKey),'key-a');
 assert.deepEqual(own.filters,[['id',rows[0].id],['company_id',rows[0].company_id]]);
});

test('the Connections route reads a kept key only through the Company-scoped read', () => {
 const route=readFileSync('app/api/hermes-connections/route.ts','utf8');
 assert.match(route,/savedConnectionKey\(server,\{id:connection\.id,company:connection\.company_id\}/);
 assert.equal(route.match(/key_encrypted'\)/g),null,'no other service-role read of the key');
});

test('the service role may filter Connections by Company, and the database proves it', () => {
 const migration=readFileSync('supabase/migrations/20261204000000_remove_agency.sql','utf8');
 assert.match(migration,/^grant select\(company_id\) on public\.hermes_connections to service_role;$/m);
 const verify=readFileSync('supabase/migrations/20261204000000_remove_agency.verify.sql','utf8');
 assert.match(verify,/has_column_privilege\('service_role','public\.hermes_connections','company_id','select'\)/);
});
