import { test, expect, type Page, type Request } from '@playwright/test';
import { forgedIdentity } from '../../scripts/forged-identity.mjs';

// Repeated wrong passwords on a real install hit the auth service's own rate limit, and the sign-in page says to try
// again later (issue #41). The browser's sign-in goes to the auth service through the HTTPS proxy in front of the
// install and its gateway, which count the limit per visitor and ignore every address a client claims. CI then checks
// that another visitor still has its own allowance, that its forged addresses buy nothing, and that this one is still
// limited (scripts/check-install-rate-limit.mjs).
const origin=process.env.APP_ORIGIN!, anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, email=process.env.SIGN_IN_EMAIL!;
const isToken=(request:Request)=>request.method()==='POST'&&new URL(request.url()).pathname==='/auth/v1/token';
const alertWith=(page:Page,text:string)=>page.getByRole('alert').filter({hasText:text});
const sessionCookies=async(page:Page)=>(await page.context().cookies()).filter(cookie=>/^sb-.*-auth-token/.test(cookie.name));

// Fill and send the sign-in form; returns the auth service's answer to the browser's own request.
async function attempt(page:Page,password:string) {
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Password',{exact:true}).fill(password);
 const response=page.waitForResponse(response=>isToken(response.request()));
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return response;
}

test('repeated wrong passwords hit the auth service rate limit through the gateway, forged addresses or not, and the page says to try again later',async({page})=>{
 expect(origin && anon && email,'APP_ORIGIN, NEXT_PUBLIC_SUPABASE_ANON_KEY and SIGN_IN_EMAIL are set').toBeTruthy();
 // A wrong password on the page: the browser asks the auth service at the public origin, which the gateway serves.
 await page.goto('/sign-in?language=en');
 const first=await attempt(page,'not-the-password');
 const request=first.request();
 expect(new URL(request.url()).origin).toBe(new URL(origin).origin);
 expect(first.status()).toBe(400);
 await expect(alertWith(page,'Wrong email or password.')).toBeVisible();
 expect(await sessionCookies(page)).toEqual([]);

 // Wrong passwords from this same address, each naming other forged addresses in every header a client could use to
 // claim one. If the auth service keyed its limit on any of them, every attempt would get a fresh allowance and the
 // limit would never answer. The bound only keeps a missing limit from hanging; the count reached is printed.
 const max=310;
 async function exhaust() {
  for(let sent=0; sent<max; sent++) {
   const response=await page.request.post(`${origin}/auth/v1/token?grant_type=password`,{headers:{apikey:anon,...forgedIdentity(sent)},data:{email,password:`wrong-password-${sent}`}});
   const body=await response.json() as {error_code?:string};
   if(response.status()===429) return {sent,body};
   expect(response.status(),JSON.stringify(body)).toBe(400);
   expect(body.error_code).toBe('invalid_credentials');
  }
  return null;
 }
 const limited=await exhaust();
 expect(limited,`the auth service never answered 429 within ${max} wrong passwords naming forged addresses`).not.toBeNull();
 expect(limited!.body.error_code).toBe('over_request_rate_limit');
 console.log(`Limited after ${limited!.sent} wrong passwords naming forged addresses`);

 // The allowance refills slowly, so one page attempt may still get through as an ordinary wrong password: drain it again
 // and retry. The page shows the limit as its own message, not as a wrong password, and opens no session.
 await expect(async()=>{
  expect(await exhaust()).not.toBeNull();
  await page.goto('/sign-in?language=en');
  const response=await attempt(page,'still-the-wrong-password');
  expect(response.status()).toBe(429);
  await expect(alertWith(page,'Too many sign-in attempts. Try again later.')).toBeVisible({timeout:3000});
 }).toPass({timeout:180000});
 await expect(alertWith(page,'Wrong email or password.')).toHaveCount(0);
 await expect(page).toHaveURL(/\/sign-in/);
 expect(await sessionCookies(page)).toEqual([]);
});
