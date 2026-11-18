import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn } from './sign-in';
import { laneHermes } from './lane-hermes';
import { inbox } from './lane.mjs';

// The board's six columns and "Waiting on you" (#34, #16; ADR 0013). The seeded accounts read English.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const rs='10000000-0000-0000-0000-000000000001';

async function newCard(page:Page,label:string) {
 await page.goto('/c/rs-learning/work/new');
 const title=`${label} ${Date.now()}`;
 await page.getByLabel('Message',{exact:true}).fill(title);
 await page.getByRole('button',{name:'Create card'}).click();
 await expect(page).toHaveURL(/\/work\/board\/\d+$/);
 return {title,path:new URL(page.url()).pathname,id:Number(new URL(page.url()).pathname.split('/').pop())};
}
// A card that is being drawn again after a move can be read between columns (null); the loop below waits for it to land.
const columnOf=(page:Page,id:number)=>page.locator(`.kcard[data-card-id="${id}"]`).evaluate(el=>el.closest('[data-column]')?.getAttribute('data-column') ?? null);
const landedColumn=async(page:Page,id:number)=>{ let column:string|null=null; await expect.poll(async()=>column=await columnOf(page,id)).not.toBeNull(); return column; };

test('a card moves by drag and by keyboard, and both moves are logged',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const card=await newCard(page,'Board move');
 await page.goto('/c/rs-learning/work/board');
 const source=page.locator(`.kcard[data-card-id="${card.id}"]`);
 await expect(source).toBeVisible();
 expect(await columnOf(page,card.id)).toBe('ideas');
 // Drag: carry the card into Planned.
 const from=(await source.boundingBox())!,to=(await page.locator('.col[data-column="planned"] .col__body').boundingBox())!;
 await page.mouse.move(from.x+from.width/2,from.y+20);
 await page.mouse.down();
 await page.mouse.move(from.x+from.width/2+8,from.y+20,{steps:2});
 await page.mouse.move(to.x+to.width/2,to.y+40,{steps:10});
 await page.mouse.up();
 await expect(page.locator('.toast')).toHaveText('Moved to “Planned”');
 await expect(page.locator(`.col[data-column="planned"] .kcard[data-card-id="${card.id}"]`)).toBeVisible();
 await expect(page).toHaveURL(/\/work\/board$/);
 // Keyboard: Shift and the arrow toward the reading end is the next column; the card keeps the focus.
 await page.locator(`.kcard[data-card-id="${card.id}"] a`).focus();
 await page.keyboard.press('Shift+ArrowRight');
 await expect(page.locator('.toast')).toHaveText('Moved to “In progress”');
 await expect(page.locator(`.col[data-column="progress"] .kcard[data-card-id="${card.id}"]`)).toBeVisible();
 await expect(page.locator(`.col[data-column="progress"] .kcard[data-card-id="${card.id}"] a`)).toBeFocused();
 await page.reload();
 expect(await columnOf(page,card.id)).toBe('progress');
 // The log under the card has both moves.
 await page.goto(card.path);
 await expect(page.locator('.detail-row').filter({hasText:'Moved the card from أفكار to بريف جاهز'})).toHaveCount(1);
 await expect(page.locator('.detail-row').filter({hasText:'Moved the card from بريف جاهز to كتابة'})).toHaveCount(1);
 // Waiting on you fills by itself: a drop there is refused on the board.
 await page.goto('/c/rs-learning/work/board');
 await page.locator(`.kcard[data-card-id="${card.id}"] a`).focus();
 for(let step=0;step<3;step++) { const before=await landedColumn(page,card.id); if(before==='waiting'||before==='ideas') break; await page.keyboard.press('Shift+ArrowLeft'); await expect.poll(async()=>{ const now=await columnOf(page,card.id); return now!==null&&now!==before; }).toBe(true); await page.locator(`.kcard[data-card-id="${card.id}"] a`).focus(); }
 expect(await columnOf(page,card.id)).toBe('ideas');
 await page.keyboard.press('Shift+ArrowLeft');
 await expect(page.locator('.toast')).toContainText('“Waiting on you” fills up on its own');
 await expect(page.locator('.board-status')).toHaveCount(0);
 expect(await columnOf(page,card.id)).toBe('ideas');
});

