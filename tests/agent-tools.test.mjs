import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { engineReady, runToolCall, toolSpecTexts } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { instructionsOf, roleAppNames, roleTemplates } from '../lib/role-templates.mjs';

const profile='co-10000000000000000000000000000001';
// `plan` is what the database names for a create_agent call (lead_agent_profile): the Agent a call already made, or
// none for a call that will be refused. `answers` are the database's answers to other calls by name.
function harness(/** @type {object} */ engineOverride={},/** @type {object} */ answer={state:'created',agent:'agent-1'},/** @type {object|null} */ plan=null,/** @type {Record<string,unknown>} */ answers={}) {
 const fake=fakeEngine(); const engine={...fake.engineFor({}),...engineOverride}; const rpcs=/** @type {[string,object][]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {object} */ args)=>{ rpcs.push([name,args]); return {data:name==='lead_agent_profile'?plan:Object.hasOwn(answers,name)?answers[name]:answer,error:null}; }};
 const call=(/** @type {string} */ name,/** @type {unknown} */ args)=>runToolCall({db,engine,profile,conversation:'conversation-1',run:'run-1'},{id:'call-0',name,arguments:args});
 return {fake,engine,rpcs,call};
}
const asked={name:' Meta Ads ',job:'Runs the Meta ads. ',apps:['Meta Ads Manager',' Canva']};

test('an unknown tool or arguments that do not read are ignored, and nothing is asked of the Engine or the database',async()=>{
 const {fake,rpcs,call}=harness();
 for(const [name,args] of /** @type {[string,unknown][]} */([['delete_company',asked],['create_agent',null],['create_agent',{...asked,name:'x'.repeat(101)}],['create_agent',{...asked,job:' '}],
  ['create_agent',{...asked,apps:Array(9).fill('Canva')}],['create_agent',{...asked,apps:['x'.repeat(41)]}],['create_agent',{...asked,apps:[7]}],['create_agent',{...asked,name:'Meta\u0000Ads'}],['create_agent',{...asked,apps:['Can\u0000va']}],['create_agent',{name:'Meta Ads',job:'Runs ads.'}],
  ['create_agent',{template:'astrologer'}],['create_agent',{...asked,template:'toString'}],['create_agent',{template:7}],['create_agent',{template:'writer',name:'x'.repeat(101)}],['create_agent',{template:'writer',apps:['x'.repeat(41)]}]]))
  assert.deepEqual(await call(name,args),{state:'ignored'},`${name} ${JSON.stringify(args)?.slice(0,60)}`);
 assert.deepEqual([fake.agentReads,rpcs],[[],[]]);
});

test('create_agent makes nothing while the Engine lacks the Company\'s profile, then asks the database once it is ready',async()=>{
 const {fake,engine,rpcs,call}=harness();
 const read=['lead_agent_profile',{conversation:'conversation-1',run:'run-1',call:'call-0',instructions:null}];
 assert.deepEqual(await call('create_agent',asked),{state:'engineNotReady'});
 assert.deepEqual([fake.agentReads,rpcs],[[profile],[read]]);
 await engine.createAgent({name:profile,instructions:''});
 assert.deepEqual(await call('create_agent',asked),{state:'created',agent:'agent-1'});
 assert.deepEqual(rpcs,[read,read,
  ['lead_create_agent',{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:'Meta Ads',job:'Runs the Meta ads.',apps:['Meta Ads Manager','Canva']}]]);
 assert.deepEqual(await call('create_agent',{name:'x'.repeat(100),job:'Writes.',apps:Array(8).fill('y'.repeat(40))}),{state:'created',agent:'agent-1'});
 assert.deepEqual(await call('create_agent',{...asked,apps:[]}),{state:'created',agent:'agent-1'});
});

test('create_agent makes nothing in the database while the Engine does not answer, so the run stays open for a retry',async()=>{
 const {rpcs,call}=harness({readAgent:async()=>({state:'unreachable',agent:null})});
 assert.deepEqual(await call('create_agent',asked),{state:'engineUnreachable'});
 assert.deepEqual(rpcs.map(([name])=>name),['lead_agent_profile']);
});

