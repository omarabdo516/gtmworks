import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn } from './sign-in';
import { laneHermes } from './lane-hermes';
import { inbox } from './lane.mjs';

// "Waiting on you" (#16; ADR 0013): the Company's Engine board opened on its first column, which holds the reader's own
// list (spec #831, #846). The board's moves, places, archive and the Cards that wait are the Engine's own board's, in the
// kanban-*.spec.ts files; these cases are the list's other rows. The seeded accounts read English.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const rs='10000000-0000-0000-0000-000000000001';
// The sidebar's count has come once it shows a number: the board's Cards that wait on the reader are counted after the
// page's first content (#841), so the list is read whole only then.
const counted=async(page:import('@playwright/test').Page)=>{ const pill=page.locator('.sidebar .sb-count[href$="/approvals"] .sb-count__n'); await expect(pill).toHaveText(/^\d+$/); return Number(await pill.textContent()); };

test('Waiting on you shows exactly the reader\'s own list, items newest first, nothing of the old board, and nothing for someone else',async({page,browser})=>{
 // Omar has an item from before and one from after; the Manager has one of their own. The old board is switched off
 // (#846): none of its Cards or approvals is part of the list.
 const omar='20000000-0000-0000-0000-000000000001', manager='20000000-0000-0000-0000-000000000002', stamp=Date.now();
 query(`select public.add_waiting_item('${rs}','${omar}','test_kind','Older ${stamp}','',null)`);
 query(`select public.add_waiting_item('${rs}','${omar}','test_kind','Newer ${stamp}','',null)`);
 query(`select public.add_waiting_item('${rs}','${manager}','test_kind','For the Manager ${stamp}','',null)`);
 query(`update public.waiting_items set created_at=now()-case when title like 'Older%' then interval '2 minutes' else interval '1 minute' end where title in ('Older ${stamp}','Newer ${stamp}')`);
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/approvals');
  const waiting=page.locator('.col[data-column="waiting"]');
  const entries=waiting.locator(':is(.kcard,.mcard)');
  await expect(waiting.locator('.mcard').filter({hasText:`Newer ${stamp}`})).toBeVisible();
  const total=await counted(page);
  await expect(waiting.locator('.kcard[data-card-id]')).toHaveCount(0);
  const order=await entries.evaluateAll(list=>list.map(entry=>entry.textContent||''));
  const at=(match:string)=>order.findIndex(entry=>entry.includes(match));
  expect(at(`Older ${stamp}`)).toBeGreaterThan(at(`Newer ${stamp}`));
  expect(at(`Newer ${stamp}`)).toBeGreaterThanOrEqual(0);
  expect(at(`For the Manager ${stamp}`)).toBe(-1);
  // The column and the sidebar count the same list.
  await expect(waiting.locator('.col__count')).toHaveText(String(order.length));
  expect(total).toBe(order.length);

  // The Manager sees their own item and none of Omar's.
  const other=await browser.newContext(); const managerPage=await other.newPage();
  try {
   await signIn(managerPage,'manager@example.com','/c/rs-learning/approvals');
   const theirs=managerPage.locator('.col[data-column="waiting"]');
   await expect(theirs.locator('.mcard').filter({hasText:`For the Manager ${stamp}`})).toBeVisible();
   await counted(managerPage);
   await expect(theirs.getByText(`Older ${stamp}`)).toHaveCount(0);
   await expect(theirs.getByText(`Newer ${stamp}`)).toHaveCount(0);
   const items=await theirs.locator('.mcard').count();
   expect(Number(rows(`select count(*)::int as n from public.waiting_items where person_id='${manager}' and resolved_at is null and kind not in ('approval','mention')`)[0].n)).toBe(items);
  } finally { await other.close(); }
 } finally {
  query(`update public.waiting_items set resolved_at=now() where resolved_at is null and title like '%${stamp}'`);
 }
});