test('+ on Ideas adds an idea with its Agent, flashes and focuses the Card, raises the count and writes the log row',async({page})=>{
 const stamp=Date.now();
 const lead=randomUUID(), ads=randomUUID();
 try {
  query(`insert into public.hermes_agents(id,company_id,name,speciality,profile,is_default) values ('${lead}','${rs}','Lead','General','idea-lead-${stamp}',true),('${ads}','${rs}','Ads','Meta ads','idea-ads-${stamp}',false)`);
  await signIn(page,'omar@example.com','/c/rs-learning/work/board');
  const ideas=page.locator('.col[data-column="ideas"]');
  const before=Number(await ideas.locator('.col__count').textContent());
  await ideas.getByRole('button',{name:'Add an idea'}).click();
  await expect(ideas.getByLabel('Idea',{exact:true})).toBeFocused();
  const title=`Idea ${stamp}`;
  await ideas.getByLabel('Idea',{exact:true}).fill(title);
  await ideas.getByLabel('Agent',{exact:true}).selectOption({label:'Ads'});
  await ideas.getByRole('button',{name:'Add',exact:true}).click();
  await expect(page.locator('.toast')).toHaveText('Idea added');
  const card=ideas.locator('.kcard').filter({hasText:title});
  await expect(card).toBeVisible();
  await expect(card.locator('.kcard__foot')).toContainText('Ads');
  await expect(card.locator('.kcard__t')).toHaveText('New idea from Omar');
  await expect(card.locator('a')).toBeFocused();
  await expect(ideas.locator('.col__count')).toHaveText(String(before+1));
  // The new idea is the first Card in the column.
  await expect(ideas.locator('.kcard').first().locator('.kcard__title')).toHaveText(title);
  // The column's own row in the Company log says it was an idea.
  await page.goto('/c/rs-learning/log');
  await expect(page.locator('.lgp-body .lg-row').filter({hasText:'added an idea'}).filter({hasText:title})).toBeVisible();
 } finally {
  query(`delete from public.hermes_agents where id in ('${lead}','${ads}')`);
 }
});

test('a card waiting for a decision moves only by it: a drop on Live opens the card, a drop elsewhere says to decide in the chat',async({page})=>{
 // Wide enough to show Waiting on you and Live together, so the card is carried from one to the other.
 await page.setViewportSize({width:2200,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const source=page.locator('.col[data-column="waiting"] .kcard[data-card-id="5"]');
 await expect(source).toBeVisible();
 const from=(await source.boundingBox())!,to=(await page.locator('.col[data-column="live"] .col__body').boundingBox())!;
 await page.mouse.move(from.x+from.width/2,from.y+20);
 await page.mouse.down();
 await page.mouse.move(from.x+from.width/2+8,from.y+20,{steps:2});
 await page.mouse.move(to.x+to.width/2,to.y+40,{steps:10});
 await page.mouse.up();
 // The toast raised on the board is still there on the card the drop opened.
 await expect(page).toHaveURL(/\/work\/board\/5$/);
 await expect(page.locator('.toast')).toHaveText('It needs your OK first. Decide here and the card moves on its own');
 await page.goto('/c/rs-learning/work/board');
 await page.locator('.kcard[data-card-id="5"] a').focus();
 await page.keyboard.press('Shift+ArrowRight');
 await expect(page.locator('.toast')).toHaveText('This card is waiting for your decision. Decide in the chat first');
 await expect(page).toHaveURL(/\/work\/board\/5$/);
 await page.goto('/c/rs-learning/work/board');
 expect(await landedColumn(page,5)).toBe('waiting');
});

test('a Viewer cannot move a card',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/work/board');
 await expect(page.getByText('Read only: approvals and moves are up to the rest of the team')).toBeVisible();
 const card=page.locator('.kcard[data-card-id="1"]');
 const before=await columnOf(page,1);
 const from=(await card.boundingBox())!,to=(await page.locator('.col[data-column="planned"] .col__body').boundingBox())!;
 await page.mouse.move(from.x+from.width/2,from.y+20);
 await page.mouse.down();
 await page.mouse.move(to.x+to.width/2,to.y+40,{steps:10});
 await page.mouse.up();
 await page.goto('/c/rs-learning/work/board');
 await page.locator('.kcard[data-card-id="1"] a').focus();
 await page.keyboard.press('Shift+ArrowRight');
 await page.reload();
 expect(await columnOf(page,1)).toBe(before);
 await expect(page.getByRole('button',{name:'Add an idea'})).toHaveCount(0);
});

test('a card waiting for my approval is in Waiting on you and leaves it when I approve its version',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const card=await newCard(page,'Waiting approval');
 await page.getByLabel('New design file').setInputFiles({name:'design.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64')});
 await page.getByRole('button',{name:'Add design'}).click();
 await expect(page.getByText(/Version 1:/)).toBeVisible();
 await page.getByLabel('Move to list',{exact:true}).selectOption({label:'مراجعة'});
 await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 await page.goto('/c/rs-learning/approvals');
 const waiting=page.locator('.col[data-column="waiting"]');
 const queued=waiting.locator(`.kcard[data-card-id="${card.id}"]`);
 await expect(queued).toBeVisible();
 await expect(queued.locator('.badge--wait')).toHaveText('Waiting on you');
 const count=Number(await waiting.locator('.col__count').textContent());
 await queued.getByRole('link',{name:card.title}).click();
 await expect(page).toHaveURL(new RegExp(`${card.path}$`));
 await page.locator('[data-card-section="review"]').getByRole('button',{name:'Approve',exact:true}).click();
 await expect(page.locator('.card-stage-line')).not.toContainText('مراجعة');
 await page.goto('/c/rs-learning/approvals');
 await expect(waiting.locator(`.kcard[data-card-id="${card.id}"]`)).toHaveCount(0);
 await expect(waiting.locator('.col__count')).toHaveText(String(count-1));
});

