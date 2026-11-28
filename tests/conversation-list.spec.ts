import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #881: the sidebar and All conversations list a person's Conversations from their rows joined with one list read per
// Agent from the Engine, newest first, each by its session's title or, untitled, its first words. The list is kept as
// the last good read, so moving between pages never waits on the Engine and an Engine that stops leaves it as it was.
// A Conversation's title is its session's title and renaming writes it there; archiving is the session's own archived
// mark, and writing in an archived Conversation clears it. The fake Engine lists a profile's sessions, keeps their
// titles and archived marks, and drops a deleted profile's sessions as the pinned release does (tests/fake-hermes.mjs).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
const faye=randomUUID();
const fayeProfile=`ag-${faye.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof fakeHermes>>;
let stopped=false;
const stopFake=async()=>{ if(!stopped&&fake) { stopped=true; await fake.close(); } };
// Each Conversation is newer than the last, on the Engine's clock (seconds).
let clock=Math.floor(Date.now()/1000)-100000;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 for(const name of [profile,fayeProfile]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','${manager}')`);
 // The seed's own Conversations go, so the sidebar's twenty newest are this file's.
 query(`do $$ begin
  delete from public.conversations v where v.company_id='${company}' and not exists(select 1 from public.conversation_messages m where m.conversation_id=v.id)
   and not exists(select 1 from public.conversation_queued_turns q where q.conversation_id=v.id);
  update public.conversations set agent_id=null where company_id='${company}';
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${faye}','${company}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${faye}','${company}','${randomUUID()}','Faye','Ads',false,'${fayeProfile}');
 end $$;`);
});
test.afterAll(async()=>{ await stopFake(); });

