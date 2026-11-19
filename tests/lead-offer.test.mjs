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
