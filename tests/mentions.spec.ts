import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// #154, "@" and "/" in the composer: the suggestion list a Member sees while they type. Its names are the product's own
// (an Agent by "@" and its name, a Member by their first name), and it offers only what the reader may call: a hidden
// Agent never appears in a Conversation, while a channel's own Members and Agents do. The caret token, the entries, the
// keys and the list the note field gets without Commands are proven in tests/composer-mentions.test.mjs,
// components/message-box.test.tsx and components/card-window.test.tsx.
const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });
const company = '10000000-0000-0000-0000-000000000001';
const contributor = '20000000-0000-0000-0000-000000000003';
const general = '/c/rs-learning/channels/69000000-0000-0000-0000-000000000001';
const id = (n: number) => `67000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [seen, hidden] = [id(701), id(702)];

test.describe.configure({ mode: 'serial' });
test.beforeAll(({}, testInfo) => {
 // A retry starts from the seed again: this file's two Agents are inserted once per run of it.
 freshSeed(testInfo.file, testInfo.retry > 0);
 // The general channel holds every Member, and every Agent the reader sees. Two Agents exist: the Contributor may call
 // the first, and the second stays hidden from them everywhere but a channel that holds it (#15). Each Agent names its
 // own profile on the bundled Hermes, as every Agent does (#342).
 query(`do $$ begin
  update public.people set language='en' where id in ('${contributor}','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
   ('${seen}','${company}','${id(11)}','Visible Agent','Plans the work','mention-seen'),
   ('${hidden}','${company}','${id(12)}','Hidden Agent','Stays out','mention-hidden');
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${contributor}','${seen}');
 end $$;`);
});

test('a Contributor\'s "@" in a Conversation offers the Agents they see, with each line under its name, and a hidden Agent stays absent', async ({ page }) => {
 await signIn(page, 'reviewer@example.com', `/c/rs-learning/chat/${seen}`);
 const box = page.getByRole('textbox', { name: 'Message' });
 await box.fill('@');
 const list = page.locator('.composer [role="listbox"]');
 await expect(list).toBeVisible();
 await expect(page.getByRole('option').filter({ hasText: 'Visible Agent' })).toContainText('Plans the work');
 await expect(page.getByRole('option').filter({ hasText: 'Hidden Agent' })).toHaveCount(0);
 await expect(box).toHaveAttribute('aria-expanded', 'true');
 // Each letter narrows the list by the name, and one that matches nothing closes it.
 await box.fill('@vis');
 await expect(page.getByRole('option')).toHaveCount(1);
 await box.fill('@hidden');
 await expect(list).toHaveCount(0);
 await expect(box).toHaveAttribute('aria-expanded', 'false');
 // A "/" opens the Commands, as the "+" menu names them.
 await box.fill('/a');
 await expect(page.getByRole('option').filter({ hasText: '/agent' })).toBeVisible();
});

test('in the general channel "@" offers the other Members with their Role, a Viewer marked "reads only", before the Agents', async ({ page }) => {
 await signIn(page, 'reviewer@example.com', general);
 const box = page.getByRole('textbox', { name: 'Write your message in the channel' });
 await box.fill('@');
 const list = page.locator('.composer [role="listbox"]');
 await expect(list).toBeVisible();
 await expect(page.locator('.composer .menu__label')).toHaveText(['Someone on the team', 'Call an agent']);
 // The Owner first, then the Manager, then the Viewer marked "reads only", as the channel lists its Members; the Agent
 // comes last.
 await expect(page.getByRole('option').first()).toContainText('Owner');
 await expect(page.getByRole('option').first()).not.toContainText('read');
 await expect(page.getByRole('option').filter({ hasText: 'Manager' })).toHaveCount(1);
 await expect(page.getByRole('option').filter({ hasText: 'Owner' })).toHaveCount(1);
 const reads = page.getByRole('option').filter({ hasText: 'reads only' });
 await expect(reads).toHaveCount(1);
 await expect(reads).toContainText('Viewer');
 await expect(page.getByRole('option').last()).toContainText('Visible Agent');
 // Tab puts the marked entry in place of what was typed, with one space after it: the Owner's first name.
 await box.press('Tab');
 await expect(box).toHaveValue('@عمر ');
});
