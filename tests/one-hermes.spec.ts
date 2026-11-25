import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { i18n } from '../lib/i18n.mjs';

// #342: the bundled Hermes is the only Hermes. A conversation, a Card note and a channel message that call Lead each
// start their Run on the Company's own profile of the Hermes the app and the worker are given (scripts/web.sh), with
// no Connection anywhere.
const company='10000000-0000-0000-0000-000000000001';
const channel='69000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

test('a conversation, a Card note and a channel message each start their Run on the Company\'s own profile of the bundled Hermes',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes(); fake.settings.pendingReads=1e9;
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const lead=randomUUID();
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${lead}','${company}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) select id,'${profile}',true,true from public.companies where id='${company}'
   on conflict (company_id) do update set tools_confirmed=true,tools_pending=false,skills_shared=true;
 end $$;`);
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const talk=await page.request.post('/api/conversations',{data:{company,conversation:randomUUID(),sendKey:randomUUID(),agent:lead,message:'Plan the launch week'}});
  expect(talk.status()).toBe(200);
  const said=await page.request.post('/api/channels',{data:{company,channel,sendKey:randomUUID(),message:'@Lead plan the teaser posts'}});
  expect(said.status()).toBe(200);
  // A note that calls Lead, written on the Card as a person writes it: sending it starts its Run (work-actions.ts). The
  // worker's own pass picks up a note nobody started only a minute later (note_runs_due), which is no part of this.
  await page.goto('/c/rs-learning/work/board/4');
  const tr=await page.evaluate(()=>document.documentElement.lang).then(lang=>i18n(lang==='ar'?'ar':'en').t);
  // Its own words: a retry on the same lane keeps the file's data, so an earlier note may already be on the Card.
  const note=`@Lead draft the caption ${randomUUID()}`;
  await page.getByRole('textbox',{name:tr('cwCommentLabel')}).fill(note);
  await page.getByRole('button',{name:tr('cwPost')}).click();
  await expect(page.locator('.cw[open] #cw-list .lg-note').filter({hasText:note})).toBeVisible();
  const runs=()=>fake.settings.requests.filter(request=>request.method==='POST'&&/\/v1\/runs$/.test(request.path??'')).map(request=>request.path);
  await expect.poll(()=>runs().length,{timeout:30000}).toBe(3);
  expect(runs()).toEqual(Array(3).fill(`/p/${profile}/v1/runs`));
  const inputs=fake.settings.runs.map(run=>run.input);
  for(const asked of ['Plan the launch week',note,'@Lead plan the teaser posts']) expect(inputs.filter(input=>input.includes(asked)),asked).toHaveLength(1);
 } finally {
  query(`delete from public.hermes_agents where id='${lead}'`);
  await fake.close();
 }
});
