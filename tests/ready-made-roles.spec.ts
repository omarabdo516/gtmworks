import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { instructionsOf, roleAppNames, roleTemplates } from '../lib/role-templates.mjs';

// #14, the ready-made gallery. Lead is RS Learning's main Agent on the Company's own profile in a fake Hermes, which
// answers a message naming a ready-made role with create_agent for that role, as the model would. The Owner opens the
// gallery from "New agent", finds roles, and adds one: Lead gets the message and makes the Agent, the same rows that
// asking in words makes. Nobody but the Owner sees the link or the gallery, even at its address.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
const roleNames:Record<string,string>=JSON.parse(readFileSync('lib/messages/ready-made.en.json','utf8'));
const ids=Object.keys(roleTemplates) as (keyof typeof roleTemplates)[];
// The driver reaches the management listener on port 9119 beside the Hermes address, as in the install; each lane's
// fake takes a loopback address of its own, so lanes (and company-sign-in.spec.ts on 127.0.0.1) never share the port.
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 // A retry or a repeat starts again from the seed: the Lead the first try inserted would refuse this one's (#526).
 freshSeed(testInfo.file,testInfo.retry>0||testInfo.repeatEachIndex>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.reply=(input:string)=>{
  const id=ids.find(role=>input.toLowerCase().includes(roleNames[`role.${role}`].toLowerCase()));
  return id?`On it.\n\n\`\`\`gtmworks-tool\n${JSON.stringify({name:'create_agent',arguments:{template:id}})}\n\`\`\``:`Reply to: ${input}`;
 };
 query(`update public.people set language='en' where id='${omar}'`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  // The Company's own Connection, saved through the Owner's route (its key encrypted), then given Lead as the worker does.
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) select id,'${profile}',true,true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

// The Agent a Conversation made, and its Activity log row, without what differs between any two (ids and times).
const madeIn=(conversation:string)=>JSON.parse(query(`select a.template,a.name,a.speciality,array_to_string(a.apps,'|') as apps,a.instructions,a.requested_by,a.is_default,
 g.actor_id,g.action,g.details->>'agent_name' as logged_name,g.details->>'job' as logged_job
 from public.lead_made_agents l join public.hermes_agents a on a.id=l.agent_id join public.company_log g on g.agent_id=a.id and g.action='agent_requested'
 where l.conversation_id='${conversation}'`));
// Signing in returns to the page without its query, so the page is opened after.
async function open(page:Page,email:string,path:string) { await signIn(page,email,'/c/rs-learning/home'); await page.goto(path); }
const conversationOf=(page:Page)=>new URL(page.url()).pathname.split('/').pop()!;
const gallery=(page:Page)=>page.getByRole('dialog',{name:'Ready-made agents for RS Learning'});
const roles=(page:Page)=>gallery(page).locator('.tpl__role');

test('the Owner finds a ready-made role, adds it, and Lead makes the same Agent that asking in words makes',async({page})=>{
 test.setTimeout(120000);
 await open(page,'omar@example.com','/c/rs-learning/chat?new=agent');
 const link=page.locator('.new-hint').getByRole('link',{name:'or pick a ready-made one'});
 await link.click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=ready$/);
 const search=gallery(page).getByRole('searchbox',{name:'Search ready-made agents'});
 await expect(search).toBeFocused();
 await expect(gallery(page).locator('.modal__sub')).toHaveText('Pick a role and add it to the team in a minute. This list is private to the RS Learning workspace. Nobody outside the team can see it.');
 await expect(roles(page)).toHaveText(['Meta ads manager','Ad critic','SEO content writer','Numbers analyst','Website coding agent']);
 const chips=gallery(page).getByRole('group',{name:'Categories'}).getByRole('button');
 await expect(chips).toHaveText(['All5','Ads2','Content1','Numbers1','Code1']);
 const card=(role:string)=>gallery(page).locator('.tpl').filter({has:page.getByRole('heading',{name:role})});
 await expect(card('SEO content writer').locator('.tpl__cat')).toHaveText('Content · Works with the whole team');
 await expect(card('SEO content writer').locator('.tpl__hand')).toHaveText('It leaves the article as a draft, and you publish it.');
 await expect(card('SEO content writer').locator('.tpl__apps')).toHaveText('Google Search Console · WordPress');
 await expect(card('Ad critic').locator('.tpl__none')).toHaveText('No tools');

 // Search reads roles, lines and apps in either language; a category narrows the list.
 await search.fill('wordpress');
 await expect(roles(page)).toHaveText(['SEO content writer']);
 await search.fill('محلل');
 await expect(roles(page)).toHaveText(['Numbers analyst']);
 await search.fill('zzz');
 await expect(gallery(page).locator('.tpl-empty b')).toHaveText('No ready-made agent matches “zzz”');
 await gallery(page).getByRole('button',{name:'Clear search'}).click();
 await expect(search).toHaveValue('');
 await chips.filter({hasText:'Ads'}).click();
 await expect(chips.filter({hasText:'Ads'})).toHaveAttribute('aria-pressed','true');
 await expect(roles(page)).toHaveText(['Meta ads manager','Ad critic']);

 // Escape leaves for Lead's chat, ready to type, once the gallery's exit has run (#130; design-reference: closeModal):
 // while it runs the dialog and its scrim stay at the old address. The exit is read when the dialog takes is-closing,
 // from the animation that class gives it, and not from animationstart: that event waits for the next frame, and a
 // frame later than the leave's timer (useLeave in lib/motion.ts; a busy CI runner) removes the dialog before it is ever sent (#526).
 // With no delay and the leave's own length, the exit starts at once and has run when the dialog goes.
 await page.evaluate(()=>{
  const seen:(string|boolean|string[])[][]=[]; Object.assign(window,{seen});
  new MutationObserver(()=>{
   const part=document.querySelector('.gw.modal');
   if(part?.matches('.is-closing')&&!seen.some(([what])=>what==='closing')) seen.push(['closing',part.getAnimations().map(run=>{ const {delay,duration}=run.effect!.getTiming(); return `${(run as CSSAnimation).animationName} ${run.playState} delay ${delay}ms for ${duration}ms`; }),part.isConnected,!!document.querySelector('[data-slot="dialog-overlay"]'),location.search]);
   if(!part&&!seen.some(([what])=>what==='gone')) seen.push(['gone',location.search]);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
 });
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=agent$/);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as {seen:unknown[]}).seen)).toEqual([['closing',['gw-modal-out running delay 0ms for 190ms'],true,true,'?new=ready'],['gone','?new=ready']]);
 await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();

 await link.click();
 await gallery(page).getByRole('button',{name:'Add SEO content writer'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
 const picked=conversationOf(page);
 const asked='Make me a “SEO content writer” agent like the ready-made one';
 await expect(page.locator('.msg[data-author=person]')).toContainText(asked);
 await expect(page.getByRole('group',{name:'Agent made: Writer'})).toBeVisible({timeout:30000});
 expect(fake.settings.runs.filter(run=>run.session===picked).map(run=>run.input)).toEqual([asked]);
 const writer=roleTemplates.writer;
 expect(madeIn(picked)).toEqual([{template:'writer',name:writer.name,speciality:writer.job,apps:roleAppNames('writer').join('|'),instructions:instructionsOf('writer').replaceAll('{company}','RS Learning'),
  requested_by:omar,is_default:false,actor_id:omar,action:'agent_requested',logged_name:writer.name,logged_job:writer.job}]);

 // Asking Lead in words, from the same chat, makes the same Agent and the same log row.
 await page.goto('/c/rs-learning/chat?new=agent');
 await page.getByRole('textbox',{name:'Message'}).fill('Can you add an SEO content writer for our blog?');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
 await expect(page.getByRole('group',{name:'Agent made: Writer'})).toBeVisible({timeout:30000});
 expect(madeIn(conversationOf(page))).toEqual(madeIn(picked));
});