test('Waiting on you lists an Agent question and an item of a new kind, each leaves when acted on, and nothing is sent out',async({page})=>{
 // The Manager: their own Conversation, a question in it, an item of a kind the list has never seen, and an item for
 // someone else that the Manager never sees.
 const manager='20000000-0000-0000-0000-000000000002', omar='20000000-0000-0000-0000-000000000001';
 const stamp=Date.now(), conversation=`62000000-0000-4000-8000-${String(stamp).slice(-12).padStart(12,'0')}`;
 // The Conversation runs on an Agent on the lane's fake Hermes, so the reply is sent as a person sends it.
 const fake=await laneHermes();
 const attachedAgent={id:''};
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  attachedAgent.id=randomUUID();
  // As an Owner's attachment made it: the Company's first Agent is its main one (New card's own Agent is a plain one).
  query(`insert into public.hermes_agents(id,company_id,name,speciality,profile,is_default) select '${attachedAgent.id}','${rs}','Lead ${stamp}','Marketing','board-${stamp}',not exists(select 1 from public.hermes_agents where company_id='${rs}' and is_default)`);
  await page.context().clearCookies();
  await signIn(page,'manager@example.com','/c/rs-learning/approvals');
  // Mail sent by earlier tests (an invite) may already be in the local mailbox; only a change counts.
  const mailCount=async()=>{const mail=await (await page.request.get(inbox)).json(); return Number(mail.total ?? mail.messages?.length ?? 0);};
  const mailBefore=await mailCount();
  query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${rs}','${manager}','${attachedAgent.id}','Lead')`);
  query(`select public.add_waiting_item('${rs}','${manager}','question','Which offer goes first ${stamp}?','',null,'${conversation}','Lead')`);
  query(`select public.add_waiting_item('${rs}','${manager}','test_kind','A new kind ${stamp}','Seeded by the test',null)`);
  query(`select public.add_waiting_item('${rs}','${omar}','test_kind','For Omar only ${stamp}','',null)`);
  // Nothing leaves gtmworks: no mail (there are no webhooks since #341).
  expect(await mailCount()).toBe(mailBefore);
  await page.goto('/c/rs-learning/approvals');
  const waiting=page.locator('.col[data-column="waiting"]');
  const question=waiting.locator('.mcard').filter({hasText:`Which offer goes first ${stamp}?`});
  const other=waiting.locator('.mcard').filter({hasText:`A new kind ${stamp}`});
  await expect(question).toBeVisible();
  await expect(question).toContainText('Question from Lead');
  await expect(other).toBeVisible();
  await expect(waiting.getByText(`For Omar only ${stamp}`)).toHaveCount(0);
  // Newest first: the item of the new kind came last, so it is listed first.
  expect(await waiting.locator('.mcard').evaluateAll(cards=>cards.map(card=>card.textContent))).toEqual([expect.stringContaining(`A new kind ${stamp}`),expect.stringContaining(`Which offer goes first ${stamp}?`)]);
  await counted(page);
  const count=Number(await waiting.locator('.col__count').textContent());
  // The item of the new kind names no chat, so it opens nothing (the old board's Card it named is switched off, #846);
  // it leaves once what it waited for is done.
  await expect(other).not.toHaveAttribute('href',/./);
  query(`update public.waiting_items set resolved_at=now() where title='A new kind ${stamp}'`);
  await page.goto('/c/rs-learning/approvals');
  await expect(other).toHaveCount(0);
  await expect(waiting.locator('.col__count')).toHaveText(String(count-1));
  // The question opens its Conversation; the Manager's reply, sent from the composer, clears it.
  await question.click();
  await expect(page).toHaveURL(new RegExp(`/conversations/${conversation}$`));
  await page.getByLabel('Message',{exact:true}).fill(`The early price ${stamp}`);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  // Sending waits for the engine to accept the run, so it is given longer than a page change.
  await expect(page.locator('.msg[data-author=person]').filter({hasText:`The early price ${stamp}`})).toBeVisible({timeout:30000});
  // The reply reached the engine as a run of this Conversation.
  await expect.poll(()=>fake.settings.runs.some(run=>run.input.includes(`The early price ${stamp}`))).toBe(true);
  await page.goto('/c/rs-learning/approvals');
  await expect(question).toHaveCount(0);
  await expect(waiting.locator('.col__count')).toHaveText(String(count-2));

  // #138: the Agent asks with the Engine's own clarify tool. The question waits in the list and the sidebar's count
  // while the Run waits. This Agent is the main one, so its question is drawn as the reference's chip card (#143): the
  // person presses a chip, the same Run replies, and the question leaves both.
  fake.settings.questions=input=>input.includes(`angle ${stamp}`)?[{question:`Which angle first ${stamp}?`,choices:['Graduates','Excel and Odoo']}]:[];
  fake.settings.reply=(input,answers=[])=>`Reply to: ${input}${answers.length?` (${answers.join(', ')})`:''}`;
  const sidebar=page.locator('a[href="/c/rs-learning/approvals"]').first();
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('.msg[data-author=agent]').filter({hasText:`The early price ${stamp}`})).toBeVisible();
  await page.getByLabel('Message',{exact:true}).fill(`Plan the ads, which angle ${stamp}`);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  // Sending waits for the engine to accept the run, as above.
  await expect(page.locator('.msg[data-author=person]').filter({hasText:`which angle ${stamp}`})).toBeVisible({timeout:30000});
  const card=page.getByRole('group',{name:`Which angle first ${stamp}?`,exact:true});
  await expect(card).toBeVisible();
  await expect(card.locator('.ask1__opts .chip')).toHaveText(['Graduates','Excel and Odoo']);
  await expect(card).toContainText('or type the answer below');
  // The card is the Agent's turn, and its words are the card's own: no plain bubble repeats the question (#143).
 await expect(page.locator('.msg[data-author=agent] .bubble--agent').filter({hasText:`Which angle first ${stamp}?`}),'the main Agent asks with its card, not plain words').toHaveCount(0);
  await page.goto('/c/rs-learning/approvals');
  const asked=waiting.locator('.mcard').filter({hasText:`Which angle first ${stamp}?`});
  await expect(asked).toContainText('Question from Lead');
  await expect(waiting.locator('.col__count')).toHaveText(String(count-1));
  await expect(sidebar).toContainText(String(count-1));
  await asked.click();
  await expect(page).toHaveURL(new RegExp(`/conversations/${conversation}$`));
  await card.getByRole('button',{name:'Excel and Odoo'}).click();
  await expect(page.locator('.msg[data-author=person][data-kind=answer]').filter({hasText:'Excel and Odoo'})).toBeVisible();
  await expect(page.locator('.msg[data-author=agent]').filter({hasText:`which angle ${stamp} (Excel and Odoo)`})).toBeVisible();
  expect(fake.settings.runs.filter(run=>run.input.includes(`angle ${stamp}`))).toHaveLength(1);
  expect(fake.settings.answers.map(answer=>[answer.status,answer.body.answer])).toEqual([[200,'Excel and Odoo']]);
  await page.goto('/c/rs-learning/approvals');
  await expect(asked).toHaveCount(0);
  await expect(waiting.locator('.col__count')).toHaveText(String(count-2));
  await expect(sidebar).toContainText(String(count-2));
 } finally {
  query(`update public.waiting_items set resolved_at=now() where resolved_at is null and title like '%${stamp}%'`);
  if(attachedAgent.id) query(`delete from public.hermes_agents where id='${attachedAgent.id}'`);
  await fake.close();
 }
});
