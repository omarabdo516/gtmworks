import { test, expect, type Page } from './fresh-seed';
import { signIn } from './sign-in';
import { i18n } from '../lib/i18n.mjs';

// The Numbers page (#35). No app is connected in the seed, so the page shows the empty state and no numbers; the
// waiting list and the agents' week are gtmworks's own records.
const t=(page:Page)=>page.evaluate(()=>document.documentElement.lang).then(lang=>i18n(lang==='ar'?'ar':'en').t);

test('the Numbers page lists what waits on its reader from their own list',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/numbers');
 const tr=await t(page);
 const panel=page.locator('.panel--wait');
 await expect(panel.getByRole('heading',{name:tr('numbersWaitingYou')})).toBeVisible();
 const rows=panel.locator('.panel-row');
 const empty=panel.locator('.wait-empty');
 await expect(rows.or(empty).first()).toBeVisible();
 await expect(panel.locator('.panel__h .muted')).toHaveText(String(await rows.count()));
});
