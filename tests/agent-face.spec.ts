import { test, expect, type Locator } from './fresh-seed';
import { signIn } from './sign-in';
import { execFileSync } from 'node:child_process';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

const writer='30000000-0000-0000-0000-000000000001', name='وكيل المحتوى';
// Spec #695: a person shows its name's first letter (#697), named for assistive technology where its name is not written
// beside it; in a message the name beside it says who, and the letter is silent.
async function faceMarkup(face:Locator,label:string|null) {
 await expect(face).toBeVisible();
 if(label) await expect(face).toHaveAccessibleName(label);
 expect(await face.evaluate(element=>element.getAnimations({subtree:true}).length)).toBe(0);
 return face.innerHTML();
}

// An identity that was one of the old role agents is a removed membership now: what it wrote keeps its name and letter.
test('a comment keeps its writer\'s name and letter after the writer\'s membership is removed',async({page})=>{
 const body=`Face history ${Date.now()}`;
 try {
  // The note on card 1, written as that Member (seed.sql's way): the note's activity row takes its author from the
  // signed-in id, auth.uid().
  query(`do $$ begin perform set_config('request.jwt.claim.sub','${writer}',true);
   insert into public.work_comments(company_id,card_id,body,author_id) values ('10000000-0000-0000-0000-000000000001',1,'${body}','${writer}'); end $$`);
  await signIn(page,'manager@example.com','/c/rs-learning/work/board/1');
  const message=page.locator('.message[data-author=person]').filter({hasText:body});
  await expect(message.locator('strong')).toHaveText(name);
  const before=await faceMarkup(message.locator('.avatar'),null);
  expect(await message.locator('.avatar').textContent()).toBe('و');
  query(`update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='${writer}'`);
  await page.reload();
  await expect(message.locator('strong')).toHaveText(name);
  expect(await faceMarkup(message.locator('.avatar'),null)).toBe(before);
 } finally {
  query(`update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000001' and person_id='${writer}'`);
 }
});
