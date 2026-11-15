import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const general='/c/rs-learning/channels/69000000-0000-0000-0000-000000000001';
const contributor='20000000-0000-0000-0000-000000000003';

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{ freshSeed(testInfo.file); });

test('a Member opens the general channel, reads that an Agent replies only when called, and posts a message that starts no Run',async({page})=>{
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 const link=page.locator('.sidebar .ch-item');
 await expect(link).toHaveText('general');
 await link.click();
 await expect(page).toHaveURL(general);
 await expect(link).toHaveAttribute('aria-current','true');
 const box=page.getByRole('textbox',{name:'Write your message in the channel',exact:true});
 await expect(box).toHaveAttribute('placeholder','Write in #general… an agent replies only when called by name');
 await expect(page.locator('.ch-intro')).toContainText('Agents read and reply only when someone calls them by name. Ordinary talk between members goes to no agent.');
 await expect(page.locator('#details')).toContainText('“general” always has everyone in the company.');
 await box.fill('Morning, team');
 await box.press('Enter');
 const mine=page.locator('.turn--user .bubble--user');
 await expect(mine).toHaveText('Morning, team');
 await expect(box).toHaveValue('');
 await expect(page.locator('.thinking')).toHaveCount(0);
 await page.reload();
 await expect(mine).toHaveText('Morning, team');
 expect(rows(`select count(*)::int n from public.channel_runs`)[0].n).toBe(0);
 expect(rows(`select author_name,body from public.channel_messages where person_id='${contributor}'`)).toEqual([{author_name:'مراجع',body:'Morning, team'}]);
});

test('in Arabic the composer gives the same hint',async({page})=>{
 query(`update public.people set language='ar' where id='${contributor}'`);
 try {
  await signIn(page,'reviewer@example.com',general);
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await expect(page.getByRole('textbox',{name:'اكتب رسالتك في القناة',exact:true})).toHaveAttribute('placeholder','اكتب في #عام… والوكيل بيرد بس لو ناديته باسمه');
 } finally { query(`update public.people set language='en' where id='${contributor}'`); }
});

test('the Viewer reads the channel, with the writer and their role, and has no composer',async({page})=>{
 await signIn(page,'viewer@example.com',general);
 const peer=page.locator('.turn--peer');
 await expect(peer.locator('.bubble--peer')).toHaveText('Morning, team');
 await expect(peer.locator('.sender')).toContainText('مراجع');
 await expect(peer.locator('.sender__role')).toHaveText('Contributor');
 await expect(page.locator('.composer')).toHaveCount(0);
 await expect(page.locator('.ro-line')).toContainText('Your account is view-only');
});
