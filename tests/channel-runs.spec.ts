import { test, expect } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { driveChannelRuns, postChannelMessage } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const channel='69000000-0000-0000-0000-000000000001';
const encryptionKey=process.env.WEBHOOK_ENCRYPTION_KEY||'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function attachAgent() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values ('${connection}','${company}','${omar}','http://127.0.0.1:9','fake-${connection.slice(0,8)}','${encryptSecret('fake-engine-key',encryptionKey)}','connected','0.23.0','{run_submission}')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${agent}','${company}','${connection}','Faye','Marketing')`);
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 return {connection,agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); query(`delete from public.hermes_connections where id='${connection}'`); }};
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
const runOf=(message:number)=>JSON.parse(query(`select agent_name,outcome,input_tokens,output_tokens from public.channel_runs where message_id=${message}`));
const repliesTo=(message:number)=>JSON.parse(query(`select author,author_name,body from public.channel_messages where reply_to=${message}`));

test('integration: ordinary talk starts no Run; a mention starts exactly one, and its reply is posted in the channel once',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=2; fake.settings.usage={input:2100,output:35};
 const {service,person}=await memberClient('omar@example.com'); const {agent,detach}=attachAgent();
 const told=randomUUID();
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${told}','${company}','${omar}','${agent}','Faye')`);
 query(`insert into public.agent_rules(company_id,agent_id,body,said_by,conversation_id,run_id,call_id) values ('${company}','${agent}','Answer in English','${omar}','${told}','channel-rule','call-0')`);
 try {
  const drive=()=>driveChannelRuns(service,{encryptionKey,channel,engineFor:fake.engineFor});
  const plain=await postChannelMessage(person,service,{channel,sendKey:randomUUID(),message:'Morning, team',encryptionKey,engineFor:fake.engineFor});
  expect(plain).toEqual({message:expect.any(Number)});
  expect(await drive()).toEqual({started:0,closed:0});
  expect(fake.runs).toEqual([]);
  expect(runOf((plain as {message:number}).message)).toEqual([]);

  const mention={channel,sendKey:randomUUID(),message:'@Faye plan the launch week',encryptionKey,engineFor:fake.engineFor};
  const sent=await postChannelMessage(person,service,mention) as {message:number};
  expect(fake.runs.map(run=>({key:run.key,input:run.input}))).toEqual([{key:`channel:${sent.message}`,input:'عمر: @Faye plan the launch week'}]);
  expect(fake.connections[0]).toMatchObject({address:'http://127.0.0.1:9',key:'fake-engine-key'});
  expect(fake.runs[0].instructions).toContain('- Answer in English');
  // No channel Run is told the Company knowledge (#344): the profile auto-loads it as the shared Skill.
  expect(fake.runs[0].instructions).not.toContain('## Brand voice');
  expect(await drive()).toEqual({started:0,closed:0});
  expect(await postChannelMessage(person,service,mention)).toEqual(sent);
  expect(fake.runs).toHaveLength(1);
  expect(repliesTo(sent.message)).toEqual([]);
  const passes=await Promise.all([drive(),drive()]);
  expect(passes[0].closed+passes[1].closed).toBe(1);
  expect(await drive()).toEqual({started:0,closed:0});
  expect(fake.runs).toHaveLength(1);
  expect(repliesTo(sent.message)).toEqual([{author:'agent',author_name:'Faye',body:'Reply to: عمر: @Faye plan the launch week'}]);
  expect(runOf(sent.message)).toEqual([{agent_name:'Faye',outcome:'completed',input_tokens:2100,output_tokens:35}]);
  const {data:record}=await person.from('channel_messages').select('author,body').eq('channel_id',channel).gte('id',sent.message).order('id');
  expect(record).toEqual([{author:'person',body:'@Faye plan the launch week'},{author:'agent',body:'Reply to: عمر: @Faye plan the launch week'}]);
 } finally { detach(); }
});

test('integration: a start whose answer was lost is asked again with the same key, and a refused first start ends without a reply',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine();
 const {service,person}=await memberClient('omar@example.com'); const {detach}=attachAgent();
 try {
  const engine=fake.engineFor({});
  const post={channel,sendKey:randomUUID(),message:'@Faye draft the teaser',encryptionKey};
  const lost=await postChannelMessage(person,service,{...post,engineFor:()=>({...engine,start:async()=>({state:'unknown'} as const)})}) as {message:number};
  expect(lost).toEqual({message:expect.any(Number)});
  const drive=()=>driveChannelRuns(service,{encryptionKey,channel,engineFor:fake.engineFor});
  expect(await drive()).toEqual({started:0,closed:0});
  expect(fake.runs).toEqual([]);
  expect(await postChannelMessage(person,service,{...post,engineFor:fake.engineFor})).toEqual(lost);
  expect(fake.runs.map(run=>run.key)).toEqual([`channel:${lost.message}`]);
  expect(await drive()).toEqual({started:0,closed:1});
  expect(repliesTo(lost.message)).toEqual([{author:'agent',author_name:'Faye',body:'Reply to: عمر: @Faye draft the teaser'}]);

  const refused=await postChannelMessage(person,service,{channel,sendKey:randomUUID(),message:'@Faye never started',encryptionKey,engineFor:()=>({...engine,start:async()=>null})}) as {message:number};
  expect(runOf(refused.message)).toEqual([{agent_name:'Faye',outcome:'failed',input_tokens:null,output_tokens:null}]);
  expect(await drive()).toEqual({started:0,closed:0});
  expect(repliesTo(refused.message)).toEqual([]);
  expect(fake.runs).toHaveLength(1);
 } finally { detach(); }
});
