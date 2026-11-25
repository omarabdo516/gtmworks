import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveChannelRuns } from '../lib/channel-runs.mjs';
import { channelHandOverSpec, channelToolSpecTexts, toolSpecTexts } from '../lib/agent-tools.mjs';

// #476 (decision 0057 point 8): in a channel, any Agent of the channel hands a job to any other Agent of the Company, in
// the channel or not. A Company of three, Lead, Ads and Writer, and a team channel whose one Agent is Writer: a member
// calls Writer, and Writer's Run is offered hand_to_agent naming Ads and Lead with their jobs, though neither is in the
// channel, never Writer itself, as the database lists them (channel_handover_targets, proved in
// supabase/tests/channel_any_agent_handovers.sql). The text is the one pin_channel_run pins, so a retry sends it again.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
const message=7;
const channel='c4760000-0000-0000-0000-000000000001';
const writerProfile='ag-a4760000000000000000000000000003';
const others=[{name:'Ads',job:'Meta ads and their numbers'},{name:'Lead',job:'Runs the team'}];

/** A channel whose due Run is Writer's, and what each database call was given. pin_channel_run pins once, as the database does. */
function database(listed=others) {
 const team=[...listed];
 const given=/** @type {Record<string,any[]>} */({}); let pinned=/** @type {string|null|undefined} */(undefined); let attempt=0;
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  (given[name]??=[]).push(args);
  if(name==='channel_runs_due') return {data:[{message,run:null,profile:null}],error:null};
  if(name==='begin_channel_start') { attempt+=1; return {data:[{attempt,company:'10000000-0000-0000-0000-000000000001',profile:writerProfile,session:'s-writer',input:'Omar: @Writer write the launch post',instructions:null}],error:null}; }
  if(name==='channel_handover_targets') return {data:[...team],error:null};
  if(name==='pin_channel_run') {
   if(pinned===undefined) { const offered=['show_draft','hand_to_agent'].filter(tool=>args.specs[tool]); pinned=offered.length?`[${offered.map(tool=>args.specs[tool]).join(',')}]`:null; }
   return {data:{tools:pinned},error:null};
  }
  if(name==='answer_channel_start') return {data:false,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {service,given,team};
}

test('a channel Run of an Agent that is not the main one is offered hand_to_agent naming the Company\'s other Agents, in the channel or not, with their jobs, pinned with the Run',async()=>{
 const stores=database(); const starts=/** @type {any[]} */([]);
 const engine={start:async(/** @type {any} */ request)=>{ starts.push(request); return null; }};
 const drive=()=>driveChannelRuns(/** @type {any} */(stores.service),{hermes,engineFor:()=>/** @type {any} */(engine),channel});
 await drive();
 assert.deepEqual(stores.given.channel_handover_targets,[{message}],'the list is the database\'s, for this message\'s Run');
 const hand=starts[0].tools.find((/** @type {any} */ tool)=>tool.name==='hand_to_agent');
 assert.ok(hand,'Writer, the channel\'s one Agent, is offered hand_to_agent');
 assert.deepEqual(hand.parameters.properties.agent.enum,['Ads','Lead'],'its enum is the Company\'s other Agents, though neither is in the channel, never the asker');
 assert.match(hand.description,/- Ads: Meta ads and their numbers\n- Lead: Runs the team\n/,'each with its job line');
 assert.match(hand.description,/in this channel or not/,'it says an Agent outside the channel may be asked');
 assert.match(hand.description,/answer comes back to you, the agent that asked/,'and that the answer comes back to the asking Agent');
 assert.deepEqual(hand.parameters.required,['agent','goal']);
 assert.equal(JSON.stringify(hand),stores.given.pin_channel_run[0].specs.hand_to_agent,'the text sent is the text pinned');
 // The team changes before the retry: the retry still sends the pinned text.
 stores.team.splice(0,stores.team.length,{name:'Critic',job:'Reviews'});
 await drive();
 assert.equal(starts.length,2,'the same Run is asked again');
 assert.deepEqual(starts[1].tools,starts[0].tools,'with the pinned tools unchanged');
});

test('a channel Run with no other Agent of the Company to hand to is offered no hand_to_agent, and the card tools keep their own text',async()=>{
 const stores=database([]); const starts=/** @type {any[]} */([]);
 const engine={start:async(/** @type {any} */ request)=>{ starts.push(request); return null; }};
 await driveChannelRuns(/** @type {any} */(stores.service),{hermes,engineFor:()=>/** @type {any} */(engine),channel});
 assert.equal('hand_to_agent' in stores.given.pin_channel_run[0].specs,false,'nothing is asked of the database to pin a tool with no target');
 assert.deepEqual(starts[0].tools.map((/** @type {any} */ tool)=>tool.name),['show_draft']);
 const texts=toolSpecTexts();
 // The handed step is the chat's tool without "on my screen" and its step (#714): a channel has no one person to open
 // a Screen for.
 const handOver=JSON.parse(texts.hand_over);
 const properties={...handOver.parameters.properties}; delete properties.screen; delete properties.step;
 assert.deepEqual(channelToolSpecTexts([]),{show_draft:texts.show_draft,show_review:texts.show_review,hand_over:JSON.stringify({...handOver,parameters:{...handOver.parameters,properties}})});
});

test('the channel\'s tool names each Agent once, even when two share a name, and keeps a name with no job line',()=>{
 const spec=channelHandOverSpec([{name:' Ads ',job:'Meta ads'},{name:'Ads',job:'Other'},{name:'Critic',job:null}]);
 assert.deepEqual(spec.parameters.properties.agent.enum,['Ads','Critic']);
 assert.match(spec.description,/- Ads: Meta ads\n- Critic\n/);
 assert.match(spec.description,/reply to the channel/,'the asking Agent replies to the channel with what came of it');
});
