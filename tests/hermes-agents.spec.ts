import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn } from './sign-in';

// The Company's Agents on the bundled Hermes, the only Hermes (#342): an Owner chooses the main Agent and removes one,
// naming its successor; nobody attaches an Agent or connects a Hermes by hand.
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const owner='20000000-0000-0000-0000-000000000001';
const endpoint='/api/hermes-agents';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// Omar is the Owner of all three seeded companies, so he manages their agents with no extra step.
async function ownerSignIn(page:Page) {
 query(`update public.people set language='en' where id='${owner}'`);
 await signIn(page,'omar@example.com','/c/rs-learning/agents');
}
// Agents as the worker leaves them, on their Company's profile.
function agents(...rows:{company:string,name:string,main?:boolean}[]) {
 const made=rows.map(row=>({...row,id:randomUUID()}));
 query(`insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ${made.map(row=>`('${row.id}','${row.company}','${row.name}','Marketing',${row.main===true},'co-${row.company.replaceAll('-','')}')`).join(',')}`);
 return made;
}
const cleanup=(rows:{id:string}[])=>query(`delete from public.hermes_agents where id in (${rows.map(row=>`'${row.id}'`).join(',')})`);

test('the Owner makes another Agent the main one and removes the main one only after choosing its successor; nothing is attached by hand',async({page})=>{
 const made=agents({company,name:'Mona',main:true},{company,name:'Nour'});
 const [mona,nour]=made;
 const post=(body:object)=>page.request.post(endpoint,{data:{company,...body}});
 try {
  await ownerSignIn(page);
  const panel=page.getByRole('region',{name:'Connected agents'});
  await expect(panel.getByText('Mona',{exact:true})).toBeVisible();
  await expect(panel.getByText('Default agent',{exact:true})).toHaveCount(1);
  // No form to attach an Agent, and no way to a Hermes connection.
  await expect(panel.getByRole('button',{name:'Attach agent',exact:true})).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  expect((await post({intent:'attach',name:'Pasted',speciality:'Writing'})).status()).toBe(400);
  expect((await post({intent:'remove',agent:mona.id})).status()).toBe(409);
  const monaRow=panel.locator('.detail-row').filter({has:page.getByText('Mona',{exact:true})});
  await expect(monaRow.getByLabel('Choose the next default agent before removing this one.')).toBeVisible();
  const noSuccessor=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');
  await monaRow.getByRole('button',{name:'Remove agent Mona',exact:true}).click();
  const removalRefused=await noSuccessor;
  expect(removalRefused.status()).toBe(409); expect((await removalRefused.json()).error).toBe('hermesNextDefault');
  await expect(panel.getByRole('alert')).toHaveText('Choose the next default agent before removing this one.');
  await monaRow.getByRole('button',{name:'Choose the next default agent before removing this one.'}).click();
  await page.getByRole('menuitemradio').filter({hasText:'Nour'}).click();
  await monaRow.getByRole('button',{name:'Remove agent Mona',exact:true}).click();
  await expect(panel.getByText('Mona',{exact:true})).toHaveCount(0);
  await expect(panel.getByText('Nour',{exact:true})).toBeVisible();
  await expect(panel.getByText('Default agent',{exact:true})).toHaveCount(1);
  // The removal and its successor are in the company log.
  expect(JSON.parse(query(`select actor_id,details->>'replacement_id' as next from public.company_log where agent_id='${mona.id}' and action='agent_removed'`))).toEqual([{actor_id:owner,next:nour.id}]);
  const removed=await post({intent:'remove',agent:nour.id}); expect(removed.status()).toBe(200);
  expect((await removed.json()).agents.map((agent:{id:string})=>agent.id)).not.toContain(nour.id);
 } finally { cleanup(made); }
});

test('integration: concurrent default changes serialize, so the Company keeps exactly one main Agent',async({page})=>{
 const made=agents({company,name:'Agent 0',main:true},{company,name:'Agent 1'});
 const post=(body:object)=>page.request.post(endpoint,{data:{company,...body}});
 try {
  await ownerSignIn(page);
  const defaults=await Promise.all(made.map(agent=>post({intent:'default',agent:agent.id})));
  expect(defaults.map(response=>response.status())).toEqual([200,200]);
  const listed=(await (await page.request.get(`${endpoint}?company=${company}`)).json()).agents;
  expect(listed.filter((agent:{is_default:boolean})=>agent.is_default)).toHaveLength(1);
 } finally { cleanup(made); }
});

test('isolation: every company role sees only its own agents; only an Owner changes assignments, and never another company\'s',async({browser})=>{
 test.setTimeout(120000);
 const made=agents({company,name:'RS agent',main:true},{company:other,name:'Other company agent',main:true});
 // The Owner comes last, so the roles before it see the seeded assignment unchanged.
 const roles=[['manager@example.com','20000000-0000-0000-0000-000000000002','manager'],['agent1@example.com','30000000-0000-0000-0000-000000000001','contributor'],['reviewer@example.com','20000000-0000-0000-0000-000000000003','contributor'],['viewer@example.com','20000000-0000-0000-0000-000000000004','viewer'],['manager@example.com','20000000-0000-0000-0000-000000000002','owner']];
 try {
  for(const [email,person,role] of roles) {
   query(`update public.members set role='${role}' where company_id='${company}' and person_id='${person}'`);
   const context=await browser.newContext(); const page=await context.newPage();
   try {
    await signIn(page,email,'/c/rs-learning/agents');
    const panel=page.getByRole('region',{name:'Connected agents'});
    await expect(panel.getByText('RS agent',{exact:true})).toBeVisible(); await expect(panel.getByText('Other company agent')).toHaveCount(0);
    await expect(panel.getByRole('button',{name:'Attach agent',exact:true})).toHaveCount(0);
    const own=await page.request.get(`${endpoint}?company=${company}`); expect(own.status()).toBe(200);
    const agent=(await own.json()).agents.find((row:{name:string})=>row.name==='RS agent'); expect(agent).toBeTruthy();
    expect((await page.request.get(`${endpoint}?company=${other}`)).status()).toBe(404);
    for(const intent of ['default','remove']) {
     expect((await page.request.post(endpoint,{data:{company:other,intent,agent:agent.id}})).status()).toBe(404);
     if(role==='owner') continue;
     const refused=await page.request.post(endpoint,{data:{company,intent,agent:agent.id}});
     expect(refused.status()).toBe(403); expect((await refused.json()).error).toBe('hermesNotAllowed');
    }
    if(role==='owner') {
     // An Owner the seed did not make still manages the company's agents, and the change is logged under them.
     const kept=await page.request.post(endpoint,{data:{company,intent:'default',agent:agent.id}});
     expect(kept.status()).toBe(200);
     expect(JSON.parse(query(`select actor_id from public.company_log where action='agent_made_main' and agent_id='${agent.id}'`))).toEqual([{actor_id:person}]);
    }
    expect(JSON.parse(query(`select name,is_default from public.hermes_agents where id='${made[0].id}'`))).toEqual([{name:'RS agent',is_default:true}]);
   } finally { await context.close(); }
  }
 } finally {
  cleanup(made);
  query(`update public.members set role='manager' where company_id='${company}' and person_id='20000000-0000-0000-0000-000000000002'`);
 }
});