test('in Arabic the link and the gallery speak Arabic, and the pick names the role as create_agent knows it too',async({page})=>{
 test.setTimeout(120000);
 query(`update public.people set language='ar' where id='${omar}'`);
 try {
  await open(page,'omar@example.com','/c/rs-learning/chat?new=agent');
  await page.locator('.new-hint').getByRole('link',{name:'أو اختار من الجاهزين'}).click();
  const arabic=page.getByRole('dialog',{name:'وكلاء جاهزين لـ RS Learning'});
  await expect(arabic.locator('.tpl__role').first()).toHaveText('مدير إعلانات Meta');
  await arabic.getByRole('button',{name:'ضيف مدير إعلانات Meta'}).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  await expect(page.locator('.msg[data-author=person]')).toContainText('اعملي وكيل «مدير إعلانات Meta» زي اللي في الجاهزين (Meta ads manager)');
  await expect(page.locator('.ac-card')).toHaveCount(1,{timeout:30000});
  expect(madeIn(conversationOf(page))).toMatchObject([{template:'meta',name:roleTemplates.meta.name,instructions:instructionsOf('meta').replaceAll('{company}','RS Learning')}]);
 } finally { query(`update public.people set language='en' where id='${omar}'`); }
});

test('a Company worked alone hears the alone wording: no team, and the coder hands its merge to the Owner',async({page})=>{
 // R&S Consultations, where Omar is the only Member, worked alone, with a Lead of its own (never called here).
 const [rs,connection,itsLead]=['10000000-0000-0000-0000-000000000002',randomUUID(),randomUUID()];
 query(`do $$ begin
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${itsLead}','${rs}','${connection}','Lead','General',true,'alone-lead');
  update public.companies set work_mode='alone' where id='${rs}';
 end $$;`);
 try {
  await open(page,'omar@example.com','/c/rs-consultations/chat?new=ready');
  const alone=page.getByRole('dialog',{name:'Ready-made agents for R&S Consultations'});
  await expect(alone.locator('.modal__sub')).toHaveText('Pick a role and Lead makes it right away, in the chat. This list is private to your workspace. Nobody outside it can see it.');
  await expect(alone.locator('.tpl__cat').first()).toHaveText('Ads');
  await expect(alone.locator('.tpl').filter({hasText:'Website coding agent'}).locator('.tpl__hand')).toHaveText('It opens the pull request and stops; you review and merge.');
  // "Start from scratch" goes back to Lead's chat, ready to type.
  await alone.locator('.modal__foot').getByRole('button',{name:'Start from scratch'}).click();
  await expect(page).toHaveURL(/\/c\/rs-consultations\/chat\?new=agent$/);
  await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();
 } finally { query(`update public.companies set work_mode='team' where id='${rs}'`); }
});

