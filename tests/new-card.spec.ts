import { test, expect, type Page } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// The one New card form (#683; design-reference-card: ncOpen), for the toolbar's button and the Ideas column's "+". It
// replaces the request form (a message to an Agent, with a mode) and the templates of card-request.spec.ts.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}

test('New card makes one Card in Planned with its description, assignee and files, also on a double press; the Ideas "+" makes one at the top of Ideas; in both languages',async({page})=>{
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 try {
  const stamp=Date.now();
  await page.getByRole('button',{name:'New card',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('textbox',{name:'Title'})).toBeFocused();
  await dialog.getByRole('textbox',{name:'Title'}).fill(`Launch post ${stamp}`);
  await dialog.locator('.ProseMirror').click();
  await page.keyboard.type('Mention the early price');
  await dialog.getByRole('button',{name:/^Assignee:/}).click();
  await page.getByRole('menuitemradio',{name:'Assign to me'}).click();
  await dialog.getByLabel('Attach files').setInputFiles({name:'brief.txt',mimeType:'text/plain',buffer:Buffer.from('the brief')});
  await page.waitForTimeout(900);
  // A double press is one Card: the form's request key is the same for both.
  await dialog.getByRole('button',{name:'Add card'}).dblclick();
  await expect(page).toHaveURL(/\/work\/board\?show=\d+&added=1$/);
  await expect(page.locator('.toast')).toHaveText('Added');
  const made=rows(`select w.id,w.status,w.description,w.assignee_person,(select count(*)::int from public.work_attachments a where a.card_id=w.id) files from public.work_cards w where w.title='Launch post ${stamp}'`);
  expect(made).toHaveLength(1);
  expect(made[0]).toMatchObject({status:'planned',description:'Mention the early price',assignee_person:'20000000-0000-0000-0000-000000000001',files:1});
  await expect(page.locator(`.col[data-column="planned"] .kcard[data-card-id="${made[0].id}"]`)).toBeVisible();

  // From the Ideas "+", in Arabic: the same form, the Card at the top of Ideas.
  await chooseLanguage(page,'ar');
  await page.goto('/c/rs-learning/work/board');
  const ideas=page.locator('.col[data-column="ideas"]');
  await ideas.getByRole('button',{name:'ضيف فكرة'}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'العنوان'}).fill(`فكرة ${stamp}`);
  for(const width of [1440,390]) { await page.setViewportSize({width,height:900}); await page.screenshot({path:`test-results/screenshots/new-card-ar-${width}.png`}); }
  await page.setViewportSize({width:1280,height:720});
  await page.getByRole('dialog').getByRole('button',{name:'ضيف البطاقة'}).click();
  await expect(page).toHaveURL(/\/work\/board\?show=\d+&idea=1$/);
  await expect(ideas.locator('.kcard').first()).toContainText(`فكرة ${stamp}`);
 } finally { await chooseLanguage(page,'en'); }
});

test('the form loads when it is opened and shows the page-opening bar while it arrives',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(page.locator('#board-cols .kcard').first()).toBeVisible();
 await page.waitForLoadState('networkidle');
 // Scripts that are still missing now are fetched on demand; hold them back to see the wait.
 let release:()=>void=()=>{}; const gate=new Promise<void>(resolve=>{release=resolve;});
 let held=0;
 await page.route('**/_next/static/chunks/**',async route=>{held++; await gate; await route.continue();});
 await page.getByRole('button',{name:'New card',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Opening page'})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Title'})).toHaveCount(0);
 expect(held,'the form is its own script').toBeGreaterThan(0);
 release();
 await expect(page.getByRole('dialog').getByRole('textbox',{name:'Title'})).toBeVisible();
 await expect(page.getByRole('progressbar',{name:'Opening page'})).toHaveCount(0);
});

test('on a phone the board\'s filters fold into one, the search comes first, and the first Card shows near the top',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const tools=page.locator('.board-tools');
 await expect(tools.getByRole('button',{name:'Filter'})).toBeVisible();
 await expect(tools.getByRole('button',{name:/^Assignee:/})).toBeHidden();
 const search=await tools.getByRole('button',{name:'Search cards'}).boundingBox();
 const filter=await tools.getByRole('button',{name:'Filter'}).boundingBox();
 expect(search!.y).toBeLessThanOrEqual(filter!.y);
 const first=await page.locator('#board-cols .kcard').first().boundingBox();
 expect(first!.y).toBeLessThan(400);
 await tools.getByRole('button',{name:'Filter'}).click();
 await page.getByRole('menuitemradio',{name:'Me'}).click();
 await expect(tools.getByRole('button',{name:'Filter'})).toContainText('1');
});
