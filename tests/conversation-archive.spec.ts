import { test, expect, laneRows, type Page } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const owner='20000000-0000-0000-0000-000000000001';

// Nour on a profile of the lane's fake Hermes, the install's one Hermes (#342).
// Nour runs on an Engine profile of its own, as an Agent the Company made does (its archived mark is written there, #881).
function attachNour() {
 const id=randomUUID(); const [profile,connection]=[`ag-${id.replaceAll('-','')}`,randomUUID()];
 query(`do $$ begin
  insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${company}','co-'||replace('${company}','-',''),true)
   on conflict (company_id) do nothing;
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${id}','${company}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${id}','${company}','${connection}','Nour','Marketing',false,'${profile}');
 end $$;`);
 return {id,profile};
}
async function ownerSignIn(page:Page,path:string) {
 query(`update public.people set language='en' where id='${owner}'`);
 await signIn(page,'omar@example.com',path);
}
// The Owner's Conversations with Nour, one an hour apart, the last written newest.
function conversations(agent:string,titles:string[]) {
 return titles.map((title,index)=>{
  const id=randomUUID();
  query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${id}','${company}','${owner}','${agent}','Nour')`);
  query(`insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,run_id,send_key,created_at)
   values ('${company}','${id}','person','${owner}','Omar','${title}','r-${id}',gen_random_uuid(),now()-make_interval(hours=>${titles.length-index}))`);
  query(`insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id,created_at)
   values ('${company}','${id}','agent','${agent}','Nour','Done: ${title}','r-${id}',now()-make_interval(hours=>${titles.length-index}))`);
  return id;
 });
}
test.use({actionTimeout:15000});

