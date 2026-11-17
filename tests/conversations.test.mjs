import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestEnded, replyCardOf, shown, waiting, withDecisions, withTeamWork } from '../lib/conversations.ts';

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

// #136: a card any Agent shows with its reply, read from its row; a row of a kind this version does not know is left out.
const planning=[
 {id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'نمشي بزاوية «من خريج لمحاسب شغال»',run_id:'r1',created_at:at(1)},
 {id:2,author:/** @type {const} */('agent'),author_name:'Ads',body:'تمام، دي خطة الحملة.',run_id:'r1',created_at:at(2)},
 {id:3,author:/** @type {const} */('person'),author_name:'Omar',body:'And the article outline',run_id:'r2',created_at:at(10)},
];
const row=(/** @type {number} */ id,/** @type {string} */ run_id,kind='draft')=>({id,run_id,kind,title:'خطة الحملة',content:{line:'مسودة · Meta Ads',rows:[{label:'الهدف',value:'ليدز على واتساب'}]},created_at:at(id===1?2:11)});
const draft=(/** @type {number} */ id)=>({id,kind:'draft',title:'خطة الحملة',line:'مسودة · Meta Ads',rows:[{label:'الهدف',value:'ليدز على واتساب'}]});

test('a draft card is read from its row, and a row of a kind this version does not know is left out',()=>{
 assert.deepEqual(replyCardOf(row(1,'r1')),draft(1));
 assert.equal(replyCardOf(row(9,'r1','poll')),null);
 assert.equal(replyCardOf(row(9,'r1','toString')),null);
});

// #137: a review card, read from its row with each verdict, in the order the Agent gave them.
test('a review card is read from its row, its texts in order with their verdicts and notes, and its decision',()=>{
 const items=[{text:'من خريج تجارة لمحاسب شغال في 3 شهور',fine:true,note:'الوعد واضح.'},{text:'أضمن طريق لأول وظيفة محاسبة',fine:false,note:'«أضمن» وعد مقدرش نثبته.'}];
 const stored={id:4,run_id:'r1',kind:'review',title:'مراجعة نصوص إعلانات ديسمبر',content:{line:'2 نصوص · Meta Ads',items,decision:'1 جاهز، و1 رجع لـ Ads'},created_at:at(2)};
 assert.deepEqual(replyCardOf(stored),{id:4,kind:'review',title:'مراجعة نصوص إعلانات ديسمبر',line:'2 نصوص · Meta Ads',items,decision:'1 جاهز، و1 رجع لـ Ads'});
});

test('a draft card is under the Agent\'s reply of its run, or is the Agent\'s whole turn when the reply was nothing but the call',()=>{
 const cards=[row(1,'r1'),row(2,'r2')].map(stored=>({run_id:stored.run_id,at:stored.created_at,card:{kind:/** @type {const} */('reply'),card:/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(stored))}}));
 const record=shown(planning,[{run_id:'r2',outcome:'failed'}],cards,'Ads');
 assert.deepEqual(order(record),[1,2,3,'made']);
 assert.deepEqual(record[1].cards,[{kind:'reply',card:draft(1)}]);
 assert.equal(record[1].body,'تمام، دي خطة الحملة.');
 assert.deepEqual(record[3],{id:3,author:'agent',author_name:'Ads',body:'',created_at:at(11),kind:'made',cards:[{kind:'reply',card:draft(2)}]});
});

// #138: an Agent's question, read from its row in each state; a claimed answer still on its way to the Engine is drawn
// answered. A Run's questions follow its person's message, each with its answer as that person's turn, before its reply.
const angles=['من خريج لمحاسب شغال','Excel وOdoo في كورس واحد'];
const askedRow=(/** @type {string} */ state,/** @type {string|undefined} */ answer)=>({id:5,run_id:'r1',kind:'question',title:'اختار زاوية الإعلان',
 content:{question:'اختار زاوية الإعلان',choices:angles,multiple:false,...(answer===undefined?{}:{answer})},state,answered_at:answer===undefined?null:at(3),created_at:at(2)});
