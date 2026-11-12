import { expect, type Page } from '@playwright/test';
export async function signIn(page:Page,email:string,path:string) {
 await page.request.delete('http://127.0.0.1:54324/api/v1/messages'); await page.goto(path); await expect(page).toHaveURL(/sign-in/); // The local Auth server throttles repeated email requests for the same person.
 await expect(async()=>{
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button',{name:'Send sign-in link'}).click();
  await expect(page.getByRole('status')).toHaveText('Check your email for a sign-in link.',{timeout:2000});
 }).toPass({intervals:[1100],timeout:10000});
 await followSignInLink(page,email);
}

export async function followSignInLink(page:Page,email:string) {
 let link='';
 for(let i=0;i<30 && !link;i++) { const response=await page.request.get('http://127.0.0.1:54324/api/v1/messages'); const mailbox=await response.json(); const summary=mailbox.messages?.find((message:{To:{Address:string}[]})=>message.To.some(to=>to.Address===email)); if(summary) { const message=await (await page.request.get(`http://127.0.0.1:54324/api/v1/message/${summary.ID}`)).json(); const body=message.HTML || message.Text; link=body.match(/https?:\/\/[^"\s<>]+/g)?.find((url:string)=>url.includes('/verify'))?.replace(/&amp;/g,'&') || ''; } if(!link) await page.waitForTimeout(1000); }
 expect(link).toBeTruthy(); await page.goto(link);
}

export async function openNavigation(page:Page) {
 // Below 768px the sidebar is a drawer behind the menu button; it is open while it carries is-open.
 if(await page.locator('.mobile-menu').isVisible()&&!await page.locator('.sidebar.is-open').count()) { await page.locator('.mobile-menu').click(); await expect(page.locator('.sidebar.is-open')).toBeVisible(); }
}
export async function closeNavigation(page:Page) {
 if(await page.locator('.sidebar.is-open').count()) { await page.keyboard.press('Escape'); await expect(page.locator('.sidebar.is-open')).toHaveCount(0); }
}
export async function chooseCompany(page:Page,slug:string) {
 await openNavigation(page);
 await page.getByLabel(/Choose company|اختيار الشركة/).click();
 await page.locator(`[data-company-slug="${slug}"]`).click();
}
