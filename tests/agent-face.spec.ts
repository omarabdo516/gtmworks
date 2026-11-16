import { test, expect, type Locator } from './fresh-seed';
import { signIn } from './sign-in';
import { appOrigin } from './lane.mjs';

const names=['Lead','وكيل المحتوى','المصمم','الناقد'];
async function faceMarkup(face:Locator,name:string) {
 await expect(face).toBeVisible();
 await expect(face).toHaveAccessibleName(name);
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
  const comment=await page.request.post('/api/v1/companies/rs-learning/cards/1/comment',{headers:{Authorization:'Bearer agt_local_fixture_for_tests_only','Idempotency-Key':body},data:{body}});
  expect(comment.status()).toBe(200);
  await signIn(member,'manager@example.com','/c/rs-learning/home');
  const before=await faceMarkup(member.locator('.home-agents').getByRole('img',{name:names[1],exact:true}),names[1]);
  await writer.getByRole('button',{name:'Revoke access from Writer'}).click();
  await expect(writer.getByText('No access',{exact:true})).toBeVisible();
  await member.goto('/c/rs-learning/work/board');
  expect(await faceMarkup(member.locator('.card-avatars').getByRole('img',{name:names[1],exact:true}).first(),names[1])).toBe(before);
  await member.goto('/c/rs-learning/work/board/1');
  const message=member.locator('.message[data-author=agent]').filter({hasText:body});
  await expect(message.locator('strong')).toHaveText(names[1]);
  expect(await faceMarkup(message.getByRole('img',{name:names[1],exact:true}),names[1])).toBe(before);
 } finally {
  await page.goto('/c/rs-learning/agents');
  if(await writer.getByRole('button',{name:'Grant access to Writer'}).isVisible()) await writer.getByRole('button',{name:'Grant access to Writer'}).click();
  await expect(writer.getByText('Has access',{exact:true})).toBeVisible();
  await context.close();
 }
});
