import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #19, on the app: an Agent's proposed change to its own model, and Lead's to another Agent's instructions, wait in the
// Owner's "Waiting on you" and nowhere else; nothing changes in the Engine until the Owner approves one, which writes
// that Agent's own profile and reads it back; the Owner declines the other with a reason; the person whose chat it was
// proposed in reads both outcomes there, and the Activity log names each step. A proposal that is not on the list waits
// on nobody. The proposals are kept by calling agent_propose_change directly, as the run's close does
// (tests/agent-changes.test.mjs proves the tool's call). #484: "Waiting on you" draws each as a board card that opens
// the whole proposal, which shows the Agent's model now as its profile reads it; the Owner edits the model among the
// ones the profile's Engine lists before approving, and the Engine then holds the Owner's choice.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const [omar,manager]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'];
const co=`co-${hex}`; const space=`cs-${hex}`;
const lead='e9200000-0000-0000-0000-000000000001'; const writer='e9200000-0000-0000-0000-000000000002'; const writerProfile=`ag-${writer.replaceAll('-','')}`;
const [managerTalk,ownerTalk]=[randomUUID(),randomUUID()];
const why='The weekly report reads many numbers and keeps running late.';
const reason='Keep its instructions as they are this month.';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 const profile=(soul='')=>({soul,provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.profiles.set(co,profile());
 // The Company holds an OpenRouter key in its shared space, so OpenRouter is one of its Providers and its models may be
 // chosen (#620).
 fake.settings.profiles.set(space,{...profile(),env:{OPENROUTER_API_KEY:'test-only-key'}});
 // Writer's profile has an OpenRouter key, so its Engine lists OpenRouter's models (tests/fake-hermes.mjs).
 fake.settings.profiles.set(writerProfile,{...profile('You write long posts.'),env:{OPENROUTER_API_KEY:'test-only-key'}});
 query(`do $$ begin
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${writer}','${company}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','e9200000-0000-0000-0000-000000000011','Lead','General',true,'${co}'),
   ('${writer}','${company}','e9200000-0000-0000-0000-000000000012','Writer','Writing',false,'${writerProfile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills') on conflict do nothing;
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${manager}','${writer}');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
   ('${managerTalk}','${company}','${manager}','${writer}','Writer'),('${ownerTalk}','${company}','${omar}','${lead}','Lead');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
   ('${company}','${managerTalk}','person','${manager}',null,'مدير','The weekly report is late again',gen_random_uuid(),'ch-1',now()-interval '10 minutes'),
   ('${company}','${managerTalk}','agent',null,'${writer}','Writer','I proposed a faster model. Nothing changes before an Administrator’s OK.',null,'ch-1',now()-interval '9 minutes'),
   ('${company}','${ownerTalk}','person','${omar}',null,'عمر','Writer’s posts run long',gen_random_uuid(),'ch-2',now()-interval '8 minutes'),
   ('${company}','${ownerTalk}','agent',null,'${lead}','Lead','I proposed shorter instructions for Writer. Nothing changes before your OK.',null,'ch-2',now()-interval '7 minutes');
 end $$;`);
 query(`select public.agent_propose_change('${managerTalk}','ch-1','call-0',null,'model',null,'"anthropic/claude-sonnet-5-5"','${why}')`);
 query(`select public.agent_propose_change('${ownerTalk}','ch-2','call-0','Writer','instructions',null,'"You write short posts."','Its posts run long.')`);
 query(`select public.agent_propose_change('${ownerTalk}','ch-2','call-1',null,'toolset','terminal','true','I need a shell.')`);
});
test.afterAll(async()=>{ await fake?.close(); });

const proposal=(page:Page,agent='Writer')=>page.getByRole('group',{name:`Proposed change: ${agent}`});
const proposals=()=>JSON.parse(query(`select change,setting,state,answered_by,answer from public.agent_change_proposals where company_id='${company}' order by id`));
const engineWrites=()=>fake.settings.managementRequests.filter(request=>request.method==='PUT').map(request=>request.path);

