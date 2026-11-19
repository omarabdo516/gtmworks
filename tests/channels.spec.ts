import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Browser } from '@playwright/test';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const general='/c/rs-learning/channels/69000000-0000-0000-0000-000000000001';
const contributor='20000000-0000-0000-0000-000000000003';
const company='10000000-0000-0000-0000-000000000001';
let fake:Awaited<ReturnType<typeof laneHermes>>;

// Another seeded person signed in on a context of their own, as team-channels.spec.ts does.
async function as(browser:Browser,email:string,path:string) {
 const context=await browser.newContext(); const page=await context.newPage();
 await signIn(page,email,path);
 return {page,close:()=>context.close()};
}

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{ freshSeed(testInfo.file); fake=await laneHermes(); });
test.afterAll(async()=>{ await fake?.close(); });

test('a Member opens the general channel, reads that an Agent replies only when called, and posts a message that starts no Run',async({page})=>{
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 const link=page.locator('.sidebar .ch-item');
 await expect(link).toHaveText('general');
 await link.click();
 await expect(page).toHaveURL(general);
 await expect(link).toHaveAttribute('aria-current','true');
 const box=page.getByRole('textbox',{name:'Write your message in the channel',exact:true});
 await expect(box).toHaveAttribute('placeholder','Write in #general… an agent replies only when called by name');
 await expect(page.locator('.ch-intro')).toContainText('Agents read and reply only when someone calls them by name. Ordinary talk between members goes to no agent.');
 await expect(page.locator('#details')).toContainText('“general” always has everyone in the company.');
 await box.fill('Morning, team');
 await box.press('Enter');
 const mine=page.locator('.turn--user .bubble--user');
 await expect(mine).toHaveText('Morning, team');
 await expect(box).toHaveValue('');
 await expect(page.locator('.thinking')).toHaveCount(0);
 await page.reload();
 await expect(mine).toHaveText('Morning, team');
 expect(rows(`select count(*)::int n from public.channel_runs`)[0].n).toBe(0);
 expect(rows(`select author_name,body from public.channel_messages where person_id='${contributor}'`)).toEqual([{author_name:'مراجع',body:'Morning, team'}]);
});

test('the Viewer reads the channel, with the writer and their role, and has no composer',async({page})=>{
 await signIn(page,'viewer@example.com',general);
 const peer=page.locator('.turn--peer');
 await expect(peer.locator('.bubble--peer')).toHaveText('Morning, team');
 await expect(peer.locator('.sender')).toContainText('مراجع');
 await expect(peer.locator('.sender__role')).toHaveText('Contributor');
 await expect(page.locator('.composer')).toHaveCount(0);
 await expect(page.locator('.ro-line')).toContainText('Your account is view-only');
});

