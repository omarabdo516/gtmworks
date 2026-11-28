import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #882 (spec #864): what a person already used in a Conversation behaves as before on one whose messages are the
// Engine's. The main Agent opens a new Company's first Conversation with its own words and no person's message before
// them; the model the Owner chooses goes with the next Runs and is still chosen after a reload, and one the Engine
// refuses takes the Conversation back to the model it had; dictation fills the composer and sends as typing does; and
// the Agent's face in the sidebar shows it working while its Run works. The fake Engine plays a Run on a chosen session
// as the pinned release does (tests/fake-hermes.mjs), and keeps no history a Run is given, as the release does not.
test.use({permissions:['microphone'],launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}});
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const profile=`co-${hex}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.pendingReads=0;
 fake.settings.transcriptionTranscript='Draft the launch note';
 fake.settings.profiles.set(profile,{soul:'',provider:'anthropic',model:'claude-opus-4-6',key:fake.settings.key,config:{},credentials:{anthropic:'signed-in'},env:{OPENROUTER_API_KEY:'set'}} as never);
 // The Company holds a model key in its shared space, so it has a model (#422) and its OpenRouter models are offered (#620).
 fake.settings.profiles.set(`cs-${hex}`,{soul:'',provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{},env:{OPENROUTER_API_KEY:'set'}} as never);
 query(`do $$ begin
  update public.people set language='en' where id='${omar}';
  -- RS Learning is switched over: its Conversations are the Engine's (companies.engine_conversations, until #883).
  update public.companies set engine_conversations=true where id='${company}';
  update public.hermes_agents set is_default=false where company_id='${company}' and is_default;
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) select id,'${profile}',true,true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/cs-${hex}/skills') on conflict do nothing;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });
test.afterEach(()=>{
 fake.settings.liveHold=false; fake.settings.refusedModels.clear(); fake.settings.loseStarts=0;
 for(const run of fake.settings.runs) if(!run.released) fake.settings.release(run.id);
});

const field=(page:Page)=>page.getByRole('textbox',{name:'Message'});
const plus=(page:Page)=>page.locator('.composer .composer__btn[aria-haspopup="menu"]');
const menu=(page:Page)=>page.getByRole('menu');
const turns=(page:Page)=>page.locator('.msg');
const send=async(page:Page,text:string)=>{ await field(page).fill(text); await field(page).press('Enter'); };
const runOf=(input:string)=>fake.settings.runs.findLast(run=>run.input===input);
const chosen=(input:string)=>{ const {provider,model}=JSON.parse(runOf(input)!.body!); return {provider,model}; };

test('on a new Company the main Agent opens the first Conversation with its own message, and the Owner\'s answer is told it',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'omar@example.com','/c/rs-learning/chat');
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/,{timeout:30000});
 const conversation=page.url().split('/').at(-1)!;
 const opening=page.locator('.msg[data-author=agent]');
 await expect(opening).toHaveCount(1,{timeout:20000});
 await expect(opening).toContainText('I’m Lead, and I manage RS Learning’s team of agents.');
 await expect(opening).toContainText('What does RS Learning sell?');
 await expect(page.locator('.msg[data-author=person]')).toHaveCount(0);
 // No message is kept in gtmworks: the row marks the Conversation, and it has no session before the Owner answers.
 expect(rows(`select lead_opening,hermes_session_id from public.conversations where id='${conversation}'`)).toEqual([{lead_opening:true,hermes_session_id:null}]);
 expect(rows(`select count(*)::int as n from public.conversation_messages where company_id='${company}'`)).toEqual([{n:0}]);
 // A reload, and Lead's chat again, go back to it until the Owner answers.
 await page.reload();
 await expect(opening).toHaveCount(1,{timeout:20000});
 await page.goto('/c/rs-learning/chat');
 await expect(page).toHaveURL(`/c/rs-learning/conversations/${conversation}`);

 await send(page,'We sell accounting courses');
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Reply to: We sell accounting courses/,{timeout:30000});
 const run=runOf('We sell accounting courses')!;
 expect(run.history,'the answer\'s Run is given the opening as the Agent\'s own words').toEqual([{role:'assistant',content:expect.stringContaining('What does RS Learning sell?')}]);
 expect(run.instructions).toContain('propose the first two or three agents');
 // The opening stays first, before the Owner's answer and the reply; the session holds only those two.
 await page.reload();
 await expect(turns(page)).toHaveCount(3,{timeout:20000});
 await expect(turns(page).nth(0)).toContainText('What does RS Learning sell?');
 await expect(turns(page).nth(1)).toHaveText(/We sell accounting courses/);
 await expect(turns(page).nth(2)).toHaveText(/Reply to: We sell accounting courses/);
 // Only the first Run is told the opening.
 await send(page,'And the budget?');
 await expect(page.locator('.msg').filter({hasText:'Reply to: And the budget?'})).toBeVisible({timeout:30000});
 expect(runOf('And the budget?')!.history).toBeUndefined();
 expect(runOf('And the budget?')!.instructions??'').not.toContain('propose the first');
 // Once answered, Lead's chat is an empty chat again.
 await page.goto('/c/rs-learning/chat');
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat$/);
});

