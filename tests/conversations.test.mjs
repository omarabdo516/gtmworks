import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shown, withDecisions, withTeamWork } from '../lib/conversations.ts';

// A Contributor's Conversation in a team (#25): the line under the Agent's reply says who their rule was sent to as a
// suggestion, and the Owner's or a Manager's decision on it shows where it happened among the messages.
const at=(/** @type {number} */ minute)=>`2026-06-10T18:${String(minute).padStart(2,'0')}:00+00:00`;
const rule='From now on, no emojis';
const messages=[
 {id:1,author:/** @type {const} */('person'),author_name:'Youssef',body:rule,run_id:'r1',created_at:at(1)},
 {id:2,author:/** @type {const} */('agent'),author_name:'Ads',body:'Done: no emojis in my work with you, and I suggested it for the team.',run_id:'r1',created_at:at(2)},
 {id:3,author:/** @type {const} */('person'),author_name:'Youssef',body:'Draft the post',run_id:'r2',created_at:at(10)},
 {id:4,author:/** @type {const} */('agent'),author_name:'Ads',body:'Here it is.',run_id:'r2',created_at:at(11)},
];
const suggested={id:'rule-1',agent:'ads',removed:false,said_at:at(2),sentTo:['Omar','Sara']};
const order=(/** @type {import('../lib/conversations.ts').ConversationMessage[]} */ record)=>record.map(message=>message.kind?`${message.kind}`:message.id);

test('the suggested line follows the reply of the run that told the rule, naming who it was sent to',()=>{
 const record=shown(messages,[],[],'Ads',[{run_id:'r1',rule:suggested}]);
 assert.deepEqual(order(record),[1,2,'saved',3,4]);
 assert.deepEqual(record[2].saved,[suggested]);
});

test('a decision shows at its time among the messages and notes, and one after them all comes last',()=>{
 const approved={approved:true,by:'Omar',rule,at:at(5)};
 const record=withDecisions(shown(messages,[],[],'Ads',[{run_id:'r1',rule:suggested}]),[approved],'Ads');
 assert.deepEqual(order(record),[1,2,'saved','decided',3,4]);
 assert.deepEqual(record[3],{id:0,author:'agent',author_name:'Ads',body:'',created_at:at(5),kind:'decided',decided:approved});
 const declined={approved:false,by:'Sara',rule:'From now on, sign every reply',at:at(20)};
 const later=withDecisions(shown(messages),[declined,approved],'Ads');
 assert.deepEqual(later.filter(message=>message.kind==='decided').map(message=>message.decided),[approved,declined]);
 assert.equal(later.at(-1)?.decided,declined);
 const withNote=withTeamWork(later,[{id:9,author_name:'Youssef',addressed_name:'Omar',body:'See this',created_at:at(4)}]);
 assert.deepEqual(order(withNote),[1,2,'note','decided',3,4,'decided']);
});

const asking=[
 {id:1,author:/** @type {const} */('person'),author_name:'Youssef',body:'I want someone to follow up our WhatsApp leads',run_id:'r1',created_at:at(1)},
 {id:2,author:/** @type {const} */('agent'),author_name:'Lead',body:'I prepared your request and sent it to Omar.',run_id:'r1',created_at:at(2)},
 {id:3,author:/** @type {const} */('person'),author_name:'Youssef',body:'And one for the blog',run_id:'r2',created_at:at(10)},
];
const request=(/** @type {number} */ id)=>({id,name:'WhatsApp Leads',job:'Follows up the WhatsApp leads.',apps:[],askedBy:'Youssef',askedWith:'I want someone to follow up our WhatsApp leads',state:/** @type {const} */('waiting'),owners:['Omar']});

test('a request\'s card is in Lead\'s reply of its run, or is Lead\'s whole turn when Lead wrote nothing',()=>{
 const cards=[{run_id:'r1',at:at(2),card:{kind:/** @type {const} */('request'),request:request(7)}},{run_id:'r2',at:at(11),card:{kind:/** @type {const} */('request'),request:request(8)}}];
 const record=shown(asking,[],cards,'Lead');
 assert.deepEqual(order(record),[1,2,3,'made']);
 assert.deepEqual(record[1].cards,[cards[0].card]);
 assert.deepEqual(record[3],{id:3,author:'agent',author_name:'Lead',body:'',created_at:at(11),kind:'made',cards:[cards[1].card]});
});

test('an Owner\'s answer to a request shows at its time',()=>{
 const made={kind:/** @type {const} */('request'),made:true,by:'Omar',name:'WhatsApp Leads',at:at(5)};
 const record=withDecisions(shown(asking,[],[{run_id:'r1',at:at(2),card:{kind:/** @type {const} */('request'),request:request(7)}}],'Lead'),[made],'Lead');
 assert.deepEqual(order(record),[1,2,'decided',3]);
 assert.equal(record[2].decided,made);
});
