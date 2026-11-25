import { test, expect, type Locator } from './fresh-seed';
import { signIn } from './sign-in';
import { appOrigin } from './lane.mjs';
import { execFileSync } from 'node:child_process';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

const names=['Lead','وكيل المحتوى','المصمم','الناقد'];
// A legacy role agent shows its name's first letter, as a person does (#697), named for assistive technology where its
// name is not written beside it; in a message the name beside it says who, and the letter is silent.
async function faceMarkup(face:Locator,name:string|null) {
 await expect(face).toBeVisible();
 if(name) await expect(face).toHaveAccessibleName(name);
 expect(await face.evaluate(element=>element.getAnimations({subtree:true}).length)).toBe(0);
 return face.innerHTML();
}

test('revoking a grant keeps the agent face and name in a company-only member’s history',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/agents');
 const context=await browser.newContext({baseURL:appOrigin});
 const member=await context.newPage();
 const writer=page.getByRole('form',{name:'Writer',exact:true});
 try {
  const body=`Face history ${Date.now()}`;
  // The Writer's note on card 1, written as the Writer (seed.sql's way): the note's activity row takes its author from
  // the signed-in id, auth.uid().
  query(`do $$ begin perform set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
   insert into public.work_comments(company_id,card_id,body,author_id) values ('10000000-0000-0000-0000-000000000001',1,'${body}','30000000-0000-0000-0000-000000000001'); end $$`);
  await signIn(member,'manager@example.com','/c/rs-learning/work/board');
  const before=await faceMarkup(member.locator('.card-avatars').getByRole('img',{name:names[1],exact:true}).first(),names[1]);
  await writer.getByRole('button',{name:'Revoke access from Writer'}).click();
  await expect(writer.getByText('No access',{exact:true})).toBeVisible();
  await member.goto('/c/rs-learning/work/board');
  expect(await faceMarkup(member.locator('.card-avatars').getByRole('img',{name:names[1],exact:true}).first(),names[1])).toBe(before);
  await member.goto('/c/rs-learning/work/board/1');
  const message=member.locator('.message[data-author=agent]').filter({hasText:body});
  await expect(message.locator('strong')).toHaveText(names[1]);
  expect(await faceMarkup(message.locator('.avatar'),null)).toBe(before);
 } finally {
  await page.goto('/c/rs-learning/agents');
  if(await writer.getByRole('button',{name:'Grant access to Writer'}).isVisible()) await writer.getByRole('button',{name:'Grant access to Writer'}).click();
  await expect(writer.getByText('Has access',{exact:true})).toBeVisible();
  await context.close();
 }
});
