import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn, openNavigation } from './sign-in';
import { laneHermes } from './lane-hermes';
import { faceAnimations, faceParts, faceTransitions } from './navigation-measure';

// #15, which Agents each Member sees: the Owner turns a switch in Company settings, and the Contributor (مراجع) finds
// the Agent in their list; an Agent not allowed to them is absent, and its address is a page that does not exist.
// The database side (every Role, the log, Conversations, the main Agent) is proven in supabase/tests/member_agent_visibility.sql.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const id=(n:number)=>`67000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads,seo]=[1,2,3].map(n=>id(10+n));

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo);
 query(`do $$ begin
  update public.people set language='en' where id in ('${omar}','20000000-0000-0000-0000-000000000003');
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','${id(1)}','Lead','General',true,'seen-lead'),
   ('${ads}','${company}','${id(2)}','Meta Ads','Runs the Meta ads.',false,'seen-ads'),
   ('${seo}','${company}','${id(3)}','SEO','Writes the blog.',false,'seen-seo');
 end $$;`);
});

test('the Owner shows an Agent to a Member, who then sees it while a hidden one stays absent, even by its address',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=members');
 const row=page.locator('.ta-table tbody tr').filter({hasText:'مراجع'});
 const toggle=row.getByRole('switch',{name:'مراجع · Meta Ads'});
 await expect(row.getByText('Shown to all')).toBeVisible();
 await expect(toggle).toHaveAttribute('aria-checked','false');
 await expect(row.getByRole('switch',{name:'مراجع · SEO'})).toHaveAttribute('aria-checked','false');
 await expect(page.locator('.ta-table tbody tr').filter({hasText:'Administrator'}).getByText('Administrators see every agent')).toBeVisible();
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked','true');
 await expect(toggle).toBeEnabled();
 await page.reload();
 await expect(page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · Meta Ads'})).toHaveAttribute('aria-checked','true');

 const context=await browser.newContext(); const member=await context.newPage();
 try {
  await signIn(member,'reviewer@example.com','/c/rs-learning/chat');
  await openNavigation(member);
  await expect(member.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name')).toHaveText(['Lead','Meta Ads']);
  expect((await member.goto(`/c/rs-learning/chat/${seo}`))!.status()).toBe(404);
  await expect(member.getByRole('heading',{name:'Page not found'})).toBeVisible();
  const refused=await member.request.post('/api/conversations',{data:{company,conversation:randomUUID(),agent:seo,message:'Hello',sendKey:randomUUID()}});
  expect(refused.status()).toBe(404);
  expect((await member.goto(`/c/rs-learning/chat/${ads}`))!.status()).toBe(200);

  // Hidden again: gone from the list at the next page, and its address is not found.
  await row.getByRole('switch',{name:'مراجع · Meta Ads'}).click();
  await expect(page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · Meta Ads'})).toHaveAttribute('aria-checked','false');
  await expect(page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · Meta Ads'})).toBeEnabled();
  expect((await member.goto(`/c/rs-learning/chat/${ads}`))!.status()).toBe(404);
  await member.goto('/c/rs-learning/chat');
  await openNavigation(member);
  await expect(member.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name')).toHaveText(['Lead']);
 } finally { await context.close(); }
});

// #129 (design-reference: .switch, .switch::after): a switch's thumb travels on the spring over 320ms and fades its
// colour over 200ms, its track fades over 150ms, and turned on the thumb sits 12px toward the end side, in English and
// in Arabic. With reduced motion it jumps. The switch is turned back, so the board test below starts as it expects.
test('a switch\'s thumb springs to the end side and fades its colour, in English and Arabic, and jumps with reduced motion',async({page})=>{
 const thumb=()=>page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · SEO'}).evaluate((element,{names,parts,life})=>{
  // Every motion on the page ends at once, but the Agents' faces live on and never end (#697, app/face.css): their
  // CSS loops, their parts' transitions and the blinks, glances and moments components/face-life keeps on them.
  const face=(animation:Animation)=>{ const target=(animation.effect as KeyframeEffect|null)?.target as Element|null;
   return animation instanceof CSSAnimation?names.includes(animation.animationName)
    :animation instanceof CSSTransition?!!target?.matches(parts):!!target?.matches(life); };
  document.getAnimations().filter(animation=>!face(animation)).forEach(animation=>animation.finish());
  const after=getComputedStyle(element,'::after'), track=getComputedStyle(element);
  return {thumb:after.transition,track:[track.transitionProperty,track.transitionDuration,track.transitionTimingFunction].join(' '),at:after.transform};
 },{names:faceAnimations,parts:faceTransitions,life:faceParts});
 const thumbMoves='transform 0.32s cubic-bezier(0.34, 1.45, 0.64, 1), background-color 0.2s cubic-bezier(0.2, 0, 0, 1)';
 const trackMoves='background-color 0.15s cubic-bezier(0.2, 0, 0, 1)';
 try { for(const [language,end] of [['en',12],['ar',-12]] as const) {
  query(`update public.people set language='${language}' where id='${omar}';`);
  await signIn(page,'omar@example.com','/c/rs-learning/settings?section=members');
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  const toggle=page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · SEO'});
  await expect(toggle).toHaveAttribute('aria-checked','false');
  expect(await thumb(),`off, in ${language}`).toEqual({thumb:thumbMoves,track:trackMoves,at:'none'});
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked','true');
  await expect(toggle).toBeEnabled();
  expect(await thumb(),`on, in ${language}`).toEqual({thumb:thumbMoves,track:trackMoves,at:`matrix(1, 0, 0, 1, ${end}, 0)`});
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await toggle.evaluate(element=>getComputedStyle(element,'::after').transitionDuration),`with reduced motion, in ${language}`).toMatch(/^0s(, 0s)*$/);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked','false');
  await expect(toggle).toBeEnabled();
  await page.context().clearCookies();
 } } finally {
  // Whatever failed, the board test below starts with Omar in English and SEO shown to nobody.
  query(`do $$ begin update public.people set language='en' where id='${omar}'; delete from public.member_agent_access where agent_id='${seo}'; end $$;`);
 }
});

// #190 on the Engine's own board (spec #831, #834): a Card given to an Agent hidden from a reader is not on their board.
// Meta Ads is shown to the Contributor again, SEO to nobody; each Agent runs on its own Engine profile, and the fake
// Engine holds one Card for each. The read through the handle is proven in company-board.test.mjs.
test('the board shows a Member the Cards of the Agents they see only, a Viewer too',async({page,browser})=>{
 query(`do $$ begin
  update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004');
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','20000000-0000-0000-0000-000000000003','${ads}') on conflict do nothing;
  insert into public.agent_profiles(agent_id,company_id) values ('${lead}','${company}'),('${ads}','${company}'),('${seo}','${company}') on conflict do nothing;
  update public.hermes_agents set profile=public.agent_engine_profile(id) where id in ('${lead}','${ads}','${seo}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${company}','co-${company.replaceAll('-','')}',true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
 const fake=await laneHermes();
 try {
  const profileOf=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
  fake.settings.kanban.task({title:'Lead plans the month',status:'triage',assignee:profileOf(lead)});
  fake.settings.kanban.task({title:'Ads runs the launch',status:'running',assignee:profileOf(ads)});
  fake.settings.kanban.task({title:'SEO drafts the blog',status:'ready',assignee:profileOf(seo)});
  const titles=(on:typeof page)=>on.locator('#board-cols .kcard .kcard__title');
  await signIn(page,'omar@example.com','/c/rs-learning/work/board');
  await expect(titles(page)).toHaveText(['Lead plans the month','SEO drafts the blog','Ads runs the launch']);
  for(const [email,seen] of [['reviewer@example.com',['Lead plans the month','Ads runs the launch']],['viewer@example.com',['Lead plans the month']],['manager@example.com',['Lead plans the month']]] as [string,string[]][]) {
   const context=await browser.newContext(); const member=await context.newPage();
   try {
    await signIn(member,email,'/c/rs-learning/work/board');
    await expect(titles(member)).toHaveText(seen);
    // Nor does the board's own answer hold a hidden Agent's Card or name.
    const answer=await (await member.request.get(`/api/board?company=${company}`)).text();
    expect(answer).not.toContain('SEO drafts the blog');
    expect(answer).not.toContain('"SEO"');
   } finally { await context.close(); }
  }
 } finally { await fake.close(); }
});
