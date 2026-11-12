// CI runs this on stdin inside /app in the installed web container, using its HTTP APIs.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const {encryptSecret,decryptSecret}=await import(`${process.cwd()}/lib/agent-crypto.mjs`);

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
  await checked(admin.from('agent_keys').insert({company_id:company.id,person_id:user.id,
   key_hash:createHash('sha256').update(`agt_install_${slug}`).digest('hex')}));
  await checked(admin.from('agent_webhooks').insert({company_id:company.id,url:'https://example.com',
   secret_encrypted:encryptSecret('restored secret',process.env.WEBHOOK_ENCRYPTION_KEY)}));
 }
}
const person=createClient(origin,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
const {user}=await checked(person.auth.signInWithPassword(credentials));
assert.equal((await checked(person.from('people').select('name').eq('id',user.id).single())).name,'Restore Person');
for(const slug of ['restore-one','restore-two']) {
 const company=await checked(person.from('companies').select().eq('slug',slug).single());
 assert.equal(company.name,slug);
 assert.equal((await checked(person.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).single())).role,'contributor');
 const webhook=await checked(admin.from('agent_webhooks').select('secret_encrypted').eq('company_id',company.id).single());
 assert.equal(decryptSecret(webhook.secret_encrypted,process.env.WEBHOOK_ENCRYPTION_KEY),'restored secret');
 const root=`${origin}/api/v1/companies/${slug}/cards`;
 const headers={Authorization:`Bearer agt_install_${slug}`};
 const request=async(url,options,status)=>{const response=await fetch(url,options); assert.equal(response.status,status,await response.clone().text()); return response;};
 if(seed) {
  const stage=await checked(person.from('work_stages').select('id').eq('company_id',company.id).eq('kind','ideas').single());
  const response=await request(root,{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'backup-card'},body:JSON.stringify({title:`Keep ${slug}`,stage:stage.id})},201);
  const {id}=await response.json();
  await request(`${root}/${id}/actor`,{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':'backup-actor'},body:JSON.stringify({person:user.id})},200);
  const form=new FormData(); form.set('file',new File([`File for ${slug}`],'keep.txt',{type:'text/plain'}));
  await request(`${root}/${id}/upload`,{method:'POST',headers:{...headers,'Idempotency-Key':'backup-file'},body:form},201);
 }
 const {cards}=await (await request(`${root}?next_actor=me`,{headers},200)).json();
 assert.equal(cards.length,1); assert.equal(cards[0].title,`Keep ${slug}`);
 const versions=cards[0].creatives[0].versions;
 assert.equal(versions.length,1);
 assert.equal(await (await request(versions[0].url,{},200)).text(),`File for ${slug}`);
 console.log(JSON.stringify({person:user.id,company:company.id,card:cards[0].id,version:versions[0].id}));
}
