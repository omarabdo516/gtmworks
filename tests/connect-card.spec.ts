import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { appByKey } from '../lib/app-catalogue.mjs';
import { appOrigin } from './lane.mjs';

// #203, an Agent's connect card. RS Learning runs on its own profile in a fake Engine whose MCP catalogue and sign-ins
// answer as the pinned release's do; Lead, its main Agent, keeps that profile. Each Conversation holds the person's
// message, Lead's reply and the connect card it showed for one app (agent_show_card's row, as the closer keeps it:
// connect-runs.test.mjs and supabase/tests/connect_cards.sql prove how it gets there). The Owner connects from the card
// through the vendor's window, the same sign-in as Settings, Apps; Later closes it for good with no log row; a
// Contributor reads the card with no button and the route refuses them; a card reads the app's state now.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const contributor='20000000-0000-0000-0000-000000000005';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
const reason='مش متوصل، فمقدرتش أعرف مين من الليدز اشترى فعلاً. لو وصّلته هقدر أحسب العائد بدقة.';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const installed=(key:string)=>({url:`https://mcp.${key}.example/mcp`,auth:'oauth',enabled:true,oauth:{redirect_uri:`${appOrigin}/api/apps/callback/${key}`}});

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','${contributor}')`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

// A Conversation of `person` with Lead: their message, Lead's reply and the connect card it showed for each app, in order.
function asked(person:string,cards:{app:string,state?:'open'|'postponed'}[]) {
 const conversation=randomUUID(); const run=`connect-${conversation.slice(0,8)}`;
 query(`do $$ begin
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${person}','${lead}','Lead');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values ('${company}','${conversation}','person','${person}','Someone','Write the weekly report','${randomUUID()}','${run}');
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id) values ('${company}','${conversation}','agent','${lead}','Lead','I wrote it without the sales.','${run}');
  ${cards.map(({app,state='open'},index)=>`insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state) values ('${company}','${conversation}','${run}','call-${index}','connect','${appByKey(app)!.name}',jsonb_build_object('app','${app}','reason','${reason}'),'${state}');`).join('\n')}
 end $$;`);
 return `/c/rs-learning/conversations/${conversation}`;
}
const appLog=()=>JSON.parse(query(`select actor_id,action,details->>'app' as app from public.company_log where company_id='${company}' and action in ('app_connected','app_disconnected') order by id`));
const logCount=()=>JSON.parse(query(`select count(*)::int as n from public.company_log where company_id='${company}'`))[0].n as number;
const approving=(page:Page)=>page.context().route(/^https:\/\/auth\.[a-z-]+\.example\//,route=>{
 const asking=new URL(route.request().url());
 return route.fulfill({status:302,headers:{location:`${asking.searchParams.get('redirect_uri')}?code=vendor-code&state=${asking.searchParams.get('state')}&scope=all`}});
});

test('the Owner connects the app from the card through the vendor\'s window: Connecting… with both buttons off, then "{App} connected", in the log once',async({page})=>{
 // The vendor's page waits for the person until the test lets it answer, so the card is seen while it is followed.
 let answer:()=>void=()=>{}; const answered=new Promise<void>(resolve=>{ answer=resolve; });
 await page.context().route(/^https:\/\/auth\.[a-z-]+\.example\//,async route=>{
  await answered;
  const asking=new URL(route.request().url());
  return route.fulfill({status:302,headers:{location:`${asking.searchParams.get('redirect_uri')}?code=vendor-code&state=${asking.searchParams.get('state')}&scope=all`}});
 });
 await signIn(page,'omar@example.com',asked(omar,[{app:'amplitude'}]));
 const card=page.getByRole('group',{name:'Connect Amplitude',exact:true});
 await expect(card.locator('.card__sub')).toHaveText(reason);
 const [vendor]=await Promise.all([page.waitForEvent('popup'),card.getByRole('button',{name:'Connect',exact:true}).click()]);
 await expect(card.getByRole('button',{name:'Later'})).toBeDisabled();
 await expect(card.getByRole('button',{name:'Connecting…'})).toBeDisabled();
 answer();
 const done=page.getByRole('group',{name:'Amplitude connected',exact:true});
 await expect(done.locator('.card__outcome')).toHaveText('Amplitude connected',{timeout:20000});
 await expect(page.locator('.toast').filter({hasText:'Amplitude connected'})).toBeVisible();
 await expect(done.getByRole('button')).toHaveCount(0);
 expect('tools' in fake.settings.profiles.get(profile)!.config.mcp_servers.amplitude).toBe(false);
 await vendor.close();
 await expect.poll(appLog).toEqual([{actor_id:omar,action:'app_connected',app:'amplitude'}]);
 await page.reload();
 await expect(page.getByRole('group',{name:'Amplitude connected',exact:true})).toBeVisible();
 expect(appLog(),'the connect is in the log once').toHaveLength(1);
});

test('Later closes the card with its line, gives the message field the focus, stays so after a reload, and writes no log row',async({page})=>{
 await signIn(page,'omar@example.com',asked(omar,[{app:'canva'}]));
 const before=logCount();
 await page.getByRole('group',{name:'Connect Canva',exact:true}).getByRole('button',{name:'Later'}).click();
 const postponed=page.getByRole('group',{name:'Canva postponed',exact:true});
 await expect(postponed.locator('.card__outcome')).toHaveText('Postponed · you can connect it from the details any time');
 await expect(page.locator('.composer__input')).toBeFocused();
 await page.reload();
 await expect(page.getByRole('group',{name:'Canva postponed',exact:true}).locator('.card__outcome')).toHaveText('Postponed · you can connect it from the details any time');
 await expect(page.getByRole('group',{name:'Canva postponed',exact:true}).getByRole('button')).toHaveCount(0);
 expect(logCount()).toBe(before);
});

test('a Contributor sees the card with the clock line naming the Owner and no button, and the connect route refuses them',async({page})=>{
 await signIn(page,'multi@example.com',asked(contributor,[{app:'gamma'}]));
 const card=page.getByRole('group',{name:'Connect Gamma',exact:true});
 await expect(card.locator('.card__outcome')).toHaveText('Apps are connected by عمر');
 await expect(card.getByRole('button')).toHaveCount(0);
 const refused=await page.request.post('/api/company-apps',{data:{company,agent:lead,app:'gamma',action:'connect'}});
 expect(refused.status()).toBe(403);
 expect(fake.settings.profiles.get(profile)!.config.mcp_servers?.gamma).toBeUndefined();
});

test('an app connected in Settings reads connected on every open card for it after a reload, and a postponed card keeps its line',async({page})=>{
 await approving(page);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const chat=asked(omar,[{app:'notion'},{app:'notion',state:'postponed'}]);
 await page.goto(chat);
 await expect(page.getByRole('group',{name:'Connect Notion',exact:true})).toBeVisible();
 await page.goto('/c/rs-learning/settings?section=apps&app=notion');
 const [vendor]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Connect',exact:true}).click()]);
 await expect(page.locator('.sheet__meta .badge')).toHaveText('Connected',{timeout:20000});
 await vendor.close();
 await page.goto(chat);
 await expect(page.getByRole('group',{name:'Notion connected',exact:true}).locator('.card__outcome')).toHaveText('Notion connected');
 await expect(page.getByRole('group',{name:'Notion postponed',exact:true}).locator('.card__outcome')).toHaveText('Postponed · you can connect it from the details any time');
 await expect(page.getByRole('group',{name:'Connect Notion',exact:true})).toHaveCount(0);
 expect(fake.settings.profiles.get(profile)!.config.mcp_servers.notion).toMatchObject({enabled:true,tools:installed('notion').tools});
});
