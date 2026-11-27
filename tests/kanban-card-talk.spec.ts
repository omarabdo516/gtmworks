import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// Spec #831 (#838): a person talks to the work on a Card in its window (design-reference-card: cwComposerHTML,
// cwCalloutHTML, cwSideHTML's stop and start) over the Company's fake Engine. A comment shows under the writer's name for
// every Member who opens the Card; a Card stopped on a question shows it at the top with an answer box, and the answer
// makes the Agent go on, its next Run given the answer; Stop ends the Card's open Run and the Card shows the stopped
// symbol until Start; a Card stopped after two failures shows its symbol and Continue; a Viewer reads every comment and
// writes none, on the page and on the server.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001';
const rsProfile=`co-${rs.replaceAll('-','')}`;
const ads=randomUUID(), adsProfile=`ag-${ads.replaceAll('-','')}`;
const viewer='20000000-0000-0000-0000-000000000004', manager='20000000-0000-0000-0000-000000000002';
const board='/c/rs-learning/work/board';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${rs}');
   insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${ads}','${rs}','Ads','Runs the ads.',false,'${adsProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rs}','${rsProfile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rs}','${viewer}','${ads}'),('${rs}','${manager}','${ads}');
  end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const windowOf=(page:Page)=>page.getByRole('dialog');
const boardCard=(page:Page,id:string)=>page.locator(`#board-cols .kcard[data-card="${id}"]`);
const taskOf=(id:string)=>fake.settings.kanban.tasks.find(task=>task.id===id);
const kanbanWrites=()=>fake.settings.managed.filter(request=>request.method!=='GET'&&String(request.path).startsWith('/api/plugins/kanban'));

test('a comment shows under the writer\'s name for every Member who opens the Card, and starts nothing',async({page,browser})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'December ad copy',status:'running',assignee:adsProfile,claim_lock:'host:1'}).id;
 const ticks=kanban.ticks;
 await signIn(page,'omar@example.com',`${board}?card=${card}`);
 const sheet=windowOf(page);
 const field=sheet.getByRole('textbox',{name:'Write a comment'});
 const post=sheet.getByRole('button',{name:'Post the comment'});
 await expect(field).toHaveAttribute('placeholder','Comment…');
 await expect(post).toBeDisabled();
 await field.fill('Keep the price in every ad.');
 await field.press('Enter');
 await expect(field).toHaveValue('');
 const rows=sheet.getByRole('tabpanel').locator('.lg-row');
 await expect(rows).toHaveCount(1);
 await expect(rows.locator('.lg-name')).toHaveText('عمر');
 await expect(rows.locator('.lg-note')).toHaveText('Keep the price in every ad.');
 // On the Engine, under the person's name, which gtmworks wrote as its author.
 expect(kanban.comments.filter(comment=>comment.task_id===card).map(comment=>[comment.author,comment.body])).toEqual([['عمر','Keep the price in every ad.']]);
 // A comment on a Card that is not stopped starts nothing.
 expect(taskOf(card)?.status).toBe('running');
 expect(kanban.ticks).toBe(ticks);
 // Another Member, and a Viewer, read it under the same name.
 for(const email of ['manager@example.com','viewer@example.com']) {
  const other=await browser.newPage();
  try {
   await signIn(other,email,`${board}?card=${card}`);
   const theirs=windowOf(other).getByRole('tabpanel').locator('.lg-row');
   await expect(theirs.locator('.lg-name')).toHaveText('عمر');
   await expect(theirs.locator('.lg-note')).toHaveText('Keep the price in every ad.');
  } finally { await other.close(); }
 }
});

test('a Card stopped on a question shows it at the top with an answer box, and the answer makes its Agent go on',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'Meta campaign',status:'blocked',assignee:adsProfile,body:'Plan the December campaign.'}).id;
 const asked=kanban.run(card,{profile:adsProfile,status:'blocked',outcome:'blocked',summary:'Which angle should the ads take?',ended_at:Math.floor(Date.now()/1000)});
 kanban.event(card,'blocked',{reason:'Which angle should the ads take?'},asked.id);
 await signIn(page,'omar@example.com',`${board}?card=${card}`);
 const sheet=windowOf(page);
 const callout=sheet.getByRole('region',{name:'Has a question'});
 const written=kanbanWrites().length;
 await expect(callout.locator('.cw-call__q')).toHaveText('Which angle should the ads take?');
 await expect(callout.getByRole('img',{name:'Has a question'})).toBeVisible();
 // The callout is the first thing under the title.
 expect(await sheet.locator('.cw-top > *').evaluateAll(nodes=>nodes.slice(0,2).map(node=>node.className))).toEqual(['cw-title','cw-call cw-call--wait']);
 // An empty answer is not sent.
 await callout.getByRole('button',{name:'Send answer'}).click();
 await expect(callout.getByText('Write your answer first, even one word.')).toBeVisible();
 await expect(callout.getByRole('textbox',{name:'Your answer'})).toBeFocused();
 expect(kanbanWrites().length).toBe(written);
 const ticks=kanban.ticks;
 await callout.getByRole('textbox',{name:'Your answer'}).fill('The accountant who works from home.');
 await callout.getByRole('button',{name:'Send answer'}).click();
 // One button: the comment, the move to ready and the tick. The Card now shows "working now", on the window and the board.
 await expect(sheet.locator('.cw-status [data-sym="working"]')).toHaveAttribute('title','Working on it now');
 await expect(sheet.locator('.cw-status')).toContainText('In progress');
 await expect(sheet.getByRole('region',{name:'Has a question'})).toHaveCount(0);
 await expect(boardCard(page,card).locator('[data-sym="working"]')).toBeVisible();
 expect(kanban.ticks).toBe(ticks+1);
 // The Agent's next Run on the fake Engine is given the answer under the person's name.
 const next=kanban.prompts.filter(prompt=>prompt.task===card).at(-1);
 expect(next?.profile).toBe(adsProfile);
 expect(next?.prompt).toContain('comment from worker `عمر`:\nThe accountant who works from home.');
 await expect(sheet.getByRole('tabpanel').locator('.lg-note')).toHaveText(['The accountant who works from home.']);
});