for(const [role,email] of [['Viewer','viewer@example.com']]) {
 test(`a ${role} sees no gallery link and no gallery, even at its address`,async({page})=>{
  await signIn(page,email,'/c/rs-learning/home');
  for(const path of ['/c/rs-learning/chat?new=agent','/c/rs-learning/chat?new=ready']) {
   await page.goto(path);
   await expect(page.locator('.chat #btn-details')).toHaveAccessibleName(/Lead/);
   await expect(page.locator('.new-hint__alt')).toHaveCount(0);
   await expect(page.locator('.tpl, .modal')).toHaveCount(0);
   await expect(page.getByRole('dialog')).toHaveCount(0);
  }
 });
}

// #189: a Manager or a Contributor opens the same gallery from the hint line and asks Lead for a role. Lead prepares
// the request their Owner answers (#17): one request is kept, no Agent is made, and the item waits in the Owner's
// "Waiting on you". The Owner alone still adds a role (the first test above).
const numbersRole='Numbers analyst';
const asked='Make me a “Numbers analyst” agent like the ready-made one';
const ownerName='عمر';
const people:Record<string,string>={'manager@example.com':'20000000-0000-0000-0000-000000000002','reviewer@example.com':'20000000-0000-0000-0000-000000000003'};
const agentsCount=()=>JSON.parse(query(`select count(*)::int as n from public.hermes_agents where company_id='${company}'`))[0].n;
for(const [role,email,who] of [['Manager','manager@example.com','مدير'],['Contributor','reviewer@example.com','مراجع']]) {
 test(`a ${role} asks from the ready-made gallery: Lead's request waits for the Owner, and no Agent is made`,async({page})=>{
  test.setTimeout(120000);
  const before=agentsCount();
  const answer=fake.settings.reply;
  fake.settings.reply=(input:string)=>input.toLowerCase().includes(numbersRole.toLowerCase())
   ?`On it.\n\n\`\`\`gtmworks-tool\n${JSON.stringify({name:'request_agent',arguments:{template:'numbers'}})}\n\`\`\``:`Reply to: ${input}`;
  try {
   await signIn(page,email,'/c/rs-learning/home');
   await page.goto('/c/rs-learning/chat?new=agent');
   // Every Member who may write gets the hint line and its link; the Viewer above gets neither.
   await expect(page.locator('.new-hint__t')).toHaveText(`Tell Lead what you need an agent for, and it prepares the request for ${ownerName}.`);
   const link=page.locator('.new-hint').getByRole('link',{name:'or pick a ready-made one'});
   await link.click();
   await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=ready$/);
   const gallery=page.getByRole('dialog',{name:'Ready-made agents for RS Learning'});
   await expect(gallery.locator('.modal__sub')).toHaveText(`Pick a role and ask Lead. It prepares a proposal, and the agent is only created when ${ownerName} approves. This list is private to the RS Learning workspace.`);
   await expect(gallery.getByRole('button',{name:'Ask for SEO content writer'})).toHaveText('Ask for it');
   await expect(gallery.getByRole('button',{name:'Add SEO content writer'})).toHaveCount(0);
   await expect(gallery.locator('.modal__foot').getByRole('button',{name:'Ask Lead'})).toBeVisible();
   await expect(gallery.locator('.modal__foot').getByRole('button',{name:'Start from scratch'})).toHaveCount(0);

   await gallery.getByRole('button',{name:'Ask for Numbers analyst'}).click();
   await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
   const talked=conversationOf(page);
   await expect(page.locator('.msg[data-author=person]')).toContainText(asked);
   await expect(page.getByRole('group',{name:'Agent request: Numbers'})).toBeVisible({timeout:30000});
   await expect(page.getByRole('group',{name:'Agent request: Numbers'}).locator('.badge--req')).toHaveText('Request · not made yet');
   // One request, kept as Lead made it; no Agent was made.
   expect(JSON.parse(query(`select asked_by,agent_name,template,state from public.lead_agent_requests where conversation_id='${talked}'`)))
    .toEqual([{asked_by:people[email],agent_name:roleTemplates.numbers.name,template:'numbers',state:'waiting'}]);
   expect(agentsCount()).toBe(before);
   expect(JSON.parse(query(`select count(*)::int as n from public.lead_made_agents where conversation_id='${talked}'`))[0].n).toBe(0);
   // The item waits in the Owner's "Waiting on you", and not in another Member's.
   await page.context().clearCookies();
   await signIn(page,'omar@example.com','/c/rs-learning/approvals');
   await expect(page.getByRole('group',{name:'Agent request: Numbers'}).filter({hasText:`Agent request from ${who}`})).toBeVisible();
  } finally { fake.settings.reply=answer; }
 });
}

test('"Ask Lead" in the gallery foot closes it and puts the focus in Lead\'s composer, with the hint line shown',async({page})=>{
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/chat?new=ready');
 const gallery=page.getByRole('dialog',{name:'Ready-made agents for RS Learning'});
 await gallery.getByRole('button',{name:'Ask Lead'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=agent$/);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.new-hint__t')).toHaveText(`Tell Lead what you need an agent for, and it prepares the request for ${ownerName}.`);
 await expect(page.locator('.new-hint__alt')).toHaveText('or pick a ready-made one');
 await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();
 // The same in an empty search.
 await page.locator('.new-hint').getByRole('link',{name:'or pick a ready-made one'}).click();
 await page.getByRole('searchbox',{name:'Search ready-made agents'}).fill('zzz');
 await expect(page.getByRole('dialog',{name:'Ready-made agents for RS Learning'}).locator('.tpl-empty b')).toHaveText('No ready-made agent matches “zzz”');
 await page.getByRole('dialog',{name:'Ready-made agents for RS Learning'}).getByRole('button',{name:'Ask Lead'}).first().click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/chat\?new=agent$/);
 await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();
});
