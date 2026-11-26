import { test, expect, type Page } from './fresh-seed';
import { withEngineContract } from '../lib/engine/handle.mjs';
import './spec-engine-records';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { closeOpenRuns, sendMessage } from '../lib/conversation-runs.mjs';
import { driveHandovers } from '../lib/handovers.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { signIn } from './sign-in';

// #671: archiving a Card an Agent works on, or that waits on someone (design-reference-card: cwArchive, cwConfirm). One
// confirmation names each thing that stops; "Archive and stop" stops the Run through the stop that exists and clears the
// wait from the list, a Run closing afterwards leaves the Card archived, and Restore starts nothing. Runs go to the fake
// engine (tests/fake-engine.mjs), driven here as the worker drives them; the page's own reads cannot reach it.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>JSON.parse(query(sql)) as Record<string,unknown>[];
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const reviewer='20000000-0000-0000-0000-000000000003';
const board='/c/rs-learning/work/board';
const sheetOf=(page:Page)=>page.getByRole('dialog').filter({has:page.locator('#sheet-title')});
const confirmOf=(page:Page)=>page.getByRole('dialog',{name:/^Archive/});
const waitingCount=(page:Page)=>page.locator('.sidebar .sb-count[href$="/approvals"] .sb-count__n');
const count=async(page:Page)=>Number((await waitingCount(page).textContent({timeout:2000}).catch(()=>'0'))||'0');

async function memberClient(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}
async function archiveFromMenu(page:Page,id:number) {
 await page.goto(`${board}?card=${id}`);
 await sheetOf(page).getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('menuitem',{name:'Archive the card'}).click();
}

test('integration: a Card its Agent works on asks once, naming the Run and the question; Archive and stop stops the Run and clears the question, the Run closing after leaves it archived, and Restore starts nothing',async({page})=>{
 test.setTimeout(240000);
 const fake=fakeEngine();
 fake.settings.questions=input=>input.startsWith('Write the June post')?[{text:'Which offer first?'}]:[];
 const [connection,agent,conversation]=[randomUUID(),randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${agent}','${company}','${connection}','Faye','Marketing','fake-${connection.slice(0,8)}')`);
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 try {
  const {service,person}=await memberClient('reviewer@example.com');
  expect(await withEngineContract(fake.engineFor,()=>sendMessage(person,service,{person:reviewer,company,conversation,sendKey:randomUUID(),agent,message:'Write the June post'}))).toEqual({conversation});
  expect(await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}))).toBe(0);
  // The chat's Card, as its first reply would put it In progress.
  const [{id}]=rows(`insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id) select company_id,id,'Write the June post','${agent}','${conversation}' from public.work_stages where company_id='${company}' and board_column='progress' and kind='before_review' order by position,id limit 1 returning id`);
  const card=Number(id);
  await signIn(page,'reviewer@example.com',board);
  const before=await count(page);
  expect(before).toBeGreaterThan(0);

  // One confirmation names the Agent's Run and its question; Cancel archives nothing.
  await archiveFromMenu(page,card);
  const confirm=confirmOf(page);
  await expect(confirm.getByRole('heading')).toHaveText('Archive the card?');
  await expect(confirm.getByRole('listitem')).toHaveText(['Faye stops working on “Write the June post”','The question from Faye on “Write the June post” closes unanswered']);
  await confirm.getByRole('button',{name:'Cancel'}).click();
  await expect(confirm).toHaveCount(0);
  await expect(sheetOf(page).getByRole('region',{name:'Archived'})).toHaveCount(0);

  // Archive and stop: the Card leaves, and its question leaves the list.
  await sheetOf(page).getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('menuitem',{name:'Archive the card'}).click();
  await confirmOf(page).getByRole('button',{name:'Archive and stop'}).click();
  await expect(sheetOf(page).getByRole('region',{name:'Archived'})).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Archived');
  await page.goto(board);
  await expect(page.locator(`#board-cols .kcard[data-card-id="${card}"]`)).toHaveCount(0);
  await expect.poll(()=>count(page)).toBe(before-1);
  expect(rows(`select state from public.reply_cards where conversation_id='${conversation}' and kind='question'`)).toEqual([{state:'closed'}]);

  // The worker stops the Run in the Engine, then closes it as stopped: the Card stays archived and asks nothing.
  await withEngineContract(fake.engineFor,()=>driveHandovers(service,{}));
  expect(fake.runs.at(-1)!.stopped).toBe(true);
  expect(await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}))).toBe(1);
  expect(rows(`select archived_at is not null as archived from public.work_cards where id=${card}`)).toEqual([{archived:true}]);
  expect(rows(`select count(*)::int as open from public.reply_cards where conversation_id='${conversation}' and state='open'`)).toEqual([{open:0}]);

  // Restore starts nothing: no Run, and nobody waits again.
  const runs=fake.runs.length;
  await page.goto(`${board}?card=${card}`);
  await sheetOf(page).getByRole('region',{name:'Archived'}).getByRole('button',{name:'Restore'}).click();
  await expect(page.locator('.toast')).toContainText('Restored');
  await expect(sheetOf(page).getByRole('region',{name:'Archived'})).toHaveCount(0);
  await withEngineContract(fake.engineFor,()=>driveHandovers(service,{}));
  await withEngineContract(fake.engineFor,()=>closeOpenRuns(service,{conversation}));
  expect(fake.runs.length).toBe(runs);
  await page.goto(board);
  await expect(page.locator(`#board-cols [data-column="progress"] .kcard[data-card-id="${card}"]`)).toBeVisible();
  await expect.poll(()=>count(page)).toBe(before-1);
 } finally { query(`delete from public.hermes_agents where id='${agent}'`); }
});

test('a Card waiting for an approval asks once; archived, the approval ends with no decision and leaves the approver\'s list, and restored it is back where it was sent from',async({page,browser})=>{
 // The seed's card 5 waits in review for the Owner's approval.
 await signIn(page,'omar@example.com',board);
 const before=await count(page);
 const title=String(rows('select title from public.work_cards where id=5')[0].title);
 const reviewerPage=await (await browser.newContext()).newPage();
 await signIn(reviewerPage,'reviewer@example.com',board);
 await archiveFromMenu(reviewerPage,5);
 const confirm=confirmOf(reviewerPage);
 await expect(confirm.getByRole('listitem')).toHaveText([`The approval of “${title}” ends with no decision`]);
 await confirm.getByRole('button',{name:'Archive and stop'}).click();
 await expect(sheetOf(reviewerPage).getByRole('region',{name:'Archived'})).toBeVisible();
 await page.reload();
 await expect.poll(()=>count(page)).toBe(before-1);
 expect(rows(`select count(*)::int as decided from public.work_activity where card_id=5 and action in ('approval_rejected','approval_approved')`)).toEqual([{decided:0}]);
 await sheetOf(reviewerPage).getByRole('region',{name:'Archived'}).getByRole('button',{name:'Restore'}).click();
 await expect(reviewerPage.locator('.toast')).toContainText('Restored');
 await reviewerPage.goto(board);
 await expect(reviewerPage.locator('#board-cols [data-column="progress"] .kcard[data-card-id="5"]')).toBeVisible();
 await page.reload();
 await expect.poll(()=>count(page)).toBe(before-1);
 await reviewerPage.context().close();
});