test('Stop ends the Card\'s open Run and the Card shows the stopped symbol; no tick starts it until Start',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'Course page copy',status:'ready',assignee:adsProfile}).id;
 kanban.dispatch();
 await signIn(page,'omar@example.com',`${board}?card=${card}`);
 const sheet=windowOf(page);
 const stop=sheet.getByRole('button',{name:'Stop Ads'});
 await expect(stop).toHaveAttribute('title','Stop');
 await stop.click();
 await expect(sheet.locator('.cw-status [data-sym="stopped"]')).toHaveAttribute('title','Stopped');
 await expect(boardCard(page,card).getByRole('img',{name:'Stopped'})).toBeVisible();
 // The Run ended, and the Engine's own tick does not start the Card again.
 const runs=kanban.runs.filter(run=>run.task_id===card);
 expect(runs.map(run=>run.outcome)).toEqual(['reclaimed']);
 kanban.dispatch();
 expect(taskOf(card)?.status).toBe('scheduled');
 await sheet.getByRole('tab',{name:/^Runs/}).click();
 await expect(sheet.getByRole('tabpanel').locator('.cw-run__t')).toHaveText(['#1 · Ads · Stopped']);
 // Start lets it go on at once.
 await sheet.getByRole('button',{name:'Start Ads'}).click();
 await expect(sheet.locator('.cw-status [data-sym="working"]')).toBeVisible();
 await expect(sheet.getByRole('button',{name:'Stop Ads'})).toBeVisible();
 expect(taskOf(card)?.status).toBe('running');
});

test('a Card stopped after two failures shows its symbol and a Continue that asks the Engine to try again',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'Google Ads numbers for October',status:'blocked',assignee:adsProfile,consecutive_failures:2}).id;
 const now=Math.floor(Date.now()/1000);
 kanban.run(card,{profile:adsProfile,status:'crashed',outcome:'crashed',ended_at:now});
 kanban.run(card,{profile:adsProfile,status:'crashed',outcome:'crashed',ended_at:now});
 await signIn(page,'omar@example.com',`${board}?card=${card}`);
 const sheet=windowOf(page);
 await expect(boardCard(page,card).getByRole('img',{name:'Stopped after 2 tries'})).toBeVisible();
 const callout=sheet.getByRole('region',{name:'Stopped after 2 tries'});
 await expect(callout.getByRole('img',{name:'Stopped after 2 tries'})).toBeVisible();
 await expect(callout.locator('.cw-call__q')).toHaveText('It failed twice in a row and stopped. Continue asks it to try again.');
 const ticks=kanban.ticks;
 await callout.getByRole('button',{name:'Continue'}).click();
 await expect(sheet.locator('.cw-status [data-sym="working"]')).toBeVisible();
 await expect(sheet.getByRole('region',{name:'Stopped after 2 tries'})).toHaveCount(0);
 expect(kanban.ticks).toBe(ticks+1);
 expect(taskOf(card)?.consecutive_failures).toBe(0);
});

test('a Viewer reads the comments and the question and writes nothing; the server refuses them before the Engine',async({page})=>{
 const kanban=fake.settings.kanban;
 const card=kanban.task({title:'Webinar invite',status:'blocked',assignee:adsProfile}).id;
 kanban.run(card,{profile:adsProfile,status:'blocked',outcome:'blocked',summary:'Which date works?',ended_at:Math.floor(Date.now()/1000)});
 kanban.comment(card,'مدير','I will check the calendar.');
 const running=kanban.task({title:'Course reel',status:'running',assignee:adsProfile,claim_lock:'host:2'}).id;
 await signIn(page,'viewer@example.com',`${board}?card=${card}`);
 const sheet=windowOf(page);
 await expect(sheet.getByRole('region',{name:'Has a question'}).locator('.cw-call__q')).toHaveText('Which date works?');
 await expect(sheet.getByRole('tabpanel').locator('.lg-note')).toHaveText(['I will check the calendar.']);
 await expect(sheet.locator('.ro-line')).toHaveText('Read only');
 await expect(sheet.locator('textarea, input')).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:/Send answer|Post the comment|Continue|Stop|Start/})).toHaveCount(0);
 await page.goto(`${board}?card=${running}`);
 await expect(sheet.getByRole('heading',{level:2})).toHaveText('Course reel');
 await expect(sheet.getByRole('button',{name:/Stop/})).toHaveCount(0);
 // Asked straight, the server refuses a Viewer before anything reaches the Engine.
 const before=kanbanWrites().length;
 const asks=[['/api/board/card/comments',{company:rs,card,body:'Hello.'}],['/api/board/card/comments',{company:rs,card,body:'Monday.',answer:true}],
  ['/api/board/card/run',{company:rs,card:running,action:'stop'}],['/api/board/card/run',{company:rs,card,action:'continue'}]] as const;
 for(const [path,data] of asks) {
  const answer=await page.request.post(path,{data});
  expect(answer.status(),path).toBe(403);
 }
 expect(kanbanWrites().length).toBe(before);
 expect(taskOf(running)?.status).toBe('running');
 expect(kanban.comments.filter(comment=>comment.task_id===card).length).toBe(1);
});
