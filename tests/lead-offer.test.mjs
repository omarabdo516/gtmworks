import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadInstructions } from '../lib/lead-offer.mjs';

// #143: the words Lead is given for its one question, per Role, beside the Agents the person sees. The reference writes
// the Arabic chips only, so the English words are carried here too and the pull request lists them.
const agents=[{name:'Reach',job:'Plans Facebook and Instagram campaigns.'},{name:'Hook',job:'Reads each ad as a customer would.'}];

test('an Owner is told to ask "Make it?", with "Not now", and the same words in Egyptian Arabic',()=>{
 const text=leadInstructions({role:'owner',owner:'Omar',agents});
 assert.match(text,/"Make it\?" with the choices "Make it" and "Not now"/);
 assert.match(text,/«أعمله؟» with «اعمله» and «مش دلوقتي»/);
 assert.doesNotMatch(text,/Ask Omar for it\?/,'an Owner is not asked to ask the Owner');
 assert.match(text,/call create_agent in the same run/);
});

test('a Manager and a Contributor are told to ask the Owner by first name, and to request the Agent, in both languages',()=>{
 for(const role of ['manager','contributor']) {
  const text=leadInstructions({role,owner:'Omar',agents});
  assert.match(text,/"Ask Omar for it\?" with the choices "Ask Omar for it" and "Not now"/,role);
  assert.match(text,/«أطلبه من Omar؟» with «اطلبه من Omar» and «مش دلوقتي»/,role);
  assert.doesNotMatch(text,/"Make it\?" with the choices "Make it"/,`${role}: the Owner's question is not theirs`);
  assert.match(text,/call request_agent in the same run/,role);
 }
});

test('a Viewer is offered nothing: no question, no choice, no Agent to make',()=>{
 const text=leadInstructions({role:'viewer',owner:'Omar',agents});
 for(const word of ['Make it','Ask Omar for it','Not now','create_agent','request_agent','أعمله','اطلبه','مش دلوقتي']) assert.ok(!text.includes(word),word);
 assert.match(text,/never offer to make an agent/);
});

test('the Agents the person sees are listed by name and job, and no one else is named; none is said plainly',()=>{
 const text=leadInstructions({role:'owner',owner:'Omar',agents});
 assert.match(text,/- Reach: Plans Facebook and Instagram campaigns\./);
 assert.match(text,/- Hook: Reads each ad as a customer would\./);
 assert.match(text,/They are the whole team that person sees/);
 assert.match(leadInstructions({role:'owner',owner:'Omar',agents:[]}),/sees no other agent on their team yet/);
});

test('a person with no place in the Company is told nothing, and a missing Owner name leaves the offer readable',()=>{
 assert.equal(leadInstructions({role:null,owner:null,agents}),'');
 const text=leadInstructions({role:'manager',owner:null,agents:[]});
 assert.match(text,/"Ask the Owner for it\?"/);
 assert.match(text,/«أطلبه من المالك؟»/);
});

// #434: in the Conversation Lead opened, its Run is given the opening it wrote, and once the Owner has answered it Lead
// proposes the first two or three Agents, each with its name and job, with the Owner's "Make it?" for each in turn.
test('the Run of the Conversation Lead opened carries its opening and the first Agents to propose; any other carries neither',()=>{
 const opening='Hi Omar, I manage the team.\n\n1. What does RS Learning sell?';
 const text=leadInstructions({role:'owner',owner:'Omar',agents:[],opening});
 assert.ok(text.includes(`You opened this conversation, before they wrote anything, with this message:\n\n${opening}\n\n`));
 assert.match(text,/propose the first two or three agents to make for this company[^.]*, each with its name and its job/);
 assert.match(text,/"Make it\?" with the choices "Make it" and "Not now"/);
 for(const brief of [{role:'owner',owner:'Omar',agents:[],opening:null},{role:'owner',owner:'Omar',agents:[]}]) assert.doesNotMatch(leadInstructions(brief),/You opened this conversation/);
 // Only the Owner the opening was written for is asked to make Agents from it.
 assert.doesNotMatch(leadInstructions({role:'manager',owner:'Omar',agents:[],opening}),/You opened this conversation/);
});

// #167: the jobs of the Agents hidden from a Manager or a Contributor, never their names, each with the reference's words
// naming who opens one for them, and the tool that shows the card.
const hidden=[{job:'Campaigns and ads',asks:'Sara',role:'manager'},{job:'Articles',asks:'Omar',role:'owner'}];
test('a Contributor is told the hidden jobs with the words naming who opens each, in both languages, and never offered to make one',()=>{
 const text=leadInstructions({role:'contributor',owner:'Omar',agents,hidden});
 assert.match(text,/- "Campaigns and ads": say "That job belongs to another agent in the company, and that agent isn't available to you\. Should I ask Sara \(Manager\) to open it for you\?"/);
 assert.match(text,/«الشغلانة دي عند وكيل تاني في الشركة، والوكيل ده مش متاح ليك\. تحب أبعت لـSara \(مدير\) طلب إنه يتفتح ليك؟»/);
 assert.match(text,/- "Articles": say ".*Should I ask Omar \(Owner\) to open it for you\?" \(in Arabic: «.*لـOmar \(مالك\).*»\)/);
 assert.match(text,/call ask_to_open_agent in the same run with the job exactly as written above/);
 assert.match(text,/Never name those agents/);
 assert.match(text,/none of those agents does and that is none of the jobs listed above/,'the offer to make one is for other work only');
});

