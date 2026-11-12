import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemberPicker } from '../lib/work-activity';
import { signIn } from './sign-in';

const company='10000000-0000-0000-0000-000000000001';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

for(const empty of ['Not specified',undefined]) test(`a removed MemberPicker default ${empty?'leaves the hidden input empty':'selects the first member'}`,()=>{
 const markup=renderToStaticMarkup(createElement(MemberPicker,{
  members:[{person_id:'first',people:{name:'First member'}}],name:'person',label:'Next actor',defaultValue:'removed',empty,
 }));
 expect(markup).toContain(`name="person" value="${empty?'':'first'}"`);
});

test('saving a card unchanged clears a next actor who was removed from the company',async({page})=>{
 const person=randomUUID(); let card:number|undefined;
 try {
  query(`insert into auth.users(id) values ('${person}')`);
  query(`insert into public.people(id,name) values ('${person}','Removed next actor')`);
  query(`insert into public.members(company_id,person_id,role) values ('${company}','${person}','contributor')`);
  [card]=JSON.parse(query(`insert into public.work_cards(company_id,stage_id,title,next_actor)
   select '${company}',id,'Removed next actor regression','${person}' from public.work_stages where company_id='${company}' order by position limit 1 returning id`)).map((row:{id:number})=>row.id);
  query(`update public.members set removed_at=now() where company_id='${company}' and person_id='${person}'`);
  await signIn(page,'manager@example.com',`/c/rs-learning/work/board/${card}`);
  const actor=page.locator('[data-card-section="next-actor"]');
  await expect(actor.getByRole('button',{name:'Next actor',exact:true})).toHaveText('Not specified');
  await expect(actor.locator('input[name="person"]')).toHaveValue('');
  await actor.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(()=>JSON.parse(query(`select next_actor from public.work_cards where company_id='${company}' and id=${card}`))[0].next_actor).toBeNull();
  await page.reload();
  await expect(actor.locator('input[name="person"]')).toHaveValue('');
 } finally {
  // Cards and removed memberships retain their history under the audit triggers.
  if(card) query(`update public.work_cards set next_actor=null where company_id='${company}' and id=${card}`);
  query(`update public.members set removed_at=coalesce(removed_at,now()) where company_id='${company}' and person_id='${person}'`);
 }
});
