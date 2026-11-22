import test from 'node:test';
import assert from 'node:assert/strict';
import { readProviderOrder, orderProviders, switchProvider, forgetProviderOrder, inOrder } from '../lib/provider-order.mjs';

// #619: the Owner orders the Company's Providers and switches one off and on; the module checks the input and passes
// the database's own refusal on as a code, never as its text. supabase/tests/provider_order.sql proves the Owner check,
// the reads and the isolation in Postgres.
const company='10000000-0000-0000-0000-000000000001';
function db({error=null,rows=[],data=null}={}) {
 const asked=[];
 return {asked,rpc:async(name,args)=>{ asked.push({name,args}); return {data,error}; },
  from:table=>({select:()=>({eq:async(column,value)=>{ asked.push({table,column,value}); return {data:rows,error:null}; }})})};
}

test('an order is the whole list, first to last, sent to order_providers', async () => {
 const person=db();
 const entries=[{provider:'openai-codex',account:'c0dex2'},{provider:'anthropic',account:'key'},{provider:'openai-codex',account:'c0dex1'}];
 assert.deepEqual(await orderProviders(person,{company,entries}),{status:200,body:{ordered:3}});
 assert.deepEqual(person.asked,[{name:'order_providers',args:{c:company,entries}}]);
});

test('an order naming one Provider twice, an id that is not the Engine\'s, or nothing is refused before the database', async () => {
 const person=db();
 for(const entries of [[],'x',[{provider:'anthropic',account:'key'},{provider:'anthropic',account:'key'}],[{provider:'anthropic',account:'86 c091'}],
  [{provider:'Open AI',account:'key'}],[{provider:'anthropic'}],Array.from({length:65},(_,at)=>({provider:'anthropic',account:`a${at}`}))])
  assert.deepEqual(await orderProviders(person,{company,entries}),{status:400,body:{error:'providerOrderInvalid'}});
 for(const change of [{provider:'anthropic',account:'key',enabled:'no'},{provider:'anthropic',account:'',enabled:false}])
  assert.deepEqual(await switchProvider(person,{company,...change}),{status:400,body:{error:'providerOrderInvalid'}});
 assert.deepEqual(person.asked,[]);
});

test('a switch is sent to switch_provider and answered as the database kept it', async () => {
 const person=db({data:false});
 assert.deepEqual(await switchProvider(person,{company,provider:'openai-codex',account:'c0dex1',enabled:false}),{status:200,body:{enabled:false}});
 assert.deepEqual(person.asked,[{name:'switch_provider',args:{c:company,provider:'openai-codex',account:'c0dex1',turned_on:false}}]);
});

test('the database\'s refusal is a code: a person who is not the Owner changes nothing', async () => {
 const refused=db({error:{code:'42501',message:'providerNotAllowed'}});
 assert.deepEqual(await switchProvider(refused,{company,provider:'anthropic',account:'key',enabled:false}),{status:403,body:{error:'providerNotAllowed'}});
 assert.deepEqual(await orderProviders(refused,{company,entries:[{provider:'anthropic',account:'key'}]}),{status:403,body:{error:'providerNotAllowed'}});
 assert.deepEqual(await switchProvider(db({error:{code:'XX000',message:'secret detail'}}),{company,provider:'anthropic',account:'key',enabled:true}),{status:502,body:{error:'providerOrderFailed'}});
});

test('the order reads by Provider; an unread one is null, never every Provider on', async () => {
 const person=db({rows:[{provider:'openai-codex',account:'c0dex2',place:0,enabled:true},{provider:'anthropic',account:'key',place:null,enabled:false}]});
 assert.deepEqual(await readProviderOrder(person,company),{'openai-codex:c0dex2':{place:0,enabled:true},'anthropic:key':{place:null,enabled:false}});
 assert.deepEqual(person.asked,[{table:'provider_order',column:'company_id',value:company}]);
 const broken={from:()=>({select:()=>({eq:async()=>({data:null,error:{message:'down'}})})})};
 assert.equal(await readProviderOrder(broken,company),null);
});

test('placed Providers come first in their places, the rest after in the Engine\'s order', () => {
 const entries=[{provider:'openai-codex',account:'c0dex1'},{provider:'openai-codex',account:'c0dex2'},{provider:'anthropic',account:'c1aude'},
  {provider:'anthropic',account:null},{provider:'openrouter',account:'key'}];
 const order={'openrouter:key':{place:0,enabled:true},'openai-codex:c0dex2':{place:1,enabled:false},'anthropic:c1aude':{place:null,enabled:false}};
 assert.deepEqual(inOrder(entries,order).map(entry=>`${entry.provider}:${entry.account}`),
  ['openrouter:key','openai-codex:c0dex2','openai-codex:c0dex1','anthropic:c1aude','anthropic:null']);
 assert.deepEqual(inOrder(entries,{}),entries);
});

test('a removed Provider\'s place and switch are forgotten; a failed forget is answered, not thrown', async () => {
 const person=db();
 assert.equal(await forgetProviderOrder(person,{company,provider:'anthropic',account:'key'}),true);
 assert.deepEqual(person.asked,[{name:'forget_provider_order',args:{c:company,provider:'anthropic',account:'key'}}]);
 assert.equal(await forgetProviderOrder(db({error:{code:'XX000'}}),{company,provider:'anthropic',account:'key'}),false);
});
