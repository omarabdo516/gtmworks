import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// The board's archive list a page at a time (#705; design-reference-card: the board's archive icon, bt-search): with
// more archived Cards than one page holds, the list shows fifty, newest archived first, "Show more" adds the rest, and
// its search reads every archived title in the database, so a Card past the first page is found and opened.
const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });
const company = '10000000-0000-0000-0000-000000000001';
const reviewer = '20000000-0000-0000-0000-000000000003';
const board = '/c/rs-learning/work/board';

// Sixty archived Cards of RS Learning, an hour apart, the first archived first: the oldest titled in Arabic. A retry on
// the same lane keeps the file's data, so they are made once.
function sixtyArchived() {
 query(`insert into public.work_cards(company_id,status,title,archived_at,archived_by)
  select '${company}','progress',case when g=1 then 'مُــهمّة إعلانات ديسمبر' else 'Archived plan '||lpad(g::text,2,'0') end,now()-interval '100 hours'+make_interval(hours=>g),'${reviewer}'
  from generate_series(1,60) g
  where not exists (select 1 from public.work_cards where company_id='${company}' and title='Archived plan 60')`);
}

test('the archive list shows fifty archived Cards, newest first, "Show more" adds the rest, and its search finds one past the first page', async ({ page }) => {
 test.setTimeout(90000);
 sixtyArchived();
 await signIn(page, 'reviewer@example.com', board);
 const toggle = page.getByRole('button', { name: 'Archived · 60' });
 await toggle.click();
 const rows = page.getByRole('list', { name: 'Archived cards' }).getByRole('listitem');
 await expect(rows).toHaveCount(50);
 await expect(rows.first()).toContainText('Archived plan 60');
 await expect(rows.last()).toContainText('Archived plan 11');
 await page.getByRole('button', { name: 'Show more' }).click();
 await expect(rows).toHaveCount(60);
 await expect(rows.last()).toContainText('مُــهمّة إعلانات ديسمبر');
 await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);

 // The search asks the database: from a fresh list of fifty, the oldest Card is found, Arabic marks and tatweel aside.
 await page.reload();
 await page.getByRole('button', { name: 'Archived · 60' }).click();
 await expect(rows).toHaveCount(50);
 await page.getByRole('button', { name: 'Search archived cards' }).click();
 await page.getByRole('searchbox', { name: 'Search archived cards' }).fill('مهمه');
 await expect(rows).toHaveCount(1);
 await expect(rows.first()).toContainText('مُــهمّة إعلانات ديسمبر');
 await page.getByRole('searchbox', { name: 'Search archived cards' }).fill('plan 0');
 await expect(rows).toHaveCount(8);
 await page.getByRole('searchbox', { name: 'Search archived cards' }).fill('nothing like it');
 await expect(page.getByText('No archived cards match these filters')).toBeVisible();
 await page.getByRole('searchbox', { name: 'Search archived cards' }).fill('مهمه');
 await rows.first().getByRole('link').click();
 await expect(page.getByRole('dialog').getByRole('region', { name: 'Archived' })).toBeVisible();
});
