import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// A Card opens in one window over the board (#678, was the sheet of #116; design-reference-card: openCard,
// renderCardWin). The seed's RS Learning: card 1 is in Ideas, card 5 waits for Omar's (the Owner's) approval.
const board = '/c/rs-learning/work/board';
const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });
const windowOf = (page: Page) => page.getByRole('dialog');
const cardLink = (page: Page, id: number) => page.locator(`#board-cols .kcard[data-card-id="${id}"] a`);
const at = (path: string) => new RegExp(`${path.replace('?', '\\?')}$`);

test('a click or Enter opens a Card in its window at an address that reloads; Escape and Close give the tile the keyboard back', async ({ page }) => {
 await signIn(page, 'omar@example.com', board);
 const title = (await cardLink(page, 1).textContent())!.trim();
 const card = windowOf(page);
 await cardLink(page, 1).click();
 await expect(card).toBeVisible();
 await expect(page).toHaveURL(at(`${board}?card=1`));
 await expect(card.getByRole('heading', { level: 2 })).toHaveText(title);
 await expect(page.locator('#board-cols .kcard[data-card-id="1"]')).toBeAttached();
 await page.keyboard.press('Escape');
 await expect(card).toHaveCount(0);
 await expect(page).toHaveURL(at(board));
 await expect(cardLink(page, 1)).toBeFocused();

 await page.keyboard.press('Enter');
 await expect(card).toBeVisible();
 await page.reload();
 await expect(card.getByRole('heading', { level: 2 })).toHaveText(title);
 await card.getByRole('button', { name: 'Close the card' }).click();
 await expect(card).toHaveCount(0);
 await expect(page).toHaveURL(at(board));
 await expect(cardLink(page, 1)).toBeFocused();
});

test('the Card page\'s old address opens the same window over the board', async ({ page }) => {
 await signIn(page, 'omar@example.com', `${board}/1`);
 await expect(windowOf(page).getByRole('heading', { level: 2 })).toHaveText((await cardLink(page, 1).textContent())!.trim());
 await expect(page.locator('.modal')).toHaveCount(0);
 await windowOf(page).getByRole('button', { name: 'Close the card' }).click();
 await expect(page).toHaveURL(at(board));
});

