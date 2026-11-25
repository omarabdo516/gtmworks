import { test, expect, type Page } from './fresh-seed';
import { signIn, openNavigation } from './sign-in';
import { idle } from './navigation-measure';
import { asAdmin } from './slow-reads';
import { laneHermes } from './lane-hermes';
import { toolConfig } from '../lib/agent-toolsets.mjs';
import { expectDarkContrast, expectQuietContrast, type QuietCheck } from './contrast';

// Text contrast on the key screens, measured from the styles the browser draws with, never from a picture (#805): every
// visible text run keeps 4.5:1 in the dark theme, in Arabic and English at 1440 and 390, and the quiet labels of Home, the
// board and a Card keep 4.5:1 and stay weaker than the body text in the light theme. These checks and the screens' states
// were the visual lane's (#257); the lane went, and contrast checks never go away (#218). First run's form is measured in
// first-run.spec.ts, which owns the empty install.
const rsLearning = '10000000-0000-0000-0000-000000000001';
const omar = '20000000-0000-0000-0000-000000000001';

// The states the seed does not hold, written as the database's administrator with triggers off (their rows are
// append-only) and taken away after each screen. Every time is fixed, so no screen depends on the day it is read.
const general = '69000000-0000-0000-0000-000000000001';
const talk = (n: number) => `69000000-0000-0000-0000-0000000000${n}`;
const busy = (n: number) => `69100000-0000-0000-0000-00000000000${n}`;
const change = (n: number) => `69200000-0000-0000-0000-00000000000${n}`;
const routine = (n: number) => `69300000-0000-0000-0000-00000000000${n}`;
const ownProfile = (agent: string) => `ag-${agent.replaceAll('-', '')}`;
const companyProfile = `co-${rsLearning.replaceAll('-', '')}`;
// A screen's Agents are written with triggers off, so none is given its look as a made Agent is (#696): each is given it
// here, as the trigger would, so every screen draws the Agents in their own looks, never the plain look of one with none.
const givenLooks = `select public.give_agent_look(a.company_id,a.id,a.is_default,a.template) from public.hermes_agents a
  where not exists(select 1 from public.agent_looks l where l.agent_id=a.id) order by a.created_at,a.id;`;
