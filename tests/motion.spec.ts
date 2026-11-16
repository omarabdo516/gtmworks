import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { motionTable, type MotionRow, type Screen } from './motion-table.mjs';
import { easing, milliseconds, motionOf, productFiles, readSheet, referenceStyles, splitTop, transitionOf } from './motion-css.mjs';
import { languages, widths } from './visual-screens.mjs';

// #127: every part in tests/motion-table.mjs, read on its own screen as the browser computes it, moves as the
// reference's rule says, in both languages and at both widths; with reduced motion nothing under .gw moves for more than
// 1ms, nothing repeats and nothing scrolls smoothly.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const [omar,reviewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003'];
const id=(n:number)=>`6c000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [leadLink,adsLink,lead,ads,talk,welcome,asked]=[1,2,3,4,5,6,7].map(id);

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 // Lead and Ads, Omar's Conversation with Lead and an empty one, a question Lead asked him, and a Contributor's request
 // for an Agent that waits on him. Added once: a retry on the same lane keeps this file's data (tests/fresh-seed.ts).
 query(`do $$ begin
  if exists (select 1 from public.hermes_connections where id='${leadLink}') then return; end if;
  insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
   ('${leadLink}','${company}','${omar}','http://127.0.0.1:9/p/motion-lead','motion-lead','no-key','unreachable'),
   ('${adsLink}','${company}','${omar}','http://127.0.0.1:9/p/motion-ads','motion-ads','no-key','unreachable');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
   ('${lead}','${company}','${leadLink}','Lead','General',true),('${ads}','${company}','${adsLink}','Ads','Runs the ads.',false);
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
   ('${talk}','${company}','${omar}','${lead}','Lead'),('${welcome}','${company}','${omar}','${lead}','Lead'),('${asked}','${company}','${reviewer}','${lead}','Lead');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id) values
   ('${company}','${talk}','person','${omar}',null,'Omar','Draft the Meta ad for the new course','${id(8)}','motion-run'),
   ('${company}','${talk}','agent',null,'${lead}','Lead','Here is a first draft of the ad.',null,'motion-run'),
   ('${company}','${asked}','person','${reviewer}',null,'مراجع','I want someone to follow up our WhatsApp leads','${id(9)}','motion-ask');
  insert into public.lead_agent_requests(company_id,conversation_id,run_id,call_id,asked_by,asked_with,agent_name,job,apps) values
   ('${company}','${asked}','motion-ask','call-0','${reviewer}','I want someone to follow up our WhatsApp leads','FollowUp','Follows up the WhatsApp leads.',array['WhatsApp Business']);
  perform public.add_waiting_item('${company}','${omar}','question','Which angle should the ad take?','',null,'${talk}','Lead');
 end $$;`);
});

// Each screen: where it opens, what shows it is ready, and what brings its parts out.
const screens:Record<Screen,{path:string,ready:string,show?:(page:Page)=>Promise<void>,set?:string,unset?:string}>={
 conversation:{path:`/c/rs-learning/conversations/${talk}`,ready:'.gw .sender__time'},
 'lead-welcome':{path:`/c/rs-learning/conversations/${welcome}`,ready:'.gw .try-one__btn'},
 gallery:{path:'/c/rs-learning/chat?new=ready',ready:'.gw.modal .tpl-search input'},
 // The leave is held still where it starts, so the closing dialog stays to be read.
 'gallery-closing':{path:'/c/rs-learning/chat?new=ready',ready:'.gw.modal .tpl-search input',show:async page=>{
  await page.addStyleTag({content:'.gw.modal { animation-play-state: paused !important; }'});
  await page.keyboard.press('Escape');
  await expect(page.locator('.gw.modal[data-state="closed"]')).toBeAttached();
 }},
 request:{path:'/c/rs-learning/approvals',ready:'.gw .ac-card--req',show:async page=>{
  await expect(async()=>{
   if(!await page.locator('.gw .ac-card .set-input').count()) await page.locator('.gw .ac-card--req .card__actions .btn--secondary').click();
   await expect(page.locator('.gw .ac-card .set-input')).toBeVisible({timeout:2000});
  }).toPass();
 }},
 board:{path:'/c/rs-learning/work/board',ready:'.gw .board-view .mcard'},
 settings:{path:'/c/rs-learning/settings',ready:'.gw .sov .switch'},
 log:{path:'/c/rs-learning/log',ready:'.gw .log-page .set-input'},
 'first-run':{path:'/c/rs-learning/home',ready:'.gw .cr-kind',set:`update public.companies set work_mode=null where id='${company}'`,unset:`update public.companies set work_mode='team' where id='${company}'`},
};

const reference=referenceStyles();
// The product's name for a keyframe, found by its frames: tests/motion-reference.test.mjs keeps each set of frames
// under one name.
const keyframeNames=new Map(productFiles().flatMap(file=>[...readSheet(file).keyframes].map(([name,frames])=>[frames,name])));

type Computed={properties:string[],durations:string[],easings:string[],names:string[],animationDurations:string[],animationEasings:string[]};
function expected(row:MotionRow,width:number):Computed {
 const motion=motionOf(reference,row.ref,width);
 if(!motion) throw new Error(`${row.ref} is not in the reference`);
 const names=motion.animation.frames.map(frames=>keyframeNames.get(frames)??`(no keyframes under app/ move as ${row.ref}'s)`);
 return {properties:motion.transition.properties,durations:motion.transition.durations,easings:motion.transition.easings,
  names:names.length?names:['none'],animationDurations:motion.animation.durations,animationEasings:motion.animation.easings};
}
async function computed(page:Page,selector:string):Promise<Computed> {
 const style=await page.locator(selector).first().evaluate(element=>{
  const style=getComputedStyle(element);
  return [style.transitionProperty,style.transitionDuration,style.transitionDelay,style.transitionTimingFunction,style.animationName,style.animationDuration,style.animationTimingFunction];
 },undefined,{timeout:10000});
 const [properties,durations,delays,easings,names,animationDurations,animationEasings]=style.map(value=>splitTop(value,','));
 const transition=transitionOf({properties,durations:durations.map(milliseconds),delays:delays.map(milliseconds),easings:easings.map(easing)});
 return {properties:transition.properties,durations:transition.durations,easings:transition.easings,names,animationDurations:animationDurations.map(milliseconds),animationEasings:animationEasings.map(easing)};
}
// What still moves under .gw: a transition or an animation longer than 1ms, an animation that repeats, a smooth scroll.
const moving=(page:Page)=>page.evaluate(()=>{
 const longest=(times:string)=>Math.max(...times.split(',').map(time=>parseFloat(time)*1000));
 const found:string[]=[];
 for(const element of document.querySelectorAll('.gw, .gw *')) for(const pseudo of [null,'::before','::after']) {
  const style=getComputedStyle(element,pseudo);
  const repeats=style.animationName!=='none'&&style.animationIterationCount.split(',').some(count=>count.trim()==='infinite'||Number(count)>1);
  if(longest(style.transitionDuration)>1||longest(style.animationDuration)>1||repeats||style.scrollBehavior==='smooth')
   found.push(`${element.tagName.toLowerCase()}.${String(element.className)}${pseudo??''}: transition ${style.transitionDuration}, animation ${style.animationDuration} × ${style.animationIterationCount}, scroll ${style.scrollBehavior}`);
 }
 return found;
});

for(const language of languages) test(`every part moves as the reference at ${widths.join(' and ')} wide in ${language}, and stops under reduced motion`,async({page})=>{
 test.setTimeout(180000);
 query(`update public.people set language='${language}' where id='${omar}'`);
 await page.setViewportSize({width:widths[0],height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 for(const [name,screen] of Object.entries(screens) as [Screen,typeof screens[Screen]][]) {
  if(screen.set) query(screen.set);
  try {
   await page.setViewportSize({width:widths[0],height:900});
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.goto(screen.path);
   await expect(page.locator('html')).toHaveAttribute('lang',language);
   await expect(page.locator(screen.ready).first()).toBeAttached();
   await screen.show?.(page);
   for(const width of widths) {
    await page.setViewportSize({width,height:900});
    for(const row of motionTable.filter(row=>row.screen===name)) expect.soft(await computed(page,row.element??row.built),`${row.built} (${row.ref}) on ${name} at ${width}px`).toEqual(expected(row,width));
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   for(const width of widths) {
    await page.setViewportSize({width,height:900});
    expect.soft(await moving(page),`what still moves on ${name} at ${width}px with reduced motion`).toEqual([]);
   }
  } finally {
   if(screen.unset) query(screen.unset);
  }
 }
});
