import { test, expect, type Page } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { signIn } from './sign-in';
import { execFileSync } from 'node:child_process';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
// The Writer agent; its role colour is #b5d9cf.
const writerName='وكيل المحتوى';
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}

test('people and agents reply inside one card, in order, each labelled and in its own direction', async ({page}) => {
 await mkdir('test-results/screenshots',{recursive:true});
 const stamp=Date.now();
 const first=`Draft is ready مسودة جاهزة ${stamp}`;
 // A card with the Writer's message on it, as an Agent's reply is stored.
 const card=Number(rows(`with card as (insert into public.work_cards(company_id,stage_id,title) select company_id,id,'Conversation ${stamp}' from public.work_stages
  where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1 returning company_id,id),
 note as (insert into public.work_comments(company_id,card_id,body,author_id) select company_id,id,'${first}','30000000-0000-0000-0000-000000000001' from card returning card_id)
 select card_id from note`)[0].card_id);

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
