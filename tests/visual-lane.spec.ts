import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { laneImage, loadLaneScreens, themes, widths } from './visual-lane.mjs';
import { blockOutsideRequests, forgetBlocked, expectDarkContrast, expectDeterministic, expectQuietContrast, fixClock, fixClockText, type QuietCheck } from './visual-lane-guards';
import { freshSeed } from './fresh-seed';
import { signIn, openNavigation } from './sign-in';
import { idle } from './navigation-measure';
import { appOrigin } from './lane.mjs';
import { asAdmin } from './slow-reads';
import { localStatement, resetFirstRun } from '../scripts/first-run-db.mjs';
import { laneHermes } from './lane-hermes';
import { morningMarker } from '../lib/morning-schedule.mjs';
import { toolConfig } from '../lib/agent-toolsets.mjs';

// The visual lane (#257): each key screen in tests/visual-lane/screens.json, in Arabic at 1440 and 390, light and dark,
// against its approved image. Each screen starts from the seed as built and signs in again, so the screens pass in any
// order.
const screens = loadLaneScreens();
const rsLearning = '10000000-0000-0000-0000-000000000001';
const seedAuthor = '30000000-0000-0000-0000-000000000001';
const omar = '20000000-0000-0000-0000-000000000001';

// Secondary text measured after the light picture; on a phone the sidebar's labels are read with the drawer open.
const quietText: Record<string, QuietCheck[]> = {
  home: [['chart subtitle', '.home-charts article h2 + span'], ['sidebar heading', '.sidebar .sb-label'], ['account role', '.sidebar .me__role']],
  board: [['toolbar label', '.work-toolbar .tabs a:not(.active), .work-toolbar .tabs button:not(.active)']],
  card: [['comment placeholder', '.modal textarea[name=body]', '::placeholder']],
};
for (const name of Object.keys(quietText)) if (!screens.some(screen => screen.name === name)) throw new Error(`${name}: quiet text is measured only on a lane screen`);

// The seed schedules its cards relative to the moment the database was built. Pin them to fixed days in a past month so
// the board and the card look the same on every run, through the same audit trigger the app uses.
function fixPublishingDates(baseURL: string | undefined) {
  localStatement(`do $$ begin
    perform set_config('request.jwt.claim.sub','${seedAuthor}',true);
    update public.work_cards c set go_live=x.fixed
    from (select id,('2026-06-'||lpad((row_number() over (order by id)*4)::text,2,'0')||'T12:00:00Z')::timestamptz fixed
          from public.work_cards where company_id='${rsLearning}') x
    where c.id=x.id and c.go_live is distinct from x.fixed;
  end $$;`, baseURL);
}

