import { expect, test } from 'vitest';
import { approvalQueue } from '@/lib/approval-queue';

// The old board is switched off (#846): waiting_list still names its approvals and the mentions in its Cards' notes, and
// neither is a row of Waiting on you; every other kind is, and none of the old board's tables is read for them.
function fakeDb(listed:unknown[],read:string[]) {
 const table=(name:string)=>{ read.push(name);
  const query:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>resolve({data:[],error:null})};
  for(const method of ['select','eq','is','order','in']) query[method]=()=>query;
  return query; };
 return {from:table,rpc:async()=>({data:listed,error:null})} as unknown as Parameters<typeof approvalQueue>[0];
}

test('the old board\'s approvals and note mentions are no rows of Waiting on you, and the other kinds are',async()=>{
 const listed=[
  {kind:'approval',id:7,title:'Launch post',body:'Owner review',asked_by:'',card_id:7,conversation_id:null,created_at:'2026-06-01T00:00:00Z'},
  {kind:'mention',id:7,title:'Launch post',body:'Note as first written',asked_by:'مدير',card_id:7,conversation_id:null,created_at:'2026-06-01T00:00:00Z'},
  {kind:'test_kind',id:8,title:'Another kind',body:'',asked_by:'',card_id:null,conversation_id:null,created_at:'2026-06-01T00:00:00Z'},
 ];
 const read:string[]=[];
 const {items,rows,available}=await approvalQueue(fakeDb(listed,read),'company','person','manager');
 expect(items.map(item=>({kind:item.kind,id:item.id}))).toEqual([{kind:'test_kind',id:8}]);
 expect(rows).toBe(1);
 expect(available).toBe(true);
 expect(read).toEqual([]);
});

// A permission item names its Conversation; that read is kept to the caller's Company, as the reads beside it are.
test('a permission item\'s Conversation is read within the caller\'s Company only',async()=>{
 const filters:string[][]=[];
 const db={rpc:async()=>({data:[{kind:'permission',id:3,title:'',body:'',asked_by:'',card_id:null,conversation_id:'c1',created_at:'2026-06-01T00:00:00Z'}],error:null}),
  from:(name:string)=>{ const seen:string[]=[]; if(name==='conversations') filters.push(seen);
   const query:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>resolve({data:[],error:null})};
   for(const method of ['select','is','order']) query[method]=()=>query;
   for(const method of ['eq','in']) query[method]=(column:string,value:unknown)=>{ seen.push(`${method} ${column} ${JSON.stringify(value)}`); return query; };
   return query; }} as unknown as Parameters<typeof approvalQueue>[0];
 await approvalQueue(db,'company-a','person','owner');
 expect(filters).toEqual([['eq company_id "company-a"','in id ["c1"]']]);
});

// #200: a mention in a channel is read from its message, which carries the channel it opens at, and the channel names
// itself: a team channel by its name, the general one by no name at all, so the reader draws its own word.
function mentionDb(channel:{id:string,kind:string,name:string|null}, seen?:string[]) {
 const listed=[{kind:'channel_mention',id:11,title:'general',body:'@Sara شوفوا ده',asked_by:'Omar',card_id:null,conversation_id:null,created_at:'2026-06-01T00:00:00Z'}];
 const from=(name:string)=>{
  const rows=name==='waiting_items'?[{id:11,channel_message_id:42}]:name==='channel_messages'?[{id:42,channel_id:'ch-1'}]:name==='channels'?[channel]:[];
  const query:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>resolve({data:rows,error:null})};
  for(const method of ['select','is','order','in']) query[method]=()=>query;
  query.eq=(column:string,value:unknown)=>{ if(seen&&name==='channels') seen.push(`${name}:${column}=${String(value)}`); return query; };
  return query; };
 return {from,rpc:async()=>({data:listed,error:null})} as unknown as Parameters<typeof approvalQueue>[0];
}

