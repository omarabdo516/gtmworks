import { test, expect, type Locator } from '@playwright/test';
import { signIn } from './sign-in';

// On a phone the Numbers period buttons and the Activity log filters keep the reference's size (26px pills, 34px
// fields), so the cards and rows start where the reference starts them, while each still has a 44px tap area: an
// invisible ring or a transparent border taken back by a negative margin.
async function tapArea(target:Locator) {
 return target.evaluate(node=>{
  const own=node.getBoundingClientRect(), ring=getComputedStyle(node,'::before');
  const grow=ring.content==='none'?{v:0,h:0}:{v:-(parseFloat(ring.top)||0)-(parseFloat(ring.bottom)||0),h:-(parseFloat(ring.left)||0)-(parseFloat(ring.right)||0)};
  return {height:own.height+Math.max(0,grow.v),width:own.width+Math.max(0,grow.h),visible:node.clientHeight};
 });
}

test('390px: Numbers period buttons sit at the head’s end and Activity log filters keep the reference’s height, each with a 44px tap area',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/numbers');
 const periods=page.locator('.numbers-page .segmented a');
 await expect(periods).toHaveCount(2);
 for(const period of await periods.all()) {
  const area=await tapArea(period);
  expect(area.height).toBeGreaterThanOrEqual(44);
  expect(area.visible).toBeLessThanOrEqual(26);
 }
 // The group sits at the inline end of the head, as in the reference (left in Arabic, right in English).
 const [group,head]=await Promise.all([page.locator('.numbers-page .segmented').boundingBox(),page.locator('.numbers-page .page-head').boundingBox()]);
 const rtl=await page.evaluate(()=>document.documentElement.dir==='rtl');
 if(rtl) expect(group!.x).toBeLessThan(head!.x+head!.width/2);
 else expect(group!.x+group!.width).toBeGreaterThan(head!.x+head!.width/2);

 await page.goto('/c/rs-learning/log');
 const fields=page.locator('.log-page .lgp-field .set-input');
 await expect(fields.first()).toBeVisible();
 for(const field of await fields.all()) {
  const area=await tapArea(field);
  expect(area.height).toBeGreaterThanOrEqual(44);
  expect(area.visible).toBe(34);
 }
});
