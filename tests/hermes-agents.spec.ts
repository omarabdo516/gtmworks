import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { signIn } from './sign-in';

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
function fixtureConnection(id:string,profile:string,state='connected') {
 query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${id}','${company}','${owner}','http://localhost','${profile}','ciphertext','${state}')`);
}
function cleanup(ids:string[]) {
 const list=ids.map(id=>`'${id}'`).join(',');
 query(`delete from public.hermes_agents where connection_id in (${list})`);
 query(`delete from public.hermes_connections where id in (${list})`);
}

test('the Owner connects, names and attaches an agent, confirms profile sharing and chooses a successor on removal',async({page})=>{
 const fake=await fakeHermes(); const ids:string[]=[];
 const post=(body:object)=>page.request.post(endpoint,{data:{company,...body}});
 try {
  await ownerSignIn(page);
  const connected=await page.request.post('/api/hermes-connections',{data:{company,intent:'save',address:fake.address,profile:'writer',key:fake.settings.key}});
  expect(connected.status()).toBe(200); const connection=(await connected.json()).connection.id; ids.push(connection);
  await page.goto('/c/rs-learning/agents');
  const panel=page.getByRole('region',{name:'Connected agents'});
  await expect(panel.getByRole('button',{name:'Attach agent',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'Connected engine profile'}).click();
  await page.getByRole('menuitemradio').filter({hasText:`writer — ${fake.address}`}).click();
  await expect(panel.getByRole('button',{name:'Attach agent',exact:true})).toBeEnabled();
  await panel.getByLabel('Agent name').fill('Mona'); await panel.getByLabel('Speciality',{exact:true}).fill('Marketing strategy');
  await panel.getByLabel('Make default',{exact:true}).check();
  await panel.getByRole('button',{name:'Attach agent',exact:true}).click();
  await expect(panel.getByText('Mona',{exact:true})).toBeVisible();
  await expect(panel.getByText('Marketing strategy',{exact:true})).toBeVisible();
  await expect(panel.getByText('Default agent',{exact:true})).toHaveCount(1);
  await expect(panel.getByRole('button',{name:'Attach agent',exact:true})).toBeDisabled();
  await page.reload(); await expect(panel.getByText('Mona',{exact:true})).toBeVisible();
  const [mona]=(await (await page.request.get(`${endpoint}?company=${company}`)).json()).agents;
  const shared={company:other,intent:'attach',connection,name:'Mona for R&S',speciality:'Writing'};
  const refused=await post(shared); expect(refused.status()).toBe(409); expect((await refused.json()).error).toBe('hermesSharingWarning');
  expect((await post({...shared,confirmSharing:'true'})).status()).toBe(409);
  const confirmed=await post({...shared,confirmSharing:true}); expect(confirmed.status()).toBe(200);
  const sharedAgent=(await confirmed.json()).agents[0];
  const audit=JSON.parse(query(`select actor_id,actor_name,details from public.hermes_agent_audit where action='ATTACH_HERMES_AGENT' and agent_id='${sharedAgent.id}'`))[0];
  expect(audit.actor_id).toBe(owner); expect(audit.actor_name).toBeTruthy(); expect(audit.details.sharing_confirmed).toBe(true);
  const next=randomUUID(); ids.push(next); fixtureConnection(next,'designer');
  const attached=await post({intent:'attach',connection:next,name:'Nour',speciality:'Design'}); expect(attached.status()).toBe(200);
  const nour=(await attached.json()).agents.find((agent:{name:string})=>agent.name==='Nour');
  expect((await post({intent:'remove',agent:mona.id})).status()).toBe(409);
  expect((await post({intent:'remove',agent:mona.id,replacement:sharedAgent.id})).status()).toBe(409);
  await page.reload();
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
  const removed=await post({intent:'remove',agent:nour.id}); expect(removed.status()).toBe(200); expect((await removed.json()).agents).toEqual([]);
 } finally { if(ids.length) cleanup(ids); await fake.close(); }
});

test('integration: concurrent default changes and first attachments serialize, and sharing cannot race confirmation',async({page})=>{
 const fake=await fakeHermes();
 const ids=[randomUUID(),randomUUID(),randomUUID()]; ids.forEach((id,index)=>fixtureConnection(id,`profile-${index}-${id}`));
 const post=(body:object)=>page.request.post(endpoint,{data:{company,...body}});
 try {
  await ownerSignIn(page);
  const first=await Promise.all(ids.slice(0,2).map((connection,index)=>post({intent:'attach',connection,name:`Agent ${index}`,speciality:'Strategy'})));
  expect(first.map(response=>response.status())).toEqual([200,200]);
  let agents=(await (await page.request.get(`${endpoint}?company=${company}`)).json()).agents;
  expect(agents.filter((agent:{is_default:boolean})=>agent.is_default)).toHaveLength(1);
  const defaults=await Promise.all(agents.map((agent:{id:string})=>post({intent:'default',agent:agent.id})));
  expect(defaults.map(response=>response.status())).toEqual([200,200]);
  agents=(await (await page.request.get(`${endpoint}?company=${company}`)).json()).agents;
  expect(agents.filter((agent:{is_default:boolean})=>agent.is_default)).toHaveLength(1);
  const shared=await Promise.all([company,other].map(company=>post({company,intent:'attach',connection:ids[2],name:'Shared profile',speciality:'Writing'})));
  expect(shared.map(response=>response.status()).sort()).toEqual([200,409]);
  const connected=await page.request.post('/api/hermes-connections',{data:{company,intent:'save',address:fake.address,profile:'initial',key:fake.settings.key}});
  expect(connected.status()).toBe(200); const connection=(await connected.json()).connection.id; ids.push(connection);
  const [attach,retarget]=await Promise.all([
   post({intent:'attach',connection,name:'During edit',speciality:'Strategy'}),
   page.request.post('/api/hermes-connections',{data:{company,intent:'save',id:connection,address:fake.address,profile:'changed',key:fake.settings.key}}),
  ]);
  expect(attach.status()).toBe(200); expect([200,409]).toContain(retarget.status());
 } finally { cleanup(ids); await fake.close(); }
});

test('isolation: every company role sees only its own agents; only an Owner changes assignments, and never another company\'s',async({browser})=>{
 test.setTimeout(120000);
 const ids=[randomUUID(),randomUUID()]; ids.forEach(id=>fixtureConnection(id,id));
 query(`insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default) values ('${company}','${ids[0]}','RS agent','Writing',true),('${other}','${ids[1]}','Other company agent','Strategy',true)`);
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
    await expect(panel.getByRole('button',{name:'Attach agent',exact:true})).toHaveCount(role==='owner'?1:0);
    const own=await page.request.get(`${endpoint}?company=${company}`); expect(own.status()).toBe(200);
    const agent=(await own.json()).agents[0]; expect(agent.name).toBe('RS agent');
    expect((await page.request.get(`${endpoint}?company=${other}`)).status()).toBe(404);
    for(const intent of ['attach','default','remove']) {
     expect((await page.request.post(endpoint,{data:{company:other,intent,agent:agent.id,connection:ids[0],name:'Forbidden',speciality:'Writing'}})).status()).toBe(404);
     if(role==='owner') continue;
     const refused=await page.request.post(endpoint,{data:{company,intent,agent:agent.id,connection:ids[0],name:'Forbidden',speciality:'Writing'}});
     expect(refused.status()).toBe(403); expect((await refused.json()).error).toBe('hermesNotAllowed');
    }
    if(role==='owner') {
     // An Owner who did not make the Connection still manages the company's agents.
     const kept=await page.request.post(endpoint,{data:{company,intent:'default',agent:agent.id}});
     expect(kept.status()).toBe(200);
     const audit=JSON.parse(query(`select actor_id from public.hermes_agent_audit where action='DEFAULT_HERMES_AGENT' and agent_id='${agent.id}'`));
     expect(audit).toEqual([{actor_id:person}]);
    }
    expect(JSON.parse(query(`select name,is_default from public.hermes_agents where company_id='${company}' and connection_id in ('${ids[0]}','${ids[1]}')`))).toEqual([{name:'RS agent',is_default:true}]);
   } finally { await context.close(); }
  }
 } finally {
  cleanup(ids);
  query(`update public.members set role='manager' where company_id='${company}' and person_id='20000000-0000-0000-0000-000000000002'`);
 }
});
