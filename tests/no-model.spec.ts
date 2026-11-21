import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { noProviderError as noProvider, creditExhaustedError, apiKeyRefusedError, signInRefusedError, modelMissingError } from './fake-hermes.mjs';
import { signIn } from './sign-in';

// #422, on the app: a Company with no model at all (no provider key in its shared space, no subscription signed in)
// says so above the composer before anyone writes, and a reply its Engine fails for that cause (no_provider_configured)
// says so in the chat instead of offering a retry. The Owner gets the way to Settings, Subscription and models; a
// Member is told to ask the Owner. Once a key is given, the notice is gone.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`;
const line='This company has no AI subscription or model key connected yet, so its agents can’t reply.';
const connect='Connect one in Subscription and models';
const askOwner='Ask the company’s Owner to connect one in Settings.';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 // The Company's space and Lead's profile, with no key and no sign-in.
 for(const name of [space,co]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},env:{}});
 fake.settings.ending='failed'; fake.settings.failure=noProvider; fake.settings.pendingReads=0;
 query(`do $$ begin
  update public.hermes_agents set is_default=false where company_id='${company}' and is_default;
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('e4220000-0000-0000-0000-000000000001','${company}','e4220000-0000-0000-0000-000000000011','Lead','General',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills') on conflict do nothing;
  update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const notice=(page:Page)=>page.locator('.composer-area [data-no-model]');
// The message goes from the empty chat, which moves to the Conversation; the Engine fails its Run for want of a model.
async function sendFromEmptyChat(page:Page,text:string) {
 await page.getByLabel('Message',{exact:true}).fill(text);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
 return page.url().split('/').at(-1)!;
}

test('the Owner sees the notice before writing, and the failed reply links to Subscription and models',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/chat');
 await expect(notice(page)).toContainText(line);
 await expect(notice(page).getByRole('link',{name:connect})).toHaveAttribute('href','/c/rs-learning/settings?section=models');
 await expect(notice(page)).not.toContainText(askOwner);
 const conversation=await sendFromEmptyChat(page,'Plan the launch week');
 const failed=page.locator('[data-outcome=no-model]');
 await expect(failed).toContainText(line);
 await expect(failed.getByRole('link',{name:connect})).toHaveAttribute('href','/c/rs-learning/settings?section=models');
 await expect(page.getByText('Send the message again to retry.')).toHaveCount(0);
 expect(JSON.parse(query(`select outcome from public.conversation_run_ends where conversation_id='${conversation}'`))).toEqual([{outcome:'no_model'}]);
});

test('a Member sees the same notice and line, telling them to ask the Owner, with no link',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/chat');
 await expect(notice(page)).toContainText(`${line} ${askOwner}`);
 await expect(notice(page).getByRole('link')).toHaveCount(0);
 await sendFromEmptyChat(page,'Draft the welcome post');
 const failed=page.locator('[data-outcome=no-model]');
 await expect(failed).toContainText(`${line} ${askOwner}`);
 await expect(failed.getByRole('link')).toHaveCount(0);
});

// #428: a channel Run its Engine fails for the same cause says so in the channel, in the same words, and is kept as
// no_model, instead of "Lead couldn't reply".
test('a channel Run the Engine fails for want of a model says so in the channel, with the way to Subscription and models',async({page})=>{
 const general='69000000-0000-0000-0000-000000000001';
 await signIn(page,'omar@example.com',`/c/rs-learning/channels/${general}`);
 await page.getByRole('textbox',{name:'Write your message in the channel'}).fill('@Lead plan the channel week');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const failed=page.locator('[data-outcome=no-model]');
 await expect(failed).toContainText(line);
 await expect(failed.getByRole('link',{name:connect})).toHaveAttribute('href','/c/rs-learning/settings?section=models');
 await expect(page.getByText('Lead couldn’t reply to this message.')).toHaveCount(0);
 expect(JSON.parse(query(`select r.outcome from public.channel_runs r join public.channel_messages m on m.id=r.message_id
  where m.channel_id='${general}' and m.body='@Lead plan the channel week'`))).toEqual([{outcome:'no_model'}]);
});

// #457: a model error a retry cannot fix is closed with its own outcome and says so, and the Owner gets the way to the
// Agent's model in Subscription and models.
const refusedFix='Check the agent’s model in Subscription and models';
test('a reply the Engine fails for no credit, a refused key or sign-in, or a missing model records why, and says so',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/chat');
 for(const [failure,outcome,line] of [
  [creditExhaustedError,'no_credit','Lead could not reply: the company’s model key has no credit left.'],
  [apiKeyRefusedError,'key_refused','Lead could not reply: the model provider refused the company’s key or sign-in.'],
  [signInRefusedError,'key_refused','Lead could not reply: the model provider refused the company’s key or sign-in.'],
  [modelMissingError,'model_missing','Lead could not reply: its model is not available from the provider.'],
 ] as const) {
  fake.settings.failure=failure;
  await page.goto('/c/rs-learning/chat');
  const conversation=await sendFromEmptyChat(page,`Plan the ${outcome} week`);
  const failed=page.locator(`[data-outcome="${outcome.replace('_','-')}"]`);
  await expect(failed).toContainText(line);
  await expect(failed.getByRole('link',{name:refusedFix})).toHaveAttribute('href','/c/rs-learning/settings?section=models');
  await expect(page.getByText('Send the message again to retry.')).toHaveCount(0);
  expect(JSON.parse(query(`select outcome from public.conversation_run_ends where conversation_id='${conversation}'`))).toEqual([{outcome}]);
 }
});

// #530: a channel Run, and a Card note's Run, whose model call cannot succeed on a retry keep the cause and say it where
// the Run was asked for, with the Owner's way to the Agent's model, instead of "Lead couldn't reply" or nothing at all.
test('a channel Run the Engine fails for no credit records why, and says so in the channel',async({page})=>{
 const general='69000000-0000-0000-0000-000000000001';
 fake.settings.failure=creditExhaustedError;
 await signIn(page,'omar@example.com',`/c/rs-learning/channels/${general}`);
 await page.getByRole('textbox',{name:'Write your message in the channel'}).fill('@Lead plan the credit week');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const failed=page.locator('[data-outcome=no-credit]');
 await expect(failed).toContainText('Lead could not reply: the company’s model key has no credit left.');
 await expect(failed.getByRole('link',{name:refusedFix})).toHaveAttribute('href','/c/rs-learning/settings?section=models');
 await expect(page.getByText('Lead couldn’t reply to this message.')).toHaveCount(0);
 expect(JSON.parse(query(`select r.outcome from public.channel_runs r join public.channel_messages m on m.id=r.message_id
  where m.channel_id='${general}' and m.body='@Lead plan the credit week'`))).toEqual([{outcome:'no_credit'}]);
});

test('a Card note whose Run the Engine fails for want of a model, or for a refused key, says why under the note',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board/4');
 for(const [failure,outcome,said] of [[noProvider,'no_model',line],[apiKeyRefusedError,'key_refused','Lead could not reply: the model provider refused the company’s key or sign-in.']] as const) {
  fake.settings.failure=failure;
  await page.goto('/c/rs-learning/work/board/4');
  const body=`@Lead plan the ${outcome} teaser`;
  await page.getByLabel('Comment',{exact:true}).fill(body);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const note=Number(JSON.parse(query(`select id from public.work_comments where body='${body}'`))[0].id);
  const under=page.locator(`#note-${note} + li`);
  await expect(under).toHaveAttribute('data-outcome',outcome.replace('_','-'),{timeout:20000});
  await expect(under).toContainText(said);
  await expect(under.getByRole('link',{name:outcome==='no_model'?connect:refusedFix})).toHaveAttribute('href','/c/rs-learning/settings?section=models');
  expect(JSON.parse(query(`select outcome from public.note_runs where note_id=${note}`))).toEqual([{outcome}]);
 }
});

test('once the Company holds a key, the empty chat shows no notice',async({page})=>{
 fake.settings.profiles.get(space)!.env={OPENROUTER_API_KEY:'sk-or-v1-playwright-0123456789abcdef'};
 await signIn(page,'omar@example.com','/c/rs-learning/chat');
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
 await expect(notice(page)).toHaveCount(0);
});
