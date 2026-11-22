import test from 'node:test';
import assert from 'node:assert/strict';
import { readProviderNames, renameProvider, forgetProviderName, nameKey } from '../lib/provider-names.mjs';

// #618: the Owner names each Provider; the module checks the input and passes the database's own refusal on as a code,
// never as its text. supabase/tests/provider_names.sql proves the Owner check, the reads and the isolation in Postgres.
const company='10000000-0000-0000-0000-000000000001';
function db({error=null,rows=[]}={}) {
 const asked=[];
 return {asked,rpc:async(name,args)=>{ asked.push({name,args}); return {data:null,error}; },
  from:table=>({select:()=>({eq:async(column,value)=>{ asked.push({table,column,value}); return {data:rows,error:null}; }})})};
}

test('a name is trimmed and sent to rename_provider; an empty one gives the kind\'s name back', async () => {
 const person=db();
 assert.deepEqual(await renameProvider(person,{company,provider:'openai-codex',account:'86c091',name:'  ChatGPT · Said '}),{status:200,body:{name:'ChatGPT · Said'}});
 assert.deepEqual(await renameProvider(person,{company,provider:'anthropic',account:'key',name:''}),{status:200,body:{name:null}});
 assert.deepEqual(person.asked,[{name:'rename_provider',args:{c:company,provider:'openai-codex',account:'86c091',name:'ChatGPT · Said'}},
  {name:'rename_provider',args:{c:company,provider:'anthropic',account:'key',name:''}}]);
});

test('a name past the limit, a control character or an id that is not the Engine\'s is refused before the database', async () => {
 const person=db();
 for(const change of [{provider:'openai-codex',account:'86c091',name:'a'.repeat(61)},{provider:'openai-codex',account:'86c091',name:'a\nb'},
  {provider:'openai-codex',account:'86 c091',name:'x'},{provider:'Open AI',account:'86c091',name:'x'},{provider:'openai-codex',account:'86c091',name:7}])
  assert.deepEqual(await renameProvider(person,{company,...change}),{status:400,body:{error:'providerNameInvalid'}});
 assert.deepEqual(person.asked,[]);
});

test('the database\'s refusal is a code: a person who is not the Owner changes nothing', async () => {
 assert.deepEqual(await renameProvider(db({error:{code:'42501',message:'providerNotAllowed'}}),{company,provider:'openai-codex',account:'86c091',name:'Mine'}),{status:403,body:{error:'providerNotAllowed'}});
 assert.deepEqual(await renameProvider(db({error:{code:'XX000',message:'secret detail'}}),{company,provider:'openai-codex',account:'86c091',name:'Mine'}),{status:502,body:{error:'providerNameFailed'}});
});

test('the names read by Provider; a removed account\'s name is forgotten', async () => {
 const person=db({rows:[{provider:'openai-codex',account:'86c091',name:'ChatGPT · Said'},{provider:'anthropic',account:'key',name:'Anthropic key'}]});
 assert.deepEqual(await readProviderNames(person,company),{[nameKey('openai-codex','86c091')]:'ChatGPT · Said','anthropic:key':'Anthropic key'});
 assert.deepEqual(person.asked,[{table:'provider_names',column:'company_id',value:company}]);
 await forgetProviderName(person,{company,provider:'openai-codex',account:'86c091'});
 assert.deepEqual(person.asked.at(-1),{name:'rename_provider',args:{c:company,provider:'openai-codex',account:'86c091',name:''}});
});
