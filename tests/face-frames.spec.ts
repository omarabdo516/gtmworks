import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn } from './sign-in';

// #697 (spec #694): the faces' cost, measured as the spec says, with the machine to itself (project `alone`): sixteen
// Agents in the sidebar, each a 56px face moving, two of them working, on a CPU slowed four times, for ten seconds, the
// pointer resting near them. The page keeps 50 frames a second or more, and the faces add no long task: the same ten
// seconds with the faces taken off the page have as many long tasks or more.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const seconds=10;

test('sixteen moving faces of 56px, two working, keep 50 frames a second on a CPU slowed four times, and add no long task',async({page},testInfo)=>{
 test.setTimeout(120000);
 // A retry starts from the seed again: the sixteen Agents of the attempt before would double the sidebar (a repeat
 // starts from it by itself, tests/fresh-seed.ts).
 if(testInfo.retry>0) freshSeed(testInfo,true);
 const agents=Array.from({length:16},(_,index)=>({id:randomUUID(),connection:randomUUID(),name:`Agent ${String(index+1).padStart(2,'0')}`}));
 const working=agents.slice(1,3).map(agent=>({agent,conversation:randomUUID()}));
 query(`do $$ begin
  update public.hermes_agents set is_default=false where company_id='${company}' and is_default;
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ${agents.map((agent,index)=>`('${agent.id}','${company}','${agent.connection}','${agent.name}','Marketing',${index===0},'frames-${index}')`).join(',\n   ')};
  ${working.map(({agent,conversation})=>`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${omar}','${agent.id}','${agent.name}');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
   ('${company}','${conversation}','person','${omar}','Omar','Plan the June campaign','${randomUUID()}','frames-${agent.id}',now());`).join('\n  ')}
 end $$;`);
 await page.setViewportSize({width:1440,height:1500});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const faces=page.locator('.sidebar .agent-tile .face--live');
 await expect(faces).toHaveCount(16);
 await expect(page.locator('.sidebar .agent-tile .face[data-state="working"]')).toHaveCount(2);
 // Every one is on screen, so every one moves.
 await expect.poll(()=>page.locator('.sidebar .agent-tile .face.is-vis').count()).toBe(16);
 // The pointer rests among them, so the faces lean toward it.
 const lead=(await page.locator('.sidebar .agent-tile').first().boundingBox())!;
 await page.mouse.move(lead.x+lead.width/2,lead.y+lead.height+40);
 const session=await page.context().newCDPSession(page);
 await session.send('Emulation.setCPUThrottlingRate',{rate:4});
 // The page settles first: what it does once, as it opens, is not the faces' cost.
 await page.waitForTimeout(5000);
 // Frames drawn and long tasks over the ten seconds.
 const measure=async()=>{
  const result=page.evaluate(async seconds=>{
   const long:number[]=[];
   const observer=new PerformanceObserver(list=>{ for(const entry of list.getEntries()) long.push(Math.round(entry.duration)); });
   observer.observe({type:'longtask'});
   let frames=0; const start=performance.now();
   await new Promise<void>(done=>{ const frame=(now:number)=>{ frames++; if(now-start<seconds*1000) requestAnimationFrame(frame); else done(); }; requestAnimationFrame(frame); });
   observer.disconnect();
   return {fps:Math.round(frames/((performance.now()-start)/1000)*10)/10,longTasks:long.length,longest:Math.max(0,...long)};
  },seconds);
  return result;
 };
 const moving=await measure();
 // The same ten seconds with no face on the page: what the page costs without them.
 await page.addStyleTag({content:'.sidebar .agent-tile .fw { display: none !important; }'});
 const without=await measure();
 await session.send('Emulation.setCPUThrottlingRate',{rate:1});
 const numbers=`faces moving: ${moving.fps} fps, ${moving.longTasks} long tasks (longest ${moving.longest}ms); no faces: ${without.fps} fps, ${without.longTasks} long tasks (longest ${without.longest}ms)`;
 testInfo.annotations.push({type:'frames',description:numbers});
 console.log(`Face frames (CPU slowed 4x, ${seconds}s): ${numbers}`);
 expect(moving.fps,numbers).toBeGreaterThanOrEqual(50);
 expect(moving.longTasks,numbers).toBeLessThanOrEqual(without.longTasks);
 // The next file starts from the seed again (tests/fresh-seed.ts), so nothing is taken away here: a Conversation's
 // messages are append-only.
});