// The proposal a board card opens, over "Waiting on you".
// A click that lands before the board's buttons are live is repeated, as the account menu's are; the card must still open.
const opened=async(page:Page,title:string)=>{ const dialog=page.getByRole('dialog');
 await expect(async()=>{ if(!await dialog.locator('.chg-card').isVisible()) await page.getByRole('button',{name:title}).click(); await expect(dialog.locator('.chg-card')).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 return dialog; };

test('the proposals wait in the Owner\'s "Waiting on you" only, change nothing, and one that is not on the list waits on nobody',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 const cards=page.locator('.chg-kcard');
 await expect(cards).toHaveCount(2);
 const model=cards.filter({hasText:'Writer on claude-sonnet-5-5?'});
 await expect(model.locator('.badge--wait')).toHaveText('Waiting on you');
 await expect(model).toContainText('A change to its settings · waiting for your OK');
 await expect(model.locator('.kcard__foot')).toHaveText('Writer· Settings');
 await expect(cards.filter({hasText:'New core instructions for Writer?'})).toContainText('Lead proposed it for Writer · waiting for your OK');
 await expect(page.getByText('I need a shell.')).toHaveCount(0);

 const dialog=await opened(page,'Writer on claude-sonnet-5-5?');
 const card=dialog.locator('.chg-card');
 for(const text of ['Proposed change to the settings of Writer','Writer proposed it for itself','New model: claude-sonnet-5-5',why]) await expect(card).toContainText(text);
 // "Now" is the model Writer's own profile holds, read from the Engine as Settings reads it.
 await expect(card.locator('[data-row="now"]')).toHaveText('Nowopenai/gpt-5.5');
 await expect(card.getByRole('button')).toHaveText(['Decline','Edit, then approve','Approve']);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const soul=await opened(page,'New core instructions for Writer?');
 for(const text of ['Lead proposed it for Writer','You write short posts.','Its posts run long.']) await expect(soul.locator('.chg-card')).toContainText(text);
 await expect(soul.locator('[data-row="now"]')).toHaveText('NowYou write long posts.');
 await page.keyboard.press('Escape');
 expect(engineWrites()).toEqual([]);

 const context=await browser.newContext(); const other=await context.newPage();
 try {
  await signIn(other,'manager@example.com','/c/rs-learning/approvals');
  await expect(other.locator('.approvals')).toBeVisible();
  await expect(other.locator('.chg-kcard')).toHaveCount(0);
  await other.goto(`/c/rs-learning/conversations/${managerTalk}`);
  const mine=proposal(other);
  await expect(mine.locator('.hcard__top .badge')).toHaveText('Waiting for عمر’s OK');
  await expect(mine.locator('.card__outcome')).toHaveText('Waiting for عمر’s OK. Until then, the agent’s settings stay as they are.');
  await expect(mine.locator('[data-row="now"]')).toHaveText('Nowopenai/gpt-5.5');
  await expect(mine.getByRole('button')).toHaveCount(0);
 } finally { await context.close(); }
});

test('the Owner edits the model among the Engine\'s, approves it, which the Engine then holds in that Agent\'s profile alone, and declines the other with a reason',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 const model=await opened(page,'Writer on claude-sonnet-5-5?');
 await model.getByRole('button',{name:'Edit, then approve'}).click();
 const choices=model.getByRole('radiogroup',{name:'Model'});
 await expect(choices.getByRole('radio')).toHaveText(['anthropic/claude-opus-4.6','openai/gpt-5.5','claude-sonnet-5-5']);
 await expect(choices.getByRole('radio',{name:'claude-sonnet-5-5'})).toHaveAttribute('aria-checked','true');
 await choices.getByRole('radio',{name:'anthropic/claude-opus-4.6'}).click();
 await model.getByRole('button',{name:'Approve with changes'}).click();
 await expect(page.locator('.chg-kcard')).toHaveCount(1);
 expect(engineWrites()).toEqual([`/api/profiles/${writerProfile}/model`]);
 expect([fake.settings.profiles.get(writerProfile)?.provider,fake.settings.profiles.get(writerProfile)?.model]).toEqual(['openrouter','anthropic/claude-opus-4.6']);
 expect(fake.settings.profiles.get(co)?.model).toBe('openai/gpt-5.5');
 expect(JSON.parse(query(`select value,approved_value from public.agent_change_proposals where company_id='${company}' and change='model'`))).toEqual([{value:'anthropic/claude-sonnet-5-5',approved_value:'openrouter/anthropic/claude-opus-4.6'}]);

 const soul=(await opened(page,'New core instructions for Writer?')).locator('.chg-card');
 await soul.getByRole('button',{name:'Decline'}).click();
 const box=soul.getByRole('textbox',{name:'Reason for declining'});
 await expect(box).toBeFocused();
 await soul.getByRole('button',{name:'Decline'}).click();
 await expect(soul.locator('.set-err')).toHaveText('Write the reason, so the agent knows why.');
 await box.fill(reason);
 await soul.getByRole('button',{name:'Decline'}).click();
 await expect(page.locator('.chg-kcard')).toHaveCount(0);
 expect(fake.settings.profiles.get(writerProfile)?.soul).toBe('You write long posts.');
 // A decline writes nothing.
 expect(engineWrites()).toEqual([`/api/profiles/${writerProfile}/model`]);
 expect(proposals()).toEqual([
  {change:'model',setting:null,state:'approved',answered_by:omar,answer:null},
  {change:'instructions',setting:null,state:'declined',answered_by:omar,answer:reason},
  {change:'toolset',setting:'terminal',state:'refused',answered_by:null,answer:null},
 ]);
});

test('each chat reads its answer, and the Activity log names every step',async({page})=>{
 await signIn(page,'manager@example.com',`/c/rs-learning/conversations/${managerTalk}`);
 const approved=proposal(page);
 await expect(approved.locator('.hcard__top .badge')).toHaveText('Approved');
 await expect(approved.locator('.card__outcome')).toContainText('عمر approved with changes');
 await expect(approved.locator('.card__outcome')).toContainText('Writer now thinks with anthropic/claude-opus-4.6.');
 await expect(approved.locator('[data-row="proposed"]')).toHaveText('Proposedclaude-sonnet-5-5');
 await page.context().clearCookies();

 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${ownerTalk}`);
 const declined=page.locator('.chg-card').filter({hasText:'New core instructions'});
 await expect(declined.locator('.hcard__top .badge')).toHaveText('Declined');
 await expect(declined.locator('.card__outcome')).toContainText(`Nothing changed. Reason: «${reason}»`);
 await expect(page.locator('.chg-card').filter({hasText:'terminal'}).locator('.card__outcome')).toHaveText('This isn’t a setting an agent can propose, so nothing changed and it waits on nobody.');

 await page.goto('/c/rs-learning/log');
 const log=page.locator('.log-page');
 for(const line of ['proposed a change to main model in the settings of Writer','proposed a change to the instructions in the settings of Writer',
  'approved a change to main model in the settings of Writer','declined a change to the instructions in the settings of Writer',reason]) await expect(log).toContainText(line);
});