// The states the seed does not hold, written as the database's administrator with triggers off (their rows are
// append-only) and taken away after each picture. Every time is fixed, so no picture depends on the day it is drawn.
const general = '69000000-0000-0000-0000-000000000001';
const talk = (n: number) => `69000000-0000-0000-0000-0000000000${n}`;
const busy = (n: number) => `69100000-0000-0000-0000-00000000000${n}`;
const change = (n: number) => `69200000-0000-0000-0000-00000000000${n}`;
const routine = (n: number) => `69300000-0000-0000-0000-00000000000${n}`;
const morning = (n: number) => `69400000-0000-0000-0000-00000000000${n}`;
const ownProfile = (agent: string) => `ag-${agent.replaceAll('-', '')}`;
const companyProfile = `co-${rsLearning.replaceAll('-', '')}`;
// A Routine as the fake Engine keeps it (#31): no zone of its own, so it reads in UTC, and its next and last runs are
// tomorrow and yesterday at fixed hours of the server's own clock, which draws the page.
const day = (offset: number, hour: number) => `${new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const routineJob = (id: string, name: string, expr: string, extra: object = {}) => ({ id, name, prompt: name, skills: [], skill: null, schedule: { kind: 'cron', expr, display: expr },
  schedule_display: expr, repeat: { times: null, completed: 0 }, enabled: true, state: 'scheduled', paused_at: null, created_at: '2026-06-01T08:00:00Z', next_run_at: day(1, Number(expr.split(' ')[1]) || 9),
  last_run_at: null, last_status: null, last_error: null, deliver: 'local', origin: null, ...extra });
const screenStates: Record<string, { set: string, unset: string, engine?: (fake: Awaited<ReturnType<typeof laneHermes>>) => void }> = {
  // Recurring tasks (#31): Lead's morning brief and two of Meta Ads's Routines, one switched off, on their own profiles.
  routines: {
    set: `      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
       ('${routine(1)}','${rsLearning}','${routine(3)}','Lead','General',true,'${companyProfile}'),
       ('${routine(2)}','${rsLearning}','${routine(4)}','Meta Ads','Runs the Meta ads.',false,'${ownProfile(routine(2))}');
      insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${companyProfile}',true from public.companies where id='${rsLearning}'
       on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
      insert into public.company_profile_keepers(company_id,agent_id) values ('${rsLearning}','${routine(1)}') on conflict (company_id) do update set agent_id=excluded.agent_id;
      insert into public.agent_profiles(agent_id,company_id) values ('${routine(2)}','${rsLearning}');`,
    unset: `delete from public.agent_profiles where agent_id='${routine(2)}';
      delete from public.company_profile_keepers where agent_id='${routine(1)}';
      delete from public.hermes_agents where id in ('${routine(1)}','${routine(2)}');`,
    engine: fake => {
      for (const name of [companyProfile, ownProfile(routine(2))]) fake.settings.profiles.set(name, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: toolConfig({ profile: name }), credentials: {} });
      fake.settings.cron.set(companyProfile, [routineJob('aa00000000a1', 'ملخص الصبح للفريق', '0 8 * * *', { last_run_at: day(-1, 8), last_status: 'ok' })]);
      fake.settings.cron.set(ownProfile(routine(2)), [routineJob('bb00000000b1', 'ابعتلي ملخص الإعلانات', '0 9 * * *', { last_run_at: day(-1, 9), last_status: 'ok' }),
        routineJob('bb00000000b2', 'وقّف أي إعلان تكلفة الليد فيه عدّت 45 ج', '0 16 * * 4', { enabled: false, state: 'paused', next_run_at: null })]);
    },
  },
  // Good morning (#182): the main Agent's page with its daily message on at 9:00, Cairo time.
  'good-morning': {
    set: `      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
       ('${morning(1)}','${rsLearning}','${morning(2)}','Lead','General',true,'${companyProfile}');
      insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${companyProfile}',true from public.companies where id='${rsLearning}'
       on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
      insert into public.company_profile_keepers(company_id,agent_id) values ('${rsLearning}','${morning(1)}') on conflict (company_id) do update set agent_id=excluded.agent_id;`,
    unset: `delete from public.company_profile_keepers where agent_id='${morning(1)}';
      delete from public.hermes_agents where id='${morning(1)}';`,
    engine: fake => {
      fake.settings.profiles.set(companyProfile, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: toolConfig({ profile: companyProfile }), credentials: {} });
      fake.settings.cron.set(companyProfile, [routineJob('cc00000000c1', 'Good morning', '0 9 * * *', { timezone: 'Africa/Cairo', prompt: `${morningMarker}\nThe morning summary.` })]);
    },
  },
  // The general channel (#24): the Manager's note, Omar asking Lead, and Lead's answer.
  channel: {
    set: `      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${talk(11)}','${rsLearning}','${talk(10)}','Lead','General',true,'visual-channel-lead');
      insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key,created_at) values
       ('${rsLearning}','${general}','person','20000000-0000-0000-0000-000000000002','مدير','صباح الخير يا جماعة. الدفعة الجديدة من «المحاسب الشامل» بتبدأ 1 ديسمبر، فكل حملات التسجيل لازم تبقى جاهزة قبل 20 نوفمبر.','${talk(12)}','2026-06-10T09:05:00Z'),
       ('${rsLearning}','${general}','person','${omar}','عمر','@Lead لخّصلنا مين مستني إيه النهارده.','${talk(13)}','2026-06-10T09:15:00Z');
      insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,attempts,attempted_at,run_id,outcome,created_at,closed_at)
       select id,company_id,channel_id,'${talk(11)}','Lead','${talk(14)}','عمر: '||body,1,'2026-06-10T09:15:00Z','visual-channel','completed','2026-06-10T09:15:00Z','2026-06-10T09:15:40Z' from public.channel_messages where send_key='${talk(13)}';
      insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to,created_at)
       select company_id,channel_id,'agent','${talk(11)}','Lead','ده اللي واقف النهارده:
• حملة Meta للمحاسب الشامل: مستنية عمر يختار زاوية الإعلان
• مقال «كورس محاسبة اونلاين»: مستني موافقة النشر