test('a call that already made its Agent answers that Agent without asking the Engine, even one that does not answer',async()=>{
 const {fake,rpcs,call}=harness({readAgent:async()=>({state:'unreachable',agent:null})},{state:'refused'},{state:'created',agent:'agent-1'});
 assert.deepEqual(await call('create_agent',{template:'writer'}),{state:'created',agent:'agent-1'});
 assert.deepEqual([fake.agentReads,fake.provided,fake.removed,rpcs.map(([name])=>name)],[[],[],[],['lead_agent_profile']]);
});

test('create_agent starts from a ready-made role: its name, job and apps unless others are given, and its instructions and limits for the database to fit',async()=>{
 const {engine,rpcs,call}=harness();
 await engine.createAgent({name:profile,instructions:''});
 for(const [id,role] of Object.entries(roleTemplates)) {
  assert.deepEqual(await call('create_agent',{template:id}),{state:'created',agent:'agent-1'},id);
  assert.deepEqual(rpcs.at(-1),['lead_create_agent',{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:role.name,job:role.job,apps:roleAppNames(/** @type {keyof typeof roleTemplates} */(id)),template:id,instructions:instructionsOf(/** @type {keyof typeof roleTemplates} */(id))}],id);
  const {instructions}=/** @type {{instructions:string}} */(rpcs.at(-1)?.[1]);
  assert.ok(instructions.startsWith(role.instructions)&&instructions.includes('{company}')&&role.limits.every(limit=>instructions.includes(limit)),id);
 }
 assert.deepEqual(await call('create_agent',{template:'writer',name:' Penny ',apps:['WordPress'],job:null}),{state:'created',agent:'agent-1'});
 assert.deepEqual(rpcs.at(-1)?.[1],{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:'Penny',job:roleTemplates.writer.job,apps:['WordPress'],template:'writer',instructions:instructionsOf('writer')});
});

const own={profile:'ag-a0000000000000000000000000000001',soul:'You write for RS Learning.'};
const writerCall={conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:roleTemplates.writer.name,job:roleTemplates.writer.job,apps:roleAppNames('writer'),template:'writer',instructions:instructionsOf('writer')};
/** @param {ReturnType<typeof harness>['engine']} engine */
const leadReady=engine=>engine.createAgent({name:profile,instructions:''});

test('create_agent makes the Agent its own profile, and the database attaches it there only when the Engine provided it',async()=>{
 const {fake,engine,rpcs,call}=harness({},{state:'created',agent:'agent-1'},own);
 await leadReady(engine); fake.settings.agentProfile='provided';
 assert.deepEqual(await call('create_agent',{template:'writer'}),{state:'created',agent:'agent-1'});
 assert.deepEqual(fake.provided,[{name:own.profile,instructions:own.soul}]);
 assert.deepEqual(rpcs,[['lead_agent_profile',{conversation:'conversation-1',run:'run-1',call:'call-0',instructions:instructionsOf('writer')}],
  ['lead_create_agent',{...writerCall,own_profile:true}]]);
 assert.deepEqual(fake.removed,[]);
});

test('a profile the Engine could not provide (forbidden, failed, refused) is not sent as the Agent\'s own, so the database decides where the Agent goes, and the profile stays in the Engine',async()=>{
 for(const state of /** @type {const} */(['forbidden','failed','refused'])) {
  const {fake,engine,rpcs,call}=harness({},{state:'created',agent:'agent-1'},own);
  await leadReady(engine); fake.settings.agentProfile=state;
  assert.deepEqual(await call('create_agent',{template:'writer'}),{state:'created',agent:'agent-1'},state);
  assert.deepEqual(rpcs.at(-1),['lead_create_agent',writerCall],state);
  assert.deepEqual(fake.removed,[],state);
 }
});