const question={id:5,kind:'question',title:'اختار زاوية الإعلان',question:'اختار زاوية الإعلان',choices:angles,multiple:false};

test('a question is read from its row: open with no answer, answered with its answer also while it is on its way, and closed with or without one',()=>{
 assert.deepEqual(replyCardOf(askedRow('open')),{...question,state:'open'});
 assert.deepEqual(replyCardOf(askedRow('sending',angles[1])),{...question,state:'answered',answer:angles[1]});
 assert.deepEqual(replyCardOf(askedRow('answered',angles[1])),{...question,state:'answered',answer:angles[1]});
 assert.deepEqual(replyCardOf(askedRow('closed',angles[1])),{...question,state:'closed'});
 assert.deepEqual(replyCardOf(askedRow('closed')),{...question,state:'closed'});
});

test('a Run\'s question follows its person\'s message, its answer is that person\'s turn, and the Run\'s reply comes after; the main Agent\'s is its plain words',()=>{
 const sent=[{id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'محتاجين حملة Meta',run_id:'r1',created_at:at(1)}];
 const placed=(/** @type {string} */ state,/** @type {string|undefined} */ answer,/** @type {string|undefined} */ words)=>{
  const card={kind:/** @type {const} */('reply'),card:/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(askedRow(state,answer)))};
  return [{run_id:'r1',at:at(2),card,...(answer===undefined?{}:{answer:{body:answer,at:at(3)}}),...(words===undefined?{}:{words})}];
 };
 const open=shown(sent,[],placed('open'),'Ads');
 assert.deepEqual(open,[{id:1,author:'person',author_name:'Omar',body:'محتاجين حملة Meta',lost:false,created_at:at(1)},
  {id:5,author:'agent',author_name:'Ads',body:'',created_at:at(2),kind:'asked',cards:[placed('open')[0].card]}]);
 assert.deepEqual(waiting(sent,[]).map(message=>message.id),[1],'the Run still waits while its question does');
 const replied=[...sent,{id:2,author:/** @type {const} */('agent'),author_name:'Ads',body:'تمام، هنمشي بزاوية Excel.',run_id:'r1',created_at:at(4)}];
 const answered=shown(replied,[{run_id:'r1',outcome:'completed'}],placed('answered',angles[1]),'Ads');
 assert.deepEqual(order(answered),[1,'asked','answer',2]);
 assert.deepEqual(answered[2],{id:5,author:'person',author_name:'Omar',body:angles[1],created_at:at(3),kind:'answer'});
 const lead=shown(sent,[],placed('open',undefined,`اختار زاوية الإعلان\n- ${angles[0]}\n- ${angles[1]}`),'Lead');
 assert.deepEqual(lead[1],{id:5,author:'agent',author_name:'Lead',body:`اختار زاوية الإعلان\n- ${angles[0]}\n- ${angles[1]}`,created_at:at(2),kind:'asked'});
});

test('a message whose run Hermes no longer knew is marked lost and waits no more, and the next message waits for its own reply', () => {
 const first=[{id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'First try',run_id:'r1',created_at:at(1)}];
 const lost=[{run_id:'r1',outcome:/** @type {const} */('lost'),input_tokens:null,output_tokens:null}];
 assert.deepEqual(shown(first,lost).map(message=>message.lost),[true]);
 assert.deepEqual(waiting(first,lost),[]);
 assert.equal(latestEnded(first,lost),true);
 assert.deepEqual(shown(first,[{...lost[0],outcome:'stopped'}]).map(message=>message.lost),[false],'a stopped run is not lost');
 const again=[...first,{id:2,author:/** @type {const} */('person'),author_name:'Omar',body:'Second try',run_id:'r2',created_at:at(2)}];
 assert.deepEqual(shown(again,lost).map(message=>message.lost),[true,false]);
 assert.deepEqual(waiting(again,lost).map(message=>message.id),[2]);
 assert.equal(latestEnded(again,lost),false);
});
