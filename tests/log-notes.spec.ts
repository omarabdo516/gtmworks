import { test, expect } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signIn } from './sign-in';
import { driveNoteRuns } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { dbContainerOf } from './lane.mjs';

// Notes and mentions in the log (#22). Seed people of RS Learning: Omar owns it, مدير (manager@) is a Manager, مراجع
// (reviewer@) a Contributor and مشاهد (viewer@) a Viewer.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
// Notes and the log refuse a change of time, so a test moves the clock back on them with the triggers off.
const asAdmin=(sql:string)=>execFileSync('docker',['exec','-i',dbContainerOf(),'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-q','--single-transaction'],
 { input:`set session_replication_role = replica;\n${sql}`,stdio:['pipe','ignore','pipe'],encoding:'utf8' });
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
// The install's Hermes as these runs are given it: the fake engine answers in its place (#342).
const hermes={address:'http://127.0.0.1:9',key:'fake-engine-key'};
const noteOf=(body:string)=>Number(rows(`select id from public.work_comments where body='${body}'`)[0].id);

test('the writer edits a note from its Card and again from the Activity log; both show its latest text, marked edited, until it locks',async({page})=>{
 const stamp=Date.now(), first=`First note ${stamp}`, second=`Second note ${stamp}`, third=`Third note ${stamp}`;
 await signIn(page,'manager@example.com','/c/rs-learning/work/board/2');
 const box=page.getByRole('textbox',{name:'Write a comment'});
 await expect(box).toHaveAttribute('placeholder','Comment… @ calls someone or an Agent');
 await expect(page.locator('#note-hint')).toHaveText('You can edit your note for 5 minutes only, then it locks. An agent you call answers here.');
 await box.fill(first);
 await page.getByRole('button',{name:'Post the comment'}).click();
 await expect(page.locator('.cw[open] #cw-list .lg-note').filter({hasText:first})).toBeVisible();
 const note=noteOf(first);
 const onCard=page.locator(`#note-${note}`);
 await expect(onCard.getByText(/^You can edit it for [0-4]:\d\d$/)).toBeVisible();
 await expect(onCard.getByText('Edited',{exact:true})).toHaveCount(0);
 await onCard.getByRole('button',{name:'Edit',exact:true}).click();
 await onCard.getByRole('textbox',{name:'Edit the note'}).fill(second);
 await onCard.getByRole('button',{name:'Save',exact:true}).click();
 await expect(onCard.locator('.lg-note')).toHaveText(second);
 await expect(onCard.getByText('Edited',{exact:true})).toBeVisible();

 await page.goto('/c/rs-learning/log');
 const row=page.locator(`#note-${note}`);
 await expect(row.locator('.lg-note')).toHaveText(second);
 await expect(row.getByText('Edited',{exact:true})).toBeVisible();
 await row.getByRole('button',{name:'Edit',exact:true}).click();
 await row.getByRole('textbox',{name:'Edit the note'}).fill(third);
 await row.getByRole('button',{name:'Save',exact:true}).click();
 await expect(row.locator('.lg-note')).toHaveText(third);
 await expect(row.getByRole('status')).toHaveText('Note edited; it now carries an “Edited” mark');

 await page.goto('/c/rs-learning/work/board/2');
 await expect(onCard.locator('.lg-note')).toHaveText(third);
 await expect(onCard.getByText('Edited',{exact:true})).toBeVisible();
 expect(rows(`select count(*)::int n from public.work_activity where action='comment_added' and details->>'id'='${note}'`)[0].n,'an edit is not a second comment').toBe(1);

 // Five minutes on, it is locked in both places.
 asAdmin(`update public.work_comments set created_at=created_at-interval '6 minutes' where id=${note};
  update public.company_log set created_at=created_at-interval '6 minutes' where source='work_comments' and source_id=${note};`);
 for(const path of ['/c/rs-learning/work/board/2','/c/rs-learning/log']) {
  await page.goto(path);
  await expect(page.locator(`#note-${note}`).getByText('Locked',{exact:true})).toBeVisible();
  await expect(page.locator(`#note-${note}`).getByRole('button',{name:'Edit',exact:true})).toHaveCount(0);
 }
 expect(rows(`select body from public.work_comments where id=${note}`)).toEqual([{body:third}]);
});