test('a profile made with no model to answer with asks the database to make the Agent there and wait for its key, and stays in the Engine',async()=>{
 const {fake,engine,rpcs,call}=harness({},{state:'created',agent:'agent-1'},own);
 await leadReady(engine); fake.settings.agentProfile='noModel';
 assert.deepEqual(await call('create_agent',{template:'writer'}),{state:'created',agent:'agent-1'});
 assert.deepEqual(rpcs.at(-1),['lead_create_agent',{...writerCall,own_profile:true,own_answers:false}]);
 assert.deepEqual(fake.removed,[]);
});

test('a profile made for a call the database then refuses is removed again, and only then',async()=>{
 for(const answer of [{state:'refused'},{state:'invalid'}]) for(const state of /** @type {const} */(['provided','noModel'])) {
  const {fake,engine,call}=harness({},answer,own);
  await leadReady(engine); fake.settings.agentProfile=state;
  assert.deepEqual(await call('create_agent',{template:'writer'}),answer);
  assert.deepEqual(fake.removed,[own.profile],`${answer.state} ${state}`);
 }
});

test('create_agent asks the database nothing more while the Engine does not answer the profile\'s making, so the run stays open',async()=>{
 const {fake,engine,rpcs,call}=harness({},{state:'created',agent:'agent-1'},own);
 await leadReady(engine); fake.settings.agentProfile='unreachable';
 assert.deepEqual(await call('create_agent',{template:'writer'}),{state:'engineUnreachable'});
 assert.deepEqual(rpcs.map(([name])=>name),['lead_agent_profile']);
 assert.deepEqual(fake.removed,[]);
});

test('a call that the database will refuse asks the Engine to make nothing',async()=>{
 const {fake,engine,rpcs,call}=harness({},{state:'refused'});
 await leadReady(engine); fake.settings.agentProfile='provided';
 assert.deepEqual(await call('create_agent',asked),{state:'refused'});
 assert.deepEqual([fake.provided,fake.removed],[[],[]]);
 assert.deepEqual(rpcs.map(([name])=>name),['lead_agent_profile','lead_create_agent']);
});

// A set the Engine never answered, past its window, that the database still counts as a held key (lead_key_settle, #299).
const unsettled={company:'10000000-0000-0000-0000-000000000001',space:'cs-10000000000000000000000000000001',seen:4};
const metaCall=['lead_create_agent',{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:'Meta Ads',job:'Runs the Meta ads.',apps:['Meta Ads Manager','Canva']}];

test('a set the Engine never answered is settled from the space before the Agent is made, naming only the providers held whose name reads',async()=>{
 const spaces=/** @type {string[]} */([]);
 const readKeys=async(/** @type {string} */ space)=>{ spaces.push(space); return {state:'found',keys:[{provider:'openrouter',label:'OpenRouter',set:true},{provider:'deepseek',label:'DeepSeek',set:false},{provider:'Not a provider',label:'Odd',set:true}]}; };
 const {engine,rpcs,call}=harness({readKeys},{state:'created',agent:'agent-1'},null,{lead_key_settle:unsettled});
 await leadReady(engine);
 assert.deepEqual(await call('create_agent',asked),{state:'created',agent:'agent-1'});
 assert.deepEqual(spaces,[unsettled.space],'the Engine is asked for the space the database named');
 assert.deepEqual(rpcs.slice(1),[['lead_key_settle',{conversation:'conversation-1'}],['settle_provider_key_holds',{c:unsettled.company,held:['openrouter'],seen:4}],metaCall],'the settle names the version the read was taken at');
});

