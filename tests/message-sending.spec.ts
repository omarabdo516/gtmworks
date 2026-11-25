import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #756: on a slow Engine, whose start of a Run is answered 3 seconds late, a message sent in an open Conversation is on
// screen within 200 ms of the press, with the line under the transcript reading "Thinking"; once the reply lands the
// message is there once.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id='${omar}'`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
});
test.afterAll(async()=>{ if(fake) fake.settings.startDelay=0; await fake?.close(); });

test('a message sent while the Engine is slow to start its Run is on screen at once, the line reads Thinking, and it is there once after the reply',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 const first=`Hello ${Date.now()}`;
 await page.getByLabel('Message',{exact:true}).fill(first);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
 await expect(page.locator('.turn--agent').filter({hasText:`Reply to: ${first}`})).toBeVisible({timeout:30000});

 fake.settings.startDelay=3000;
 const text=`Plan the December campaign ${Date.now()}`;
 await page.getByLabel('Message',{exact:true}).fill(text);
 // The time from the press to the message in the transcript, measured in the page itself.
 await page.evaluate(said=>{
  const marks=window as unknown as {pressed?:number,drawn?:number,kind?:string|null};
  document.querySelector('.composer__send')!.addEventListener('click',()=>{ marks.pressed=performance.now(); },{capture:true,once:true});
  const seen=new MutationObserver(()=>{ const bubble=[...document.querySelectorAll('.turn--user .bubble--user')].find(each=>each.textContent===said); if(bubble) { marks.drawn=performance.now(); marks.kind=bubble.closest('li')!.getAttribute('data-kind'); seen.disconnect(); } });
  seen.observe(document.querySelector('.turns')!,{subtree:true,childList:true,characterData:true});
 },text);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const mine=page.locator('.turn--user').filter({hasText:text});
 await expect(mine).toBeVisible();
 const {pressed:at,drawn,kind}=await page.evaluate(()=>{ const marks=window as unknown as {pressed:number,drawn:number,kind:string|null}; return {pressed:marks.pressed,drawn:marks.drawn,kind:marks.kind}; });
 expect(drawn-at,'drawn within 200 ms of the press').toBeLessThan(200);
 // Drawn by the page before the Engine answered the start: the message the person sent, not yet the stored one.
 expect(kind).toBe('sending');
 await expect(page.locator('.activity .activity__t')).toHaveText('Thinking…');
 await expect(page.locator('.turn--agent').filter({hasText:`Reply to: ${text}`})).toBeVisible({timeout:30000});
 await expect(mine).toHaveCount(1);
 await expect(mine).not.toHaveAttribute('data-kind','sending');
});
