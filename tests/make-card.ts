import { expect, type Page } from '@playwright/test';

// A Card made through the one New card form (#683), opened in its window at its old address (which opens the same
// window, #678), as the specs that made one through the old request form did. The board shows the new Card and takes
// the address it was shown by back off (useShowCard), so its id is read from its tile. `idea`: made from the Ideas
// column's "+", so it lands at the top of Ideas instead of in Planned.
export async function makeCard(page: Page, title: string, { slug = 'rs-learning', open = true, idea = false }: { slug?: string, open?: boolean, idea?: boolean } = {}) {
 if (idea) { await page.goto(`/c/${slug}/work/board`); await page.locator('.col[data-column="ideas"]').getByRole('button', { name: 'Add an idea' }).click(); }
 else await page.goto(`/c/${slug}/work/new`);
 const dialog = page.getByRole('dialog');
 await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
 await dialog.getByRole('button', { name: 'Add card' }).click();
 await expect(dialog).toHaveCount(0);
 const tile = page.locator('#board-cols .kcard').filter({ hasText: title });
 await expect(tile).toHaveCount(1);
 const id = Number(await tile.getAttribute('data-card-id'));
 const path = `/c/${slug}/work/board/${id}`;
 if (open) { await page.goto(path); await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText(title); }
 return { title, path, id };
}
