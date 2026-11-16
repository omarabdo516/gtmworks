import { test, expect, type Page } from './fresh-seed';
import { signIn } from './sign-in';

// A Card on the Marketing board opens as the approved sheet over the board (#116; design-reference: openSheet,
// renderSheetHead, cardLogHTML). The seed's RS Learning: card 1 is in Ideas with its Agent, card 5 waits for Omar's (the
// Owner's) approval. Nothing ties a Card to a Conversation yet, so every sheet opens on Log and Chat is not open.
const board = '/c/rs-learning/work/board';
const sheetOf = (page: Page) => page.getByRole('dialog');
const cardLink = (page: Page, id: number) => page.locator(`#board-cols .kcard[data-card-id="${id}"] a`);
const agentOn = async (page: Page, id: number) => (await page.locator(`#board-cols .kcard[data-card-id="${id}"] .kcard__agent bdi`).textContent())!.trim();
const at = (path: string) => new RegExp(`${path.replace('?', '\\?')}$`);

test('a click or Enter opens a Card over the board at an address that reloads; Escape and Close give the Card the keyboard back', async ({ page }) => {
 await signIn(page, 'omar@example.com', board);
 const title = (await cardLink(page, 1).textContent())!.trim();
 const sheet = sheetOf(page);
 await cardLink(page, 1).click();
 await expect(sheet).toBeVisible();
 await expect(page).toHaveURL(at(`${board}?card=1`));
 await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(title);
 await expect(page.locator('#board-cols .kcard[data-card-id="1"]')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(sheet).toHaveCount(0);
 await expect(page).toHaveURL(at(board));
 await expect(cardLink(page, 1)).toBeFocused();

 await page.keyboard.press('Enter');
 await expect(sheet).toBeVisible();
 await expect(page).toHaveURL(at(`${board}?card=1`));
 await page.reload();
 await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(title);
 await expect(page.locator('#board-cols .kcard[data-card-id="1"]')).toBeVisible();
 await sheet.getByRole('button', { name: 'Close', exact: true }).click();
 await expect(sheet).toHaveCount(0);
 await expect(page).toHaveURL(at(board));
 await expect(cardLink(page, 1)).toBeFocused();
});

test('for the Owner the head names the Agent and where the Card stands; Chat is not open and Log is', async ({ page }) => {
 // A shared address opens the sheet once its reader has signed in.
 await signIn(page, 'omar@example.com', `${board}?card=5`);
 const sheet = sheetOf(page);
 await expect(sheet.locator('.sheet__meta .badge--wait')).toHaveText('Waiting on you');
 await expect(sheet.locator('.sheet__meta > bdi')).toHaveText(await agentOn(page, 5));
 await expect(sheet.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-disabled', 'true');
 await expect(sheet.getByRole('tab', { name: /^Log \d+$/ })).toHaveAttribute('aria-selected', 'true');
 await expect(sheet.getByRole('link', { name: 'Open in Chats' })).toHaveCount(0);
 await page.goto(`${board}?card=1`);
 await expect(sheet.locator('.sheet__meta .badge')).toHaveText('Ideas');
 await expect(sheet.locator('.sheet__meta .badge--wait')).toHaveCount(0);
 await expect(sheet.locator('.sheet__meta > bdi')).toHaveText(await agentOn(page, 1));
});

test('a Viewer reads the sheet: the waiting Card waits on the team, and the log has no note field', async ({ page }) => {
 await signIn(page, 'viewer@example.com', `${board}?card=5`);
 const sheet = sheetOf(page);
 await expect(sheet.locator('.sheet__meta .badge--wait')).toHaveText('Waiting on the team');
 await expect(sheet.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-disabled', 'true');
 await expect(sheet.getByRole('tab', { name: /^Log \d+$/ })).toHaveAttribute('aria-selected', 'true');
 await expect(sheet.getByRole('link', { name: 'Open in Chats' })).toHaveCount(0);
 await expect(sheet.getByRole('textbox')).toHaveCount(0);
 await expect(sheet.getByRole('button', { name: 'Add the note' })).toHaveCount(0);
 await expect(sheet.locator('.ro-line')).toHaveText('Your account is view-only: you can read the whole log, without writing notes.');
 await page.goto(`${board}?card=1`);
 await expect(sheet.locator('.sheet__meta .badge')).toHaveText('Ideas');
});

test('the Log tab counts the Card\'s log, and a note written there shows in it and in the Activity log', async ({ page }) => {
 const note = `Sheet note ${Date.now()}`;
 await signIn(page, 'omar@example.com', `${board}?card=2`);
 const sheet = sheetOf(page);
 await expect(sheet).toBeVisible();
 const rows = sheet.locator('#sheet-log .lg-row'), count = sheet.locator('#sh-tab-log .sheet-tabs__n');
 const before = await rows.count();
 await expect(count).toHaveText(String(before));
 const field = sheet.getByRole('textbox', { name: 'Write a note in the card’s log' });
 await expect(field).toHaveAttribute('placeholder', 'Write a note for the team, @ to call someone or an agent…');
 await expect(sheet.getByRole('button', { name: 'Add the note' })).toBeDisabled();
 await field.fill(note);
 await sheet.getByRole('button', { name: 'Add the note' }).click();
 await expect(sheet.locator('#sheet-log .lg-note').filter({ hasText: note })).toBeVisible();
 await expect(field).toHaveValue('');
 await expect(rows).toHaveCount(before + 1);
 await expect(count).toHaveText(String(before + 1));
 await page.goto('/c/rs-learning/log');
 await expect(page.locator('.lgp-body .lg-note').filter({ hasText: note })).toBeVisible();
});

test('Card details opens the Card\'s page with its fields', async ({ page }) => {
 await signIn(page, 'omar@example.com', `${board}?card=1`);
 await sheetOf(page).getByRole('link', { name: 'Card details' }).click();
 await expect(page).toHaveURL(at(`${board}/1`));
 await expect(sheetOf(page)).toHaveCount(0);
 await expect(page.locator('.modal')).toBeVisible();
 await expect(page.getByLabel('Offering', { exact: true })).toBeVisible();
});
