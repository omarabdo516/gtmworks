import { expect, test } from 'vitest';
import { approvalQueue } from '@/lib/approval-queue';

// waiting_list puts approval Card ids and waiting item ids in one list, so an approval and a mention can share an id.
// Each item takes only what belongs to its own kind.
function fakeDb(listed:unknown[]) {
 const table=(name:string)=>{ const rows=name==='approval_steps'?[]:name==='work_cards'?[{id:7,title:'Launch post'}]
  :[{id:7,note_id:41,work_comments:{body:'Note as it now stands'}}];
  const query:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>resolve({data:rows,error:null})};
  for(const method of ['select','eq','is','order','in']) query[method]=()=>query;
  return query; };
 return {from:table,rpc:async()=>({data:listed,error:null})} as unknown as Parameters<typeof approvalQueue>[0];
}

test('an approval that shares its id with a mention keeps its own step, and the mention gets its note',async()=>{
 const listed=[
  {kind:'approval',id:7,title:'Launch post',body:'Owner review',asked_by:'',card_id:7,conversation_id:null,created_at:'2026-06-01T00:00:00Z'},
  {kind:'mention',id:7,title:'Launch post',body:'Note as first written',asked_by:'مدير',card_id:7,conversation_id:null,created_at:'2026-06-01T00:00:00Z'},
 ];
 const {items}=await approvalQueue(fakeDb(listed),'company','person','manager');
 expect(items.map(item=>({kind:item.kind,body:item.body,note_id:item.note_id}))).toEqual([
  {kind:'approval',body:'Owner review',note_id:undefined},
  {kind:'mention',body:'Note as it now stands',note_id:41},
 ]);
});
