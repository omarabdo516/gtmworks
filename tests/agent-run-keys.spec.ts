import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { hashKey } from '../lib/agent-crypto.mjs';
// This file sorts before app.spec.ts on purpose: that file revokes the public fixture key at its end.
const legacy={Authorization:'Bearer agt_local_fixture_for_tests_only'};
const root='/api/v1/companies/rs-learning/cards';
const list=`${root}?next_actor=me`;
const bearer=(key:string)=>({Authorization:`Bearer ${key}`});
test('a run key reaches one card, expires, follows the grant and never takes its identity from the request', async ({page,request}) => {
 const listing=await request.get(list,{headers:legacy});
 expect(listing.status()).toBe(200);
 // A legacy company key still works, and the answer says it is legacy.
 expect(listing.headers()['deprecation']).toBe('true');
 expect(listing.headers()['x-gtmworks-key']).toBe('legacy');
 const ids:number[]=(await listing.json()).cards.map((card:{id:number})=>card.id);
 expect(ids.length).toBeGreaterThan(0);
 const own=ids[0]; const other=own===1?2:1;
 const issue=async(headers:Record<string,string>,ttl?:number)=>request.post(`${root}/${own}/run-keys`,{headers,data:ttl?{ttl_seconds:ttl}:{}});

 const issued=await issue(legacy);
 expect(issued.status()).toBe(201);
 const {key:runKey,expires_at}=await issued.json();
 expect(runKey).toMatch(/^gtmw_run_/);
 expect(Date.parse(expires_at)).toBeGreaterThan(Date.now());
 const run=bearer(runKey);

 // It reads and writes its own card only.
 const mine=await request.get(list,{headers:run});
 expect(mine.status()).toBe(200);
 expect((await mine.json()).cards.map((card:{id:number})=>card.id)).toEqual([own]);
 expect(mine.headers()['deprecation']).toBeUndefined();
 const stamp=Date.now();
 expect((await request.post(`${root}/${other}/comment`,{headers:{...run,'Idempotency-Key':`other-${stamp}`},data:{body:'not on this card'}})).status()).toBe(403);
 expect((await request.patch(`${root}/${other}`,{headers:{...run,'Idempotency-Key':`other-edit-${stamp}`},data:{fields:{title:'Other card'}}})).status()).toBe(403);
 expect((await request.post(root,{headers:{...run,'Idempotency-Key':`create-${stamp}`},data:{title:'New card',stage:1}})).status()).toBe(403);
 expect((await issue(run)).status()).toBe(403);

 // Who is acting comes from the key, whatever the body says.
 const spoof=await request.post(`${root}/${own}/comment`,{headers:{...run,'Idempotency-Key':`spoof-${stamp}`},data:{body:'run key comment',actor:'Intruder',agent:'Intruder',person:'20000000-0000-0000-0000-000000000001',actor_id:'20000000-0000-0000-0000-000000000001'}});
 expect(spoof.status()).toBe(200);
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await page.goto(`/c/rs-learning/work/board/${own}`);
 const row=page.locator('.detail-row').filter({has:page.locator('.comment-body',{hasText:'run key comment'})}).first();
 await expect(row.locator('strong')).toHaveText('وكيل المحتوى');
 await expect(page.getByText('Intruder')).toHaveCount(0);

 // It stops when it expires, and every failure has the same 401 answer.
 const shortLived=await issue(legacy,3);
 expect(shortLived.status()).toBe(201);
 const short=bearer((await shortLived.json()).key);
 expect((await request.get(list,{headers:short})).status()).toBe(200);
 await expect.poll(async()=>(await request.get(list,{headers:short})).status(),{timeout:20000,intervals:[500]}).toBe(401);
 expect(await (await request.get(list,{headers:short})).json()).toEqual({error:'unauthorized'});
 expect(await (await request.get(list,{headers:bearer('gtmw_run_unknownunknownunknownunknownunknown')})).json()).toEqual({error:'unauthorized'});
 expect(await (await request.get(list)).json()).toEqual({error:'unauthorized'});

 // A new company key shows its prefix once, is stored as a hash and records its first use.
 await page.goto('/c/rs-learning/settings/agents');
 await page.locator('.agent-create-form').getByRole('button',{name:'Member',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'Lead',exact:true}).click();
 await page.getByRole('button',{name:'Create key'}).click();
 const agentKey=(await page.locator('.agent-secret code').innerText()).trim();
 expect(agentKey).toMatch(/^gtmw_agt_/);
 const firstCall=await request.get(list,{headers:bearer(agentKey)});
 expect(firstCall.status()).toBe(200);
 expect(firstCall.headers()['deprecation']).toBeUndefined();
 // This company has no webhook: the assigned agent pulls its run key (it did above), and another agent of the company is refused for a card that is not its own.
 expect((await request.post(`${root}/${own}/run-keys`,{headers:bearer(agentKey),data:{}})).status()).toBe(403);
 await page.reload();
 const keyRow=page.locator('.agent-key-row').filter({hasText:'Lead'}).first();
 await expect(keyRow).not.toContainText('Not used yet');
 await expect(keyRow).toContainText('Last used');
 await keyRow.getByRole('button',{name:'Revoke key Lead'}).click();
 await expect.poll(async()=>(await request.get(list,{headers:bearer(agentKey)})).status()).toBe(401);

 // A run key can be revoked before it expires: by itself, or by the company key that holds the card.
 const mine1=bearer((await (await issue(legacy)).json()).key); const mine2=bearer((await (await issue(legacy)).json()).key);
 expect((await request.delete(`${root}/${other}/run-keys`,{headers:mine1})).status()).toBe(403);
 const ended=await request.delete(`${root}/${own}/run-keys`,{headers:mine1});
 expect(ended.status()).toBe(200); expect((await ended.json()).revoked).toBe(1);
 expect((await request.get(list,{headers:mine1})).status()).toBe(401);
 expect((await request.get(list,{headers:mine2})).status()).toBe(200);
 expect((await (await request.delete(`${root}/${own}/run-keys`,{headers:legacy})).json()).revoked).toBeGreaterThanOrEqual(1);
 expect((await request.get(list,{headers:mine2})).status()).toBe(401);

 // Revoking the agent's company grant revokes its live run keys.
 const live=bearer((await (await issue(legacy)).json()).key);
 expect((await request.get(list,{headers:live})).status()).toBe(200);
 await page.goto('/c/rs-learning/agents');
 const writer=page.getByRole('form',{name:'Writer',exact:true});
 try {
  await writer.getByRole('button',{name:'Revoke access from Writer'}).click();
  await expect(writer.getByText('No access',{exact:true})).toBeVisible();
  await expect.poll(async()=>(await request.get(list,{headers:live})).status()).toBe(401);
  expect(await (await request.get(list,{headers:live})).json()).toEqual({error:'unauthorized'});
  const refused=await request.get(list,{headers:legacy});
  expect(refused.status()).toBe(404); expect(refused.headers()['deprecation']).toBe('true');
 } finally {
  if(await writer.getByRole('button',{name:'Grant access to Writer'}).isVisible()) await writer.getByRole('button',{name:'Grant access to Writer'}).click();
  await expect(writer.getByText('Has access',{exact:true})).toBeVisible();
 }
 // The old run key does not come back with the grant.

 expect((await request.get(list,{headers:live})).status()).toBe(401);
 await expect.poll(async()=>(await request.get(list,{headers:legacy})).status()).toBe(200);
});