test('for the Owner a Card in review is waiting on them, with the decision in its callout; a Card in Ideas shows its column', async ({ page }) => {
 await signIn(page, 'omar@example.com', `${board}?card=5`);
 const card = windowOf(page);
 await expect(card.getByRole('button', { name: /^Status: Waiting on you/ })).toBeVisible();
 await expect(card.locator('[data-card-section="review"]')).toContainText('Waiting on you');
 await expect(card.locator('[data-card-section="review"]').getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
 await page.goto(`${board}?card=1`);
 await expect(card.getByRole('button', { name: /^Status: Ideas/ })).toBeVisible();
 await expect(card.locator('[data-card-section="review"]')).toHaveCount(0);
});

test('a Viewer reads the window with no control drawn: the waiting Card waits on the team, and the comments have no field', async ({ page }) => {
 await signIn(page, 'viewer@example.com', `${board}?card=5`);
 const card = windowOf(page);
 await expect(card.locator('.cw-status')).toHaveText('Waiting on the team');
 await expect(card.getByRole('img', { name: 'Read only' }).first()).toBeVisible();
 await expect(card.getByRole('textbox')).toHaveCount(0);
 await expect(card.locator('input, select, textarea')).toHaveCount(0);
 await expect(card.getByRole('button', { name: /^Status:|^Assignee:|^Project:/ })).toHaveCount(0);
 await expect(card.locator('.cw-comp .ro-line')).toHaveText('Read only');
});

test('a comment written in the window is the team\'s: it shows under Comments, in the Activity log, and to a Viewer', async ({ page, browser }) => {
 const note = `Window comment ${Date.now()}`;
 await signIn(page, 'omar@example.com', `${board}?card=2`);
 const card = windowOf(page);
 const tab = card.getByRole('tab', { name: /^Comments \d+$/ });
 const before = Number((await tab.getAttribute('aria-label'))!.split(' ').pop());
 const field = card.getByRole('textbox', { name: 'Write a comment' });
 await expect(field).toHaveAttribute('placeholder', 'Comment… @ calls someone or an Agent');
 await field.fill(note);
 await card.getByRole('button', { name: 'Post the comment' }).click();
 await expect(card.locator('#cw-list .lg-note').filter({ hasText: note })).toBeVisible();
 await expect(field).toHaveValue('');
 await expect(card.getByRole('tab', { name: `Comments ${before + 1}` })).toBeVisible();
 await card.getByRole('tab', { name: /^Activity \d+$/ }).click();
 await expect(card.locator('.lg-forever')).toHaveText('Nothing in the log is ever deleted, not even by the Owner. Only the writer can edit a comment, in its first 5 minutes.');
 await page.goto('/c/rs-learning/log');
 await expect(page.locator('.lgp-body .lg-note').filter({ hasText: note })).toBeVisible();
 const context = await browser.newContext(); const viewer = await context.newPage();
 try {
  await signIn(viewer, 'viewer@example.com', `${board}?card=2`);
  await expect(windowOf(viewer).locator('#cw-list .lg-note').filter({ hasText: note })).toBeVisible();
 } finally { await context.close(); }
});

test('the title, assignee, publishing date and Project save as they change; a save over a newer title is refused with the newer one shown', async ({ page, browser }) => {
 const [{ id: project }] = JSON.parse(query(`insert into public.work_projects(company_id,name) values ('10000000-0000-0000-0000-000000000001','Window launch ${Date.now()}') returning id,name`)) as { id: number }[];
 const projectName = (JSON.parse(query(`select name from public.work_projects where id=${project}`)) as { name: string }[])[0].name;
 await signIn(page, 'reviewer@example.com', `${board}?card=3`);
 const card = windowOf(page);
 const title = (await card.getByRole('heading', { level: 2 }).textContent())!.trim();
 // Someone else renames it meanwhile, in their own window.
 const context = await browser.newContext(); const other = await context.newPage();
 try {
  await signIn(other, 'manager@example.com', `${board}?card=3`);
  await windowOf(other).getByRole('button', { name: title }).click();
  await windowOf(other).getByRole('textbox', { name: 'Card title' }).fill('Renamed by the manager');
  await other.keyboard.press('Enter');
  await expect(windowOf(other).getByRole('heading', { level: 2 })).toHaveText('Renamed by the manager');
  await expect.poll(() => JSON.parse(query('select title from public.work_cards where id=3'))).toEqual([{ title: 'Renamed by the manager' }]);
 } finally { await context.close(); }
 await card.getByRole('button', { name: title }).click();
 await card.getByRole('textbox', { name: 'Card title' }).fill('Renamed by the contributor');
 await page.keyboard.press('Enter');
 await expect(card.getByRole('alert')).toHaveText('Someone changed this meanwhile. It now reads: Renamed by the manager');
 await expect(card.getByRole('heading', { level: 2 })).toHaveText('Renamed by the manager');
 expect(JSON.parse(query('select title from public.work_cards where id=3'))).toEqual([{ title: 'Renamed by the manager' }]);

 await card.getByRole('button', { name: /^Assignee:/ }).click();
 await card.getByRole('menuitem', { name: 'Assign to me' }).click();
 await expect(card.getByRole('button', { name: /^Assignee: مراجع/ })).toBeVisible();
 await card.getByLabel('Publishing date').fill('2026-12-20');
 await card.getByRole('button', { name: /^Project:/ }).click();
 await card.getByRole('menuitemradio', { name: projectName }).click();
 await expect(card.getByRole('button', { name: `Project: ${projectName}` })).toBeVisible();
 await expect.poll(() => JSON.parse(query(`select assignee_person::text as person,to_char(go_live at time zone 'UTC','YYYY-MM-DD') as day,project_id from public.work_cards where id=3`)))
  .toEqual([{ person: '20000000-0000-0000-0000-000000000003', day: '2026-12-20', project_id: project }]);
 // The Card stays in its column, and each change is a row of its log.
 await card.getByRole('tab', { name: /^Activity \d+$/ }).click();
 await expect(card.locator('#cw-list')).toContainText('Renamed by the manager');
});

test('Versions are uploaded and opened under Result, and files are added to the Card itself', async ({ page }) => {
 await signIn(page, 'omar@example.com', `${board}?card=1`);
 const card = windowOf(page);
 await card.getByLabel('Upload a version').setInputFiles({ name: 'post-v1.png', mimeType: 'image/png', buffer: Buffer.from('v1') });
 await expect(card.getByRole('list', { name: 'Versions' }).getByRole('link', { name: 'Open version 1: post-v1.png' })).toBeVisible();
 await card.getByLabel('Upload a version').setInputFiles({ name: 'post-v2.png', mimeType: 'image/png', buffer: Buffer.from('v2') });
 const versions = card.getByRole('list', { name: 'Versions' }).getByRole('link');
 await expect(versions).toHaveCount(2);
 await expect(versions.first()).toHaveAccessibleName('Open version 2: post-v1.png');
 const opened = await page.request.get((await versions.first().getAttribute('href'))!);
 expect(await opened.text()).toBe('v2');
 await card.getByLabel('Add files').setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('brief') });
 const file = card.getByRole('link', { name: 'Open brief.pdf' });
 await expect(file).toBeVisible();
 expect(await (await page.request.get((await file.getAttribute('href'))!)).text()).toBe('brief');
 expect(JSON.parse(query(`select name,comment_id from public.work_attachments where card_id=1 and name='brief.pdf'`))).toEqual([{ name: 'brief.pdf', comment_id: null }]);
});