test('a Member named in a note finds one item in Waiting on you, and it opens the note on its Card',async({page,browser})=>{
 const body=`@مراجع please check the hook ${Date.now()}`;
 await signIn(page,'manager@example.com','/c/rs-learning/work/board/3');
 await page.getByRole('textbox',{name:'Write a comment'}).fill(body);
 await page.getByRole('button',{name:'Post the comment'}).click();
 await expect(page.locator('.cw[open] #cw-list .lg-note').filter({hasText:body})).toBeVisible();
 const note=noteOf(body);
 const title=String(rows(`select title from public.work_cards where id=3`)[0].title);

 const reviewer=await browser.newPage();
 await signIn(reviewer,'reviewer@example.com','/c/rs-learning/approvals');
 const items=reviewer.locator('.mcard[data-kind="mention"]');
 await expect(items).toHaveCount(1);
 await expect(items.locator('.mcard__who')).toHaveText(`مدير mentioned you in the log of “${title}”`);
 await expect(items.locator('.mcard__q')).toHaveText(body);
 await items.click();
 await expect(reviewer).toHaveURL(new RegExp(`/c/rs-learning/work/board/3#note-${note}$`));
 await expect(reviewer.locator(`#note-${note} .lg-note`)).toHaveText(body);
 await expect(reviewer.locator(`#note-${note}`)).toBeInViewport();
 await reviewer.close();
 expect(rows(`select person_id::text from public.waiting_items where note_id=${note}`)).toEqual([{person_id:'20000000-0000-0000-0000-000000000003'}]);
});

test('integration: a note that calls an Agent starts one Run on the fake engine, and its reply is a log row under the note; a hidden Agent is not called',async({page})=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const stamp=Date.now(); fake.settings.reply=input=>`Reply ${stamp} to: ${input}`;
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link}=await service.auth.admin.generateLink({type:'magiclink',email:'manager@example.com'});
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 const [connections,faye,secret]=[[randomUUID(),randomUUID()],randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${faye}','${company}','${connections[0]}','Faye','Marketing','fake-${connections[0].slice(0,8)}'),('${secret}','${company}','${connections[1]}','Secret','Hidden','fake-${connections[1].slice(0,8)}')`);
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${faye}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 try {
  const write=async(body:string)=>{ const {data,error}=await person.rpc('change_work_card',{c:company,card:4,operation:'comment',payload:{body}}); expect(error).toBeNull(); return data as number; };

  const hidden=await write('@Secret look at this');
  const note=await write('@Faye draft the teaser');
  expect(rows(`select note_id,agent_name from public.note_runs where note_id in (${hidden},${note}) order by note_id`)).toEqual([{note_id:note,agent_name:'Faye'}]);
  const drive=()=>driveNoteRuns(service,{hermes,engineFor:fake.engineFor,message:note});
  await Promise.all([drive(),drive()]);
  expect(fake.runs.map(run=>({key:run.key,input:run.input}))).toEqual([{key:`note:${note}`,input:'مدير: @Faye draft the teaser'}]);
  // The writer keeps the Card open while Faye works; her reply shows there without a reload.
  await signIn(page,'manager@example.com','/c/rs-learning/work/board/4');
  await expect(page.locator(`#note-${note} .note-working`)).toContainText('Faye · Working on the request from مدير…');
  const under=page.locator(`#note-${note} + li`);
  const reads=await Promise.all([drive(),drive()]);
  expect(reads[0].closed+reads[1].closed).toBe(1);
  expect(await drive()).toEqual({started:0,closed:0});
  expect(fake.runs).toHaveLength(1);
  const reply=`Reply ${stamp} to: مدير: @Faye draft the teaser`;
  expect(rows(`select actor_name,action,body,details->>'reply_to' reply_to from public.company_log where source='note_runs' and source_id=${note}`)).toEqual([{actor_name:'Faye',action:'note_reply',body:reply,reply_to:String(note)}]);

  await expect(under).toContainText('replied in the log',{timeout:15000});
  await expect(under.locator('.lg-name')).toHaveText('Faye');
  await expect(under.locator('.lg-note')).toHaveText(reply);
  await expect(page.locator(`#note-${note} .note-working`)).toHaveCount(0);
  await page.goto('/c/rs-learning/log?card=4');
  const replyRow=page.locator('.lgp-body .lg-row').filter({hasText:reply});
  await expect(replyRow).toHaveCount(1);
  await expect(replyRow.locator('.lg-name')).toHaveText('Faye');
  await expect(replyRow.locator('.lg-act')).toHaveText('replied in the log');
 } finally {
  query(`delete from public.hermes_agents where id in ('${faye}','${secret}')`);
 }
});

test('a Viewer reads a Card\'s notes with no note field, and the view-only line in its place',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/work/board/1');
 await expect(page.locator('.cw[open]')).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Write a comment'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Post the comment'})).toHaveCount(0);
 await expect(page.locator('.cw[open] .cw-comp .ro-line')).toHaveText('Read only');
});
