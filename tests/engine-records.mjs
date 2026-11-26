import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { forgetEngineRecords } from '../lib/company-engine.mjs';
import { forgetListeners } from '../lib/engine/transport.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { withEngineCapabilities } from '../lib/engine/handle.mjs';

// The Engine record as the server reads it (#782): the handle finds a Company's Engine only in the database, through the
// service-role client (lib/company-engine.mjs), so a node test gives it one the same way: a small PostgREST of its own
// that answers the two reads of lib/engine-record.mjs, `companies.engine_id` and `company_engines.address,key_encrypted`,
// with the key encrypted as the install encrypts it. Importing this file points the service-role client at it, so it is
// imported before any module reads a record.
const encryption=Buffer.alloc(32,11).toString('base64');
/** @type {Map<string,{address:string,key:string}>} */
const records=new Map();
let reads=0;
const server=createServer((request,response)=>{
 const url=new URL(request.url??'/','http://records.test');
 const id=/^eq\.(.+)$/.exec(url.searchParams.get('id')??'')?.[1]??'';
 const one=String(request.headers.accept??'').includes('vnd.pgrst.object');
 const send=(/** @type {unknown[]} */ rows)=>{
  response.writeHead(200,{'Content-Type':'application/json'});
  response.end(JSON.stringify(one?rows[0]??null:rows));
 };
 if(url.pathname==='/rest/v1/companies') { reads++; return send(records.has(id)?[{engine_id:id}]:[]); }
 if(url.pathname==='/rest/v1/company_engines') {
  const found=records.get(id);
  // Encrypted with the key the reading process holds now, as the install encrypts with its own.
  return send(found?[{address:found.address,key_encrypted:encryptSecret(found.key,process.env.WEBHOOK_ENCRYPTION_KEY||encryption)}]:[]);
 }
 response.writeHead(404,{'Content-Type':'application/json'}); response.end('{"message":"not here"}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
server.unref();
process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${/** @type {any} */(server.address()).port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role';
process.env.WEBHOOK_ENCRYPTION_KEY=encryption;

/** Gives the Company this Engine as its record (null: no Engine). Each change is seen at once. @param {string} company @param {{address:string,key?:string}|null} engine */
export function engineRecord(company,engine) {
 if(engine) records.set(company,{address:engine.address,key:engine.key??'test-only-key'});
 else records.delete(company);
 forgetEngineRecords(); forgetListeners();
}
/** How many times a Company's record was read since the file started. */
export const recordReads=()=>reads;

// A fake Engine as a Company's record names it: its API listener at the record's address and its management listener on
// port 9119 of the same host, where the transport finds it. Each fake takes a loopback address of its own, so two at once
// (two files, or two Companies of one test) never share the port.
/** @param {Parameters<typeof fakeHermes>[0]} [options] */
export async function companyHermes(options={}) {
 const host=`127.${randomInt(1,255)}.${randomInt(0,256)}.${randomInt(1,255)}`;
 return fakeHermes({...options,host,managementPort:9119});
}
/** A fake Engine serving the Company, its record written. @param {string} company @param {Parameters<typeof fakeHermes>[0]} [options] */
export async function engineServing(company,options={}) {
 const fake=await companyHermes(options);
 engineRecord(company,fake);
 return fake;
}

// A test that made one driver call answer its own way (a race, a refusal at one step) gives that stub here, as it gave it
// before #782, by the names `calls` maps to the profile handle's methods (`{delete:'routines.remove'}`): each stub is
// called with the profile's connection first, as a driver function is, and may call the real driver with it, which
// reaches the wire fake. Only the named stubs change; every other call goes to the Engine as ever.
/** @template T @param {Record<string,string>} calls @param {Record<string,Function>|null|undefined} stub @param {()=>T} work @returns {T} */
export function withDriver(calls,stub,work) {
 if(!stub) return work();
 return withEngineCapabilities(connection=>{
  /** @type {Record<string,Record<string,Function>>} */
  const over={};
  for(const [name,path] of Object.entries(calls)) {
   if(typeof stub[name]!=='function') continue;
   const [capability,method]=path.split('.');
   (over[capability]??={})[method]=(/** @type {any[]} */ ...args)=>stub[name](connection,...args);
  }
  return over;
 },work);
}
/** Runs `work` while the Company has no Engine record, then gives it back the one it had (a test's "no Engine").
 * @template T @param {string} company @param {()=>Promise<T>} work @returns {Promise<T>} */
export async function withNoEngine(company,work) {
 const had=records.get(company)??null;
 engineRecord(company,null);
 try { return await work(); } finally { engineRecord(company,had); }
}
