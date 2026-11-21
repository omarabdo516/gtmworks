import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handTurn, latestEnd, offeredChoices, queuedWaiting, questionParts, replyCardOf, shown, stepsOfReplies, waiting, withDecisions, withTeamWork } from '../lib/conversations.ts';

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

// #139: a step handed to the person, read from its row: open until its person marks it done, then done at the time the
// database kept; an address or a note left out reads as none.
test('a hand card is read from its row: open with its app, rows, address and note, and done at the time it was marked',()=>{
 const content={app:'WordPress',line:'المقال جاهز مسودة على WordPress',rows:[{label:'الطول',value:'1,600 كلمة'}],url:'https://rslearning.example/wp-admin/post.php?post=812',note:'هتابع ترتيبه.'};
 const stored=(/** @type {string} */ state,/** @type {object} */ more={})=>({id:6,run_id:'r1',kind:'hand',title:'انشر المقال',content:{...content,...more},state,answered_at:null,done_at:state==='done'?at(4):null,created_at:at(2)});
 const hand={id:6,kind:'hand',title:'انشر المقال',line:content.line,app:'WordPress',rows:content.rows,url:content.url,note:content.note};
 assert.deepEqual(replyCardOf(stored('open')),{...hand,state:'open'});
 assert.deepEqual(replyCardOf(stored('done')),{...hand,state:'done',at:at(4)});
 const bare=stored('open'); bare.content={app:'Stripe',line:'Ready',rows:[]};
 assert.deepEqual(replyCardOf(bare),{id:6,kind:'hand',title:'انشر المقال',line:'Ready',app:'Stripe',rows:[],url:null,note:null,state:'open'});
});

// #203: a connect card, read from its row with the app's state in the Agent's profile now: open while the Engine says it
// is not connected or cannot be read, connected once it is, and postponed for good once the Owner said Later.
test('a connect card is read from its row with the app\'s state now: open, connected when the Agent has it, and postponed whatever the Agent has',()=>{
 const stored=(/** @type {string} */ state)=>({id:8,run_id:'r1',kind:'connect',title:'Amplitude',content:{app:'amplitude',reason:'مش متوصل، فمقدرتش أعرف مين من الليدز اشترى فعلاً.'},state,answered_at:null,done_at:null,decided_at:null,created_at:at(2)});
 const card={id:8,kind:'connect',title:'Amplitude',app:'amplitude',reason:'مش متوصل، فمقدرتش أعرف مين من الليدز اشترى فعلاً.'};
 assert.deepEqual(replyCardOf(stored('open')),{...card,state:'open'},'the Engine was not read');
 assert.deepEqual(replyCardOf(stored('open'),{amplitude:'off'}),{...card,state:'open'});
 assert.deepEqual(replyCardOf(stored('open'),{amplitude:'attention'}),{...card,state:'open'},'a sign-in that stopped working is asked for again');
 assert.deepEqual(replyCardOf(stored('open'),{amplitude:'connected'}),{...card,state:'connected'});
 assert.deepEqual(replyCardOf(stored('open'),{notion:'connected'}),{...card,state:'open'});
 assert.deepEqual(replyCardOf(stored('postponed'),{amplitude:'connected'}),{...card,state:'postponed'});
 assert.deepEqual(replyCardOf(stored('postponed')),{...card,state:'postponed'});
});

test('a connect card sits right under the reply\'s text, before any other card of its run',()=>{
 const connect={id:9,run_id:'r1',kind:'connect',title:'Amplitude',content:{app:'amplitude',reason:'For sales'},state:'open',answered_at:null,done_at:null,decided_at:null,created_at:at(2)};
 const cards=[row(1,'r1'),connect].map(stored=>({run_id:stored.run_id,at:stored.created_at,card:{kind:/** @type {const} */('reply'),card:/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(/** @type {any} */(stored)))}}));
 const record=shown(planning,[],cards,'Ads');
 assert.deepEqual(record[1].cards?.map(card=>card.kind==='reply'&&card.card.kind),['connect','draft']);
});