type Talk={words:string,title?:string,person?:string,agent?:string,on?:string};
// Conversations of `person`'s with an Agent, each on its own Engine session holding one turn, made a day ago (so a
// session the Engine no longer holds is gone, not one still starting), each newer than every one before it. Their rows
// go in with one query.
function talks(list:Talk[]) {
 const made=list.map(({words,title,person=omar,agent=lead,on=profile})=>{
  const conversation=randomUUID(); const session=`session-${conversation}`;
  clock+=10;
  fake.settings.sessions.set(session,{profile:on,messages:[{role:'user',content:words,timestamp:clock},{role:'assistant',content:'Done.',timestamp:clock+1}]});
  if(title) fake.settings.sessionTitles.set(`${on}:${session}`,title);
  return {conversation,session,person,agent};
 });
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id,created_at) values ${made.map(({conversation,session,person,agent})=>
  `('${conversation}','${company}','${person}','${agent}','${agent===lead?'Lead':'Faye'}','${session}',now()-interval '1 day')`).join(',')}`);
 return made;
}
const talk=(one:Talk)=>talks([one])[0];
const sidebar=(page:Page)=>page.locator('#sb-recent .thread-row .thread-item');
const listReads=()=>fake.settings.managementRequests.filter(request=>/^\/api\/sessions\?/.test(String(request.path))).length;

test('the sidebar lists the person\'s Conversations by title, newest first, an untitled one by its first words, and never another person\'s',async({page})=>{
 test.setTimeout(120000);
 talks([{words:'Plan the spring ads',title:'Spring ads'},{words:'Write the December newsletter for the accounting course'},
  {words:'Manager only words',title:'Manager plans',person:manager},{words:'Find three new audiences',title:'Audiences',agent:faye,on:fayeProfile}]);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await expect(sidebar(page).first()).toContainText('Audiences',{timeout:20000});
 await expect(sidebar(page).nth(1)).toContainText('Write the December newsletter for the accounting course');
 await expect(sidebar(page).nth(2)).toContainText('Spring ads');
 await expect(page.locator('#sb-recent')).not.toContainText('Manager plans');
 await expect(page.locator('#sb-recent')).not.toContainText('Manager only words');
});

test('moving between two pages of the Company makes no new Engine read for the sidebar while its last read is fresh',async({page})=>{
 test.setTimeout(120000);
 const {conversation}=talk({words:'A fresh one',title:'Fresh one'});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await expect(page.locator('#sb-recent')).toContainText('Fresh one',{timeout:20000});
 const before=listReads();
 await page.locator('#sb-recent').getByRole('link',{name:'Fresh one'}).click();
 await expect(page).toHaveURL(new RegExp(`/conversations/${conversation}$`));
 await page.goto('/c/rs-learning/conversations');
 await expect(page.locator('.cv-list')).toContainText('Fresh one');
 expect(listReads()-before).toBe(0);
});

test('renaming writes the title on the Engine, and the list and the chat head show it',async({page})=>{
 test.setTimeout(120000);
 const {conversation,session}=talk({words:'Draft the webinar invite'});
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 const row=page.locator('#sb-recent .thread-row').filter({hasText:'Draft the webinar invite'});
 await expect(row).toBeVisible({timeout:20000});
 await row.hover();
 await row.getByRole('button',{name:'More: Draft the webinar invite'}).click();
 await page.getByRole('menuitem',{name:'Rename the conversation'}).click();
 const field=page.getByRole('dialog',{name:'Rename the conversation'}).getByLabel('Name');
 await expect(field).toHaveValue('Draft the webinar invite');
 await field.fill('Webinar invite');
 await field.press('Enter');
 await expect(page.getByText('Renamed')).toBeVisible();
 expect(fake.settings.sessionTitles.get(`${profile}:${session}`)).toBe('Webinar invite');
 await expect(page.locator('#sb-recent')).toContainText('Webinar invite');
 await page.reload();
 await expect(page.locator('#sb-recent')).toContainText('Webinar invite',{timeout:20000});
 // A name another of the Agent's sessions holds is refused, and says so.
 const again=page.locator('#sb-recent .thread-row').filter({hasText:'Webinar invite'});
 await again.hover();
 await again.getByRole('button',{name:'More: Webinar invite'}).click();
 await page.getByRole('menuitem',{name:'Rename the conversation'}).click();
 const second=page.getByRole('dialog',{name:'Rename the conversation'}).getByLabel('Name');
 await second.fill('Spring ads');
 await second.press('Enter');
 await expect(page.getByRole('alert').filter({hasText:'That name can’t be used'})).toBeVisible();
 expect(fake.settings.sessionTitles.get(`${profile}:${session}`)).toBe('Webinar invite');
});

test('archiving moves a Conversation to All conversations\' Archived list, and writing in it brings it back',async({page})=>{
 test.setTimeout(150000);
 const {conversation,session}=talk({words:'Shelve this one',title:'To shelve'});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const row=page.locator('#sb-recent .thread-row').filter({hasText:'To shelve'});
 await expect(row).toBeVisible({timeout:20000});
 await row.hover();
 await row.getByRole('button',{name:'More: To shelve'}).click();
 await page.getByRole('menuitem',{name:'Archive the conversation'}).click();
 await expect(page.getByText('Archived',{exact:true})).toBeVisible();
 expect(fake.settings.archivedSessions.has(`${profile}:${session}`)).toBe(true);
 await expect(page.locator('#sb-recent')).not.toContainText('To shelve');
 await page.goto('/c/rs-learning/conversations?tab=archived');
 await expect(page.locator('.cv-list')).toContainText('To shelve',{timeout:20000});
 await page.goto('/c/rs-learning/conversations');
 await expect(page.locator('.cv-body')).not.toContainText('To shelve');
 // Writing in it brings it back: the session's mark is cleared.
 await page.goto(`/c/rs-learning/conversations/${conversation}`);
 await expect(page.getByText('This conversation is archived.',{exact:false})).toBeVisible({timeout:20000});
 const box=page.getByLabel('Message',{exact:true});
 await box.fill('One more thing');
 await box.press('Enter');
 await expect.poll(()=>fake.settings.archivedSessions.has(`${profile}:${session}`),{timeout:20000}).toBe(false);
 await page.goto('/c/rs-learning/conversations');
 await expect(page.locator('.cv-list')).toContainText('To shelve',{timeout:20000});
});

test('All conversations pages by 50 and searches titles and previews',async({page})=>{
 test.setTimeout(240000);
 talks(Array.from({length:52},(_,n)=>({words:`Batch words ${n}`,...(n===3?{title:'The odd title'}:{})})));
 await signIn(page,'omar@example.com','/c/rs-learning/conversations');
 const rows=page.locator('.cv-list .cv-row');
 await expect(rows).toHaveCount(50,{timeout:30000});
 await expect(rows.first()).toContainText('Batch words 51');
 await page.getByRole('button',{name:'Show more'}).click();
 await expect(rows.nth(50)).toBeVisible();
 expect(await rows.count()).toBeGreaterThan(52);
 await page.getByRole('button',{name:'Search conversations'}).click();
 await page.getByRole('searchbox').fill('odd title');
 await expect(rows).toHaveCount(1,{timeout:20000});
 await expect(rows.first()).toContainText('The odd title');
 await expect(rows.first()).toContainText('Batch words 3');
 await page.getByRole('searchbox').fill('Batch words 17');
 await expect(rows).toHaveCount(1,{timeout:20000});
 await expect(rows.first()).toContainText('Batch words 17');
});

test('after an Agent is deleted on the Engine, its Conversations leave every list',async({page})=>{
 test.setTimeout(150000);
 talk({words:'Faye\'s second idea',title:'Faye idea',agent:faye,on:fayeProfile});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await expect(page.locator('#sb-recent')).toContainText('Faye idea',{timeout:20000});
 const removed=await fetch(`${fake.managementAddress}/api/profiles/${fayeProfile}`,{method:'DELETE',headers:{authorization:`Bearer ${fake.settings.key}`}});
 expect(removed.status).toBe(200);
 // Once its last read is no longer fresh the list is read again: the profile is gone, and so are its Conversations.
 await expect.poll(async()=>{ await page.goto('/c/rs-learning/conversations'); await page.locator('.cv-list').waitFor(); return await page.locator('.cv-list').textContent(); },{timeout:90000,intervals:[5000]}).not.toContain('Faye idea');
 await expect(page.locator('#sb-recent')).not.toContainText('Faye idea');
 await expect(page.locator('#sb-recent')).not.toContainText('Audiences');
});

test('with the Engine stopped, the sidebar keeps its last list',async({page})=>{
 test.setTimeout(120000);
 talk({words:'Kept while stopped',title:'Still here'});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await expect(page.locator('#sb-recent')).toContainText('Still here',{timeout:20000});
 await stopFake();
 // Past the read's freshness the list is asked for again, and the Engine does not answer.
 await page.waitForTimeout(16000);
 await page.goto('/c/rs-learning/conversations');
 await expect(page.locator('#sb-recent')).toContainText('Still here',{timeout:20000});
 await expect(page.locator('.cv-list')).toContainText('Still here');
 await page.reload();
 await expect(page.locator('#sb-recent')).toContainText('Still here',{timeout:20000});
});
