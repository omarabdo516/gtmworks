import { test, expect, type Locator, type Page } from '@playwright/test';
import { chooseLanguageInSettings } from './choose-language';
import { signIn } from './sign-in';

const names=['Lead','وكيل المحتوى','المصمم','الناقد'];
async function faceMarkup(face:Locator,name:string) {
 await expect(face).toBeVisible();
 await expect(face).toHaveAccessibleName(name);
 expect(await face.evaluate(element=>element.getAnimations({subtree:true}).length)).toBe(0);
 return face.innerHTML();
}
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}

test('shared agents keep distinct, named, still faces across screens and companies',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 try {
  for(const language of ['en','ar'] as const) {
   await chooseLanguage(page,language);
   for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto('/c/rs-learning/home');
    const faces=await Promise.all(names.map(name=>faceMarkup(page.locator('.home-agents').getByRole('img',{name,exact:true}),name)));
    expect(new Set(faces).size).toBe(4);
    for(const [path,scope] of [
     ['/c/rs-learning/work/board','.card-avatars'],
     ['/c/rs-learning/agents','main'],
     ['/c/aleem/home','.home-agents'],
     ['/c/aleem/agents','main'],
    ]) {
     await page.goto(path);
     for(const [index,name] of names.entries()) {
      const face=page.locator(scope).getByRole('img',{name,exact:true}).first();
      expect(await faceMarkup(face,name)).toBe(faces[index]);
      await page.mouse.move(0,0);
      await page.mouse.move(width/2,300);
      expect(await face.innerHTML()).toBe(faces[index]);
     }
    }
   }
  }
  await chooseLanguage(page,'en');
  await page.goto('/c/rs-learning/work/board/1');
  await page.getByRole('button',{name:'Add assignee',exact:true}).click();
  const writer=page.getByRole('menuitemradio',{name:names[1],exact:true});
  await expect(writer.getByRole('img',{name:names[1],exact:true})).toBeVisible();
  await writer.click();
  await expect(page.locator('[data-card-section=assignees] input[name=person]')).toHaveValue('30000000-0000-0000-0000-000000000001');
 } finally { await chooseLanguage(page,'en'); }
});

test('revoking a grant keeps the agent face and name in a company-only member’s history',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/agents');
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3000'});
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
