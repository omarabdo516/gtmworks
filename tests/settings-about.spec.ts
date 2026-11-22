import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { signIn } from './sign-in';

// #616: Your account offers Light, Dark and System, saved to the account, System following the device; About names the
// installed version, lists What's new from the shipped release notes in the interface language, and opens the licenses.
const viewer='20000000-0000-0000-0000-000000000004';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const saved=()=>JSON.parse(query(`select theme,language from public.people where id='${viewer}'`))[0] as {theme:string|null,language:string|null};
const notes=JSON.parse(readFileSync('lib/whats-new.json','utf8')) as {issue:number,en:{title:string,body:string},ar:{title:string,body:string}}[];
const dark='oklch(0.185 0 0)', light='rgb(250, 250, 250)';

test('Your account: System follows the device, and Light or Dark stays chosen whatever the device shows',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await signIn(page,'viewer@example.com','/c/rs-learning/settings?section=account');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const look=overlay.getByRole('radiogroup',{name:'Appearance'});
 await expect(look.getByRole('radio')).toHaveText(['Light','Dark','System']);
 await expect(look.getByRole('radio',{name:'System'})).toHaveAttribute('aria-checked','true');
 await expect(page.locator('.app-layout')).toHaveCSS('background-color',dark);
 await page.emulateMedia({colorScheme:'light'});
 await expect(page.locator('.app-layout')).toHaveCSS('background-color',light);
 try {
  await look.getByRole('radio',{name:'Dark'}).click();
  await expect(look.getByRole('radio',{name:'Dark'})).toHaveAttribute('aria-checked','true');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color',dark);
  await expect.poll(()=>saved().theme).toBe('dark');
  // The choice is the account's: a reload under a light device keeps it, and so does the keyboard's next choice.
  await page.reload();
  await expect(look.getByRole('radio',{name:'Dark'})).toHaveAttribute('aria-checked','true');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color',dark);
  await look.getByRole('radio',{name:'Dark'}).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(look.getByRole('radio',{name:'Light'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(look.getByRole('radio',{name:'Light'})).toHaveAttribute('aria-checked','true');
  await expect.poll(()=>saved().theme).toBe('light');
  await page.emulateMedia({colorScheme:'dark'});
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color',light);
 } finally {
  await look.getByRole('radio',{name:'System'}).click();
  await expect.poll(()=>saved().theme).toBe('device');
 }
 await expect(page.locator('html')).toHaveAttribute('data-theme','device');
 await expect(page.locator('.app-layout')).toHaveCSS('background-color',dark);
 await page.emulateMedia({colorScheme:'light'});
 await expect(page.locator('.app-layout')).toHaveCSS('background-color',light);
});

test('About shows the installed version, What\'s new from the release notes and the licenses, in English and Arabic',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/settings?section=account');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await overlay.locator('#sov-nav-about').click();
 await expect(page).toHaveURL(/\?section=about$/);
 await expect(overlay.getByRole('heading',{name:'About',exact:true})).toBeVisible();
 // The lane's server runs as 0.0.1 (scripts/web.sh), the version a release image carries.
 await expect(overlay.getByRole('region',{name:'Version'})).toContainText('v0.0.1');
 const news=overlay.getByRole('region',{name:'What’s new'});
 await expect(news.getByRole('listitem')).toHaveCount(5);
 for(const [at,item] of notes.slice(0,5).entries()) await expect(news.getByRole('listitem').nth(at)).toContainText(`${item.en.title}${item.en.body}`);
 await news.getByText(`${notes.length-5} earlier changes`).click();
 await expect(news.getByRole('listitem')).toHaveCount(notes.length);
 await expect(news.getByRole('listitem').last()).toContainText(notes.at(-1)!.en.title);
 const licenses=overlay.getByRole('region',{name:'Licenses'});
 const [own]=await Promise.all([page.waitForEvent('popup'),licenses.getByRole('link',{name:/^gtmworks/}).click()]);
 await expect(own.locator('body')).toContainText('MIT License');
 await expect(own.locator('body')).toContainText(readFileSync('LICENSE','utf8').split('\n')[2]);
 await own.close();
 const third=await page.request.get('/licenses/third-party');
 expect(third.headers()['content-type']).toBe('text/plain; charset=utf-8');
 expect(await third.text()).toBe(readFileSync('THIRD_PARTY_NOTICES.md','utf8'));
 expect((await page.request.get('/licenses/..%2Fpackage.json')).status()).toBe(404);
 expect((await page.request.get('/licenses/constructor')).status()).toBe(404);
 // In Arabic the same page reads the Arabic notes, right to left.
 await overlay.locator('#sov-nav-account').click();
 await overlay.getByRole('radio',{name:/^العربية/}).click();
 await expect(page.locator('html')).toHaveAttribute('dir','rtl');
 try {
  // The overlay is named in the interface language now.
  const overlay=page.getByRole('dialog',{name:'الإعدادات'});
  await overlay.locator('#sov-nav-about').click();
  await expect(overlay.getByRole('heading',{name:'عن gtmworks',exact:true})).toBeVisible();
  await expect(overlay.getByRole('region',{name:'الإصدار'})).toContainText('v0.0.1');
  const arabic=overlay.getByRole('region',{name:'الجديد'});
  await expect(arabic.getByRole('listitem').first()).toContainText(`${notes[0].ar.title}${notes[0].ar.body}`);
  await expect(arabic).not.toContainText(notes[0].en.title);
  await expect(arabic.getByText(`${notes.length-5} تغييرات أقدم`)).toBeVisible();
  await expect(overlay.getByRole('region',{name:'التراخيص'}).getByRole('link',{name:/^ملاحظات الأطراف التانية/})).toHaveAttribute('href','/licenses/third-party');
  // Nothing sideways on a phone, in the language that reads right to left.
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.locator('#sov-main').evaluate(node=>node.scrollWidth-node.clientWidth)).toBe(0);
 } finally { query(`update public.people set language='en' where id='${viewer}'`); }
});