test('A person archives their Conversation from its head while its Agent replies: one confirmation names what stops, Undo brings it back, and writing in it brings it back too; the archive is the own mark of its Engine session, and nothing is archived while the Engine cannot take it',async({page})=>{
 test.setTimeout(150000);
 const fake=await laneHermes();
 const nour=attachNour();
 fake.settings.profiles.set(nour.profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 try {
  await ownerSignIn(page,`/c/rs-learning/chat/${nour.id}`);
  const title=`Plan the launch ${Date.now()}`;
  await page.getByLabel('Message',{exact:true}).fill(title);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  const conversation=page.url().split('/').pop()!;
  // Its first reply names the Engine's session; the next message's Run is still going.
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${title}`);
  fake.settings.pendingReads=1e9;
  await page.getByLabel('Message',{exact:true}).fill('And the budget');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(()=>fake.settings.runs.length).toBe(2);
  const recent=page.locator('#sb-recent .thread-row').filter({hasText:title});
  await expect(recent).toHaveCount(1);

  // The archive is the session's own archived mark (#881): while the Engine cannot take it, nothing is archived.
  fake.settings.sessionMarkStatus=503;
  const archiveFromHead=async()=>{
   await page.getByRole('button',{name:'More: this conversation'}).click();
   await page.getByRole('menuitem',{name:'Archive the conversation'}).click();
  };
  await archiveFromHead();
  const dialog=page.getByRole('dialog',{name:'Archive the conversation?'});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.cf-row')).toHaveText([`Nour stops working on “${title}”`]);
  await dialog.getByRole('button',{name:'Cancel'}).click();
  await expect(dialog).toHaveCount(0);
  await archiveFromHead();
  await page.getByRole('dialog',{name:'Archive the conversation?'}).getByRole('button',{name:'Archive and stop'}).click();
  await expect(page.locator('.toast').filter({hasText:'Nothing was archived'})).toBeVisible();
  await expect(recent).toHaveCount(1);
  await expect(page.locator('.arc-line')).toHaveCount(0);
  expect(fake.settings.archivedSessions.has(`${nour.profile}:${conversation}`)).toBe(false);

  // Once it answers, archiving marks the session at once, and gtmworks keeps no mark of its own.
  fake.settings.sessionMarkStatus=null;
  await archiveFromHead();
  await page.getByRole('dialog',{name:'Archive the conversation?'}).getByRole('button',{name:'Archive and stop'}).click();
  const toast=page.locator('.toast').filter({hasText:'Archived'});
  await expect(toast).toBeVisible();
  await expect(page.locator('.arc-line')).toHaveText('This conversation is archived. Writing in it brings it back to your recent chats.');
  await expect(recent).toHaveCount(0);
  expect(fake.settings.archivedSessions.has(`${nour.profile}:${conversation}`)).toBe(true);
  expect(rows(`select archived_at from public.conversations where id='${conversation}'`)[0].archived_at).toBeNull();

  // Undo brings it back to the recent chats. It lasts as long as its toast (app/toast.tsx), so it is pressed before the
  // Engine is asked whether the Run stopped, which the Engine keeps once told (#746).
  await toast.getByRole('button',{name:'Undo'}).click();
  await expect.poll(()=>fake.settings.runs[1].stopped,{message:'the Run is stopped in the Engine'}).toBe(true);
  await expect(page.locator('.toast').filter({hasText:'Restored'})).toBeVisible();
  await expect(recent).toHaveCount(1);
  await expect(page.locator('.arc-line')).toHaveCount(0);
  expect(fake.settings.archivedSessions.has(`${nour.profile}:${conversation}`)).toBe(false);
  // Archived again once its stopped Run has closed, so nothing is left to stop: no confirmation.
  await expect.poll(()=>rows(`select count(*)::int as n from public.conversation_run_ends where conversation_id='${conversation}'`)[0].n,{timeout:30000}).toBe(2);
  await archiveFromHead();
  await expect(page.locator('.toast').filter({hasText:'Archived'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(fake.settings.archivedSessions.has(`${nour.profile}:${conversation}`)).toBe(true);
  expect(fake.settings.sessionMarks.every(mark=>Object.keys(mark.body).join()==='archived'),'the archived flag alone: nothing else of the session, nor the Agent\'s memory').toBe(true);

  // A message written in it brings it back, and the Engine's mark is taken off.
  fake.settings.pendingReads=0;
  await page.getByLabel('Message',{exact:true}).fill('Back to it');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.toast').filter({hasText:'The conversation is back in your recent chats'})).toBeVisible();
  await expect(page.locator('.arc-line')).toHaveCount(0);
  await expect(recent).toHaveCount(1);
  await expect(page.locator('.msg[data-author=agent]').last()).toContainText('Reply to: Back to it');
  await expect.poll(()=>fake.settings.archivedSessions.has(`${nour.profile}:${conversation}`),{timeout:30000}).toBe(false);
 } finally { await fake.close(); }
});

test('A person archives several Conversations from All conversations and one from the sidebar, with Undo, and restores them from Archived',async({page})=>{
 test.setTimeout(120000);
 const nour=attachNour();
 const mark=randomUUID().slice(0,6); const [june,july,august]=[`Ads for June ${mark}`,`Ads for July ${mark}`,`Ads for August ${mark}`];
 const [first,second,third]=conversations(nour.id,[june,july,august]);
 await ownerSignIn(page,'/c/rs-learning/conversations');
 const list=page.locator('.cv-list .cv-row');
 const titled=(title:string)=>list.filter({hasText:title});
 await expect(titled(mark)).toHaveCount(3);
 const counted=async(name:'Current'|'Archived')=>Number((await page.getByRole('button',{name:new RegExp(`^${name} \\d+$`)}).getAttribute('aria-label'))!.split(' ')[1]);
 const count=await counted('Current'); const before=await counted('Archived');

 // Several at once: select two, archive them, then Undo.
 await page.getByRole('button',{name:'Select several conversations'}).click();
 const bar=page.getByRole('region',{name:'Selecting conversations'});
 await expect(bar.getByRole('button',{name:'Archive'})).toBeDisabled();
 await page.getByRole('checkbox',{name:`Select ${june}`}).click();
 await page.getByRole('checkbox',{name:`Select ${july}`}).click();
 await expect(bar).toContainText('2 selected');
 await bar.getByRole('button',{name:'Archive'}).click();
 const toast=page.locator('.toast').filter({hasText:'2 archived'});
 await expect(toast).toBeVisible();
 await expect(titled(mark)).toHaveCount(1);
 await expect(page.getByRole('button',{name:`Current ${count-2}`})).toBeVisible();
 await expect(page.getByRole('button',{name:`Archived ${before+2}`})).toBeVisible();
 // Read on the lane's database at once (laneRows): Undo lasts only as long as its toast (app/toast.tsx), and a read
 // through the Supabase CLI took up to 8 s on a loaded runner, past it (#746).
 expect(laneRows(`select count(*)::int as n from public.conversations where id in ('${first}','${second}') and archived_by='${owner}'`)[0].n).toBe(2);
 await toast.getByRole('button',{name:'Undo'}).click();
 await expect(page.locator('.toast').filter({hasText:'2 restored'})).toBeVisible();
 await expect(titled(mark)).toHaveCount(3);

 // One from its row, and one from the sidebar's menu.
 await titled(june).hover();
 await page.getByRole('button',{name:`Archive ${june}`}).click();
 await expect(page.locator('.toast').filter({hasText:'Archived'})).toBeVisible();
 await expect(titled(june)).toHaveCount(0);
 const recent=page.locator('#sb-recent .thread-row').filter({hasText:august});
 await recent.hover();
 await recent.getByRole('button',{name:`More: ${august}`}).click();
 await page.getByRole('menuitem',{name:'Archive the conversation'}).click();
 await expect(page.locator('#sb-recent .thread-row').filter({hasText:august})).toHaveCount(0);
 expect(rows(`select count(*)::int as n from public.conversations where id in ('${first}','${third}') and archived_at is not null`)[0].n).toBe(2);

 // Archived holds them, newest message first; Restore brings one back, then the other.
 await page.getByRole('button',{name:/^Archived \d+$/}).click();
 await expect(page).toHaveURL(/tab=archived$/);
 await expect(list).toHaveCount(before+2);
 await expect(titled(mark).first()).toContainText(august);
 await list.first().hover();
 await page.getByRole('button',{name:`Restore ${august}`}).click();
 await expect(page.locator('.toast').filter({hasText:'Restored'})).toBeVisible();
 await expect(list).toHaveCount(before+1);
 await expect(page.locator('#sb-recent .thread-row').filter({hasText:august})).toHaveCount(1);
 await page.getByRole('button',{name:'Select several conversations'}).click();
 await page.getByRole('button',{name:'Select all shown'}).click();
 await page.getByRole('region',{name:'Selecting conversations'}).getByRole('button',{name:'Restore'}).click();
 await expect(page.getByText('No archived conversations')).toBeVisible();
 expect(rows(`select count(*)::int as n from public.conversations where id in ('${first}','${second}','${third}') and archived_at is null`)[0].n).toBe(3);
});