// A Routine as the fake Engine keeps it (#31): no zone of its own, so it reads in UTC, and its next and last runs are
// tomorrow and yesterday at fixed hours of the server's own clock, which draws the page.
const day = (offset: number, hour: number) => `${new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const routineJob = (id: string, name: string, expr: string, extra: object = {}) => ({ id, name, prompt: name, skills: [], skill: null, schedule: { kind: 'cron', expr, display: expr },
  schedule_display: expr, repeat: { times: null, completed: 0 }, enabled: true, state: 'scheduled', paused_at: null, created_at: '2026-06-01T08:00:00Z', next_run_at: day(1, Number(expr.split(' ')[1]) || 9),
  last_run_at: null, last_status: null, last_error: null, deliver: 'local', origin: null, ...extra });
const standing = (n: number) => `69400000-0000-0000-0000-00000000000${n}`;
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
  // Meta Ads's page in Settings: Lead's proposal of a faster model for it waiting on Omar's OK (#178), and after Tools the
  // one standing permission Omar gave it (#166), Always allow on the Meta Ads app's create_campaign, kept in Meta Ads's
  // own profile in the Engine. One screen holds both. The June campaign's Run and the Run in which
  // Lead proposed are over, so both Agents are idle (#572, #641).
  'settings-proposal': {
    set: `      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
       ('${standing(1)}','${rsLearning}','${standing(5)}','Lead','General',true,'visual-standing-lead'),
       ('${standing(2)}','${rsLearning}','${standing(6)}','Meta Ads','Runs the Meta ads and asks before it publishes or spends.',false,'ag-${standing(2).replaceAll('-', '')}');
      insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${standing(2)}','${rsLearning}',true);
      insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${rsLearning}','co-${rsLearning.replaceAll('-', '')}',true)
       on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
      insert into public.company_profile_keepers(company_id,agent_id) values ('${rsLearning}','${standing(1)}') on conflict (company_id) do update set agent_id=excluded.agent_id;
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${standing(3)}','${rsLearning}','${omar}','${standing(2)}','Meta Ads','2026-06-15T11:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${standing(3)}','person','${omar}','عمر','اطلق حملة يونيو','${standing(4)}','visual-standing','2026-06-15T11:00:00Z');
      insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,decided_by,decided_at,allows,created_at) values
       ('${rsLearning}','${standing(3)}','visual-standing','visual-standing-1','permission','Launch the campaign',
        '{"description":"Launch the campaign","command":"create_campaign","choices":["once","always","deny"],"choice":"always"}','decided','${omar}','2026-06-15T11:01:00Z',
        '{mcp:meta-ads/create_campaign}','2026-06-15T11:00:30Z');
      insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome,recorded_at) values
       ('${rsLearning}','${standing(3)}','visual-standing','completed','2026-06-15T11:02:00Z');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${standing(7)}','${rsLearning}','${omar}','${standing(1)}','Lead','2026-06-10T11:26:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${standing(7)}','person','${omar}',null,'عمر','حملة يونيو بطيئة في التقارير.','${standing(8)}','visual-standing-change','2026-06-10T11:26:00Z');
      insert into public.agent_change_proposals(company_id,conversation_id,run_id,call_id,agent_id,proposed_by,asked_by,change,value,reason,created_at) values
       ('${rsLearning}','${standing(7)}','visual-standing-change','call-0','${standing(2)}','${standing(1)}','${omar}','model','"google/gemini-2.5-pro"',
        'التقارير بتقرا أرقام كتير وبتتأخر عن ميعادها. Gemini 2.5 Pro أسرع في الأرقام الكبيرة.','2026-06-10T11:30:00Z');
      insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome,recorded_at) values
       ('${rsLearning}','${standing(7)}','visual-standing-change','completed','2026-06-10T11:30:00Z');`,
    unset: `delete from public.agent_change_proposals where conversation_id='${standing(7)}';
      delete from public.reply_cards where conversation_id='${standing(3)}';
      delete from public.conversation_run_ends where conversation_id in ('${standing(3)}','${standing(7)}');
      delete from public.conversation_messages where conversation_id in ('${standing(3)}','${standing(7)}');
      delete from public.conversations where id in ('${standing(3)}','${standing(7)}');
      delete from public.agent_profiles where agent_id='${standing(2)}';
      delete from public.company_profile_keepers where agent_id='${standing(1)}';
      delete from public.hermes_agents where id in ('${standing(1)}','${standing(2)}');`,
    engine: fake => { fake.settings.profiles.set(`ag-${standing(2).replaceAll('-', '')}`, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: { command_allowlist: ['mcp:meta-ads/create_campaign'] }, credentials: {} }); },
  },
};

type Screen = { name: string, path: string, ready: string, state?: string, quiet?: QuietCheck[] };
const screens: Screen[] = [
  { name: 'home', path: '/c/rs-learning/home', ready: '.home-dashboard', state: 'agent-details', quiet: [['chart subtitle', '.home-charts article h2 + span'], ['sidebar heading', '.sidebar .sb-label'], ['account role', '.sidebar .me__role']] },
  { name: 'board', path: '/c/rs-learning/work/board', ready: '.board', quiet: [['toolbar label', '.work-toolbar .tabs a:not(.active), .work-toolbar .tabs button:not(.active)']] },
  { name: 'card', path: '/c/rs-learning/work/board/1', ready: '.cw[open]', quiet: [['comment placeholder', '.cw[open] textarea[name=body]', '::placeholder']] },
  { name: 'chat', path: '/c/rs-learning/chat', ready: '.chat' },
  { name: 'channel', path: `/c/rs-learning/channels/${general}`, ready: '.ch-intro', state: 'channel' },
  { name: 'agents', path: '/c/rs-learning/agents', ready: '.company-hermes-agents' },
  { name: 'agent-details', path: `/c/rs-learning/chat/${busy(5)}`, ready: '.chat', state: 'agent-details' },
  { name: 'members', path: '/c/rs-learning/settings/members', ready: '.member-row' },
  { name: 'numbers', path: '/c/rs-learning/numbers', ready: '.numbers-page' },
  { name: 'approvals', path: '/c/rs-learning/approvals', ready: '.approvals' },
  { name: 'change-proposal', path: `/c/rs-learning/conversations/${change(3)}`, ready: '.chg-card', state: 'change-proposal' },
  { name: 'routines', path: '/c/rs-learning/settings?section=routines', ready: '.rt-row', state: 'routines' },
  { name: 'settings-proposal', path: `/c/rs-learning/settings?agent=${standing(2)}`, ready: '.sov-pend', state: 'settings-proposal' },
];
for (const screen of screens) if (screen.state && !screenStates[screen.state]) throw new Error(`${screen.name}: no state "${screen.state}"`);
const widths = [1440, 390];
const languages = ['ar', 'en'] as const;

async function open(page: Page, path: string, ready: string, language: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator(ready).first()).toBeVisible();
  await idle(page);
}

test.afterAll(() => asAdmin(`update public.people set language='en' where id='${omar}'`));

for (const language of languages) {
  test(`every key screen keeps its text at 4.5:1 in ${language}, dark and light`, async ({ page }) => {
    test.setTimeout(300000);
    asAdmin(`update public.people set language='${language}' where id='${omar}'`);
    await signIn(page, 'omar@example.com', '/c/rs-learning/home');
    for (const screen of screens) {
      await test.step(screen.name, async () => {
        // A screen whose data the seed does not hold writes it first, and one whose data the Engine holds reads it from a
        // fake Engine made for this screen alone.
        const state = screen.state ? screenStates[screen.state] : undefined;
        if (state) { asAdmin(state.unset); asAdmin(state.set); asAdmin(givenLooks); }
        const engine = state?.engine ? await laneHermes() : null;
        if (engine) state!.engine!(engine);
        try {
          for (const width of widths) {
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme: 'dark' });
            await open(page, screen.path, screen.ready, language);
            await expectDarkContrast(page);
            if (!screen.quiet) continue;
            await page.emulateMedia({ colorScheme: 'light' });
            await open(page, screen.path, screen.ready, language);
            if (screen.quiet.some(([, selector]) => selector.startsWith('.sidebar'))) await openNavigation(page);
            await expectQuietContrast(page, screen.quiet);
          }
        } finally {
          await engine?.close();
          if (state) asAdmin(state.unset);
        }
      });
    }
  });
}

test('the sign-in page keeps its text at 4.5:1 in the dark theme, in Arabic and English at 1440 and 390', async ({ page }) => {
  for (const language of languages) for (const width of widths) {
    await test.step(`${language} ${width}`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/sign-in');
      await page.locator('select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('input[name=email]')).toBeVisible();
      await idle(page);
      await expectDarkContrast(page);
    });
  }
});