// #140: "Done it" starts the Agent's turn with a message the person never wrote: it draws no bubble, waiting or started,
// while what its run shows stays and the Agent is still shown working on it.
test('a hand card\'s turn draws no bubble of the person, keeps its run\'s cards and question, and still keeps the page waiting',()=>{
 const told='Omar did the step you handed over, "انشر المقال" in WordPress, and pressed "Done it" at 2026-06-10 18:04 UTC. Pick up from there.';
 const typed={send_key:'k-typed',message:'And the next one?',queued_at:at(6),started_at:null,failed_at:null,hand_card:null};
 const hand={send_key:'k-hand',message:told,queued_at:at(4),started_at:null,failed_at:null,hand_card:6};
 assert.deepEqual(withTeamWork([],[],[hand,typed],'Omar').map(message=>message.body),['And the next one?'],'a waiting hand turn is not drawn; a typed one is');
 assert.equal(queuedWaiting([hand]),true,'the page still waits for the Agent');
 const record=[
  {id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'Get the article out',run_id:'r1',hand_card:null,created_at:at(1)},
  {id:2,author:/** @type {const} */('agent'),author_name:'Ads',body:'Your turn to publish it.',run_id:'r1',created_at:at(2)},
  {id:3,author:/** @type {const} */('person'),author_name:'Omar',body:told,run_id:'r2',hand_card:6,created_at:at(5)},
 ];
 const cards=[{run_id:'r2',at:at(6),card:{kind:/** @type {const} */('reply'),card:/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(row(7,'r2')))}},
  {run_id:'r2',at:at(7),card:{kind:/** @type {const} */('reply'),card:/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(askedRow('open')))}}];
 const drawn=shown(record,[],cards,'Ads');
 assert.deepEqual([...record,hand,typed].map(handTurn),[false,false,true,true,false],'one test tells a hand turn, stored or waiting');
 assert.deepEqual(order(drawn),[1,2,'asked','made'],'the started hand turn has no bubble; its question and card stay');
 assert.ok(!drawn.some(message=>message.body===told));
 assert.deepEqual(waiting(record,[]).map(message=>message.id),[3],'its run is still waited on');
 assert.deepEqual(order(shown(record.map(({hand_card,...message})=>message),[],cards,'Ads')),[1,2,3,'asked','made'],'a message that names no card is an ordinary one');
});

// #358: a job command in the main Agent's Conversation. The person's message carries the command's own Run, the quiet
// "Handed to" row is drawn under it as Lead's turn, and the Agent handed the job answers in the same chat with its own
// words — its message says which Agent it is, so the page draws that Agent's face. The chat never waits on the command's
// Run as the Lead's: the handover's own answer closes it.
test('a command\'s handover row follows the person\'s message and the Agent handed the job answers in the same chat',()=>{
 const inChat=[{id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'/campaign Launch the December ads',run_id:'command:k1',created_at:at(1)},
  {id:2,author:/** @type {const} */('agent'),author_name:'Reach',agent_id:'a-meta',body:'Three ad sets, 30 days, EGP 9,000.',run_id:'run-target',created_at:at(3)}];
 const cards=[{run_id:'command:k1',at:at(2),card:{kind:/** @type {const} */('handed'),from:{name:'Mona',face:'c-mona'},name:'Reach',face:'c-meta',goal:'Launch the December ads'}}];
 const drawn=shown(inChat,[],cards,'Lead');
 assert.deepEqual(order(drawn),[1,'made',2],'the row under the message that asked, then that Agent\'s answer');
 assert.deepEqual(drawn[1].cards,[cards[0].card]);
 assert.deepEqual([drawn[2].author_name,drawn[2].agent_id,drawn[2].body],['Reach','a-meta','Three ad sets, 30 days, EGP 9,000.']);
 assert.deepEqual(waiting(inChat,[],new Set(['command:k1'])),[],'the chat does not wait on the Lead for it');
 assert.deepEqual(waiting([inChat[0]],[]).map(message=>message.id),[1],'and without its handover its Run waits as any other');
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

test('a Run\'s question follows its person\'s message with its card, also the main Agent\'s, its answer is that person\'s turn, and the Run\'s reply comes after',()=>{
 const sent=[{id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'محتاجين حملة Meta',run_id:'r1',created_at:at(1)}];
 const placed=(/** @type {string} */ state,/** @type {string|undefined} */ answer)=>{
  const card={kind:/** @type {const} */('reply'),card:/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(askedRow(state,answer)))};
  return [{run_id:'r1',at:at(2),card,...(answer===undefined?{}:{answer:{body:answer,at:at(3),delivered:true}})}];
 };
 const open=shown(sent,[],placed('open'),'Ads');
 assert.deepEqual(open,[{id:1,author:'person',author_name:'Omar',body:'محتاجين حملة Meta',lost:false,created_at:at(1)},
  {id:5,author:'agent',author_name:'Ads',body:'',created_at:at(2),kind:'asked',cards:[placed('open')[0].card]}]);
 assert.deepEqual(waiting(sent,[]).map(message=>message.id),[1],'the Run still waits while its question does');
 const replied=[...sent,{id:2,author:/** @type {const} */('agent'),author_name:'Ads',body:'تمام، هنمشي بزاوية Excel.',run_id:'r1',created_at:at(4)}];
 const answered=shown(replied,[{run_id:'r1',outcome:'completed'}],placed('answered',angles[1]),'Ads');
 assert.deepEqual(order(answered),[1,'asked','answer',2]);
 assert.deepEqual(answered[2],{id:5,author:'person',author_name:'Omar',body:angles[1],created_at:at(3),kind:'answer'});
 const lead=shown(sent,[],placed('open'),'Lead');
 assert.deepEqual(lead[1],{id:5,author:'agent',author_name:'Lead',body:'',created_at:at(2),kind:'asked',cards:[placed('open')[0].card]},
  'the main Agent\'s question is its card, drawn as chips by the page (#143), not plain words');
});

test('an answer claimed after the Engine stopped waiting is the person\'s turn marked not delivered; one the Engine took is not marked',()=>{
 const parts=(/** @type {string} */ state)=>{ const row=askedRow(state,angles[1]); return questionParts(row,/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(row))); };
 assert.deepEqual(parts('closed'),{answer:{body:angles[1],at:at(3),delivered:false}});
 assert.deepEqual(parts('answered'),{answer:{body:angles[1],at:at(3),delivered:true}});
 assert.deepEqual(parts('sending'),{answer:{body:angles[1],at:at(3),delivered:true}},'one still on its way is drawn as sent');
 const sent=[{id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'محتاجين حملة Meta',run_id:'r1',created_at:at(1)}];
 const closed=askedRow('closed',angles[1]);
 const card={kind:/** @type {const} */('reply'),card:/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(closed))};
 const record=shown(sent,[{run_id:'r1',outcome:'completed'}],[{run_id:'r1',at:at(2),card,...parts('closed')}],'Ads');
 assert.deepEqual(record[2],{id:5,author:'person',author_name:'Omar',body:angles[1],created_at:at(3),kind:'answer',failed:true});
});