الباقي ماشي لوحده، وهقولكم هنا لو حاجة وقفت.',id,'2026-06-10T09:15:40Z' from public.channel_messages where send_key='${talk(13)}';`,
    unset: `delete from public.channel_runs where channel_id='${general}';
      delete from public.channel_messages where channel_id='${general}';
      delete from public.hermes_agents where id='${talk(11)}';`,
  },
  // Omar's chat with Meta Ads, the Agent Lead made for him (#21), with its details open beside it.
  'agent-details': {
    set: `      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by,apps,requester_opened_at,profile) values
       ('${busy(4)}','${rsLearning}','${busy(1)}','Lead','General',true,null,null,null,null,'visual-busy-lead'),
       ('${busy(5)}','${rsLearning}','${busy(2)}','Meta Ads','Runs the Meta ads and asks before it publishes or spends.',false,'2026-06-10T09:01:00Z','${omar}',array['Meta Ads Manager'],'2026-06-10T09:05:00Z','visual-busy-ads');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${busy(8)}','${rsLearning}','${omar}','${busy(4)}','Lead','2026-06-10T09:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${busy(8)}','person','${omar}',null,'Omar','I want someone to handle our Meta ads','${busy(9)}','visual-busy-made','2026-06-10T09:00:00Z'),
       ('${rsLearning}','${busy(8)}','agent',null,'${busy(4)}','Lead','Done. Meta Ads runs your Meta ads from now on.',null,'visual-busy-made','2026-06-10T09:01:00Z');
      insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at) values ('${busy(8)}','visual-busy-made','call-0','${rsLearning}','${busy(5)}','2026-06-10T09:01:00Z');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${busy(6)}','${rsLearning}','${omar}','${busy(5)}','Meta Ads','2026-06-12T09:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${busy(6)}','person','${omar}','Omar','Plan the June campaign for the new course','${busy(7)}','visual-busy','2026-06-15T11:55:00Z');
      insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at) values
       ('${rsLearning}','${omar}','person','عمر','agent','${busy(5)}','agent_added','{"agent_name":"Meta Ads"}','hermes_agent_audit',691001,'2026-06-15T11:00:00Z'),
       ('${rsLearning}','${omar}','person','عمر','agent','${busy(5)}','agent_changed','{"agent_name":"Meta Ads"}','hermes_agent_audit',691002,'2026-06-15T10:00:00Z');`,
    unset: `delete from public.company_log where agent_id='${busy(5)}';
      delete from public.lead_made_agents where conversation_id='${busy(8)}';
      delete from public.conversation_messages where conversation_id in ('${busy(6)}','${busy(8)}');
      delete from public.conversations where id in ('${busy(6)}','${busy(8)}');
      delete from public.hermes_agents where id in ('${busy(4)}','${busy(5)}');`,
  },
  // Omar's chat with Lead, in which Lead proposed a faster model for Analyst, waiting on his OK (#19).
  'change-proposal': {
    set: `      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
       ('${change(1)}','${rsLearning}','${change(5)}','Lead','General',true,'visual-change-lead'),
       ('${change(2)}','${rsLearning}','${change(6)}','Analyst','Numbers',false,'visual-change-analyst');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${change(3)}','${rsLearning}','${omar}','${change(1)}','Lead','2026-06-10T11:26:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${change(3)}','person','${omar}',null,'عمر','تقرير آخر 90 يوم لسه مخلصش؟ كنت محتاجه قبل اجتماع بكرة.','${change(4)}','visual-change','2026-06-10T11:26:00Z'),
       ('${rsLearning}','${change(3)}','agent',null,'${change(1)}','Lead','Analyst لسه شغال عليه، والمرة اللي فاتت اتأخر ساعة عن ميعاده. اقترحت نغيّر موديله، ومش هيحصل غير بموافقة المالك.',null,'visual-change','2026-06-10T11:30:00Z');
      insert into public.agent_change_proposals(company_id,conversation_id,run_id,call_id,agent_id,proposed_by,asked_by,change,value,reason,created_at) values
       ('${rsLearning}','${change(3)}','visual-change','call-0','${change(2)}','${change(1)}','${omar}','model','"google/gemini-2.5-pro"',
        'تقرير الـ 90 يوم بيقرا أرقام كتير وبيتأخر عن ميعاده. Gemini 2.5 Pro أسرع في الأرقام الكبيرة.','2026-06-10T11:30:00Z');`,
    unset: `delete from public.agent_change_proposals where conversation_id='${change(3)}';
      delete from public.conversation_messages where conversation_id='${change(3)}';
      delete from public.conversations where id='${change(3)}';
      delete from public.hermes_agents where id in ('${change(1)}','${change(2)}');`,
  },
};
for (const screen of screens) if (screen.state && !screenStates[screen.state]) throw new Error(`${screen.name}: no state "${screen.state}"`);

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

