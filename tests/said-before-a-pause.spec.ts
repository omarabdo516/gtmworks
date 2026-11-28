import { test, expect } from './fresh-seed';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { laneEngineRecords } from './spec-engine-records';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { answerChannelQuestion, driveChannelRuns, postChannelMessage } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { signIn } from './sign-in';
test.beforeAll(()=>laneEngineRecords());

// #647: an Agent writes its whole answer and asks about it with clarify in the same message. The Engine keeps those
// words only in its session while the Run waits (the driver's own test, tests/hermes-runs.test.mjs, reads them there);
// the fake engine hands them over with the question, as the driver does. The chat shows them as the Agent's message
// above the card while the Run waits, once, and after the answer and a reload the reply does not repeat them, in a
// Channel. A Conversation's question is its Engine Run's since #883 (tests/conversation-steer.spec.ts).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const general='69000000-0000-0000-0000-000000000001';
const five='Five Agents I advise:\n1. Writer — drafts the posts alone\n2. Analyst — reads the numbers, asks you before any spend';

function attachAgent() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${agent}','${company}','${connection}','Faye','Marketing','fake-${connection.slice(0,8)}')`);
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 return {agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); }};
}
async function memberClient(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}
const asking=()=>{
 const fake=fakeEngine();
 fake.settings.questions=input=>input.includes('Which Agents')?[{text:'Which of them do we make now?',choices:['Writer','Analyst'],said:five}]:[];
 fake.settings.reply=(_input,answers)=>`Making ${answers.join(', ')} now.`;
 return fake;
};

test('integration: in a Channel the words written before a question are the Agent\'s message above its card while the Run waits, and once after the answer and a reload',async({page})=>{
 test.setTimeout(120000);
 const fake=asking(); const {detach}=attachAgent();
 try {
  const {service,person}=await memberClient('omar@example.com');
  const drive=()=>withEngineContract(fake.engineFor,()=>driveChannelRuns(service,{channel:general}));
  const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(person,service,{channel:general,sendKey:randomUUID(),message:'@Faye Which Agents do you advise we make?'})) as {message:number};
  expect(await drive()).toEqual({started:0,closed:0});
  expect(JSON.parse(query(`select said_before from public.reply_cards where channel_message_id=${sent.message}`))).toEqual([{said_before:five}]);

  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'omar@example.com',`/c/rs-learning/channels/${general}`);
  const turn=page.locator('.turns > li.turn--agent').filter({hasText:'Which of them do we make now?'});
  await expect(turn).toHaveCount(1);
  await expect(turn.locator('.sender')).toContainText('Faye');
  await expect(turn.locator('.bubble--agent')).toHaveText(five);

  const [{id:card}]=JSON.parse(query(`select id from public.reply_cards where channel_message_id=${sent.message}`));
  const work:Promise<void>[]=[];
  expect(await withEngineContract(fake.engineFor,()=>answerChannelQuestion(person,service,{company,channel:general,card:Number(card),choice:1,answerKey:randomUUID(),later:(deliver:()=>Promise<void>)=>{ work.push(deliver()); }}))).toMatchObject({state:'claimed'});
  await Promise.all(work);
  await expect.poll(async()=>{ await drive(); return JSON.parse(query(`select body from public.channel_messages where reply_to=${sent.message}`)); }).toEqual([{body:'Making Analyst now.'}]);

  await page.reload();
  await expect(page.locator('.turns .bubble--agent').filter({hasText:'Making Analyst now.'})).toHaveCount(1);
  await expect(page.locator('.turns .bubble--agent').filter({hasText:'Five Agents I advise'})).toHaveCount(1);
 } finally { detach(); }
});
