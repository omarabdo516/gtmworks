import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { chooseLanguageInSettings } from './choose-language';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { resetFirstRun } from '../scripts/first-run-db.mjs';
import { idle } from './navigation-measure';
import { languages, widths, screens, snapshotName } from './visual-screens.mjs';
import { appOrigin, dbContainerOf } from './lane.mjs';

// Every listed screen is compared with its approved image (tests/visual.spec.ts-snapshots) in both languages at 1440 and 390.
// This project runs first on the freshly seeded database (see playwright.config.ts). It leaves the data as the seed built it,
// except the opened-card record that opening a card always makes, and it restores the owner's language.
type Language = 'en' | 'ar';
const rsLearning = '10000000-0000-0000-0000-000000000001';
const rsConsultations = '10000000-0000-0000-0000-000000000002';
const seedAuthor = '30000000-0000-0000-0000-000000000001';
const contextOptions = {
  baseURL: appOrigin,
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light' as const,
  reducedMotion: 'reduce' as const,
};
// Supabase CLI targets the local test database by default; never pass --remote.
const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });

// The seed schedules its cards relative to the moment the database was built. Pin them to fixed days in a past month so
// the board, the card and the calendar look the same on every run, through the same audit trigger the app uses.
function fixPublishingDates() {
  query(`do $$ begin
    perform set_config('request.jwt.claim.sub','${seedAuthor}',true);
    update public.work_cards c set go_live=x.fixed
    from (select id,('2026-06-'||lpad((row_number() over (order by id)*4)::text,2,'0')||'T12:00:00Z')::timestamptz fixed
          from public.work_cards where company_id='${rsLearning}') x
    where c.id=x.id and c.go_live is distinct from x.fixed;
  end $$;`);
}

async function chooseLanguage(page: Page, language: Language) {
  await chooseLanguageInSettings(page,language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
}

// The shell scrolls inside its own frame, so a page taller than the window would be cut at the fold. Grow the window until
// nothing scrolls, so the whole screen is compared.
async function showWholePage(page: Page, width: number) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const hidden = await page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll('*'))
      .filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.clientHeight > 0)
      .map(element => element.scrollHeight - element.clientHeight)));
    if (hidden <= 1) return;
    await page.setViewportSize({ width, height: Math.min(page.viewportSize()!.height + hidden, 8000) });
    await idle(page);
  }
}

// Times and the 14 day chart labels follow the real calendar, so they are replaced by fixed text; the layout around
// them, their font and their colour are still compared.
async function fixClockText(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur(); // no focus ring or open picker in the picture
    const months = 'January|February|March|April|May|June|July|August|September|October|November|December|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر';
    const monthName = new RegExp(months);
    const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      if (element.children.length || skipped.has(element.tagName)) continue;
      const text = (element.textContent ?? '').trim();
      if (element.closest('.chart-bars') && /\d/.test(text) && monthName.test(text)) element.textContent = 'Month 00';
      else if (element.tagName === 'TIME' || /\d{1,2}:\d{2}/.test(text)) element.textContent = 'Date, 00:00';
    }
  });
}

const readyBy: Record<string, string> = {
  home: '.home-dashboard',
  chat: '.chat',
  board: '.board',
  card: '.modal',
  calendar: '.calendar',
  approvals: '.approvals',
  members: '.member-row',
  'work-settings': '.settings-row',
  numbers: '.numbers-page',
  log: '.log-page',
  'first-run-question': '.fr',
  'lead-welcome': '[data-lead-line]',
  'alone-chat': '.chat',
  'alone-settings': '#inv-email',
  'made-card': '.ac-card',
  'new-agent': '.new-hint',
  'agent-visibility': '.ta-table .switch',
  'ready-roles': '.modal .tpl',
  'made-agent': '.born--sov',
  channel: '.ch-intro',
  'rule-saved': '.note--saved',
  'agent-rules': '.rl-said:not([data-utc])',
  'settings-agents': '.sov-ag',
  'settings-main-agent': '#set-h-main',
  'agent-details': '.chat',
};