test('with no hidden Agent, and for an Owner or a Viewer, no hidden job and no ask_to_open_agent is said',()=>{
 for(const brief of [{role:'contributor',owner:'Omar',agents},{role:'contributor',owner:'Omar',agents,hidden:[]},{role:'owner',owner:'Omar',agents,hidden},{role:'viewer',owner:'Omar',agents,hidden}]) {
  const text=leadInstructions(/** @type {any} */(brief));
  for(const word of ['ask_to_open_agent','Campaigns and ads','isn\'t available to you']) assert.ok(!text.includes(word),`${brief.role} ${brief.hidden?.length??'none'}: ${word}`);
 }
 assert.match(leadInstructions({role:'contributor',owner:'Omar',agents}),/that none of those agents does, ask them/);
});

// Spec #831 (#844): an Agent gives a job to another Agent, or keeps long work of its own, as a Card on the Company's
// board, with the Engine's own Kanban tool (kanban_create): its Run is told each Agent's board name (the profile the
// Engine knows it by) and its own, and is offered no tool of gtmworks's own for it. The names are the brief's, pinned
// with the Run, so a retry sends the same words.
const team=[{name:'Reach',job:'Plans Facebook and Instagram campaigns.',board:'ag-reach',role:'meta'},{name:'Hook',job:'Reads each ad as a customer would.',board:'ag-hook',role:'hook'}];
test('the main Agent is told the board name of each Agent the person sees and its own, to give a job as a Card with kanban_create, and no hand_to_agent',()=>{
 for(const role of ['owner','manager','contributor']) {
  const text=leadInstructions({role,owner:'Omar',agents:team,main:true,self:'co-rs'});
  assert.match(text,/- Reach: Plans Facebook and Instagram campaigns\. \(board name: ag-reach\)/,role);
  assert.match(text,/- Hook: Reads each ad as a customer would\. \(board name: ag-hook\)/,role);
  assert.match(text,/make a card with kanban_create[^.]*assignee the board name of the agent who does it \(yours is co-rs\)/,role);
  assert.match(text,/When the job belongs to one of the agents above, give it to that agent as a card on the board instead of asking this\./,role);
  assert.doesNotMatch(text,/hand_to_agent/,role);
 }
 assert.doesNotMatch(leadInstructions({role:'viewer',owner:'Omar',agents:team,main:true,self:'co-rs'}),/kanban_create|board name/,'a Viewer\'s Run is told no board');
});

test('another Agent is told the board names of the Company\'s other Agents and its own, and nothing of the main Agent\'s offer',()=>{
 const text=leadInstructions({role:'contributor',owner:'Omar',agents:[{name:'Lead',job:'Runs the team.',board:'co-rs',role:null},team[1]],main:false,self:'ag-reach'});
 assert.match(text,/^The other agents of your company, each with its board name:\n- Lead: Runs the team\. \(board name: co-rs\)\n- Hook: Reads each ad as a customer would\. \(board name: ag-hook\)\n\n/);
 assert.match(text,/kanban_create[^.]*\(yours is ag-reach\)/);
 for(const word of ['Make it','Ask Omar for it','create_agent','request_agent','hand_to_agent','They are the whole team']) assert.ok(!text.includes(word),word);
 assert.equal(leadInstructions({role:'contributor',owner:'Omar',agents:[],main:false,self:'ag-reach'}).includes('kanban_create'),true,'it may still keep its own work on the board');
});

test('a job command to the main Agent asks it to make one card for the Agent of that role, with the job after the command; other words ask nothing',()=>{
 const brief={role:'contributor',owner:'Omar',agents:team,main:true,self:'co-rs'};
 const text=leadInstructions(brief,'/campaign Plan the March intake ads');
 assert.match(text,/This message is the job command \/campaign for Reach: make one card for Reach with kanban_create, its assignee ag-reach, for this job: Plan the March intake ads\n/);
 assert.match(text,/Say in your reply that you gave the job to Reach/);
 for(const message of ['Plan the March intake ads','/campaign','/report the numbers','hello /campaign x']) assert.doesNotMatch(leadInstructions(brief,message),/This message is the job command/,message);
 assert.doesNotMatch(leadInstructions({...brief,main:false,self:'ag-hook'},'/campaign Plan the March intake ads'),/job command/,'only the main Agent takes a job command');
});