// #163: a request the Agent's Run waits on to allow an action, read from its row in each state; a choice still on its way
// to the Engine is drawn decided. It is the Agent's turn after its person's message, before the Run's reply.
const permissionRow=(/** @type {string} */ state,/** @type {string|undefined} */ choice)=>({id:8,run_id:'r1',kind:'permission',title:'delete the old exports',
 content:{description:'delete the old exports',command:'rm -r exports',choices:['once','always','deny'],...(choice===undefined?{}:{choice})},state,answered_at:null,done_at:null,decided_at:choice===undefined?null:at(3),created_at:at(2)});
const permission={id:8,kind:'permission',title:'delete the old exports',description:'delete the old exports',command:'rm -r exports',choices:['once','always','deny']};

test('a permission request is read from its row: open, decided with its choice and time also while it is on its way, and closed with or without one',()=>{
 assert.deepEqual(replyCardOf(permissionRow('open')),{...permission,state:'open'});
 assert.deepEqual(replyCardOf(permissionRow('sending','always')),{...permission,state:'decided',choice:'always',at:at(3)});
 assert.deepEqual(replyCardOf(permissionRow('decided','deny')),{...permission,state:'decided',choice:'deny',at:at(3)});
 assert.deepEqual(replyCardOf(permissionRow('closed','once')),{...permission,state:'closed'});
 assert.deepEqual(replyCardOf(permissionRow('closed')),{...permission,state:'closed'});
});

test('a Run\'s request follows its person\'s message as the Agent\'s turn with its card, also the main Agent\'s, the Run still waits, and its reply comes after',()=>{
 const sent=[{id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'نضّف الملفات القديمة',run_id:'r1',created_at:at(1)}];
 const placed=(/** @type {string} */ state,/** @type {string|undefined} */ choice)=>{
  const row=permissionRow(state,choice); const card=/** @type {import('../lib/conversations.ts').ReplyCard} */(replyCardOf(row));
  return [{run_id:'r1',at:at(2),card:{kind:/** @type {const} */('reply'),card},...questionParts(row,card)}];
 };
 for(const agent of ['Ads','Lead']) assert.deepEqual(shown(sent,[],placed('open'),agent),[{id:1,author:'person',author_name:'Omar',body:'نضّف الملفات القديمة',lost:false,created_at:at(1)},
  {id:8,author:'agent',author_name:agent,body:'',created_at:at(2),kind:'asked',cards:[placed('open')[0].card]}],agent);
 assert.deepEqual(waiting(sent,[]).map(message=>message.id),[1],'the Run still works while its request waits');
 const replied=[...sent,{id:2,author:/** @type {const} */('agent'),author_name:'Ads',body:'تمام، مسحتها.',run_id:'r1',created_at:at(4)}];
 assert.deepEqual(order(shown(replied,[{run_id:'r1',outcome:'completed'}],placed('decided','once'),'Ads')),[1,'asked',2],'no turn of the person\'s own, and the reply under it');
});

