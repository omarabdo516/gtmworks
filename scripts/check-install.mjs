// CI runs this on stdin inside /app in the installed web container, using its HTTP APIs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const seed=process.argv[2]==='seed';
const origin='http://gateway:8080';
const admin=createClient(origin,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const credentials={email:'restore@example.com',password:'Install-restore-239!'};
const checked=async query=>{const {data,error}=await query; assert.equal(error,null,JSON.stringify(error)); return data;};
if(seed) {
 const {user}=await checked(admin.auth.admin.createUser({...credentials,email_confirm:true}));
 await checked(admin.from('people').insert({id:user.id,name:'Restore Person'}));
 for(const slug of ['restore-one','restore-two']) {
  // Like bootstrap-owner and the test seed, supply the UUID; companies.id has no default.
  const company=await checked(admin.from('companies').insert({id:randomUUID(),slug,name:slug}).select().single());
  await checked(admin.from('members').insert({company_id:company.id,person_id:user.id,role:'contributor'}));
  // A card waiting on the person, with one stored file, written by the server (the external-agent API is gone, #341).
  const stage=await checked(admin.from('work_stages').select('id').eq('company_id',company.id).eq('kind','ideas').single());
  const card=await checked(admin.from('work_cards').insert({company_id:company.id,stage_id:stage.id,title:`Keep ${slug}`,next_actor:user.id}).select('id').single());
  const path=`${company.id}/${card.id}/keep.txt`;
  await checked(admin.storage.from('creatives').upload(path,new Blob([`File for ${slug}`],{type:'text/plain'})));
  const creative=await checked(admin.from('work_creatives').insert({company_id:company.id,card_id:card.id,name:'keep.txt'}).select('id').single());
  await checked(admin.from('work_versions').insert({company_id:company.id,card_id:card.id,creative_id:creative.id,path}));
 }
}
const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
const {user}=await checked(person.auth.signInWithPassword(credentials));
assert.equal((await checked(person.from('people').select('name').eq('id',user.id).single())).name,'Restore Person');
for(const slug of ['restore-one','restore-two']) {
 const company=await checked(person.from('companies').select().eq('slug',slug).single());
 assert.equal(company.name,slug);
 assert.equal((await checked(person.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).single())).role,'contributor');
 const cards=await checked(person.from('work_cards').select('id,title').eq('company_id',company.id).eq('next_actor',user.id));
 assert.equal(cards.length,1); assert.equal(cards[0].title,`Keep ${slug}`);
 const versions=await checked(person.from('work_versions').select('id,path').eq('company_id',company.id).eq('card_id',cards[0].id));
 assert.equal(versions.length,1);
 const {signedUrl}=await checked(admin.storage.from('creatives').createSignedUrl(versions[0].path,3600));
 const response=await fetch(signedUrl); assert.equal(response.status,200);
 assert.equal(await response.text(),`File for ${slug}`);
 console.log(JSON.stringify({person:user.id,company:company.id,card:cards[0].id,version:versions[0].id}));
}
