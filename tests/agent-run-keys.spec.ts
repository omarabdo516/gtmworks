import { test, expect } from '@playwright/test';
import { signIn } from './sign-in';
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