test('on a phone the window is full screen, and its details are reached by scrolling under a long title', async ({ page }) => {
 query(`update public.work_cards set title=repeat('A very long title for the launch post ',40) where id=1`);
 await page.setViewportSize({ width: 390, height: 844 });
 await signIn(page, 'omar@example.com', `${board}?card=1`);
 const card = windowOf(page);
 await expect(card).toBeVisible();
 expect(await card.evaluate(box => [box.getBoundingClientRect().width, box.getBoundingClientRect().height])).toEqual([390, 844]);
 const assignee = card.getByRole('button', { name: /^Assignee:/ });
 await assignee.scrollIntoViewIfNeeded();
 await expect(assignee).toBeInViewport();
 await assignee.focus();
 await page.keyboard.press('Tab');
 await expect(card.getByLabel('Publishing date')).toBeFocused();
});

test('a description is read drawn and its to-do items are ticked while reading: the database, the Activity and the tile follow, and a Viewer cannot press a box', async ({ page, browser }) => {
 // #679: card 1's description, written as #680's editor will save it (Markdown).
 query(`update public.work_cards set description=E'# Brief\\n\\n- [ ] Write the hook\\n- [x] Pick the format\\n\\n<b>raw</b> stays text' where id=1`);
 await signIn(page, 'reviewer@example.com', `${board}?card=1`);
 const card = windowOf(page);
 await expect(card.getByRole('heading', { name: 'Brief', level: 3 })).toBeVisible();
 await expect(card.getByText('<b>raw</b> stays text')).toBeVisible();
 await expect(card.locator('.de-prog')).toHaveText('1/2 done');
 const hook = card.getByRole('checkbox', { name: 'Write the hook' });
 await hook.click();
 await expect(hook).toHaveAttribute('aria-checked', 'true');
 await expect.poll(() => JSON.parse(query(`select description_version v, split_part(description,E'\\n',3) line from public.work_cards where id=1`))[0]).toEqual({ v: 1, line: '- [x] Write the hook' });
 await expect(card.locator('.de-prog')).toHaveText('2/2 done');
 await card.getByRole('tab', { name: /Activity/ }).click();
 await expect(card.locator('p', { hasText: /ticked$/ }).locator('xpath=..').filter({ hasText: 'Write the hook' })).toBeVisible();
 // The keyboard unticks it.
 await card.getByRole('tab', { name: /Comments/ }).click();
 const format = card.getByRole('checkbox', { name: 'Pick the format' });
 await expect(format).toHaveAttribute('aria-checked', 'true');
 await format.focus();
 await expect(format).toBeFocused();
 await page.keyboard.press('Space');
 await expect(format).toHaveAttribute('aria-checked', 'false');
 await expect.poll(() => JSON.parse(query(`select split_part(description,E'\\n',4) line from public.work_cards where id=1`))[0].line).toBe('- [ ] Pick the format');
 await page.keyboard.press('Escape');
 await expect(page.locator('#board-cols .kcard[data-card-id="1"] .kcard__todo')).toContainText('1/2');

 const viewer = await (await browser.newContext()).newPage();
 await signIn(viewer, 'viewer@example.com', `${board}?card=1`);
 const read = windowOf(viewer).getByRole('checkbox', { name: 'Write the hook' });
 await expect(read).toHaveAttribute('aria-disabled', 'true');
 await expect(read).toHaveAttribute('aria-checked', 'true');
 await expect(windowOf(viewer).locator('.de button')).toHaveCount(0);
});
