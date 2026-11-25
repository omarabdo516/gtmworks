import { expect, type Page } from '@playwright/test';

// A Card made through the one New card form (#683), opened in its window at its old address (which opens the same
// window, #678), as the specs that made one through the old request form did.
export async function makeCard(page: Page, title: string, { slug = 'rs-learning', open = true }: { slug?: string, open?: boolean } = {}) {
 await page.goto(`/c/${slug}/work/new`);
 const dialog = page.getByRole('dialog');
 await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
 await dialog.getByRole('button', { name: 'Add card' }).click();
 await expect(page).toHaveURL(/\/work\/board\?show=\d+/);
 const id = Number(new URL(page.url()).searchParams.get('show'));
 const path = `/c/${slug}/work/board/${id}`;
 if (open) { await page.goto(path); await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText(title); }
 return { title, path, id };
}
