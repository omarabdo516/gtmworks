import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { driveChannelRuns } from '../lib/channel-runs.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// An Agent on its own profile (ADR 0016) has its instructions as the profile's soul, so its Runs start on that profile
// with the sender's note only (the team's rules are in the soul too, #345), and a retry sends the same body: the fake
// Engine server, as the pinned release, refuses another body under the same idempotency key. No Run is told the Company
// knowledge (#344): the profile auto-loads it as the shared Skill company-knowledge, so this database pins none.
const own='ag-a0000000000000000000000000000001';
const lead='co-10000000000000000000000000000001';
const role='You are the SEO content writer on RS Learning\'s marketing team.';
const rule='Answer every comment within the day';
const company='10000000-0000-0000-0000-000000000001';

// The database as a channel's start sees it: the run's pinned profile, its pinned parts, and the attempts begun.
function databases(fake,{profile}) {
 const attempts=new Map();
 const attempt=key=>{ attempts.set(key,(attempts.get(key)??0)+1); return attempts.get(key); };
 const rpc=async(/** @type {string} */ name)=>{
  if(name==='pin_channel_run') return {data:{tools:null},error:null};
  if(name==='channel_handover_targets') return {data:[],error:null};
  if(name==='channel_runs_due') return {data:[{message:7,run:null,company}],error:null};
  if(name==='begin_channel_start') return {data:[{attempt:attempt('channel'),company,profile,session:'s',input:'Omar: draft the offer email',instructions:role,rules:[rule]}],error:null};
  if(name==='answer_channel_start') return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}}; };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const service={rpc,from:(/** @type {string} */ table)=>chain(table==='hermes_agents'?{instructions:role}:null)};
 return {service};
}
async function engineServer(profile) {
 const fake=await fakeHermes();
 fake.settings.profiles.set(profile,{soul:role,provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 // The Company's Engine record names this Engine.
 engineRecord(company,fake);
 return fake;
}
const starts=fake=>fake.settings.requests.filter(request=>request.method==='POST');

test('a channel Run of an Agent on its own profile starts there without its instructions, and so does its retry',async()=>{
 const fake=await engineServer(own);
 try {
  const {service}=databases(fake,{profile:own});
  fake.settings.loseStarts=2;
  assert.deepEqual(await driveChannelRuns(service,{}),{started:0,closed:0});
  assert.deepEqual(await driveChannelRuns(service,{}),{started:1,closed:0});
  assert.deepEqual(starts(fake).map(request=>request.path),[`/p/${own}/v1/runs`,`/p/${own}/v1/runs`,`/p/${own}/v1/runs`]);
  assert.equal(fake.settings.runs.length,1);
  const sent=fake.settings.runs[0].instructions;
  assert.ok(!sent?.includes(rule),'the team\'s rules are in the profile\'s SOUL.md');
  assert.ok(!sent?.includes('Brand voice')&&!sent?.includes('knowledge'),'no Company knowledge');
  assert.ok(!sent?.includes(role));
 } finally { await fake.close(); }
});

test('an Agent on Lead\'s profile still has its instructions first in every Run',async()=>{
 const fake=await engineServer(lead);
 try {
  const databasesOf=databases(fake,{profile:lead});
  await driveChannelRuns(databasesOf.service,{});
  assert.deepEqual(starts(fake).map(request=>request.path),[`/p/${lead}/v1/runs`]);
  for(const run of fake.settings.runs) assert.ok(run.instructions.startsWith(role),run.instructions);
 } finally { await fake.close(); }
});

test('no Run starts on another Company\'s profile',async()=>{
 const fake=await engineServer(own);
 try {
  await driveChannelRuns(databases(fake,{profile:'co-10000000000000000000000000000002'}).service,{});
  assert.deepEqual(starts(fake),[]);
 } finally { await fake.close(); }
});
