import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn } from './sign-in';

const company='10000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

// #677: a Card has one assignee. One whose Member leaves the Company is assigned to nobody, stays in its column and says
// why in its log; "Assign to me" makes it the reader's, and it is then on their list under the bell, in its own column.
test('a Card whose assignee leaves the Company has no assignee and stays in its column, logged; Assign to me puts it under the bell',async({page})=>{
 const person=randomUUID(); let card:number|undefined;
 try {
  query(`insert into auth.users(id) values ('${person}')`);
  query(`insert into public.people(id,name) values ('${person}','Removed assignee')`);
  query(`insert into public.members(company_id,person_id,role) values ('${company}','${person}','contributor')`);
  // A Card assigned to the Member.
  [card]=JSON.parse(query(`insert into public.work_cards(company_id,status,title,assignee_person)
   values ('${company}','planned','Removed assignee regression','${person}') returning id`)).map((row:{id:number})=>row.id);
  expect(JSON.parse(query(`select assignee_person from public.work_cards where id=${card}`))[0].assignee_person).toBe(person);
  query(`update public.members set removed_at=now() where company_id='${company}' and person_id='${person}'`);
  expect(JSON.parse(query(`select assignee_person,status from public.work_cards where id=${card}`))[0]).toEqual({assignee_person:null,status:'planned'});

  await signIn(page,'manager@example.com',`/c/rs-learning/work/board/${card}`);
  // The Card window's assignee menu (#678; design-reference-card: popHTML 'asg').
  const win=page.getByRole('dialog');
  const assignee=win.getByRole('button',{name:/^Assignee:/});
  await expect(assignee).toHaveAccessibleName('Assignee: No one yet');
  await win.getByRole('tab',{name:/^Activity \d+$/}).click();
  await expect(win.locator('#cw-list')).toContainText('left the card with no assignee: the Member left');

  await assignee.click();
  await win.getByRole('menuitem',{name:'Assign to me',exact:true}).click();
  await expect.poll(()=>JSON.parse(query(`select assignee_person,status from public.work_cards where id=${card}`))[0]).toEqual({assignee_person:manager,status:'planned'});
  await expect(assignee).toHaveAccessibleName(/^Assignee: مدير/);
  await assignee.click();
  await expect(win.getByRole('menuitem',{name:'Assign to me',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('/c/rs-learning/work/board');
  await expect(page.locator(`#board-cols [data-column="planned"] .kcard[data-card-id="${card}"]`)).toBeVisible();
  const bell=page.locator('.waiting-bell > button');
  const count=Number(await bell.locator('.num').textContent());
  await expect(bell).toHaveAccessibleName(`Waiting on you: ${count}`);
  const sidebar=page.locator('.sidebar .sb-count[href$="/approvals"]');
  if(await sidebar.isVisible()) await expect(sidebar).toHaveText(String(count));
  await bell.click();
  const mine=page.getByRole('menu').getByRole('group',{name:'Assigned to you',exact:true}).getByRole('menuitem').filter({hasText:'Removed assignee regression'});
  await expect(mine).toHaveText('Removed assignee regressionPlanned');
  await mine.click();
  await expect(page).toHaveURL(new RegExp(`/work/board\\?card=${card}$`));
 } finally {
  // Cards and removed memberships retain their history under the audit triggers.
  query(`update public.members set removed_at=coalesce(removed_at,now()) where company_id='${company}' and person_id='${person}'`);
 }
});