test('a mention in a channel opens that channel at the message it points at, named as the channel is',async()=>{
 const {items}=await approvalQueue(mentionDb({id:'ch-1',kind:'team',name:'Launch week'}),'company','person','contributor');
 expect(items.map(item=>({kind:item.kind,title:item.title,body:item.body,asked_by:item.asked_by,channel_id:item.channel_id,channel_message_id:item.channel_message_id})))
  .toEqual([{kind:'channel_mention',title:'Launch week',body:'@Sara شوفوا ده',asked_by:'Omar',channel_id:'ch-1',channel_message_id:42}]);
 const general=await approvalQueue(mentionDb({id:'ch-1',kind:'general',name:null}),'company','person','viewer');
 expect(general.items.map(item=>({title:item.title,channel_id:item.channel_id}))).toEqual([{title:'',channel_id:'ch-1'}]);
});

test('the channel a mention opens is read within the caller\'s Company only',async()=>{
 const seen:string[]=[];
 await approvalQueue(mentionDb({id:'ch-1',kind:'team',name:'Launch week'},seen),'company-a','person','owner');
 expect(seen).toEqual(['channels:company_id=company-a']);
});

// #354: a mention's own message or channel that could not be read leaves the queue unavailable, so its link never
// falls back to a board URL with no id.
test.each(['channel_messages','channels'])('a mention whose %s read failed leaves the queue unavailable',async(failed)=>{
 const listed=[{kind:'channel_mention',id:11,title:'general',body:'@Sara شوفوا ده',asked_by:'Omar',card_id:null,conversation_id:null,created_at:'2026-06-01T00:00:00Z'}];
 const rows=(name:string)=>name==='waiting_items'?[{id:11,channel_message_id:42}]:name==='channel_messages'?[{id:42,channel_id:'ch-1'}]:[{id:'ch-1',kind:'team',name:'Launch week'}];
 const from=(name:string)=>{
  const query:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>resolve(name===failed?{data:null,error:{message:`${name} down`}}:{data:rows(name),error:null})};
  for(const method of ['select','is','order','in','eq']) query[method]=()=>query;
  return query; };
 const {available}=await approvalQueue({from,rpc:async()=>({data:listed,error:null})} as unknown as Parameters<typeof approvalQueue>[0],'company','person','contributor');
 expect(available).toBe(false);
});

// #152/#149: a message that called two Agents keeps one question or handed step per Agent, at its Run's place. Each item's
// Agent is the one whose Run asked it, never the other Agent the same message called.
test('a channel card names the Agent whose Run asked it, not the other Agent the same message called',async()=>{
 const listed=[
  {kind:'channel_question',id:31,title:'Which angle?',body:'',asked_by:'Ads',card_id:31,conversation_id:null,created_at:'2026-06-01T00:00:00Z'},
  {kind:'channel_hand',id:32,title:'Publish the post',body:'',asked_by:'Lead',card_id:32,conversation_id:null,created_at:'2026-06-01T00:00:00Z'},
 ];
 const from=(name:string)=>{
  const rows=name==='reply_cards'?[
    {id:31,channel_message_id:7,channel_ordinal:1,channel_messages:{channel_id:'ch-1'}},
    {id:32,channel_message_id:7,channel_ordinal:2,channel_messages:{channel_id:'ch-1'}},
   ]:name==='channel_runs'?[
    {message_id:7,ordinal:1,agent_id:'a-1'},
    {message_id:7,ordinal:2,agent_id:'a-2'},
   ]:name==='hermes_agents'?[{id:'a-1',connection_id:'c-1',name:'Ads'},{id:'a-2',connection_id:'c-2',name:'Lead'}]:[];
  const query:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>resolve({data:rows,error:null})};
  for(const method of ['select','is','order','in','eq']) query[method]=()=>query;
  return query; };
 const {items}=await approvalQueue({from,rpc:async()=>({data:listed,error:null})} as unknown as Parameters<typeof approvalQueue>[0],'company','person','owner');
 expect(items.map(item=>({kind:item.kind,agent:item.agent?.name,channel_id:item.channel_id})))
  .toEqual([{kind:'channel_question',agent:'Ads',channel_id:'ch-1'},{kind:'channel_hand',agent:'Lead',channel_id:'ch-1'}]);
});