// #228. The database side (every function, every Role, the waiting list) is proven in supabase/tests/hidden_card_readers.sql.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
test('a Card tied to a chat whose Agent is hidden from a key\'s agent answers on every card route as a Card that does not exist, and as before once the Agent is shown', async ({request},testInfo) => {
 // Its rows have fixed ids and its writes happen once, so a retry starts again from the seed.
 if(testInfo.retry) freshSeed(testInfo.file,true);
 const company='10000000-0000-0000-0000-000000000001'; const designerId='30000000-0000-0000-0000-000000000002';
 const id=(n:number)=>`22800000-0000-0000-0000-${String(n).padStart(12,'0')}`; const [connection,ads,chat]=[1,2,3].map(id);
 const designerKey='gtmw_agt_hidden_cards_spec_designer'; const designer=bearer(designerKey);
 query(`do $$ begin
  insert into public.agent_keys(company_id,person_id,key_hash) values ('${company}','${designerId}','${hashKey(designerKey)}');
  insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${connection}','${company}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/ads','hidden-cards-ads','no-key','unreachable');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${ads}','${company}','${connection}','Ads','Runs the Meta ads.',false);
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${chat}','${company}','20000000-0000-0000-0000-000000000003','${ads}','Ads');
  insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id,next_actor) select company_id,id,'Plan the June campaign','${ads}','${chat}','${designerId}'
   from public.work_stages where company_id='${company}' and board_column='progress' and kind='before_review' order by position,id limit 1;
  insert into public.work_checklist(company_id,card_id,title) select company_id,id,'Hook written' from public.work_cards where conversation_id='${chat}';
 end $$;`);
 const [fixture]=rows(`select c.id as card,(select id from public.work_checklist where card_id=c.id) as item,(select id from public.work_stages where company_id=c.company_id and kind='ideas') as stage,
  (select min(id) from public.work_labels where company_id=c.company_id) as label,(select max(id)+1000 from public.work_cards) as missing from public.work_cards c where c.conversation_id='${chat}'`);
 const [card,item,stage,label,missing]=['card','item','stage','label','missing'].map(name=>Number(fixture[name]));
 const show=(shown:boolean)=>query(shown?`insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${designerId}','${ads}')`
  :`delete from public.member_agent_access where person_id='${designerId}' and agent_id='${ads}'`);
 const listed=async(headers:Record<string,string>)=>((await (await request.get(list,{headers})).json()).cards as {id:number}[]).map(listedCard=>listedCard.id);
 const stamp=Date.now();
 const file={name:'ad.txt',mimeType:'text/plain',buffer:Buffer.from(`Three ads for June ${stamp}`)};
 const upload=(target:number,key:string)=>request.post(`${root}/${target}/upload`,{headers:{...designer,'Idempotency-Key':key},multipart:{file,evidence:'https://example.test/ad'}});
 const note=(target:number,key:string)=>request.post(`${root}/${target}/comment`,{headers:{...designer,'Idempotency-Key':key},multipart:{body:'Here is the ad',file}});
 // Each write, and what the route answers for a Card that does not exist.
 const writes:{op:string,data:object,missingStatus:number}[]=[
  {op:'comment',data:{body:'Three ads drafted.'},missingStatus:400},{op:'assignee',data:{person:designerId},missingStatus:400},{op:'label',data:{label},missingStatus:400},
  {op:'check',data:{item,done:true},missingStatus:404},{op:'actor',data:{person:designerId},missingStatus:404},
  {op:'edit',data:{fields:{title:'Plan the June campaign, three ads'}},missingStatus:403},{op:'move',data:{stage},missingStatus:403}];
 const write=(target:number,op:string,data:object,key:string)=>op==='edit'
  ?request.patch(`${root}/${target}`,{headers:{...designer,'Idempotency-Key':key},data})
  :request.post(`${root}/${target}/${op}`,{headers:{...designer,'Idempotency-Key':key},data});
 const issue=(target:number)=>request.post(`${root}/${target}/run-keys`,{headers:designer,data:{}});
 const answer=async(response:Awaited<ReturnType<typeof request.get>>)=>({status:response.status(),body:await response.json()});

 show(true);
 expect(await listed(designer)).toContain(card);
 expect((await upload(card,`upload-seen-${stamp}`)).status()).toBe(201);
 const [attached]=rows(`with written as (insert into public.work_comments(company_id,card_id,body,author_id) values ('${company}',${card},'The ad','20000000-0000-0000-0000-000000000001') returning id,company_id,card_id)
  insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path,created_by)
  select w.company_id,w.card_id,w.id,'ad.txt','text/plain',${file.buffer.length},(select path from public.work_versions where card_id=w.card_id),'20000000-0000-0000-0000-000000000001' from written w returning id`);
 const attachment=Number(attached.id);
 const served=await request.get(`${root}/${card}/files/${attachment}`,{headers:designer});
 expect(served.status()).toBe(200); expect(await served.body()).toEqual(file.buffer);
 expect((await note(card,`note-seen-${stamp}`)).status()).toBe(200);
 for(const {op,data} of writes) expect((await write(card,op,data,`${op}-seen-${stamp}`)).status(),op).toBe(200);
 const issued=await issue(card); expect(issued.status()).toBe(201);
 const run=bearer((await issued.json()).key);
 expect(await listed(run)).toEqual([card]);

 show(false);
 expect(await listed(designer)).not.toContain(card);
 const same=async(call:(target:number)=>Promise<Awaited<ReturnType<typeof request.get>>>,status:number,what:string)=>{
  const hidden=await answer(await call(card)); expect(hidden,what).toEqual(await answer(await call(missing))); expect(hidden.status,what).toBe(status);
 };
 await same(target=>request.get(`${root}/${target}/files/${attachment}`,{headers:designer}),404,'its file');
 await same(target=>upload(target,`upload-hidden-${target}-${stamp}`),403,'an upload');
 await same(target=>note(target,`note-hidden-${target}-${stamp}`),403,'a note with a file');
 for(const {op,data,missingStatus} of writes) await same(target=>write(target,op,data,`${op}-hidden-${target}-${stamp}`),missingStatus,op);
 await same(issue,404,'a run key');
 for(const [method,path] of [['GET',list],['GET','/api/v1/companies/rs-learning/skills'],['GET','/api/v1/companies/rs-learning/skill-loads'],['POST','/api/v1/companies/rs-learning/skills/caption-hooks/lessons']]) {
  const refused=await request.fetch(path,{method,headers:{...run,'Idempotency-Key':`lesson-${stamp}`},data:method==='POST'?{lesson:'Open with the number.',reason:'Saved more often.'}:undefined});
  expect(await answer(refused),`its run key at ${path}, as one whose Card is gone`).toEqual({status:401,body:{error:'unauthorized'}});
 }
 await same(target=>request.delete(`${root}/${target}/run-keys`,{headers:designer}),200,'ending its run keys');

 show(true);
 expect((await request.get(list,{headers:run})).status(),'the run key ended while the Card was hidden stays ended').toBe(401);
 expect((await issue(card)).status()).toBe(201);
 expect(await (await request.delete(`${root}/${card}/run-keys`,{headers:designer})).json()).toEqual({revoked:1});
});