// #148: an Agent's channel reply carries its Run's steps, read live from its Hermes session when the channel opens, and
// the review card it showed, drawn by the same components a Conversation uses; every member of the channel reads them,
// a Viewer included. The session is the fake Hermes's, on the profile the Run was pinned to.
test('a channel reply shows its Run\'s steps and its review card to the channel\'s members',async({page})=>{
 const lead=String(rows(`select id from public.hermes_agents where company_id='${company}' and is_default order by id limit 1`)[0].id);
 const session=randomUUID(); const profile=`ag-148-${randomUUID().slice(0,8)}`; const run=`run-148-${randomUUID().slice(0,8)}`;
 const sent=Date.parse('2026-11-16T10:12:00Z')/1000;
 query(`do $$ declare asked bigint; begin
  insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key,created_at)
   values ('${company}','69000000-0000-0000-0000-000000000001','person','${contributor}','مراجع','@Lead review the December scripts','${randomUUID()}','2026-11-16T10:12:00Z') returning id into asked;
  insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to,created_at)
   values ('${company}','69000000-0000-0000-0000-000000000001','agent','${lead}','Lead','I reviewed the three scripts.',asked,'2026-11-16T10:14:00Z');
  insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,instructions,run_id,profile,attempts,attempted_at,outcome,closed_at)
   values (asked,'${company}','69000000-0000-0000-0000-000000000001','${lead}','Lead','${session}','مراجع: @Lead review the December scripts',null,'${run}','${profile}',1,now(),'completed',now());
  insert into public.reply_cards(company_id,channel_message_id,run_id,call_id,kind,title,content,state) values
   ('${company}',asked,'${run}','call-1','review','December scripts review','{"line":"3 scripts · Meta Ads","items":[{"text":"من خريج تجارة لمحاسب شغال","fine":true,"note":"The promise is clear."},{"text":"أضمن طريق لأول وظيفة","fine":false,"note":"Swap the promise."}],"decision":"1 ready, 1 back to Ads"}','shown'),
   ('${company}',asked,'${run}','call-2','draft','December scripts','{"line":"Draft · Meta Ads","rows":[{"label":"Scripts","value":"3"}]}','shown');
 end $$;`);
 const call=(id:string,name:string,args:object)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
 fake.settings.sessions.set(session,{profile,messages:[
  {role:'user',content:'@Lead review the December scripts',timestamp:sent+1},
  {role:'assistant',content:'',tool_calls:[call('call_1','meta_ads',{query:'October results'}),call('call_2','docs',{path:'scripts.md'})],timestamp:sent+3},
  {role:'tool',tool_call_id:'call_1',tool_name:'meta_ads',content:'{"results":[]}',timestamp:sent+10},
  {role:'tool',tool_call_id:'call_2',tool_name:'docs',content:'{"success":false,"error":"not found"}',timestamp:sent+12},
  {role:'assistant',content:'I reviewed the three scripts.',timestamp:sent+42}]});
 await signIn(page,'reviewer@example.com',general);
 const toggle=page.locator('.steps__toggle');
 await expect(toggle).toHaveText('Used 2 tools · 41 sec');
 await toggle.click();
 await expect(page.locator('.steps__list .step')).toHaveText(['meta_ads · October resultsDone','docs · scripts.mdSkipped']);
 const card=page.locator('.reply-card--review');
 await expect(card).toBeVisible();
 await expect(card.locator('.card__title')).toHaveText('December scripts review');
 await expect(card.locator('.rv-item')).toHaveCount(2);
 await expect(card.locator('.rv-decision__t')).toHaveText('1 ready, 1 back to Ads');
 await page.reload();
 await expect(page.locator('.reply-card--review')).toBeVisible();
});