test('a space the Engine could not read, or nothing to settle, settles nothing, and the Agent is still asked for, so the database keeps it waiting',async()=>{
 let reads=0;
 for(const [label,readKeys,settle] of /** @type {[string,()=>Promise<unknown>,unknown][]} */([['unreachable',async()=>({state:'unreachable',keys:null}),unsettled],
  ['thrown',async()=>{ throw new Error('down'); },unsettled],['nothing to settle',async()=>{ reads++; return {state:'found',keys:[]}; },null],['an odd answer',async()=>{ reads++; return {state:'found',keys:[]}; },{company:7,space:unsettled.space,seen:4}],
  ['no version to settle against',async()=>{ reads++; return {state:'found',keys:[]}; },{company:unsettled.company,space:unsettled.space}]])) {
  const {engine,rpcs,call}=harness({readKeys},{state:'created',agent:'agent-1'},null,{lead_key_settle:settle});
  await leadReady(engine);
  assert.deepEqual(await call('create_agent',asked),{state:'created',agent:'agent-1'},label);
  assert.deepEqual(rpcs.slice(1),[['lead_key_settle',{conversation:'conversation-1'}],metaCall],label);
 }
 assert.equal(reads,0,'the Engine is asked only for a space the database named');
});

test('an Agent asked for in words, with no role, gets the Company profile\'s soul',async()=>{
 const {fake,engine,call}=harness({},{state:'created',agent:'agent-1'},{...own,soul:null});
 await leadReady(engine); fake.settings.agentProfile='provided';
 await call('create_agent',asked);
 assert.match(fake.provided[0].instructions,/^You are a marketing agent working for one company in gtmworks\./);
});

test('a save_rule call whose rule does not read is ignored, and nothing is asked of the database',async()=>{
 const {fake,rpcs,call}=harness();
 for(const args of /** @type {unknown[]} */([null,{},{rule:'  '},{rule:7},{rule:'x'.repeat(501)},{rule:'من دلوقتي\u0000'}]))
  assert.deepEqual(await call('save_rule',args),{state:'ignored'},JSON.stringify(args)?.slice(0,60));
 assert.deepEqual([fake.agentReads,rpcs],[[],[]]);
});

test('save_rule asks the database with the trimmed rule, whatever the Engine\'s profile, and answers what it saved',async()=>{
 const {fake,rpcs,call}=harness({},{state:'saved',rule:'rule-1'});
 assert.deepEqual(await call('save_rule',{rule:' من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها\n'}),{state:'saved',rule:'rule-1'});
 assert.deepEqual(rpcs,[['agent_save_rule',{conversation:'conversation-1',run:'run-1',call:'call-0',rule:'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها'}]]);
 assert.deepEqual(fake.agentReads,[]);
 await call('save_rule',{rule:'y'.repeat(500)});
 assert.equal(rpcs.length,2);
});

test('suggest_rule reads its rule as save_rule does, asks the database the same, and answers the suggestion it kept',async()=>{
 const {fake,rpcs,call}=harness({},{state:'suggested',rule:'rule-2'});
 for(const args of /** @type {unknown[]} */([null,{},{rule:'  '},{rule:'x'.repeat(501)}])) assert.deepEqual(await call('suggest_rule',args),{state:'ignored'},JSON.stringify(args)?.slice(0,60));
 assert.deepEqual(await call('suggest_rule',{rule:' From now on, no emojis\n'}),{state:'suggested',rule:'rule-2'});
 assert.deepEqual(rpcs,[['agent_save_rule',{conversation:'conversation-1',run:'run-1',call:'call-0',rule:'From now on, no emojis'}]]);
 assert.deepEqual(fake.agentReads,[]);
 const specs=toolSpecTexts();
 assert.deepEqual(JSON.parse(specs.suggest_rule).parameters,JSON.parse(specs.save_rule).parameters,'the model gives the same argument to either');
 assert.match(JSON.parse(specs.suggest_rule).description,/suggestion for the whole team/);
});

// The version a Contributor's new run is offered (review of #340): the rule waits for an OK before it reaches the Agent.
test('suggest_team_rule keeps a rule as suggest_rule does, and says it reaches the Agent only once approved',async()=>{
 const {rpcs,call}=harness({},{state:'suggested',rule:'rule-3'});
 assert.deepEqual(await call('suggest_team_rule',{rule:' From now on, no emojis\n'}),{state:'suggested',rule:'rule-3'});
 assert.deepEqual(rpcs,[['agent_save_rule',{conversation:'conversation-1',run:'run-1',call:'call-0',rule:'From now on, no emojis'}]]);
 const specs=toolSpecTexts();
 assert.deepEqual(JSON.parse(specs.suggest_team_rule).parameters,JSON.parse(specs.suggest_rule).parameters);
 const {description}=JSON.parse(specs.suggest_team_rule);
 assert.match(description,/suggestion for the whole team/);
 assert.match(description,/once one of them approves it/);
 assert.doesNotMatch(description,/at once/,'it never says the rule reaches the teller before it is approved');
});

