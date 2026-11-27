import { test, expect, type Page } from './fresh-seed';
import { signIn } from './sign-in';

// Archiving a Card (#670; design-reference-card: cwArchive, cwUndo, cwRestore, the board's archive icon and the archived
// Card's callout). The sheet stays open on a Card just archived, as the reference's does. The seed's RS Learning: card 1 is in Ideas, card 2 in Planned, card 3 in In progress. The tests share
// the file's data in order; each puts back what it archived.
const board = '/c/rs-learning/work/board';
// Spec #831 made /work/board the Engine's own Kanban board (#834): a Card opened over the board (?card=) still opens on
// the old board, and the old board's columns stay on the board opened on Waiting on you, until the Engine's Card window
// (#835) and archive (#842) replace them and the old board is switched off (#846).
const columns = '/c/rs-learning/approvals';
const sheetOf = (page: Page) => page.getByRole('dialog');
const onBoard = (page: Page, id: number) => page.locator(`#board-cols .kcard[data-card-id="${id}"]`);
const inColumn = (page: Page, column: string, id: number) => page.locator(`#board-cols [data-column="${column}"] .kcard[data-card-id="${id}"]`);
const toast = (page: Page) => page.locator('.toast');
const archivedToggle = (page: Page) => page.getByRole('button', { name: /^Archived · \d+$/ });

async function archiveFromMenu(page: Page, id: number) {
 await page.goto(`${board}?card=${id}`);
 const sheet = sheetOf(page);
 await sheet.getByRole('button', { name: 'More', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Archive the card' }).click();
 await expect(sheet.getByRole('region', { name: 'Archived' })).toBeVisible();
 await sheet.getByRole('button', { name: 'Close', exact: true }).click();
 await expect(sheet).toHaveCount(0);
}

test('a Contributor archives a Card from its menu: it leaves the board, and Undo puts it back in its column', async ({ page }) => {
 await signIn(page, 'reviewer@example.com', columns);
 await expect(inColumn(page, 'ideas', 1)).toBeVisible();
 await page.goto(`${board}?card=1`);
 const more = sheetOf(page).getByRole('button', { name: 'More', exact: true });
 await more.focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeFocused();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitem', { name: 'Archive the card' })).toBeFocused();
 await page.keyboard.press('Enter');
 // The sheet stays open on the Card, now archived and read-only, with the keyboard back on its menu.
 await expect(more).toBeFocused();
 await expect(sheetOf(page).getByRole('region', { name: 'Archived' })).toBeVisible();
 await expect(toast(page)).toContainText('Archived');
 await expect(onBoard(page, 1)).toHaveCount(0);
 await expect(archivedToggle(page)).toHaveAccessibleName('Archived · 1');
 await toast(page).getByRole('button', { name: 'Undo' }).click();
 await expect(toast(page)).toContainText('Restored');
 await expect(sheetOf(page).getByRole('region', { name: 'Archived' })).toHaveCount(0);
 await expect(archivedToggle(page)).toHaveAccessibleName('Archived · 0');
 await sheetOf(page).getByRole('button', { name: 'Close', exact: true }).click();
 await page.goto(columns);
 await expect(inColumn(page, 'ideas', 1)).toBeVisible();
});

test('an archived Card opens read-only from an old link and from its chat\'s link, its log names the archive, and Restore brings it back', async ({ page }) => {
 await signIn(page, 'manager@example.com', board);
 await archiveFromMenu(page, 3);
 await page.goto(columns);
 await expect(onBoard(page, 3)).toHaveCount(0);
 await page.goto(`${board}/3`);
 await expect(page).toHaveURL(new RegExp(`${board.replace('?', '\\?')}\\?card=3$`));
 const sheet = sheetOf(page);
 const callout = sheet.getByRole('region', { name: 'Archived' });
 await expect(callout).toContainText('مدير');
 await expect(sheet.getByRole('textbox')).toHaveCount(0);
 await expect(sheet.locator('#sheet-log')).toContainText('archived the card');
 // Its Conversation's or its channel's link to the board (?show) opens it the same way, read-only.
 await page.goto(`${board}?show=3`);
 await expect(page).toHaveURL(new RegExp(`${board}\\?card=3$`));
 await expect(sheet.getByRole('region', { name: 'Archived' })).toBeVisible();
 await expect(sheet.getByRole('textbox')).toHaveCount(0);
 await callout.getByRole('button', { name: 'Restore' }).click();
 await expect(sheet.getByRole('region', { name: 'Archived' })).toHaveCount(0);
 await expect(toast(page)).toContainText('Restored');
 await expect(sheet.locator('#sheet-log')).toContainText('restored the card');
 await sheet.getByRole('button', { name: 'Close', exact: true }).click();
 await page.goto(columns);
 await expect(inColumn(page, 'progress', 3)).toBeVisible();
});

test('a Viewer sees an archived Card and no control to archive or restore', async ({ page, browser }) => {
 await signIn(page, 'omar@example.com', board);
 await archiveFromMenu(page, 1);

 const viewer = await (await browser.newContext()).newPage();
 await signIn(viewer, 'viewer@example.com', columns);
 await expect(onBoard(viewer, 1)).toHaveCount(0);
 // Its old link opens it (the archived list returns on the Engine's board with #842).
 await viewer.goto(`${board}?card=1`);
 const sheet = sheetOf(viewer);
 await expect(sheet.getByRole('region', { name: 'Archived' })).toBeVisible();
 await expect(sheet.getByRole('button', { name: 'Restore' })).toHaveCount(0);
 await expect(sheet.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
 await viewer.goto(`${board}?card=2`);
 await expect(sheetOf(viewer).getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
 await viewer.context().close();

 await page.goto(`${board}?card=1`);
 await sheetOf(page).getByRole('button', { name: 'More', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Restore the card' }).click();
 await expect(toast(page)).toContainText('Restored');
});
