import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn } from './sign-in';
import { laneHermes } from './lane-hermes';

// #648, on the app with the lane's fake Hermes: an Agent asks with clarify a question where several may be picked (Omar's
// "Which of them do we make now?", four choices, multi_select). The card draws every choice; the person picks two of the
// four and sends them, which reaches Hermes as the one JSON array it decodes for multi_select, and the card then shows both
// picks, each with its check. A second such question is answered in words, which reach Hermes as written.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001', omar='20000000-0000-0000-0000-000000000001';
const formats=['Reel','Carousel','Story','Post'];

test('a several-pick question draws its choices: two of four picked are sent as one answer and shown with their checks, and typed words answer the next',async({page})=>{
 const stamp=Date.now(), conversation=randomUUID(), agent=randomUUID();
 const fake=await laneHermes();
 try {
  fake.settings.questions=input=>input.includes(stamp.toString())?[{question:`Which of them do we make now ${stamp}?`,choices:formats,multi_select:true}]:[];
  fake.settings.reply=(input:string,answers:(string|null)[]=[])=>`Reply to: ${input}${answers.length?` (${answers.join(', ')})`:''}`;
  query(`insert into public.hermes_agents(id,company_id,name,speciality,profile,is_default) values ('${agent}','${rs}','Ads ${stamp}','Ads','picks-${stamp}',false)`);
  query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${rs}','${omar}','${agent}','Ads ${stamp}')`);
  await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
  const ask=async(message:string)=>{
   await page.getByLabel('Message',{exact:true}).fill(message);
   await page.getByRole('button',{name:'Send',exact:true}).click();
   // Sending waits for the engine to accept the run, so it is given longer than a page change.
   await expect(page.locator('.msg[data-author=person]').filter({hasText:message})).toBeVisible({timeout:30000});
  };

  await ask(`Plan the December posts ${stamp}`);
  const card=page.getByRole('group',{name:`Which of them do we make now ${stamp}?`,exact:true});
  await expect(card).toBeVisible();
  await expect(card).toContainText('Pick one or more, then send, or write your answer in the message');
  await expect(card.locator('.qcard__opts .opt .opt__t')).toHaveText(formats);
  const send=card.getByRole('button',{name:'Send',exact:true});
  await expect(send).toBeDisabled();
  await card.getByRole('button',{name:'Story'}).click();
  await card.getByRole('button',{name:'Reel'}).click();
  await expect(card.getByRole('button',{name:'Reel'})).toHaveAttribute('aria-pressed','true');
  await send.click();
  const answered=page.getByRole('group',{name:`Which of them do we make now ${stamp}?: Answered`,exact:true});
  await expect(answered.locator('.opt.is-chosen .opt__t')).toHaveText(['Reel','Story']);
  await expect(answered.locator('.opt.is-chosen .opt__check')).toHaveCount(2);
  await expect(page.locator('.msg[data-author=agent]').filter({hasText:`Plan the December posts ${stamp} (["Reel","Story"])`})).toBeVisible({timeout:30000});
  expect(fake.settings.answers.map(answer=>[answer.status,answer.body.answer])).toEqual([[200,JSON.stringify(['Reel','Story'])]]);
  // The record keeps both: after a reload the card still shows the two picks, each with its check.
  await page.reload();
  await expect(answered.locator('.opt.is-chosen .opt__t')).toHaveText(['Reel','Story']);
  await expect(answered.locator('.opt.is-chosen .opt__check')).toHaveCount(2);

  // Typed words answer the next several-pick question as written.
  await ask(`Plan the January posts ${stamp}`);
  await expect(page.getByRole('group',{name:`Which of them do we make now ${stamp}?`,exact:true})).toBeVisible();
  await ask('Only the reel, this week');
  await expect(page.locator('.msg[data-author=agent]').filter({hasText:`Plan the January posts ${stamp} (Only the reel, this week)`})).toBeVisible({timeout:30000});
  expect(fake.settings.answers.map(answer=>answer.body.answer)).toEqual([JSON.stringify(['Reel','Story']),'Only the reel, this week']);
 } finally {
  query(`delete from public.hermes_agents where id='${agent}'`);
  await fake.close();
 }
});