test('request_agent reads its arguments as create_agent does, and asks the database to keep the request without asking the Engine',async()=>{
 const {fake,rpcs,call}=harness({},{state:'requested',request:7});
 for(const args of /** @type {unknown[]} */([null,{...asked,name:'x'.repeat(101)},{...asked,apps:Array(9).fill('Canva')},{name:'Meta Ads',job:'Runs ads.'},{template:'astrologer'}]))
  assert.deepEqual(await call('request_agent',args),{state:'ignored'},JSON.stringify(args)?.slice(0,60));
 assert.deepEqual(await call('request_agent',asked),{state:'requested',request:7});
 assert.deepEqual(await call('request_agent',{template:'writer',name:' Penny '}),{state:'requested',request:7});
 assert.deepEqual(rpcs,[['lead_request_agent',{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:'Meta Ads',job:'Runs the Meta ads.',apps:['Meta Ads Manager','Canva']}],
  ['lead_request_agent',{conversation:'conversation-1',run:'run-1',call:'call-0',agent_name:'Penny',job:roleTemplates.writer.job,apps:roleAppNames('writer'),template:'writer',instructions:instructionsOf('writer')}]]);
 assert.deepEqual(fake.agentReads,[],'the Engine is not asked: nothing is made');
 const specs=toolSpecTexts();
 assert.deepEqual(JSON.parse(specs.request_agent).parameters,JSON.parse(specs.create_agent).parameters,'the model gives the same arguments to either');
 assert.match(JSON.parse(specs.request_agent).description,/Nothing is made until the Owner says yes/);
});

// #136: the database alone judges a draft (reply_card_valid), so what reaches it is the model's words, trimmed, and never
// a NUL or a lone surrogate, which the database cannot store; a whole emoji is kept.
test('show_draft asks the database to show the draft as the model wrote it, trimmed and without NUL or a lone surrogate, and the Engine is not asked',async()=>{
 const {fake,rpcs,call}=harness({},{state:'shown',card:42});
 for(const args of /** @type {unknown[]} */([null,'Campaign plan',{title:'Plan',line:'Draft',rows:'Goal'}])) assert.deepEqual(await call('show_draft',args),{state:'ignored'},JSON.stringify(args));
 assert.deepEqual(await call('show_draft',{title:' خطة الحملة ',line:'مسودة · Meta Ads\n',rows:[{label:' الهدف',value:'ليدز على واتساب '}]}),{state:'shown',card:42});
 await call('show_draft',{title:'Plan\u0000',line:'Draft',rows:[{label:'Goal'},'Budget',{label:'Bud\u0000get',value:7}]});
 await call('show_draft',{line:'Draft'});
 await call('show_draft',{title:'Plan \ud83d',line:'Draft 🚀',rows:[{label:'Goal',value:'\ude80 leads'}]});
 const sent=(/** @type {string|null} */ title,/** @type {object} */ content)=>['agent_show_card',{conversation:'conversation-1',run:'run-1',call:'call-0',kind:'draft',title,content}];
 assert.deepEqual(rpcs,[sent('خطة الحملة',{line:'مسودة · Meta Ads',rows:[{label:'الهدف',value:'ليدز على واتساب'}]}),
  sent(null,{line:'Draft',rows:[{label:'Goal',value:null},{label:null,value:null},{label:null,value:null}]}),sent(null,{line:'Draft',rows:[]}),
  sent(null,{line:'Draft 🚀',rows:[{label:'Goal',value:null}]})]);
 assert.deepEqual(fake.agentReads,[]);
});