async function laneContext(browser: Browser) {
  const context = await browser.newContext({ baseURL: appOrigin, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ar-EG', timezoneId: 'UTC', reducedMotion: 'reduce' });
  await blockOutsideRequests(context);
  await fixClock(context);
  return context;
}

for (const screen of screens) {
  test.describe(screen.name, () => {
    let context: BrowserContext;
    let page: Page;
    test.beforeAll(async ({ browser, baseURL }) => {
      test.setTimeout(120000);
      // A visitor's screen draws no Company data: sign-in needs nothing, and first run empties the installation itself.
      if (screen.name === 'first-run') resetFirstRun(baseURL);
      if (!screen.anonymous) {
        freshSeed(test.info().file, true);
        fixPublishingDates(baseURL);
        asAdmin(`update public.people set language='ar' where id='${omar}'`);
      }
      context = await laneContext(browser);
      page = await context.newPage();
      if (screen.anonymous) return;
      await signIn(page, 'omar@example.com', '/c/rs-learning/home');
      // The sidebar lists recently opened Cards and the board orders Ideas by last change: opening Card 1 first gives
      // every screen the same list.
      await page.goto('/c/rs-learning/work/board/1');
      await expect(page.locator('.modal')).toBeVisible();
      await idle(page);
      // The open is recorded once Home lists it, before any picture's sidebar asks for the list (as the old spec waited).
      await page.goto('/c/rs-learning/home');
      await expect(page.locator('.recent-cards a')).toHaveCount(1);
    });
    test.afterAll(async ({ baseURL }) => {
      await context?.close();
      // First run empties the installation; the seed goes back for whatever runs next, as the old screens did.
      if (screen.name === 'first-run') resetFirstRun(baseURL, true);
    });

    for (const width of widths) for (const theme of themes) {
      test(`${screen.name} ${width} ${theme}`, async () => {
        forgetBlocked(context);
        const state = screen.state ? screenStates[screen.state] : undefined;
        if (state) { asAdmin(state.unset); asAdmin(state.set); }
        // A screen whose data the Engine holds draws it from the lane's fake Engine, made for this picture alone.
        const engine = state?.engine ? await laneHermes() : null;
        if (engine) state!.engine!(engine);
        try {
          await page.emulateMedia({ colorScheme: theme });
          await page.setViewportSize({ width, height: 900 });
          // The first-run form shows only through the installer's setup link (#50).
          await page.goto(screen.name === 'first-run' ? `${screen.path}#code=${process.env.SETUP_CODE}` : screen.path);
          if (screen.anonymous) await page.locator('select').selectOption('ar');
          await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
          await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
          await expect(page.locator(screen.ready ?? '.content').first()).toBeVisible();
          await idle(page);
          // The fixed text is shorter than a real date, so it goes in before the window is sized for the page.
          await fixClockText(page);
          await showWholePage(page, width);
          // With reduced motion the sign-in artwork holds its first frame; it only exists on the wide layout.
          if (screen.name === 'sign-in' && width === 1440) await expect(page.locator('pre[aria-hidden=true]')).toContainText('╭');
          await expectDeterministic(page);
          if (theme === 'dark') await expectDarkContrast(page);
          await expect(page).toHaveScreenshot(laneImage(screen, width, theme), { fullPage: true });
          const quiet = quietText[screen.name];
          if (theme === 'light' && quiet) {
            const measure = async () => {
              if (quiet.some(([, selector]) => selector.startsWith('.sidebar'))) await openNavigation(page);
              await expectQuietContrast(page, quiet);
            };
            await measure();
            // The same labels in English, measured with no picture: the lane draws Arabic only, contrast is kept in both.
            asAdmin(`update public.people set language='en' where id='${omar}'`);
            try {
              await page.reload();
              await expect(page.locator('html')).toHaveAttribute('lang', 'en');
              await expect(page.locator(screen.ready ?? '.content').first()).toBeVisible();
              await idle(page);
              await measure();
            } finally {
              asAdmin(`update public.people set language='ar' where id='${omar}'`);
            }
          }
        } finally {
          await engine?.close();
          if (state) asAdmin(state.unset);
        }
      });
    }
  });
}