test('Waiting on you shows exactly the reader\'s own list, approvals and items newest first, and nothing for someone else',async({page,browser})=>{
 // Omar holds the review step: a card he must approve, one item from before it entered review and one from after, so
 // approvals and items interleave by time. The Manager holds no approval, so a card in review is not theirs.
 const omar='20000000-0000-0000-0000-000000000001', manager='20000000-0000-0000-0000-000000000002', stamp=Date.now();
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const card=await newCard(page,'Own list approval');
 await page.getByLabel('New design file').setInputFiles({name:'design.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64')});
 await page.getByRole('button',{name:'Add design'}).click();
 await expect(page.getByText(/Version 1:/)).toBeVisible();
 await page.getByLabel('Move to list',{exact:true}).selectOption({label:'مراجعة'});
 await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
 query(`select public.add_waiting_item('${rs}','${omar}','test_kind','Older than the approval ${stamp}','',1)`);
 query(`select public.add_waiting_item('${rs}','${omar}','test_kind','Newer than the approval ${stamp}','',1)`);
 query(`select public.add_waiting_item('${rs}','${manager}','test_kind','For the Manager ${stamp}','',1)`);
 query(`update public.waiting_items i set created_at=w.review_entered_at+case when i.title like 'Older%' then interval '-1 minute' else interval '1 minute' end
  from public.work_cards w where w.id=${card.id} and i.title in ('Older than the approval ${stamp}','Newer than the approval ${stamp}')`);
 try {
  await page.goto('/c/rs-learning/approvals');
  const waiting=page.locator('.col[data-column="waiting"]');
  const entries=waiting.locator(':is(.kcard,.mcard)');
  await expect(waiting.locator(`.kcard[data-card-id="${card.id}"]`)).toBeVisible();
  const order=await entries.evaluateAll(list=>list.map(entry=>entry.getAttribute('data-card-id')?`card:${entry.getAttribute('data-card-id')}`:entry.textContent||''));
  const at=(match:string)=>order.findIndex(entry=>entry.includes(match));
  expect(at(`card:${card.id}`)).toBeGreaterThan(at(`Newer than the approval ${stamp}`));
  expect(at(`Older than the approval ${stamp}`)).toBeGreaterThan(at(`card:${card.id}`));
  expect(at(`Newer than the approval ${stamp}`)).toBeGreaterThanOrEqual(0);
  expect(at(`For the Manager ${stamp}`)).toBe(-1);
  // The column and the sidebar count the same list.
  await expect(waiting.locator('.col__count')).toHaveText(String(order.length));
  await expect(page.locator(`a[href="/c/rs-learning/approvals"]`).first()).toContainText(String(order.length));
  // Home's "Awaiting your approval" counts approvals only; the items (two of them here) are not approvals.
  const approvals=order.filter(entry=>entry.startsWith('card:')).length;
  expect(approvals).toBeLessThan(order.length);
  await page.goto('/c/rs-learning/home');
  await expect(page.locator('.stats .stat').first().locator('strong')).toHaveText(String(approvals));

  // The Manager sees their own item and not Omar's card in review, nor Omar's items.
  const other=await browser.newContext(); const managerPage=await other.newPage();
  try {
   await signIn(managerPage,'manager@example.com','/c/rs-learning/approvals');
   const theirs=managerPage.locator('.col[data-column="waiting"]');
   await expect(theirs.locator('.mcard').filter({hasText:`For the Manager ${stamp}`})).toBeVisible();
   await expect(theirs.locator(`.kcard[data-card-id="${card.id}"]`)).toHaveCount(0);
   await expect(theirs.getByText(`than the approval ${stamp}`)).toHaveCount(0);
   const count=await theirs.locator(':is(.kcard,.mcard)').count();
   await expect(theirs.locator('.col__count')).toHaveText(String(count));
   expect(Number(rows(`select count(*)::int as n from public.waiting_items where person_id='${manager}' and resolved_at is null`)[0].n)).toBe(count);
  } finally { await other.close(); }
 } finally {
  query(`update public.waiting_items set resolved_at=now() where resolved_at is null and title like '%${stamp}'`);
 }
});