// #137: as show_draft's, and a verdict reaches the database only as the model's true or false; a review with no texts or no
// decision still goes to the database, which alone refuses it.
test('show_review asks the database to show the review as the model wrote it, trimmed, with each verdict only when it is true or false, and the Engine is not asked',async()=>{
 const {fake,rpcs,call}=harness({},{state:'shown',card:43});
 for(const args of /** @type {unknown[]} */([null,'Review'])) assert.deepEqual(await call('show_review',args),{state:'ignored'},JSON.stringify(args));
 assert.deepEqual(await call('show_review',{title:' مراجعة نصوص إعلانات ديسمبر ',line:'3 نصوص · Meta Ads\n',items:[{text:' أضمن طريق لأول وظيفة محاسبة',fine:false,note:'«أضمن» وعد مقدرش نثبته. '}],decision:' 2 جاهزين'}),{state:'shown',card:43});
 await call('show_review',{title:'Review',line:'Texts',items:[{text:'Hook',fine:'true',note:'Fine'},{text:'Hook\u0000',fine:1,note:7},'Hook',{text:'Hook',fine:true,note:'Fine \ud83d'}],decision:'Done'});
 await call('show_review',{title:'Review',line:'Texts',items:'Hook',decision:'Done'});
 await call('show_review',{title:'Review',line:'Texts',items:[{text:'Hook',fine:true,note:'Fine'}]});
 const sent=(/** @type {string|null} */ title,/** @type {object} */ content)=>['agent_show_card',{conversation:'conversation-1',run:'run-1',call:'call-0',kind:'review',title,content}];
 assert.deepEqual(rpcs,[sent('مراجعة نصوص إعلانات ديسمبر',{line:'3 نصوص · Meta Ads',items:[{text:'أضمن طريق لأول وظيفة محاسبة',fine:false,note:'«أضمن» وعد مقدرش نثبته.'}],decision:'2 جاهزين'}),
  sent('Review',{line:'Texts',items:[{text:'Hook',fine:null,note:'Fine'},{text:null,fine:null,note:null},{text:null,fine:null,note:null},{text:'Hook',fine:true,note:null}],decision:'Done'}),
  sent('Review',{line:'Texts',items:null,decision:'Done'}),sent('Review',{line:'Texts',items:[{text:'Hook',fine:true,note:'Fine'}],decision:null})]);
 assert.deepEqual(fake.agentReads,[]);
});

// #139: as show_draft's, and an address or a note left out (null, or blank as models often send it) stays out, and a note that cannot be kept (not a string, or holding NUL) is dropped and one over its limit cut, so the step still reaches its person of the card, while one given goes to the
// database as read, so an address that is not https, or not a string, is refused there rather than dropped.
test('hand_over asks the database to show the handed step as the model wrote it, trimmed, with an address or note only when given (a blank one is not given), a note that cannot be kept dropped or cut, and the Engine is not asked',async()=>{
 const {fake,rpcs,call}=harness({},{state:'shown',card:44});
 for(const args of /** @type {unknown[]} */([null,'Publish',{title:'Publish',line:'Ready',app:'WordPress',rows:'Title'}])) assert.deepEqual(await call('hand_over',args),{state:'ignored'},JSON.stringify(args));
 assert.deepEqual(await call('hand_over',{title:' انشر المقال ',line:'المسودة جاهزة\n',app:' WordPress',rows:[{label:' العنوان',value:'إزاي تبدأ في المحاسبة '}],url:' https://rslearning.example/wp-admin/post.php?post=812 ',note:'هتابع ترتيبه. '}),{state:'shown',card:44});
 await call('hand_over',{title:'Pay',line:'Ready',app:'Stripe',url:null,note:null});
 await call('hand_over',{line:'Ready',app:'WordPress',url:'http://example.com/draft'});
 await call('hand_over',{title:'Publish',line:'Ready',app:'WordPress',url:7,note:'Done\u0000'});
 await call('hand_over',{title:'Send',line:'Ready',app:'Klaviyo',url:'',note:'  '});
 await call('hand_over',{title:'Pay',line:'Ready',app:'Stripe',note:'n'.repeat(250)});
 await call('hand_over',{title:'Pay',line:'Ready',app:'Stripe',note:5});
 const sent=(/** @type {string|null} */ title,/** @type {object} */ content)=>['agent_show_card',{conversation:'conversation-1',run:'run-1',call:'call-0',kind:'hand',title,content}];
 assert.deepEqual(rpcs,[sent('انشر المقال',{app:'WordPress',line:'المسودة جاهزة',rows:[{label:'العنوان',value:'إزاي تبدأ في المحاسبة'}],url:'https://rslearning.example/wp-admin/post.php?post=812',note:'هتابع ترتيبه.'}),
  sent('Pay',{app:'Stripe',line:'Ready',rows:[]}),sent(null,{app:'WordPress',line:'Ready',rows:[],url:'http://example.com/draft'}),
  sent('Publish',{app:'WordPress',line:'Ready',rows:[],url:null}),sent('Send',{app:'Klaviyo',line:'Ready',rows:[]}),
  sent('Pay',{app:'Stripe',line:'Ready',rows:[],note:`${'n'.repeat(239)}…`}),sent('Pay',{app:'Stripe',line:'Ready',rows:[]})]);
 assert.deepEqual(fake.agentReads,[]);
 assert.match(JSON.parse(toolSpecTexts().hand_over).description,/may not do yourself.*Done it.*approves, publishes and spends nothing/s);
});

