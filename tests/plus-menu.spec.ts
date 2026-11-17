import { test, expect, freshSeed, type Page } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { closeOpenRuns, sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { signIn } from './sign-in';

// #153, the composer's "+" menu: whom it calls in a Conversation and in a channel, and a new chat's first message that
// calls an Agent. The menu's own behaviour (focus, keys, the caret) is proven in tests/components/plus-menu.test.tsx.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const contributor='20000000-0000-0000-0000-000000000003';
const general='/c/rs-learning/channels/69000000-0000-0000-0000-000000000001';
const encryptionKey=process.env.WEBHOOK_ENCRYPTION_KEY||'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const id=(n:number)=>`68153000-0000-0000-0000-${String(n).padStart(12,'0')}`;
// Faye's empty chat is the one open; Reach is the Agent called. Reach is hidden from the Contributor (مراجع).
const [faye,reach]=[id(11),id(12)];

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 // Connections that are never called: every run goes to the fake engine.
 query(`do $$ begin
  update public.people set language='en' where id in ('${omar}','${contributor}');
  insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
   ('${id(1)}','${company}','${omar}','http://127.0.0.1:9','fake-plus-faye','${encryptSecret('fake-engine-key',encryptionKey)}','connected','0.23.0','{run_submission}'),
   ('${id(2)}','${company}','${omar}','http://127.0.0.1:9','fake-plus-reach','${encryptSecret('fake-engine-key',encryptionKey)}','connected','0.23.0','{run_submission}');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values
   ('${faye}','${company}','${id(1)}','Faye','Marketing'),('${reach}','${company}','${id(2)}','Reach','Outreach');
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${contributor}','${faye}');
 end $$;`);
});

async function session(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}
const agentOf=(conversation:string)=>rows(`select agent_id from public.conversations where id='${conversation}'`)[0]?.agent_id;
// The menu's entries under each of its labels, in order.
const groups=(page:Page)=>page.getByRole('menu').evaluate(menu=>{
 const found:Record<string,string[]>={}; let label='';
 for(const child of menu.children) {
  if(child.classList.contains('menu__label')) found[label=child.textContent||'']=[];
  else if(child.classList.contains('menu__item')) found[label].push(child.querySelector('.menu__t')?.textContent||'');
 }
 return found;
});

const conversations:Record<string,string>={};
test('integration: on the fake engine a first message from Faye\'s empty chat that calls @Reach starts the Conversation with Reach',async()=>{
 const fake=fakeEngine(); const {service,person}=await session('omar@example.com');
 const conversation=randomUUID();
 expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),agent:faye,message:'@Reach plan the outreach week',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
 expect(agentOf(conversation)).toBe(reach);
 expect(fake.runs.map(run=>({conversation:run.conversation,input:run.input}))).toEqual([{conversation,input:'@Reach plan the outreach week'}]);
});

test('integration: on the fake engine a call of an Agent hidden from the Contributor changes nothing: the Conversation is Faye\'s',async()=>{
 const fake=fakeEngine(); const {service,person}=await session('reviewer@example.com');
 const conversation=randomUUID();
 expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),agent:faye,message:'@Reach plan the outreach week',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
 expect(agentOf(conversation)).toBe(faye);
 expect(fake.runs.map(run=>run.input)).toEqual(['@Reach plan the outreach week']);
 conversations.contributor=conversation;
 await closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
});

test('integration: on the fake engine an open Conversation keeps its Agent: a message that calls @Reach goes, as typed, to Faye',async()=>{
 const fake=fakeEngine(); const {service,person}=await session('omar@example.com');
 const conversation=randomUUID();
 expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),agent:faye,message:'Plan the launch',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
 expect(await closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor})).toBe(1);
 // The open Conversation's composer names no Agent (app/conversation-thread.tsx).
 expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),message:'@Reach take over the outreach',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
 expect(agentOf(conversation)).toBe(faye);
 expect(fake.runs.map(run=>({conversation:run.conversation,input:run.input}))).toEqual([{conversation,input:'Plan the launch'},{conversation,input:'@Reach take over the outreach'}]);
 expect(rows(`select body from public.conversation_messages where conversation_id='${conversation}' and author='person' order by id`).map(row=>row.body)).toEqual(['Plan the launch','@Reach take over the outreach']);
});

test('in a Conversation the Contributor\'s "Call an agent" lists exactly the Agents they see, each with its face, name and @name, and not Reach',async({page})=>{
 for(const path of [`/c/rs-learning/chat/${faye}`,`/c/rs-learning/conversations/${conversations.contributor}`]) {
  if(path.includes('/chat/')) await signIn(page,'reviewer@example.com',path); else await page.goto(path);
  const plus=page.getByRole('button',{name:'More: call someone, commands'});
  await plus.click();
  await expect(plus).toHaveAttribute('aria-expanded','true');
  await expect(page.getByRole('menuitem',{name:'Faye @Faye'})).toBeFocused();
  const seen=await page.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name').allTextContents();
  expect(seen).not.toContain('Reach');
  expect(await groups(page)).toEqual({'Call an agent':seen,'Commands':['Ask for a new agent']});
  await expect(page.getByRole('menu').locator('.menu__item .agent-face')).toHaveCount(seen.length);
  await expect(page.getByRole('menuitem',{name:/Reach/})).toHaveCount(0);
 }
});

test('in the general channel "Call someone in the channel" lists the other Members before "Call an agent" lists the channel\'s Agents',async({page})=>{
 await signIn(page,'omar@example.com',general);
 await page.getByRole('button',{name:'More: call someone, commands'}).click();
 // The channel's Members as the server lists them to Omar.
 const record=await (await page.request.get(`/api/channels?company=${company}&channel=69000000-0000-0000-0000-000000000001`)).json() as {members:{person:string,name:string}[]};
 const others=record.members.filter(member=>member.person!==omar).map(member=>member.name);
 expect(others.length).toBeGreaterThan(1);
 const found=await groups(page);
 expect(Object.keys(found)).toEqual(['Call someone in the channel','Call an agent','Commands']);
 expect([...found['Call someone in the channel']].sort()).toEqual([...others].sort());
 expect(found['Call someone in the channel']).not.toContain('عمر');
 expect(found['Call an agent']).toEqual(['Faye','Reach']);
 await page.getByRole('menuitem',{name:'Reach @Reach'}).click();
 const box=page.getByRole('textbox',{name:'Write your message in the channel',exact:true});
 await expect(box).toHaveValue('@Reach ');
 await expect(box).toBeFocused();
});
