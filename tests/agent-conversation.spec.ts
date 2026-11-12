import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { signIn } from './sign-in';
// This file sorts before app.spec.ts on purpose: that file revokes the public fixture key at its end.
const agent={Authorization:'Bearer agt_local_fixture_for_tests_only'};
const root='/api/v1/companies/rs-learning/cards';
// The fixture key belongs to the Writer agent; its role colour is #b5d9cf.
const writerName='وكيل المحتوى';
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await page.goto('/c/rs-learning/settings');
 await page.locator('select[name=language]').selectOption(language);
 await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}

test('people and agents reply inside one card, in order, each labelled and in its own direction', async ({page,request}) => {
 await mkdir('test-results/screenshots',{recursive:true});
 const stamp=Date.now();
 const created=await request.post(root,{headers:{...agent,'Idempotency-Key':`conversation-card-${stamp}`},data:{title:`Conversation ${stamp}`,stage:1}});
 expect(created.status()).toBe(201);
 const card=(await created.json()).id as number;
 const first=`Draft is ready مسودة جاهزة ${stamp}`;
 const posted=await request.post(`${root}/${card}/comment`,{headers:{...agent,'Idempotency-Key':`conversation-agent-${stamp}`},data:{body:first}});
 expect(posted.status()).toBe(200);

 await signIn(page,'omar@example.com',`/c/rs-learning/work/board/${card}`);
 const messages=page.locator('.conversation .message');
 await expect(messages).toHaveCount(1);
 // The agent's message carries its name, the agent label and its role colour.
 const fromAgent=messages.first();
 await expect(fromAgent).toHaveAttribute('data-author','agent');
 await expect(fromAgent.locator('strong')).toHaveText(writerName);
 await expect(fromAgent.locator('.author-chip')).toHaveText('Agent');
 await expect(fromAgent.locator('.author-chip')).toHaveCSS('border-top-color','rgb(181, 217, 207)');

 // A person replies below it.
 const reply=`شكرا، نكمل ${stamp} thanks`;
 await page.getByLabel('Comment',{exact:true}).fill(reply);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(messages).toHaveCount(2);
 await expect(messages.nth(1)).toHaveAttribute('data-author','person');
 await expect(messages.nth(1).locator('.author-chip')).toHaveText('Person');
 await expect(messages.nth(1).locator('strong')).toContainText('عمر');
 expect(await messages.locator('.comment-body').allInnerTexts()).toEqual([first,reply]);

 // Each body is a block that picks its own direction from its text, so mixed Arabic and English never shares one.
 for(const body of await messages.locator('.comment-body').all()) {
  await expect(body).toHaveAttribute('dir','auto');
  expect(await body.evaluate(element=>getComputedStyle(element).display)).toBe('block');
 }
 expect(await messages.nth(0).locator('.comment-body').evaluate(element=>getComputedStyle(element).direction)).toBe('ltr');
 expect(await messages.nth(1).locator('.comment-body').evaluate(element=>getComputedStyle(element).direction)).toBe('rtl');
 // The same conversation in both languages and at phone and desktop width, kept as screenshots of the run.
 try {
  for(const language of ['en','ar'] as const) {
   await chooseLanguage(page,language);
   await page.goto(`/c/rs-learning/work/board/${card}`);
   await expect(messages).toHaveCount(2);
   for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.locator('.modal').first().screenshot({path:`test-results/screenshots/conversation-${language}-${width}.png`});
   }
  }
 } finally { await chooseLanguage(page,'en'); }
});