// #203: an Agent asks its person for an app on gtmworks's list that its own profile does not have connected. The Engine is
// asked for the Run's profile's apps, and only a listed app that is not connected there reaches the database; an unknown
// app, or one already connected, shows nothing, and an Engine that does not answer leaves the run open for a retry.
test('ask_for_app shows a card only for a listed app not connected in the Run\'s profile, with the reason trimmed, and leaves the run open while the Engine does not answer',async()=>{
 const {fake,rpcs,call}=harness({},{state:'shown',card:45});
 fake.settings.apps={notion:'connected',canva:'off',klaviyo:'attention'};
 for(const args of /** @type {unknown[]} */([null,'canva',{app:'ga4',reason:'Needed for sales'},{app:'toString',reason:'x'},{app:'canva'},{app:'canva',reason:7},{app:'canva',reason:'x'.repeat(201)},{app:'canva',reason:'Need\u0000it'}]))
  assert.deepEqual(await call('ask_for_app',args),{state:'ignored'},JSON.stringify(args));
 assert.deepEqual(rpcs,[],'nothing is asked of the database for an app off the list or a reason that cannot be kept');
 assert.deepEqual(await call('ask_for_app',{app:'notion',reason:'To read the briefs'}),{state:'ignored'},'one already connected for this Agent');
 assert.deepEqual(await call('ask_for_app',{app:'canva',reason:' محتاجه عشان أجيب التصميمات. '}),{state:'shown',card:45});
 await call('ask_for_app',{app:'klaviyo',reason:'The sign-in stopped working.'});
 fake.settings.apps={};
 assert.deepEqual(await call('ask_for_app',{app:'canva',reason:'x'}),{state:'ignored'},'an app the Engine does not offer this profile');
 fake.settings.apps='unreachable';
 assert.deepEqual(await call('ask_for_app',{app:'canva',reason:'x'}),{state:'engineUnreachable'});
 fake.settings.apps='refused';
 assert.deepEqual(await call('ask_for_app',{app:'canva',reason:'x'}),{state:'ignored'},'an Engine with no apps of its own for this profile');
 const sent=(/** @type {string} */ title,/** @type {object} */ content)=>['agent_show_card',{conversation:'conversation-1',run:'run-1',call:'call-0',kind:'connect',title,content}];
 assert.deepEqual(rpcs,[sent('Canva',{app:'canva',reason:'محتاجه عشان أجيب التصميمات.'}),sent('Klaviyo',{app:'klaviyo',reason:'The sign-in stopped working.'})]);
 assert.equal(fake.appReads.count,6,'the Engine is asked only once a call reads');
 const spec=JSON.parse(toolSpecTexts().ask_for_app);
 assert.deepEqual(spec.parameters.properties.app.enum,['klaviyo','canva','notion','airtable','gamma','amplitude','mixpanel']);
 assert.equal(spec.parameters.properties.reason.maxLength,200);
 assert.match(spec.description,/connects it.*approves, publishes and spends nothing/s);
});

