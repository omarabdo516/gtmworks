import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { chooseLanguageInSettings } from './choose-language';

// Spec #831 (#839): a Card that needs review is passed or sent back, by an Agent as Hermes does it or by a person, in its
// window over the Company's fake Engine (design-reference-card: cwCalloutHTML's review, cwSendBack; ADR 0033: no
// Approval panel and no Version). A Card its Agent hands in waits under "Waiting on you" with the review symbol; an
// Administrator (the Owner Role) and a Manager see Pass and Send back, a Contributor and a Viewer do not and are refused
// on the server; a pass moves the Card to Done and its Activity names the person; a return needs a reason, which is a
// comment under the person's name and reaches the Agent's next Run, and the Card says it was sent back; a reviewing
// Agent's pass or return names that Agent the same way; and neither the board nor the Card says Approval or Version, in
// English or in Arabic.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const critic=randomUUID(), criticProfile=`ag-${critic.replaceAll('-','')}`;
const viewer='20000000-0000-0000-0000-000000000004', manager='20000000-0000-0000-0000-000000000002', contributor='20000000-0000-0000-0000-000000000003';
const board='/c/rs-learning/work/board';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}'),('${critic}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}'),
    ('${critic}','${rs}','Critic','Reviews before anything goes out.',false,'${criticProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) select '${rs}',person,agent from unnest(array['${viewer}','${manager}','${contributor}']::uuid[]) person
    cross join unnest(array['${ads}','${critic}']::uuid[]) agent;
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const windowOf=(page:Page)=>page.getByRole('dialog');
const boardCard=(page:Page,id:string)=>page.locator(`#board-cols .kcard[data-card="${id}"]`);
const column=(page:Page,name:string)=>page.locator(`#board-cols [data-column="${name}"]`);
const taskOf=(id:string)=>fake.settings.kanban.tasks.find(task=>task.id===id);
const kanbanWrites=()=>fake.settings.managed.filter(request=>request.method!=='GET'&&String(request.path).startsWith('/api/plugins/kanban'));
// A Card its Agent worked and handed in for review, as a worker's kanban_request_review leaves it.
function handedIn(title:string,summary='Wrote the article, 1,850 words.') {
 const kanban=fake.settings.kanban;
 const id=kanban.task({title,status:'ready',assignee:adsProfile}).id;
 kanban.dispatch();
 kanban.requestReview(id,summary);
 return id;
}

test('a Card its Agent sends for review waits under Waiting on you with the review symbol, and says what it handed in',async({page})=>{
 const kanban=fake.settings.kanban;
 const id=kanban.task({title:'SEO article: online accounting course',status:'ready',assignee:adsProfile}).id;
 kanban.dispatch();
 await signIn(page,'omar@example.com',board);
 await expect(column(page,'progress').locator(`.kcard[data-card="${id}"]`)).toBeVisible();
 // The Agent hands it in while the board is open: the board follows the Engine.
 kanban.requestReview(id,'Wrote the article, 1,850 words.');
 const card=column(page,'waiting').locator(`.kcard[data-card="${id}"]`);
 await expect(card.getByRole('img',{name:'Needs review'})).toBeVisible();
 await expect(card.locator('[data-sym="review"]')).toHaveAttribute('title','Needs review');
 await card.getByRole('link').click();
 const callout=windowOf(page).getByRole('region',{name:'Needs review'});
 await expect(callout.locator('.cw-call__q')).toHaveText('Wrote the article, 1,850 words.');
 await expect(callout.getByRole('button',{name:'Pass'})).toBeVisible();
 await expect(callout.getByRole('button',{name:'Send back'})).toBeVisible();
});

test('a Manager\'s pass moves the Card to Done with its Agent\'s summary, and its Activity names them',async({page})=>{
 const id=handedIn('Weekly report for the course');
 await signIn(page,'manager@example.com',`${board}?card=${id}`);
 const sheet=windowOf(page);
 await sheet.getByRole('region',{name:'Needs review'}).getByRole('button',{name:'Pass'}).click();
 await expect(sheet.locator('.cw-status')).toContainText('Done');
 await expect(sheet.locator('.cw-status [data-sym="passed"]')).toHaveAttribute('title','Passed');
 await expect(sheet.getByRole('region',{name:'Needs review'})).toHaveCount(0);
 await expect(sheet.locator('.cw-sum')).toHaveText('Wrote the article, 1,850 words.');
 await expect(sheet.locator('.cw-review')).toHaveText('Passed by مدير');
 await expect(column(page,'done').locator(`.kcard[data-card="${id}"]`)).toBeVisible();
 expect(taskOf(id)?.status).toBe('done');
 await sheet.getByRole('tab',{name:/^Activity/}).click();
 const passed=sheet.getByRole('tabpanel').locator('.lg-row[data-event="passed"]');
 await expect(passed.locator('.lg-line')).toHaveText('Passed');
 await expect(passed.locator('.lg-meta bdi')).toHaveText('مدير');
 await sheet.getByRole('tab',{name:/^Runs/}).click();
 await expect(sheet.getByRole('tabpanel').locator('.cw-run__t').first()).toHaveText('#2 · مدير · Passed it');
});

test('Send back needs a reason; the reason is a comment under the person\'s name, the Agent\'s next Run reads it, and the Card says who sent it back',async({page})=>{
 const kanban=fake.settings.kanban;
 const id=handedIn('Meta campaign: the full accountant');
 await signIn(page,'omar@example.com',`${board}?card=${id}`);
 const sheet=windowOf(page);
 const callout=sheet.getByRole('region',{name:'Needs review'});
 await callout.getByRole('button',{name:'Send back'}).click();
 const reason=callout.getByRole('textbox',{name:'The reason'});
 await expect(reason).toBeFocused();
 await expect(reason).toHaveAttribute('placeholder','What should change?');
 // Escape leaves the reason, not the Card; Send back again opens it.
 await reason.press('Escape');
 await expect(reason).toHaveCount(0);
 await expect(sheet).toBeVisible();
 await callout.getByRole('button',{name:'Send back'}).click();
 const written=kanbanWrites().length;
 await callout.getByRole('button',{name:'Send back'}).click();
 await expect(callout.getByText('Write the reason so the Agent knows what to change.')).toBeVisible();
 expect(kanbanWrites().length).toBe(written);
 const ticks=kanban.ticks;
 await callout.getByRole('textbox',{name:'The reason'}).fill('Use the course\'s real price.');
 await callout.getByRole('button',{name:'Send back'}).click();
 await expect(sheet.getByRole('region',{name:'Needs review'})).toHaveCount(0);
 // The Agent goes on at once: it works on the reason, and the Card still says who sent it back and why.
 await expect(sheet.locator('.cw-status [data-sym="working"]')).toBeVisible();
 const back=sheet.locator('.cw-review');
 await expect(back.getByRole('img',{name:'Sent back'})).toBeVisible();
 await expect(back.locator('.cw-review__by')).toHaveText('Sent back by عمر');
 await expect(back.locator('.cw-review__why')).toHaveText('Use the course\'s real price.');
 await expect(sheet.getByRole('tabpanel').locator('.lg-row')).toHaveCount(1);
 await expect(sheet.getByRole('tabpanel').locator('.lg-name')).toHaveText('عمر');
 await expect(sheet.getByRole('tabpanel').locator('.lg-note')).toHaveText('Use the course\'s real price.');
 expect(kanban.ticks).toBe(ticks+1);
 const next=kanban.prompts.filter(prompt=>prompt.task===id).at(-1);
 expect(next?.profile).toBe(adsProfile);
 expect(next?.prompt).toContain('comment from worker `عمر`:\nUse the course\'s real price.');
 expect(taskOf(id)?.assignee).toBe(adsProfile);
});

test('a reviewing Agent that returns or passes the work on the Engine is named on the Card the same way',async({page})=>{
 const kanban=fake.settings.kanban;
 const id=handedIn('Google Ads numbers for October');
 kanban.claimReview(id,criticProfile);
 kanban.reviewerReturns(id,'The cost per lead in row two is wrong.');
 await signIn(page,'viewer@example.com',`${board}?card=${id}`);
 const sheet=windowOf(page);
 await expect(boardCard(page,id)).toBeVisible();
 await expect(sheet.locator('.cw-status [data-sym="sentBack"]')).toHaveAttribute('title','Sent back');
 const back=sheet.locator('.cw-review');
 await expect(back.locator('.cw-review__by')).toHaveText('Sent back by Critic');
 await expect(back.locator('.cw-review__why')).toHaveText('The cost per lead in row two is wrong.');
 // Its Agent goes on, hands it in again, and the reviewing Agent passes it while the Card is open.
 kanban.dispatch();
 kanban.requestReview(id,'Fixed row two.');
 kanban.claimReview(id,criticProfile);
 kanban.reviewerPasses(id,'The numbers match the account.');
 await expect(sheet.locator('.cw-status [data-sym="passed"]')).toBeVisible();
 await expect(sheet.locator('.cw-review')).toHaveText('Passed by Critic');
 await expect(sheet.locator('.cw-sum')).toHaveText('The numbers match the account.');
 await sheet.getByRole('tab',{name:/^Activity/}).click();
 await expect(sheet.getByRole('tabpanel').locator('.lg-row[data-event="changes_requested"] .lg-meta bdi')).toHaveText('Critic');
 await expect(sheet.getByRole('tabpanel').locator('.lg-row[data-event="passed"] .lg-meta bdi')).toHaveText('Critic');
});

test('a Contributor and a Viewer see the review and decide nothing; the server refuses them before the Engine',async({page,browser})=>{
 const id=handedIn('Course reel script');
 for(const email of ['reviewer@example.com','viewer@example.com']) {
  const other=await browser.newPage();
  try {
   await signIn(other,email,`${board}?card=${id}`);
   const callout=windowOf(other).getByRole('region',{name:'Needs review'});
   await expect(callout.locator('.cw-call__q')).toHaveText('Wrote the article, 1,850 words.');
   await expect(callout.getByRole('button')).toHaveCount(0);
   const before=kanbanWrites().length;
   for(const data of [{company:rs,card:id,action:'pass'},{company:rs,card:id,action:'sendBack',reason:'No.'}]) {
    const answer=await other.request.post('/api/board/card/review',{data});
    expect(answer.status(),`${email} ${data.action}`).toBe(403);
   }
   expect(kanbanWrites().length).toBe(before);
  } finally { await other.close(); }
 }
 expect(taskOf(id)?.status).toBe('review');
 expect(fake.settings.kanban.comments.filter(comment=>comment.task_id===id)).toEqual([]);
 // And no one asks the Engine to delete a Card.
 expect(fake.settings.managed.filter(request=>request.method==='DELETE'&&String(request.path).startsWith('/api/plugins/kanban/tasks'))).toEqual([]);
 void page;
});

test('neither the board nor a Card says Approval or Version, in English or in Arabic',async({page})=>{
 const kanban=fake.settings.kanban;
 const waiting=handedIn('Landing page copy');
 const passed=handedIn('December email');
 kanban.claimReview(passed,criticProfile);
 kanban.reviewerPasses(passed,'Reads well.');
 const returned=handedIn('Webinar invite');
 kanban.claimReview(returned,criticProfile);
 kanban.reviewerReturns(returned,'Name the date.');
 await signIn(page,'omar@example.com',board);
 const words={en:/approv|version/i,ar:/موافق|وافق|نسخة|نسخه|النسخ/};
 // Every word a person reads: the text, and each name, tooltip and hint on the board and the Card.
 const seen=(scope:string)=>page.locator(scope).evaluateAll(nodes=>nodes.map(node=>[(node as HTMLElement).innerText,
  ...[node,...node.querySelectorAll('*')].flatMap(one=>['aria-label','title','placeholder'].map(name=>one.getAttribute(name)??''))].join('\n')).join('\n'));
 for(const language of ['en','ar'] as const) {
  await chooseLanguageInSettings(page,language);
  await page.goto(board);
  await expect(boardCard(page,waiting)).toBeVisible();
  expect(await seen('.board-view')).not.toMatch(words[language]);
  for(const id of [waiting,passed,returned]) {
   await page.goto(`${board}?card=${id}`);
   const sheet=windowOf(page);
   await expect(sheet.locator('.cw-status [data-sym]')).toBeVisible();
   for(const tab of ['comments','activity','runs']) {
    await sheet.locator(`#cw-tab-${tab}`).click();
    await expect(sheet.locator(`#cw-tab-${tab}`)).toHaveAttribute('aria-selected','true');
    expect(await seen('dialog.cw'),`${language} ${id} ${tab}`).not.toMatch(words[language]);
   }
   if(id===waiting) {
    await sheet.locator('.cw-sendback').click();
    await expect(sheet.locator('#cw-reason')).toBeVisible();
    expect(await seen('dialog.cw'),`${language} send back`).not.toMatch(words[language]);
   }
  }
 }
 await chooseLanguageInSettings(page,'en');
});
