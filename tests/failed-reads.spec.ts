import { test, expect, freshSeed } from './fresh-seed';
import { asAdmin } from './slow-reads';
import { signIn } from './sign-in';

// Spec #760: a read that fails says so and is tried again; what was on the page stays, and a Company that cannot be read
// is never "not found". The failure is made at the database, as a person meets it: every signed-in read of one table
// errors (a restrictive policy that divides by zero on each row it checks), or a function the page calls is not granted.
const failing = (table: string) => ({
 on: () => asAdmin(`drop policy if exists test_failed_read on public.${table}; create policy test_failed_read on public.${table} as restrictive for select to authenticated using ((1/(select 0))=1);`),
 off: () => asAdmin(`drop policy if exists test_failed_read on public.${table};`),
});
const ungranted = (fn: string) => ({
 on: () => asAdmin(`revoke execute on function public.${fn} from authenticated;`),
 off: () => asAdmin(`grant execute on function public.${fn} to authenticated;`),
});
const general = '/c/rs-learning/channels/69000000-0000-0000-0000-000000000001';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({}, testInfo) => { freshSeed(testInfo); });
test.afterEach(() => {
 for (const table of ['channel_messages', 'companies', 'members', 'work_attachments']) failing(table).off();
 for (const fn of ['conversation_can_write(uuid)', 'channel_sidebar(uuid)']) ungranted(fn).off();
});

// #776
test('a Channel whose reads fail keeps its messages and its composer, says it could not be read, and comes back with Try again', async ({ page }) => {
 await signIn(page, 'reviewer@example.com', general);
 const box = page.getByRole('textbox', { name: 'Write your message in the channel', exact: true });
 await box.fill('Kept through a failed read'); await box.press('Enter');
 const mine = page.locator('.turn--user .bubble--user').filter({ hasText: 'Kept through a failed read' });
 await expect(mine).toBeVisible();
 // Every timer of the page from here on is the test's, so each poll comes when the test moves the clock.
 await page.clock.install(); await page.reload(); await expect(mine).toBeVisible();
 // A poll the clock starts from here: a request sent before this one (still on its way) is not it.
 const poll = async () => {
  const sent = page.waitForRequest(request => request.url().includes('/api/channels?') && request.method() === 'GET');
  await page.clock.fastForward(31_000);
  return (await (await sent).response())!.status();
 };
 // Whether the reader may write could not be read: an error, never a view-only channel.
 const write = ungranted('conversation_can_write(uuid)'); write.on();
 expect(await poll()).toBe(503);
 await expect(box).toBeVisible(); await expect(page.getByText('View only')).toHaveCount(0);
 write.off();
 const messages = failing('channel_messages'); messages.on();
 for (let n = 0; n < 3; n++) expect(await poll()).toBe(503);
 await expect(mine).toBeVisible(); await expect(box).toBeVisible();
 const line = page.getByRole('alert').filter({ hasText: 'This channel couldn’t be read just now' });
 await expect(line).toBeVisible();
 messages.off();
 await line.getByRole('button', { name: 'Try again' }).click();
 await expect(line).toHaveCount(0);
 await expect(mine).toBeVisible();
});

test('a Channel that cannot be read when it opens shows could not be read with Try again, not an empty channel', async ({ page }) => {
 await signIn(page, 'reviewer@example.com', '/c/rs-learning/home');
 const messages = failing('channel_messages'); messages.on();
 const opened = await page.goto(general);
 expect(opened?.status()).toBe(500);
 await expect(page.getByRole('heading', { name: 'Could not load this page' })).toBeVisible();
 await expect(page.getByRole('textbox', { name: 'Write your message in the channel', exact: true })).toHaveCount(0);
 messages.off();
 await page.getByRole('button', { name: 'Try again' }).click();
 await expect(page.locator('.turn--user .bubble--user').filter({ hasText: 'Kept through a failed read' })).toBeVisible();
});

test('the sidebar keeps its channels when their read fails, on the next page and on its poll', async ({ page }) => {
 await signIn(page, 'reviewer@example.com', '/c/rs-learning/home');
 const link = page.locator('.sidebar .ch-item');
 await expect(link).toHaveText('general');
 const sidebar = ungranted('channel_sidebar(uuid)'); sidebar.on();
 await page.locator('.sidebar').getByRole('link', { name: 'All conversations' }).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations$/);
 await expect(link).toHaveText('general');
 const polled = await page.waitForResponse(response => response.url().includes('/api/sidebar?'), { timeout: 15_000 });
 expect(polled.status()).toBe(503);
 await expect(link).toHaveText('general');
});

// #777
test('a Company that cannot be read shows could not be read on every page, never not found', async ({ page }) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/home');
 const companies = failing('companies'); companies.on();
 for (const path of ['/c/rs-learning/work/board', general, '/c/rs-learning/work/new', '/c/rs-learning/numbers', '/c/rs-learning/log']) {
  const opened = await page.goto(path);
  expect(opened?.status(), path).toBe(500);
  await expect(page.getByRole('heading', { name: 'Could not load this page' }), path).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Page not found' }), path).toHaveCount(0);
 }
 companies.off();
 await page.getByRole('button', { name: 'Try again' }).click();
 await expect(page.getByRole('heading', { name: 'Could not load this page' })).toHaveCount(0);
 await expect(page).toHaveURL(/\/c\/rs-learning\/log$/);
});

test('an Owner whose membership cannot be read is not shown the page without their controls', async ({ page }) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/settings/members');
 await expect(page.getByRole('button', { name: 'Invite a member' })).toBeVisible();
 const members = failing('members'); members.on();
 const opened = await page.goto('/c/rs-learning/settings/members');
 expect(opened?.status()).toBe(500);
 await expect(page.getByRole('heading', { name: 'Could not load this page' })).toBeVisible();
 await expect(page.getByRole('heading', { name: 'Team members' })).toHaveCount(0);
 members.off();
 await page.getByRole('button', { name: 'Try again' }).click();
 await expect(page.getByRole('button', { name: 'Invite a member' })).toBeVisible();
});

test('a person who is not a Member of a Company still gets not found, with nothing that tells them it exists', async ({ page }) => {
 await signIn(page, 'multi@example.com', '/c/rs-learning/home');
 const outside = await page.goto('/c/rs-consultations/home');
 expect(outside?.status()).toBe(404);
 await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
 expect((await page.request.get('/c/rs-consultations/files/1')).status()).toBe(404);
});