test('a model chosen for a Conversation goes with its next Runs and is still chosen after a reload; one the Engine refuses goes back',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 await send(page,'Plan the launch');
 await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/,{timeout:30000});
 const conversation=page.url().split('/').at(-1)!;
 await expect(page.locator('.msg').filter({hasText:'Reply to: Plan the launch'})).toBeVisible({timeout:30000});
 expect(chosen('Plan the launch'),'a Conversation with no choice runs on its Agent\'s own model').toEqual({provider:undefined,model:undefined});
 await plus(page).click();
 await menu(page).getByRole('menuitemradio',{name:/^openai\/gpt-5\.5/}).click();
 await expect(page.locator('.toast')).toHaveText('Lead will think with openai/gpt-5.5');
 await send(page,'Write the first post');
 await expect(page.locator('.msg').filter({hasText:'Reply to: Write the first post'})).toBeVisible({timeout:30000});
 expect(chosen('Write the first post')).toEqual({provider:'openrouter',model:'openai/gpt-5.5'});
 await page.reload();
 await expect(page.locator('.msg').filter({hasText:'Reply to: Write the first post'})).toBeVisible({timeout:20000});
 await plus(page).click();
 await expect(menu(page).getByRole('menuitemradio',{checked:true})).toHaveText('openai/gpt-5.5OpenRouter');
 await page.keyboard.press('Escape');
 await send(page,'Now the second one');
 await expect(page.locator('.msg').filter({hasText:'Reply to: Now the second one'})).toBeVisible({timeout:30000});
 expect(chosen('Now the second one')).toEqual({provider:'openrouter',model:'openai/gpt-5.5'});

 // A model the Engine will not take: the message stays in the box, and the Conversation is on the model it had.
 fake.settings.refusedModels.add('anthropic/claude-opus-4.6');
 await plus(page).click();
 await menu(page).getByRole('menuitemradio',{name:/^anthropic\/claude-opus-4\.6/}).click();
 await expect(page.locator('.toast')).toHaveText('Lead will think with anthropic/claude-opus-4.6');
 await send(page,'Write the third');
 await expect(page.locator('.composer-error')).toHaveText('The agent engine did not take that model, so this chat stays on the model it had. Your message is still in the box.');
 await expect(field(page)).toHaveValue('Write the third');
 expect(rows(`select model from public.conversations where id='${conversation}'`)).toEqual([{model:{provider:'openrouter',model:'openai/gpt-5.5'}}]);
 await field(page).press('Enter');
 await expect(page.locator('.msg').filter({hasText:'Reply to: Write the third'})).toBeVisible({timeout:30000});
 expect(chosen('Write the third')).toEqual({provider:'openrouter',model:'openai/gpt-5.5'});
});

test('a send whose answer was lost, asked again after another model was chosen, replays the Run it made on the model it had',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 await send(page,'Plan the week');
 await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/,{timeout:30000});
 await expect(page.locator('.msg').filter({hasText:'Reply to: Plan the week'})).toBeVisible({timeout:30000});
 await plus(page).click();
 await menu(page).getByRole('menuitemradio',{name:/^openai\/gpt-5\.5/}).click();
 await expect(page.locator('.toast')).toHaveText('Lead will think with openai/gpt-5.5');
 // The Engine takes the Run, but every answer to its start is lost: the words stay in the box with Try again.
 fake.settings.loseStarts=1000;
 await send(page,'Draft the agenda');
 await expect(field(page)).toHaveValue('Draft the agenda',{timeout:30000});
 await expect(page.locator('.composer-error')).toBeVisible();
 fake.settings.loseStarts=0;
 await plus(page).click();
 await menu(page).getByRole('menuitemradio',{name:/^claude-opus-4-6/}).click();
 await field(page).press('Enter');
 await expect(page.locator('.msg').filter({hasText:'Reply to: Draft the agenda'})).toBeVisible({timeout:30000});
 const made=fake.settings.runs.filter(run=>run.input==='Draft the agenda');
 expect(made.length,'Try again replays the Run the lost start made, and starts no other').toBe(1);
 expect(chosen('Draft the agenda')).toEqual({provider:'openrouter',model:'openai/gpt-5.5'});
});

test('dictation fills the composer and sends as a typed message does, and the Agent\'s face works while its Run does',async({page})=>{
 test.setTimeout(120000);
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages:[{role:'user',content:'Hello',timestamp:1},{role:'assistant',content:'Hi Omar.',timestamp:2}]});
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Hi Omar\./,{timeout:20000});
 const mic=page.locator('.composer__mic');
 const at=(await mic.boundingBox())!;
 await page.mouse.move(at.x+at.width/2,at.y+at.height/2);
 await page.mouse.down();
 await expect(page.locator('.composer.is-rec')).toBeVisible();
 await page.waitForTimeout(600);
 await page.mouse.up();
 await expect(field(page)).toHaveValue('Draft the launch note');
 fake.settings.liveHold=true;
 await field(page).press('Enter');
 await expect(page.locator('.msg[data-author=person]').last()).toHaveText(/Draft the launch note/,{timeout:3000});
 await expect.poll(()=>runOf('Draft the launch note')?.sessionId,{timeout:20000}).toBe(session);
 // Away from the Conversation, the sidebar's face reads the Agent's state from the server: it works while the row holds its Run.
 await page.goto('/c/rs-learning/home');
 const tile=page.locator(`.agent-tile[data-agent="${lead}"]`);
 await expect(tile).toHaveAttribute('aria-label',/Working$/,{timeout:20000});
 fake.settings.release(runOf('Draft the launch note')!.id);
 await page.goto(`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.msg').filter({hasText:'Reply to: Draft the launch note'})).toBeVisible({timeout:30000});
 await expect.poll(()=>rows(`select open_runs from public.conversations where id='${conversation}'`)[0].open_runs,{timeout:15000}).toEqual([]);
 await page.goto('/c/rs-learning/home');
 await expect(tile).not.toHaveAttribute('aria-label',/Working$/,{timeout:20000});
});