test('Waiting on you lists an Agent question and an item of a new kind, each opens its place and leaves when acted on, and nothing is sent out',async({page})=>{
 // The Manager: their own Conversation, a question in it, an item of a kind the list has never seen on card 1, and a
 // question for someone else that the Manager never sees.
 const manager='20000000-0000-0000-0000-000000000002', omar='20000000-0000-0000-0000-000000000001';
 const stamp=Date.now(), conversation=`62000000-0000-4000-8000-${String(stamp).slice(-12).padStart(12,'0')}`;
 // The Conversation runs on an Agent on the lane's fake Hermes, so the reply is sent as a person sends it.
 const fake=await laneHermes();
 const attachedAgent={id:''};
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  attachedAgent.id=randomUUID();
  // As an Owner's attachment made it: the Company's first Agent is its main one.
  query(`insert into public.hermes_agents(id,company_id,name,speciality,profile,is_default) select '${attachedAgent.id}','${rs}','Lead ${stamp}','Marketing','board-${stamp}',not exists(select 1 from public.hermes_agents where company_id='${rs}')`);
  await page.context().clearCookies();
  await signIn(page,'manager@example.com','/c/rs-learning/approvals');
  // Mail sent by earlier tests (an invite) may already be in the local mailbox; only a change counts.
  const mailCount=async()=>{const mail=await (await page.request.get(inbox)).json(); return Number(mail.total ?? mail.messages?.length ?? 0);};
  const mailBefore=await mailCount();
  query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${rs}','${manager}','${attachedAgent.id}','Lead')`);
  query(`select public.add_waiting_item('${rs}','${manager}','question','Which offer goes first ${stamp}?','',null,'${conversation}','Lead')`);
  query(`select public.add_waiting_item('${rs}','${manager}','test_kind','A new kind ${stamp}','Seeded by the test',1)`);
  query(`select public.add_waiting_item('${rs}','${omar}','test_kind','For Omar only ${stamp}','',1)`);
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
  const count=Number(await waiting.locator('.col__count').textContent());
  // The item of the new kind opens its Card; a comment there acts on it.
  await other.click();
  await expect(page).toHaveURL(/\/work\/board\/1$/);
  await page.getByLabel('Comment',{exact:true}).fill(`Answered ${stamp}`);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.comment-body').filter({hasText:`Answered ${stamp}`})).toBeVisible();
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
  // while the Run waits. This Agent is the main one, whose question is drawn as its plain words until #143 (no card), so
  // the person answers in words; the same Run replies, and the question leaves both.
  fake.settings.questions=input=>input.includes(`angle ${stamp}`)?[{question:`Which angle first ${stamp}?`,choices:['Graduates','Excel and Odoo']}]:[];
  fake.settings.reply=(input,answers=[])=>`Reply to: ${input}${answers.length?` (${answers.join(', ')})`:''}`;
  const sidebar=page.locator('a[href="/c/rs-learning/approvals"]').first();
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('.msg[data-author=agent]').filter({hasText:`The early price ${stamp}`})).toBeVisible();
  await page.getByLabel('Message',{exact:true}).fill(`Plan the ads, which angle ${stamp}`);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  // Sending waits for the engine to accept the run, as above.
  await expect(page.locator('.msg[data-author=person]').filter({hasText:`which angle ${stamp}`})).toBeVisible({timeout:30000});
  await expect(page.locator('.msg[data-author=agent]').filter({hasText:`Which angle first ${stamp}?`})).toContainText('Excel and Odoo');
  await expect(page.getByRole('group',{name:`Which angle first ${stamp}?`,exact:true})).toHaveCount(0);
  await page.goto('/c/rs-learning/approvals');
  const asked=waiting.locator('.mcard').filter({hasText:`Which angle first ${stamp}?`});
  await expect(asked).toContainText('Question from Lead');
  await expect(waiting.locator('.col__count')).toHaveText(String(count-1));
  await expect(sidebar).toContainText(String(count-1));
  await asked.click();
  await expect(page).toHaveURL(new RegExp(`/conversations/${conversation}$`));
  await page.getByLabel('Message',{exact:true}).fill('Excel and Odoo');
  await page.getByRole('button',{name:'Send',exact:true}).click();
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