// #200: a Member named with @ in a channel message finds it at the top of "Waiting on you" under "Mentions of you", with
// who mentioned them, where and the message; pressing it opens the channel at that message, ringed for a moment, and the
// item leaves the list and the counts. Opening the channel any other way leaves it waiting. A Viewer is mentioned and
// reads their own as anyone else does.
test('a Member mentioned in a channel finds it under "Mentions of you", and pressing it opens the channel at the message and clears it',async({page,context})=>{
 const count=async()=>Number(await page.locator('.sb-count__n').first().innerText());
 await signIn(page,'viewer@example.com','/c/rs-learning/approvals');
 const viewerBefore=await count();
 await context.clearCookies();
 await signIn(page,'reviewer@example.com',general);
 const box=page.getByRole('textbox',{name:'Write your message in the channel',exact:true});
 for(const text of ['@مشاهد شوف الخطة','@مدير شوف الخطة']) {
  await box.fill(text); await box.press('Enter');
  await expect(page.locator('.turn--user .bubble--user').last()).toHaveText(text);
  await expect(box).toHaveValue('');
 }
 expect(rows(`select count(*)::int n from public.waiting_items where kind='channel_mention'`)[0].n).toBe(2);

 // The Viewer's own item: under "Mentions of you", above the Cards, counted in the sidebar.
 await context.clearCookies();
 await signIn(page,'viewer@example.com','/c/rs-learning/approvals');
 await expect.poll(count).toBe(viewerBefore+1);
 const card=page.locator('a.mcard[data-kind="channel_mention"]');
 await expect(card).toHaveCount(1);
 await expect(card.locator('.mcard__who')).toHaveText('مراجع mentioned you in #general');
 await expect(card.locator('.mcard__q .mention')).toHaveText('@مشاهد');
 await expect(card.locator('.mcard__q')).toHaveText('@مشاهد شوف الخطة');
 expect(await card.evaluate(node=>node.closest('.mn-group')?.querySelector('.mn-h')?.textContent)).toBe('Mentions of you 1');
 // Opening the channel any other way leaves the item waiting.
 await page.locator('.sidebar .ch-item').click();
 await expect(page).toHaveURL(general);
 await page.goto('/c/rs-learning/approvals');
 await expect(card).toHaveCount(1);
 expect(await count()).toBe(viewerBefore+1);
 // Pressing it opens the channel at that message, ringed for a moment.
 await card.click();
 await expect(page).toHaveURL(new RegExp(`^${general}`));
 const bubble=page.locator('.bubble--peer').filter({hasText:'@مشاهد شوف الخطة'});
 await expect(bubble).toBeInViewport();
 await expect(bubble).toHaveClass(/is-spot/);
 await expect(page).not.toHaveURL(/#mention-/);
 // And it is gone from the list and the counts.
 await page.goto('/c/rs-learning/approvals');
 await expect(card).toHaveCount(0);
 await expect.poll(count).toBe(viewerBefore);

 // The Manager's own item, read and cleared the same way.
 await context.clearCookies();
 await signIn(page,'manager@example.com','/c/rs-learning/approvals');
 const managerCard=page.locator('a.mcard[data-kind="channel_mention"]');
 await expect(managerCard).toHaveCount(1);
 await expect(managerCard.locator('.mcard__q .mention')).toHaveText('@مدير');
 await managerCard.click();
 await expect(page).toHaveURL(new RegExp(`^${general}`));
 await expect(page.locator('.bubble--peer').filter({hasText:'@مدير شوف الخطة'})).toBeInViewport();
 await page.goto('/c/rs-learning/approvals');
 await expect(managerCard).toHaveCount(0);
});

// #151: a channel's work gets a Card. The first Agent called in a team channel puts one Card under "In progress", named
// for the channel; the channel's details show "On the board" and its top corner the pill; a second call makes no second
// Card; and the Card's sheet shows the channel under Chat to its members (a Viewer reads it, a writer writes) and the
// lock to a Member outside it. The database rules per Role are in supabase/tests/channel_card.sql.
test('a channel\'s first Agent call puts one Card on the board, and its sheet shows the channel to its members and the lock to a Member outside it',async({page,browser})=>{
 const key=randomUUID();
 query(`do $$ declare ch uuid; msg bigint; agent uuid; begin
  select id into agent from public.hermes_agents where company_id='${company}' and is_default order by id limit 1;
  insert into public.channels(company_id,kind,name,created_by,create_key) values('${company}','team','Board week','${contributor}','${key}') returning id into ch;
  insert into public.channel_people(channel_id,company_id,person_id)
   values(ch,'${company}','${contributor}'),(ch,'${company}','20000000-0000-0000-0000-000000000004');
  insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key)
   values('${company}',ch,'person','${contributor}','مراجع','@Lead plan the week','${randomUUID()}') returning id into msg;
  insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input)
   values(msg,'${company}',ch,agent,(select name from public.hermes_agents where id=agent),gen_random_uuid(),'مراجع: @Lead plan the week');
  perform public.close_channel_run(msg,null,'completed','Here is the plan.',null,null);
 end $$;`);
 const channel=String(rows(`select id from public.channels where create_key='${key}'`)[0].id);
 const card=rows(`select id,title from public.work_cards where channel_id='${channel}'`);
 expect(card).toHaveLength(1);
 expect(card[0].title).toBe('Board week');
 expect(rows(`select count(*)::int n from public.company_log where action='channel_card_added' and card_id=${card[0].id}`)[0].n).toBe(1);
 expect(rows(`select count(*)::int n from public.channel_notes where kind='card' and card_id=${card[0].id}`)[0].n).toBe(1);
 const cardId=String(card[0].id);

 // The Member who called the Agent reads the pill and the section, and the Card on the board at its foot "Channel".
 await signIn(page,'reviewer@example.com',`/c/rs-learning/channels/${channel}`);
 const pill=page.locator('.chat__corner .corner-pill');
 await expect(pill).toBeVisible();
 await expect(pill).toContainText('On the board:');
 await expect(pill).toContainText('In progress');
 await expect(pill).toHaveAttribute('href',`/c/rs-learning/work/board?show=${cardId}`);
 await expect(page.locator('#details')).toContainText('On the board');
 await expect(page.locator('#details .panel-row').filter({hasText:'Board week'})).toContainText('In progress');
 await pill.click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/work/board\\?show=${cardId}$`));
 await expect(page.locator(`.kcard[data-card-id="${cardId}"]`)).toContainText('Board week');
 await expect(page.locator(`.kcard[data-card-id="${cardId}"] .kcard__job`)).toContainText('Channel');

 // The Card's sheet, as a Member of the channel: the channel under Chat, and a message written there saves.
 await page.goto(`/c/rs-learning/work/board?card=${cardId}`);
 const sheet=page.getByRole('dialog',{name:'Board week'});
 await expect(sheet.getByRole('tab',{name:'Chat'})).toHaveAttribute('aria-selected','true');
 await expect(sheet.locator('.sheet__meta')).toContainText('Channel #Board week');
 await expect(sheet.locator('.hp-hash')).toBeVisible();
 await expect(sheet.getByText('Here is the plan.')).toBeVisible();
 const box=sheet.getByRole('textbox',{name:'Write your message in the channel'});
 await box.fill('Morning, team'); await box.press('Enter');
 await expect.poll(()=>rows(`select count(*)::int n from public.channel_messages where channel_id='${channel}' and body='Morning, team'`)[0].n).toBe(1);

 // A second call makes no second Card, and a second Agent that answers joins "Worked on it:".
 query(`do $$ declare msg bigint; agent uuid; begin
  select id into agent from public.hermes_agents where company_id='${company}' and is_default order by id limit 1;
  insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key)
   values('${company}','${channel}','person','${contributor}','مراجع','@Lead one more thing','${randomUUID()}') returning id into msg;
  insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input)
   values(msg,'${company}','${channel}',agent,(select name from public.hermes_agents where id=agent),gen_random_uuid(),'مراجع: @Lead one more thing');
  perform public.close_channel_run(msg,null,'completed','And another line.',null,null);
 end $$;`);
 expect(rows(`select count(*)::int n from public.work_cards where channel_id='${channel}'`)[0].n).toBe(1);

 // A Viewer in the channel reads the pill, the section and the channel in the sheet, and writes nothing.
 const viewer=await as(browser,'viewer@example.com',`/c/rs-learning/channels/${channel}`);
 try {
  await expect(viewer.page.locator('.chat__corner .corner-pill')).toBeVisible();
  await expect(viewer.page.locator('#details')).toContainText('On the board');
  await viewer.page.goto(`/c/rs-learning/work/board?card=${cardId}`);
  const seen=viewer.page.getByRole('dialog',{name:'Board week'});
  await expect(seen.getByRole('tab',{name:'Chat'})).toHaveAttribute('aria-selected','true');
  await expect(seen.getByText('Here is the plan.')).toBeVisible();
  await expect(seen.getByRole('textbox',{name:'Write your message in the channel'})).toHaveCount(0);
 } finally { await viewer.close(); }

 // The Owner is not in the channel: the Card opens on its log, and its Chat tab is a lock with no message of the channel.
 const owner=await as(browser,'omar@example.com',`/c/rs-learning/work/board?card=${cardId}`);
 try {
  const locked=owner.page.getByRole('dialog',{name:'Board week'});
  await expect(locked.getByRole('tab',{name:/^Log/})).toHaveAttribute('aria-selected','true');
  await locked.getByRole('tab',{name:'Chat'}).click();
  await expect(locked.getByRole('heading',{name:'#Board week'})).toBeVisible();
  await expect(locked.getByText('This card came from a channel. Its members read and write there; you can read the card’s log.')).toBeVisible();
  await expect(locked.getByText('Here is the plan.')).toHaveCount(0);
  await expect(locked.getByRole('textbox')).toHaveCount(0);
 } finally { await owner.close(); }
});
