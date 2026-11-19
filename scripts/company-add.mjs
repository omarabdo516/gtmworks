import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { registerEngine, removeEngine } from '../lib/engine-record.mjs';

// `gtmworks company add` (#382, ADR 0018) runs this inside the web container after scripts/install.sh has made and
// health-checked the Company's Engine. It answers in three steps: check refuses an unknown Owner email and a bad name
// before the installer makes anything; add registers the Engine record, makes the Company naming that record, and makes
// the existing Person its Owner; drop removes a waiting record left by a failed add. It prints the slug the installer
// names the Engine folder after, and never prints a key.
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||'http://gateway:8080',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const [mode]=process.argv.slice(2);
const option=name=>{ const at=process.argv.indexOf(`--${name}`); return at>0?process.argv[at+1]:''; };
const sayError=message=>{ console.error(message); process.exitCode=1; };
const name=option('name').trim();
const owner=option('owner').trim();
const address=option('address').trim();
const slug=option('slug').trim();
const key=process.env.ENGINE_KEY||'';
const slugFor=name=>`${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'company'}-${randomUUID().slice(0,8)}`;
const press=async query=>{ const {data,error}=await query; if(error) throw new Error(error.message); return data; };
// An email names an existing Person: an Auth user that has a person row. A signed-up user without one is nobody here.
const personByEmail=async email=>{
 for(let page=1;;page++) {
  const {data,error}=await service.auth.admin.listUsers({page,perPage:1000});
  if(error) throw new Error(error.message);
  const user=data.users.find(found=>String(found.email||'').toLowerCase()===email.toLowerCase());
  if(user) {
   const person=await press(service.from('people').select('id').eq('id',user.id).maybeSingle());
   return person?user.id:null;
  }
  if(data.users.length<1000) return null;
 }
};
const checked=async()=>{
 if(!name||name.length>120) { sayError('A Company needs a name of 1 to 120 letters. Nothing was created.'); return null; }
 if(!owner) { sayError('Name the new Owner with --owner <email>. Nothing was created.'); return null; }
 const person=await personByEmail(owner);
 if(!person) { sayError(`No Person on this install has the email ${owner}. Nothing was created.`); return null; }
 return person;
};

try {
 if(mode==='check') {
  // Prints the name the installer gives the Engine's folder, and refuses before anything is made.
  const person=await checked();
  if(person) process.stdout.write(`${slugFor(name)}\n`);
 } else if(mode==='add') {
  if(!address||!key) { sayError('The new Engine has no address or key; nothing was created.'); }
  else {
   const person=await checked();
   if(person) {
    // The slug names the Engine's folder and the Company alike, so the two are read together; the preflight printed it.
    const companySlug=/^[a-z0-9-]{1,80}$/.test(slug)?slug:slugFor(name);
    let made=null,company=null;
    try {
     made=await registerEngine(service,{address,key});
     company=randomUUID();
     await press(service.from('companies').insert({id:company,slug:companySlug,name,engine_id:made.id,work_mode:null}).select('id').single());
     await press(service.from('members').insert({company_id:company,person_id:person,role:'owner',grant_publishing:true,grant_money_figures:true,grant_customer_data:true}).select('company_id').single());
    } catch(error) {
     // Nothing half made: remove the Company (the record goes with it) or the waiting record alone, then say so plainly.
     if(company) { try { await service.from('companies').delete().eq('id',company); } catch {} }
     if(made) { try { await removeEngine(service,{id:made.id}); } catch {} }
     sayError(`The Company "${name}" was not made: ${error.message}. Nothing was left behind; run the same command again.`);
    }
   }
  }
 } else if(mode==='drop') {
  // A failed add leaves no record waiting for a Company that will never come.
  if(!address) { sayError('An Engine address is needed to remove its waiting record.'); }
  else await press(service.from('company_engines').delete().eq('address',address).is('company_id',null));
 } else sayError('Usage: company-add.mjs check|add|drop --name <name> --owner <email> [--address <url>]');
} catch(error) {
 sayError(`${error.message} Nothing was left behind.`);
}