test('an Engine is ready for a new Agent only when it has the Company\'s profile ready',async()=>{
 const {fake,engine}=harness();
 assert.equal(await engineReady(engine,profile),'engineNotReady');
 await engine.createAgent({name:profile,instructions:''});
 assert.equal(await engineReady(engine,profile),'ready');
 assert.equal(await engineReady({...engine,readAgent:async()=>({state:'unreachable',agent:null})},profile),'engineUnreachable');
 assert.deepEqual(fake.agentReads,[profile,profile]);
});

// A run pinned before this version resends its pinned text, and Hermes refuses another body under the same key.
test('the tool texts a run may already be pinned with stay byte for byte as they were',()=>{
 const sha=(/** @type {string} */ value)=>createHash('sha256').update(value).digest('hex');
 const specs=toolSpecTexts();
 assert.deepEqual({create_agent:sha(specs.create_agent),save_rule:sha(specs.save_rule),suggest_rule:sha(specs.suggest_rule)},{
  create_agent:'606a3225225a5d5ea500d40b6a9912c41a9df3452ce86e7ee820fc028e921676',
  save_rule:'57d671d0e25a566996b232a7502f7b5701de124fde7d637072b73d0148797093',
  suggest_rule:'b968872c1d39b12cceba952c080a66432d778dba12b77f1e155c032495a3ac2c',
 });
 assert.equal(sha(specs.show_draft),'14f3e489f8903145db328693857952e95f34678a9071a2b50a48f1180ff4754c','show_draft (#136)');
 assert.equal(sha(specs.show_review),'5370ac820042bd31ca7cb07dc9a1b7e7002a9e43427ed9ebb33fd6fd926dc9e1','show_review (#137)');
 assert.equal(sha(specs.hand_over),'ac501c0e535a035daad42a48657f74cd84e53800e73c720db040b2d3adb8518d','hand_over (#139)');
});

// #148: a channel Run's card calls are kept against its channel message, not a Conversation, so the channel reads them
// under the Agent's reply.
test('a channel Run\'s draft and review calls are shown to the database for its message, and the Engine is not asked',async()=>{
 const fake=fakeEngine(); const rpcs=/** @type {[string,object][]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {object} */ args)=>{ rpcs.push([name,args]); return {data:{state:'shown',card:12},error:null}; }};
 const call=(/** @type {string} */ name,/** @type {unknown} */ args,/** @type {string} */ id='call_1')=>runToolCall({db,engine:fake.engineFor({}),profile:'profile-a',channel:{message:17},run:'char:17'},
  {id,name,arguments:args});
 assert.deepEqual(await call('show_draft',{title:'Plan',line:'Draft · Meta Ads',rows:[{label:'Goal',value:'Leads'}]}),{state:'shown',card:12});
 assert.deepEqual(await call('show_review',{title:'Review',line:'3 texts',items:[{text:'A',fine:true,note:'Fine'}],decision:'Ready'},'call_2'),{state:'shown',card:12});
 assert.deepEqual(rpcs,[
  ['channel_show_card',{message:17,run:'char:17',call:'call_1',kind:'draft',title:'Plan',content:{line:'Draft · Meta Ads',rows:[{label:'Goal',value:'Leads'}]}}],
  ['channel_show_card',{message:17,run:'char:17',call:'call_2',kind:'review',title:'Review',content:{line:'3 texts',items:[{text:'A',fine:true,note:'Fine'}],decision:'Ready'}}],
 ]);
 assert.deepEqual(fake.agentReads,[]);
});