test('the buttons are the choices the person\'s role may send that the Engine offered, in the reference\'s order',()=>{
 const card=/** @type {Extract<import('../lib/conversations.ts').ReplyCard,{kind:'permission'}>} */(replyCardOf(permissionRow('open')));
 assert.deepEqual(offeredChoices(card,['once','always','deny']),['deny','always','once'],'an Owner or a Manager');
 assert.deepEqual(offeredChoices(card,['once','deny']),['deny','once'],'a Contributor');
 assert.deepEqual(offeredChoices(card,[]),[],'a Viewer');
 assert.deepEqual(offeredChoices({...card,choices:['once','deny']},['once','always','deny']),['deny','once'],'a request the Engine will not keep for later');
});

test('a message whose run Hermes no longer knew is marked lost and waits no more, and the next message waits for its own reply', () => {
 const first=[{id:1,author:/** @type {const} */('person'),author_name:'Omar',body:'First try',run_id:'r1',created_at:at(1)}];
 const lost=[{run_id:'r1',outcome:/** @type {const} */('lost')}];
 assert.deepEqual(shown(first,lost).map(message=>message.lost),[true]);
 assert.deepEqual(waiting(first,lost),[]);
 assert.equal(latestEnd(first,lost),'lost');
 assert.deepEqual(shown(first,[{...lost[0],outcome:'stopped'}]).map(message=>message.lost),[false],'a stopped run is not lost');
 const again=[...first,{id:2,author:/** @type {const} */('person'),author_name:'Omar',body:'Second try',run_id:'r2',created_at:at(2)}];
 assert.deepEqual(shown(again,lost).map(message=>message.lost),[true,false]);
 assert.deepEqual(waiting(again,lost).map(message=>message.id),[2]);
 assert.equal(latestEnd(again,lost),null);
});

// #346: a reply's steps are read from the Agent's Hermes session, never kept: each reply takes the last turn the session
// started after the reply before it and by the time the reply was written, so a run that failed before it keeps its
// steps to itself, and a reply with no turn of its own, or a turn with no tool calls, shows none.
test('each reply carries the steps of its own turn in the session, and a turn of a failed run goes to no reply',()=>{
 const time=(/** @type {number} */ minute)=>Date.parse(at(minute))/1000;
 const chat=[
  {id:1,author:/** @type {const} */('person'),author_name:'Youssef',body:'Plan the ads',run_id:'r1',created_at:at(1)},
  {id:2,author:/** @type {const} */('agent'),author_name:'Ads',body:'Here is the plan.',run_id:'r1',created_at:at(3)},
  {id:3,author:/** @type {const} */('person'),author_name:'Youssef',body:'Try again',run_id:'r2',created_at:at(10)},
  {id:4,author:/** @type {const} */('person'),author_name:'Youssef',body:'And the budget?',run_id:'r3',created_at:at(20)},
  {id:5,author:/** @type {const} */('agent'),author_name:'Ads',body:'15,000 a month.',run_id:'r3',created_at:at(22)},
  {id:6,author:/** @type {const} */('person'),author_name:'Youssef',body:'Thanks',run_id:'r4',created_at:at(30)},
  {id:7,author:/** @type {const} */('agent'),author_name:'Ads',body:'Any time.',run_id:'r4',created_at:at(31)}];
 const search={tool:'web_search',preview:'audiences',state:/** @type {const} */('done')};
 const failed={tool:'read_file',preview:null,state:/** @type {const} */('failed')};
 const sheet={tool:'sheets',preview:'budget',state:/** @type {const} */('done')};
 const turns=[{at:time(1)+2,seconds:41,steps:[search]},{at:time(10)+1,seconds:5,steps:[failed]},{at:time(20)+1,seconds:7,steps:[sheet]},{at:time(30)+1,seconds:2,steps:[]}];
 const steps=stepsOfReplies(chat,turns);
 assert.deepEqual(steps,[{run_id:'r1',steps:[search],seconds:41},{run_id:'r3',steps:[sheet],seconds:7}]);
 assert.deepEqual(shown(chat,[],[],'Ads',[],steps).filter(message=>message.steps).map(message=>[message.id,message.steps]),[[2,{list:[search],seconds:41}],[5,{list:[sheet],seconds:7}]]);
 assert.deepEqual(stepsOfReplies(chat,null),[],'a session that cannot be read shows no steps');
});
