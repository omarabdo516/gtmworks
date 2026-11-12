import { test, expect } from '@playwright/test';
import { signIn } from './sign-in';
// This file sorts before app.spec.ts on purpose: that file revokes the public fixture key at its end.
const legacy={Authorization:'Bearer agt_local_fixture_for_tests_only'};
const root='/api/v1/companies/rs-learning/cards';
const list=`${root}?next_actor=me`;
const bearer=(key:string)=>({Authorization:`Bearer ${key}`});

test('an agent files its card into a project with a run key, and never into another company\'s project',async({page,request})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/projects');
 const stamp=Date.now();
 const create=async(company:string,name:string)=>{
  await page.goto(`/c/${company}/projects`);
  const form=page.getByRole('form',{name:'New project',exact:true});
  await form.getByLabel('Project name').fill(name);
  await form.getByRole('button',{name:'Create project'}).click();
  const row=page.getByRole('form',{name,exact:true});
  await expect(row).toBeVisible();
  return Number(await row.locator('input[name=project]').getAttribute('value'));
 };
 const mine=await create('rs-learning',`Agent project ${stamp}`);
 const theirs=await create('aleem',`Other company project ${stamp}`);

 const own:number=(await (await request.get(list,{headers:legacy})).json()).cards[0].id;
 const issued=await request.post(`${root}/${own}/run-keys`,{headers:legacy,data:{}});
 expect(issued.status()).toBe(201);
 const run=bearer((await issued.json()).key);
 const project=async()=>(await (await request.get(list,{headers:run})).json()).cards[0].project_id;
 const file=(value:number|string|null,key:string)=>request.patch(`${root}/${own}`,{headers:{...run,'Idempotency-Key':`${key}-${stamp}`},data:{fields:{project_id:value}}});
 expect(await project()).toBeNull();

 // A project of another company is not found, and the card keeps no project.
 expect((await file(theirs,'other')).status()).toBe(404);
 expect(await project()).toBeNull();
 // Its own company's project is accepted.
 expect((await file(mine,'mine')).status()).toBe(200);
 expect(await project()).toBe(mine);
 // The card keeps its project when other fields are edited (a null text value leaves the card as it is), and an empty value takes it out.
 expect((await request.patch(`${root}/${own}`,{headers:{...run,'Idempotency-Key':`edit-${stamp}`},data:{fields:{hook:null}}})).status()).toBe(200);
 expect(await project()).toBe(mine);
 expect((await file('','out')).status()).toBe(200);
 expect(await project()).toBeNull();
 // A value that is not a project number is refused.
 expect((await file('abc','bad')).status()).toBe(400);
 expect((await request.delete(`${root}/${own}/run-keys`,{headers:run})).status()).toBe(200);
});