// The states the seed does not hold: first run's two (#9), RS Learning with no answer yet and a new workspace's Lead with
// the Owner's empty Conversation, RS Consultations worked alone (#10), an Agent Lead made (#13) and a rule told to an
// Agent (#18). Each is set up for its own picture and taken away after it, so the seed stays as built.
const leadWelcome = { connection: '64000000-0000-0000-0000-000000000007', agent: '64000000-0000-0000-0000-000000000008', conversation: '64000000-0000-0000-0000-000000000009' };
// Lead and the Meta Ads it made for Omar on June 10 (#13), with the Conversation that made it (tests/visual-screens.mjs).
const made = (n: number) => `65000000-0000-0000-0000-00000000000${n}`;
// Ads and the lasting rule Omar told it in its Conversation on June 10 (#18), as agent_save_rule keeps it.
const told = (n: number) => `68000000-0000-0000-0000-00000000000${n}`;
const rule = 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
// A state whose rows are append-only (a Conversation's messages) is set and taken away as the database's own
// administrator with triggers off, the way tests/fresh-seed.ts puts the seed back, so nothing of it stays behind.
const asAdmin = (sql: string) => execFileSync('docker', ['exec', '-i', dbContainerOf(), 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction'],
  { input: `set session_replication_role = replica;\n${sql}`, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' });
// Lead, Meta Ads and SEO in RS Learning, with the switches the screen shows on (#15).
const seen = (n: number) => `68000000-0000-0000-0000-00000000000${n}`;
const general = '69000000-0000-0000-0000-000000000001';
const talk = (n: number) => `69000000-0000-0000-0000-0000000000${n}`;
const busy = (n: number) => `69100000-0000-0000-0000-00000000000${n}`;
const screenStates: Record<string, { set: string, unset: string, admin?: true }> = {
  unanswered: {
    set: `update public.companies set work_mode=null where id='${rsLearning}'`,
    unset: `update public.companies set work_mode='team' where id='${rsLearning}'`,
  },
  alone: {
    set: `update public.companies set work_mode='alone' where id='${rsConsultations}'`,
    unset: `update public.companies set work_mode='team' where id='${rsConsultations}'`,
  },
  'lead-welcome': {
    set: `do $$ begin insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${leadWelcome.connection}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual','visual-lead','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${leadWelcome.agent}','${rsLearning}','${leadWelcome.connection}','Lead','General',true);
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${leadWelcome.conversation}','${rsLearning}','20000000-0000-0000-0000-000000000001','${leadWelcome.agent}','Lead'); end $$;`,
    unset: `do $$ begin delete from public.conversations where id='${leadWelcome.conversation}';
      delete from public.hermes_agents where id='${leadWelcome.agent}';
      delete from public.hermes_connections where id='${leadWelcome.connection}'; end $$;`,
  },
  visibility: {
    set: `do $$ begin insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
       ('${seen(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-seen-lead','visual-seen-lead','visual-no-key','unreachable'),
       ('${seen(2)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-seen-ads','visual-seen-ads','visual-no-key','unreachable'),
       ('${seen(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-seen-seo','visual-seen-seo','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
       ('${seen(4)}','${rsLearning}','${seen(1)}','Lead','General',true),
       ('${seen(5)}','${rsLearning}','${seen(2)}','Meta Ads','Runs the Meta ads.',false),
       ('${seen(6)}','${rsLearning}','${seen(3)}','SEO','Writes the blog.',false);
      insert into public.member_agent_access(company_id,person_id,agent_id) values
       ('${rsLearning}','20000000-0000-0000-0000-000000000002','${seen(5)}'),('${rsLearning}','20000000-0000-0000-0000-000000000002','${seen(6)}'),
       ('${rsLearning}','20000000-0000-0000-0000-000000000003','${seen(5)}'); end $$;`,
    unset: `do $$ begin delete from public.hermes_agents where id in ('${seen(4)}','${seen(5)}','${seen(6)}');
      delete from public.hermes_connections where id in ('${seen(1)}','${seen(2)}','${seen(3)}'); end $$;`,
  },
  channel: {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
       ('${talk(10)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-channel','visual-channel-lead','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${talk(11)}','${rsLearning}','${talk(10)}','Lead','General',true);
      insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key,created_at) values
       ('${rsLearning}','${general}','person','20000000-0000-0000-0000-000000000002','مدير','صباح الخير يا جماعة. الدفعة الجديدة من «المحاسب الشامل» بتبدأ 1 ديسمبر، فكل حملات التسجيل لازم تبقى جاهزة قبل 20 نوفمبر.','${talk(12)}','2026-06-10T09:05:00Z'),
       ('${rsLearning}','${general}','person','20000000-0000-0000-0000-000000000001','عمر','@Lead لخّصلنا مين مستني إيه النهارده.','${talk(13)}','2026-06-10T09:15:00Z');
      insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,attempts,attempted_at,run_id,outcome,created_at,closed_at)
       select id,company_id,channel_id,'${talk(11)}','Lead','${talk(14)}','عمر: '||body,1,'2026-06-10T09:15:00Z','visual-channel','completed','2026-06-10T09:15:00Z','2026-06-10T09:15:40Z' from public.channel_messages where send_key='${talk(13)}';
      insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to,created_at)
       select company_id,channel_id,'agent','${talk(11)}','Lead','ده اللي واقف النهارده:
• حملة Meta للمحاسب الشامل: مستنية عمر يختار زاوية الإعلان
• مقال «كورس محاسبة اونلاين»: مستني موافقة النشر

الباقي ماشي لوحده، وهقولكم هنا لو حاجة وقفت.',id,'2026-06-10T09:15:40Z' from public.channel_messages where send_key='${talk(13)}';`,
    unset: `delete from public.channel_runs where channel_id='${general}';
      delete from public.channel_messages where channel_id='${general}';
      delete from public.hermes_agents where id='${talk(11)}';
      delete from public.hermes_connections where id='${talk(10)}';`,
  },
  'lead-made': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
       ('${made(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-lead','visual-made-lead','visual-no-key','unreachable'),
       ('${made(2)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-ads','visual-made-ads','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by,apps) values
       ('${made(3)}','${rsLearning}','${made(1)}','Lead','General',true,null,null,null),
       ('${made(4)}','${rsLearning}','${made(2)}','Meta Ads','Runs the Meta ads and asks before it publishes or spends.',false,'2026-06-10T09:01:00Z','20000000-0000-0000-0000-000000000001',array['Meta Ads Manager','Canva']);
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${made(5)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${made(3)}','Lead','2026-06-10T09:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${made(5)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','I want someone to handle our Meta ads','${made(6)}','visual-made','2026-06-10T09:00:00Z'),
       ('${rsLearning}','${made(5)}','agent',null,'${made(3)}','Lead','Done. Meta Ads runs your Meta ads from now on, and asks you before it publishes or spends anything.',null,'visual-made','2026-06-10T09:01:00Z');
      insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at) values ('${made(5)}','visual-made','call-0','${rsLearning}','${made(4)}','2026-06-10T09:01:00Z');`,
    unset: `delete from public.lead_made_agents where conversation_id='${made(5)}';
      delete from public.conversation_usage where conversation_id='${made(5)}';
      delete from public.conversation_messages where conversation_id='${made(5)}';
      delete from public.conversations where id='${made(5)}';
      delete from public.hermes_agents where id in ('${made(3)}','${made(4)}');
      delete from public.hermes_connections where id in ('${made(1)}','${made(2)}');`,
  },
  'rule-told': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${told(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-rules','visual-rules','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${told(2)}','${rsLearning}','${told(1)}','Ads','Runs the Meta and Google ads.');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${told(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${told(2)}','Ads','2026-06-10T18:39:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${told(3)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','${rule}','${told(4)}','visual-rule','2026-06-10T18:39:00Z'),
       ('${rsLearning}','${told(3)}','agent',null,'${told(2)}','Ads','تمام يا عمر. من دلوقتي أي حاجة رايحة لعميل، رسالة أو عرض أو رد على تعليق، هجهّزها وأستناك تشوفها الأول، وانت اللي تبعت.',null,'visual-rule','2026-06-10T18:40:00Z');
      insert into public.agent_rules(id,company_id,agent_id,body,said_by,said_at,conversation_id,run_id,call_id) values
       ('${told(5)}','${rsLearning}','${told(2)}','${rule}','20000000-0000-0000-0000-000000000001','2026-06-10T18:40:00Z','${told(3)}','visual-rule','call-0');`,
    unset: `delete from public.agent_rules where conversation_id='${told(3)}';
      delete from public.conversation_usage where conversation_id='${told(3)}';
      delete from public.conversation_messages where conversation_id='${told(3)}';
      delete from public.conversations where id='${told(3)}';
      delete from public.hermes_agents where id='${told(2)}';
      delete from public.hermes_connections where id='${told(1)}';`,
  },
  'agent-details': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
       ('${busy(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-busy-lead','visual-busy-lead','visual-no-key','unreachable'),
       ('${busy(2)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-busy-ads','visual-busy-ads','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by,apps,requester_opened_at) values
       ('${busy(4)}','${rsLearning}','${busy(1)}','Lead','General',true,null,null,null,null),
       ('${busy(5)}','${rsLearning}','${busy(2)}','Meta Ads','Runs the Meta ads and asks before it publishes or spends.',false,'2026-06-10T09:01:00Z','20000000-0000-0000-0000-000000000001',array['Meta Ads Manager'],'2026-06-10T09:05:00Z');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${busy(8)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${busy(4)}','Lead','2026-06-10T09:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${busy(8)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','I want someone to handle our Meta ads','${busy(9)}','visual-busy-made','2026-06-10T09:00:00Z'),
       ('${rsLearning}','${busy(8)}','agent',null,'${busy(4)}','Lead','Done. Meta Ads runs your Meta ads from now on.',null,'visual-busy-made','2026-06-10T09:01:00Z');
      insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at) values ('${busy(8)}','visual-busy-made','call-0','${rsLearning}','${busy(5)}','2026-06-10T09:01:00Z');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${busy(6)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${busy(5)}','Meta Ads','2026-06-12T09:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${busy(6)}','person','20000000-0000-0000-0000-000000000001','Omar','Plan the June campaign for the new course','${busy(7)}','visual-busy',now()-interval '5 minutes');
      insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at) values
       ('${rsLearning}','20000000-0000-0000-0000-000000000001','person','عمر','agent','${busy(5)}','agent_added','{"agent_name":"Meta Ads"}','hermes_agent_audit',691001,now()-interval '1 hour'),
       ('${rsLearning}','20000000-0000-0000-0000-000000000001','person','عمر','agent','${busy(5)}','agent_changed','{"agent_name":"Meta Ads"}','hermes_agent_audit',691002,now()-interval '2 hours');`,
    unset: `delete from public.company_log where agent_id='${busy(5)}';
      delete from public.lead_made_agents where conversation_id='${busy(8)}';
      delete from public.conversation_messages where conversation_id in ('${busy(6)}','${busy(8)}');
      delete from public.conversations where id in ('${busy(6)}','${busy(8)}');
      delete from public.hermes_agents where id in ('${busy(4)}','${busy(5)}');
      delete from public.hermes_connections where id in ('${busy(1)}','${busy(2)}');`,
  },
};

async function showScreen(page: Page, screen: (typeof screens)[number], width: number) {
  await page.emulateMedia({ colorScheme: screen.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(screen.path);
  await expect(page.locator(readyBy[screen.name.replace('-dark', '')] ?? '.content').first()).toBeVisible();
  if (screen.name === 'calendar') {
    // The calendar opens on the current month; every run compares the month the seeded cards are pinned to.
    const title = page.locator('.calendar-title');
    await expect(async () => {
      await page.locator('input[type=month]').fill('2026-06');
      await expect(title).toContainText('2026');
    }).toPass();
    await expect(page.locator('.calendar').getByRole('link')).toHaveCount(5);
  }
  await idle(page);
  // The fixed text is shorter than a real date, so it changes how rows wrap and how tall the page is. It goes in before the
  // window is sized, otherwise the window is sized for the real date and the picture keeps blank space that depends on the day.
  await fixClockText(page);
  // The question and the gallery cover the window over an inert page: the window keeps its size, as a person sees it.
  if (!['first-run-question', 'ready-roles'].includes(screen.name.replace('-dark', ''))) await showWholePage(page, width);
}

test.describe('anonymous screens', () => {
  let context: BrowserContext;
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
  });
  test.afterAll(async () => { await context.close(); });

  for (const language of languages as Language[]) for (const width of widths) for (const screen of screens.filter(s => s.anonymous && s.name !== 'first-run')) {
    test(`${screen.name} ${language} ${width}`, async () => {
      await page.emulateMedia({ colorScheme: screen.dark ? 'dark' : 'light' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(screen.path);
      await page.locator('select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await idle(page);
      await showWholePage(page, width);
      // With reduced motion the artwork holds its first frame; it only exists on the wide layout.
      if (width === 1440) await expect(page.locator('pre[aria-hidden=true]')).toContainText('╭');
      if (screen.dark) await expectDarkContrast(page);
      await expect(page).toHaveScreenshot(`${snapshotName(screen, language, width)}.png`, { fullPage: true });
    });
  }
});

test.describe('signed-in screens', () => {
  let context: BrowserContext;
  let page: Page;
  let current: Language | null = null;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240000);
    // A clean slate if an earlier run stopped half way: the seeded dates, English.
    fixPublishingDates();
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    // Omar is the Owner of every seeded company, so the screens show what an Owner sees.
    await signIn(page, 'omar@example.com', '/c/rs-learning/settings');
    await chooseLanguage(page, 'en');
    current = 'en';
    // The sidebar lists recently opened cards and opening one is recorded. Open card 1 now so that every screen,
    // in every run, starts with the same list.
    await page.goto('/c/rs-learning/work/board/1');
    await expect(page.locator('.modal')).toBeVisible();
    await idle(page);
    await page.goto('/c/rs-learning/home');
    await expect(page.locator('.recent-cards a')).toHaveCount(1);
  });
  test.afterAll(async () => {
    try {
      if (page && current !== 'en') await chooseLanguage(page, 'en');
    } finally {
      await context?.close();
    }
  });

  for (const language of languages as Language[]) for (const width of widths) for (const screen of screens.filter(s => !s.anonymous)) {
    test(`${screen.name} ${language} ${width}`, async () => {
      if (current !== language) {
        await chooseLanguage(page, language);
        current = language;
      }
      const state = 'state' in screen && typeof screen.state === 'string' ? screenStates[screen.state] : undefined;
      const write = state?.admin ? asAdmin : query;
      if (state) { write(state.unset); write(state.set); }
      try {
        await showScreen(page, screen, width);
        if (screen.dark) await expectDarkContrast(page);
        await expect(page).toHaveScreenshot(`${snapshotName(screen, language, width)}.png`, { fullPage: true });
      } finally {
        if (state) write(state.unset);
      }
    });
  }
});

async function expectDarkContrast(page: Page) {
  const result = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1); const bytes = canvas.getImageData(0, 0, 1, 1).data; return [bytes[0], bytes[1], bytes[2], bytes[3] / 255]; };
    const over = (top: number[], below: number[]) => [0, 1, 2].map(index => top[index] * top[3] + below[index] * (1 - top[3]));
    const luminance = (color: number[]) => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const targets: { element: Element, text: string, pseudo?: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) targets.push({ element: walker.currentNode.parentElement!, text });
    }
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]),textarea')) {
      const text = element.value || element.placeholder;
      if (text) targets.push({ element, text, pseudo: element.value ? undefined : '::placeholder' });
    }
    for (const element of document.querySelectorAll<HTMLSelectElement>('select')) targets.push({ element, text: element.selectedOptions[0]?.text || '' });
    let checked = 0;
    const failures = [];
    for (const { element, text, pseudo } of targets) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('[aria-hidden=true],.sr-only')) continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      let background = [255, 255, 255], opacity = 1;
      const chain: Element[] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) chain.unshift(ancestor);
      for (const ancestor of chain) { const style = getComputedStyle(ancestor); background = over(rgba(style.backgroundColor), background); opacity *= Number(style.opacity); }
      const style = getComputedStyle(element, pseudo);
      const color = rgba(style.color);
      const shown = over([color[0], color[1], color[2], color[3] * opacity * (pseudo ? Number(style.opacity) : 1)], background);
      const values = [luminance(shown), luminance(background)].sort((first, second) => second - first);
      const ratio = (values[0] + 0.05) / (values[1] + 0.05);
      checked++;
      if (ratio < 4.5) failures.push({ text, ratio });
    }
    return { checked, failures };
  });
  expect(result.checked, 'visible dark text was measured').toBeGreaterThan(0);
  await test.info().attach('dark-contrast', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.failures, `${result.checked} dark text runs checked at 4.5:1`).toEqual([]);
}

// Last visual group: capture a real empty installation, then restore the exact seed before functional starts.
test.describe('first-run screens', () => {
  test.use(contextOptions);
  test.beforeAll(({ baseURL }) => resetFirstRun(baseURL));
  test.afterAll(({ baseURL }) => resetFirstRun(baseURL, true));
  const screen = screens.find(screen => screen.name === 'first-run')!;
  for (const language of languages) for (const width of widths) {
    test(`first-run ${language} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // The form shows only through the installer's setup link (issue #50); the screen is the same.
      await page.goto(`${screen.path}#code=${process.env.SETUP_CODE}`);
      await page.locator('select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('input[name=company]')).toBeVisible();
      await idle(page);
      await showWholePage(page, width);
      await expect(page).toHaveScreenshot(`${snapshotName(screen, language, width)}.png`, { fullPage: true });
    });
  }
});
