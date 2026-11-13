import { expect, type Page } from '@playwright/test';
// The password every seeded person has on the local database (supabase/seed.sql).
export const seededPassword='local-seed-password';
export async function signIn(page:Page,email:string,path:string,password=seededPassword) {
 await page.request.delete('http://127.0.0.1:54324/api/v1/messages'); await page.goto(path); await expect(page).toHaveURL(/sign-in/);
 // A wrong password fails at once. Only the auth service's rate limit is waited out: every test signs in from this one
 // address, and the allowance refills within seconds. The install job goes past the limit on purpose (issue #41).
 for(let attempt=1;;attempt++) {
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const outcome=async()=>!new URL(page.url()).pathname.startsWith('/sign-in')?'signed in':await page.getByText('Wrong email or password.').isVisible()?'wrong':await page.getByText('Too many sign-in attempts. Try again later.').isVisible()?'limited':'waiting';
  await expect.poll(outcome,{timeout:15000}).not.toBe('waiting');
  const result=await outcome();
  if(result==='signed in') return;
  if(result==='wrong') throw new Error(`Sign-in refused for ${email}: wrong email or password`);
  if(attempt>=20) throw new Error(`Sign-in for ${email} still rate limited after ${attempt} attempts`);
  await page.waitForTimeout(3000); await page.reload();
 }
}

export async function followSignInLink(page:Page,email:string) {
 await page.goto(await emailLink(page,email));
}
// The first auth-service link (/verify) in the newest local-inbox message to this address.
export async function emailLink(page:Page,email:string) {
 let link='';
 for(let i=0;i<30 && !link;i++) { const response=await page.request.get('http://127.0.0.1:54324/api/v1/messages'); const mailbox=await response.json(); const summary=mailbox.messages?.find((message:{To:{Address:string}[]})=>message.To.some(to=>to.Address===email)); if(summary) { const message=await (await page.request.get(`http://127.0.0.1:54324/api/v1/message/${summary.ID}`)).json(); const body=message.HTML || message.Text; link=body.match(/https?:\/\/[^"\s<>]+/g)?.find((url:string)=>url.includes('/verify'))?.replace(/&amp;/g,'&') || ''; } if(!link) await page.waitForTimeout(1000); }
 expect(link).toBeTruthy(); return link;
}

export async function openNavigation(page:Page) {
 // Below 768px the sidebar is a drawer behind the menu button; it is open while it carries is-open.
 if(await page.locator('.mobile-menu').isVisible()&&!await page.locator('.sidebar.is-open').count()) {
  await page.locator('.mobile-menu').click(); await expect(page.locator('.sidebar.is-open')).toBeVisible();
  // It slides in (200ms): measure it only once the slide has ended.
  await expect.poll(()=>page.locator('.sidebar').evaluate(node=>node.getAnimations().length)).toBe(0);
 }
}
export async function closeNavigation(page:Page) {
 if(await page.locator('.sidebar.is-open').count()) { await page.keyboard.press('Escape'); await expect(page.locator('.sidebar.is-open')).toHaveCount(0); }
}
export async function chooseCompany(page:Page,slug:string) {
 await openNavigation(page);
 await page.getByLabel(/Choose company|اختيار الشركة/).click();
 await page.locator(`[data-company-slug="${slug}"]`).click();
}
