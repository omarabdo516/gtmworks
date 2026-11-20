import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { registerEngine, removeEngine } from '../lib/engine-record.mjs';
import { ownerLink, generateOwnerSecret, ownerSecretHash } from '../lib/owner-link.mjs';
import { appUrl } from '../lib/app-origin.mjs';

// `gtmworks company add` (#382, #383, ADR 0018, 0019) runs this inside the web container after scripts/install.sh has made
// and health-checked the Company's Engine. It answers in four steps: check refuses an unknown Owner email and a bad name
// before the installer makes anything; add registers the Engine record and then either makes the Company with the named
// existing Person as its Owner (one SQL function, so the Company is never left without one) or holds the Company's name
// behind a printed first-Owner link, which is used once and makes the Company with its sender as Owner; link prints a
// fresh link for a Company still waiting, ending the earlier one; drop removes a waiting record left by a failed add, and
// says whether a Company holds it (so the installer never destroys an Engine that Company was made on). It
// prints the slug the installer names the Engine folder after, and only a link's address, never a key or a secret's hash.
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
const validName=()=>{ if(name&&name.length<=120) return true; sayError('A Company needs a name of 1 to 120 letters. Nothing was created.'); return false; };
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
// An Owner is named only when the enquiry gave one: with none, the Company waits behind a first-Owner link instead.
const checkedOwner=async()=>owner?personByEmail(owner):null;
const checked=async()=>{
 if(!validName()) return false;
 if(!owner) return true;
 if(!await checkedOwner()) { sayError(`No Person on this install has the email ${owner}. Nothing was created.`); return false; }
 return true;
};
// The link's secret is after `#` and only its hash is stored (#383, ADR 0019), so printing it again is the only way back.
const printLink=secret=>process.stdout.write(`First-Owner link for "${name}": ${ownerLink(appUrl('/').origin,secret)}\n`);
const waitingLinks=async()=>{
 const links=await press(service.from('company_owner_links').select('id,company_name,engine_id,created_at').is('claimed_at',null).order('created_at'));
 // A waiting Engine is a record no Company names (#378, T3).
 const named=await press(service.from('companies').select('engine_id').not('engine_id','is',null));
 const engines=new Set((await press(service.from('company_engines').select('id'))).map(engine=>engine.id));
 const taken=new Set(named.map(company=>company.engine_id));
 return links.filter(link=>engines.has(link.engine_id)&&!taken.has(link.engine_id));
};

try {
 if(mode==='check') {
  // Prints the name the installer gives the Engine's folder, and refuses before anything is made.
  if(await checked()) process.stdout.write(`${slugFor(name)}\n`);
 } else if(mode==='add') {
  if(!address||!key) { sayError('The new Engine has no address or key; nothing was created.'); }
  else if(await checked()) {
   // The slug names the Engine's folder and, with a named Owner, the Company alike; the preflight printed it.
   const companySlug=/^[a-z0-9-]{1,80}$/.test(slug)?slug:slugFor(name);
   let made=null;
   try {
    made=await registerEngine(service,{address,key});
    if(owner) {
     const person=await checkedOwner();
     await press(service.rpc('create_company_with_owner',{engine:made.id,company_name:name,person,person_name:null,language:null,slug:companySlug}));
    } else {
     const secret=generateOwnerSecret();
     await press(service.from('company_owner_links').insert({engine_id:made.id,company_name:name,secret_hash:ownerSecretHash(secret)}).select('id').single());
     printLink(secret);
    }
   } catch(error) {
    // Nothing half made: the one function made no Company, so the waiting record (and any link on it) is all to remove.
    if(made) { try { await removeEngine(service,{id:made.id}); } catch {} }
    sayError(`The Company "${name}" was not made: ${error.message}. Nothing was left behind; run the same command again.`);
   }
  }
 } else if(mode==='link') {
  // A fresh link for a Company still waiting ends the one printed before it: one link is kept per waiting Engine.
  if(validName()) {
   const waiting=(await waitingLinks()).find(link=>link.company_name.toLowerCase()===name.toLowerCase());
   if(!waiting) sayError(`No Company named "${name}" is waiting for its Owner. Nothing was changed.`);
   else {
    const secret=generateOwnerSecret();
    await press(service.from('company_owner_links').update({secret_hash:ownerSecretHash(secret)}).eq('id',waiting.id).select('id').single());
    printLink(secret);
   }
  }
 } else if(mode==='drop') {
  // A failed add leaves no record waiting for a Company that will never come; a record a Company names is kept, and the
  // answer says so (#378, C11): the installer never destroys an Engine a Company was made on.
  if(!address) { sayError('An Engine address is needed to remove its waiting record.'); }
  else {
   let held=false;
   for(const record of await press(service.from('company_engines').select('id').eq('address',address))) {
    const named=await press(service.from('companies').select('id').eq('engine_id',record.id).limit(1));
    if(named.length) { held=true; continue; }
    await removeEngine(service,{id:record.id});
   }
   process.stdout.write(held?'held\n':'removed\n');
  }
 } else sayError('Usage: company-add.mjs check|add|drop --name <name> [--owner <email>] [--address <url>] | company-add.mjs link --name <name>');
} catch(error) {
 sayError(`${error.message} Nothing was left behind.`);
}
