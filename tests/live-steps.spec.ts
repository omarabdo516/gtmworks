import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #646: while Lead works on a reply, the line under the transcript names the step it is on now and the turn's steps list
// fills in, from the Run's own event stream on the lane's fake Hermes (api_server_runs.py _handle_run_events). A reload
// mid-Run draws the steps so far at once, and the reply that lands carries the session's list in their place, once.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
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
test.afterAll(async()=>{ fake.settings.pendingReads=0; await fake?.close(); });

test('while Lead works, its step now and its steps so far are on screen live, a reload keeps them, and the reply takes their place',async({page})=>{
 test.setTimeout(120000);
 fake.settings.pendingReads=1e9;
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 const text=`Plan the Meta campaign ${Date.now()}`;
 await page.getByLabel('Message',{exact:true}).fill(text);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
 const conversation=page.url().split('/').pop()!;
 const [{run_id:run}]=rows(`select run_id from public.conversation_messages where conversation_id='${conversation}' and author='person'`) as {run_id:string}[];
 const line=page.locator('.activity');
 const now=line.locator('.activity__t');
 // The Run has made no call yet.
 await expect(now).toHaveText('Thinking…',{timeout:20000});
 await expect(line.locator('.activity__who')).toHaveText('Lead');
 fake.settings.emit(run,{event:'tool.started',tool:'web_search',preview:'accounting courses Cairo',tool_call_id:'call_1'});
 await expect(now).toHaveText('web_search · accounting courses Cairo…');
 fake.settings.emit(run,{event:'tool.completed',tool:'web_search',duration:1.2,error:false,tool_call_id:'call_1'});
 await expect(now).toHaveText('Writing the reply…');
 const live=page.locator('li[data-live]');
 await expect(live.locator('.steps__toggle')).toHaveText('Used 1 tool');
 // A path is never shown, and a failed call is the reference's skipped step.
 fake.settings.emit(run,{event:'tool.started',tool:'read_file',preview:'/opt/data/work/campaigns.csv',tool_call_id:'call_2'});
 await expect(now).toHaveText('read_file…');
 fake.settings.emit(run,{event:'tool.completed',tool:'read_file',duration:0.1,error:true,tool_call_id:'call_2'});
 await expect(live.locator('.steps__toggle')).toHaveText('Used 2 tools');
 // Opened again mid-Run: the steps so far and the line, not an empty line.
 await page.reload();
 await expect(now).toHaveText('Writing the reply…',{timeout:20000});
 await live.locator('.steps__toggle').click();
 await expect(live.locator('.steps__list .step')).toHaveText(['web_search · accounting courses CairoDone','read_fileSkipped']);
 // The reply lands with the session's own record of the Run's steps, drawn once where the live list was.
 const sent=Date.parse(String(rows(`select created_at from public.conversation_messages where conversation_id='${conversation}' and author='person'`)[0].created_at))/1000;
 const call=(id:string,name:string,args:object)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
 const session=fake.settings.runs.find(each=>each.id===run)?.session as string;
 fake.settings.sessions.set(session,{profile,messages:[
  {role:'user',content:text,timestamp:sent+0.5},
  {role:'assistant',content:'',tool_calls:[call('call_1','web_search',{query:'accounting courses Cairo'}),call('call_2','read_file',{path:'campaigns.csv'})],timestamp:sent+1},
  {role:'tool',tool_call_id:'call_1',tool_name:'web_search',content:'{"results":[]}',timestamp:sent+2},
  {role:'tool',tool_call_id:'call_2',tool_name:'read_file',content:'{"success":false,"error":"not found"}',timestamp:sent+3},
  {role:'assistant',content:`Reply to: ${text}`,timestamp:sent+4}]});
 fake.settings.pendingReads=0;
 const reply=page.locator('.turn--agent').filter({hasText:`Reply to: ${text}`});
 await expect(reply).toBeVisible({timeout:30000});
 await expect(live).toHaveCount(0);
 await expect(line).toHaveCount(0);
 await expect(page.locator('.steps')).toHaveCount(1);
 await expect(reply.locator('.steps__toggle')).toHaveText('Used 2 tools · 4 sec');
 await expect(reply.locator('.steps__toggle')).toHaveAttribute('aria-expanded','true');
 await expect(reply.locator('.steps__list .step')).toHaveText(['web_search · accounting courses CairoDone','read_file · campaigns.csvSkipped']);
 expect(fake.settings.requests.some(request=>request.path===`/p/${profile}/v1/runs/${run}/events`),'read from the profile the Run is on').toBe(true);
 // The fake Engine counts what it was asked, by kind (#762): one message started one Run.
 expect(fake.settings.counts().runStart).toBe(1);
});
