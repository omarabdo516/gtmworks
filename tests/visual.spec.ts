import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { chooseLanguageInSettings } from './choose-language';
import { execFileSync } from 'node:child_process';
import { signIn, openNavigation } from './sign-in';
import { resetFirstRun } from '../scripts/first-run-db.mjs';
import { idle } from './navigation-measure';
import { languages, widths, screens, snapshotName } from './visual-screens.mjs';
import { appOrigin, lane } from './lane.mjs';
import { asAdmin, holdPages, slowReads } from './slow-reads';
import { fakeHermes } from './fake-hermes.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { appByKey, appConfig } from '../lib/app-catalogue.mjs';

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
async function showWholePage(page: Page, width: number, settle = idle) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const hidden = await page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll('*'))
      .filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.clientHeight > 0)
      .map(element => element.scrollHeight - element.clientHeight)));
    if (hidden <= 1) return;
    await page.setViewportSize({ width, height: Math.min(page.viewportSize()!.height + hidden, 8000) });
    await settle(page);
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

// The states the seed does not hold: first run's two (#9), RS Learning with no answer yet and a new workspace's Lead with
// the Owner's empty Conversation, RS Consultations worked alone (#10), an Agent Lead made (#13) and a rule told to an
// Agent (#18). Each is set up for its own picture and taken away after it, so the seed stays as built.
const leadWelcome = { connection: '64000000-0000-0000-0000-000000000007', agent: '64000000-0000-0000-0000-000000000008', conversation: '64000000-0000-0000-0000-000000000009' };
// Lead and the Meta Ads it made for Omar on June 10 (#13), with the Conversation that made it (tests/visual-screens/made-card.json).
const made = (n: number) => `65000000-0000-0000-0000-00000000000${n}`;
// Ads and the lasting rule Omar told it in its Conversation on June 10 (#18), as agent_save_rule keeps it.
const told = (n: number) => `68000000-0000-0000-0000-00000000000${n}`;
const rule = 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
// Ads and the lasting rule the first Contributor told it on June 10 (#25), kept as a suggestion waiting on the Owner and
// the Manager, as agent_save_rule keeps it.
const suggested = (n: number) => `6a000000-0000-0000-0000-00000000000${n}`;
const suggestedRule = 'من دلوقتي أي إعلان للسعودية يتكتب بلهجة سعودية خفيفة';
// Ads and the campaign plan it showed Omar under its reply on June 10 (#136), as the reference's chooseAngle shows it and
// agent_show_card keeps it.
const drafted = (n: number) => `6d000000-0000-0000-0000-00000000000${n}`;
const plan = { line: 'مسودة · Meta Ads', rows: [['الهدف', 'ليدز على واتساب'], ['الجمهور', 'خريجين تجارة 22–30 · القاهرة والجيزة والإسكندرية'], ['الإعلانات', '3 فيديو + 2 صور'], ['الميزانية', '500 ج يومياً · 15,000 ج للشهر'], ['المتوقع', '26–30 ج لليد']].map(([label, value]) => ({ label, value })) };
// Critic and the review of the December ad texts it showed Omar under its reply on June 10 (#137), as the reference's
// th-team thread shows it (message t5) and agent_show_card keeps it.
const reviewed = (n: number) => `6e000000-0000-0000-0000-00000000000${n}`;
const review = { line: '3 نصوص · Meta Ads · قبل ما تطلع', items: [
  { text: 'من خريج تجارة لمحاسب شغال في 3 شهور', fine: true, note: 'الوعد واضح، ومعانا قصص طلبة تثبته.' },
  { text: 'أضمن طريق لأول وظيفة محاسبة', fine: false, note: '«أضمن» وعد مقدرش نثبته. البديل: «أقصر طريق لأول شغلانة محاسبة».' },
  { text: 'Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج', fine: true, note: 'السعر مطابق لصفحة الكورس.' },
], decision: '2 جاهزين، و1 رجع لـ Ads بالبديل' };
// Ads waiting on Omar's answer to the question it asked with the Engine's clarify tool on June 10 (#138), as the
// reference's th-meta thread shows it (message m3): the Run stays open while it waits, and the card is open.
const questioned = (n: number) => `71000000-0000-0000-0000-00000000000${n}`;
const angle = { question: 'اختار زاوية الإعلان', choices: ['من خريج لمحاسب شغال', 'Excel وOdoo في كورس واحد', 'شهادة معتمدة وتدريب عملي'], multiple: false };
// A state whose rows are append-only (a Conversation's messages) is `admin`: it is set and taken away as the database's
// own administrator with triggers off (asAdmin), so nothing of it stays behind.
// Lead, Meta Ads and SEO in RS Learning, with the switches the screen shows on (#15).
const seen = (n: number) => `68000000-0000-0000-0000-00000000000${n}`;
const general = '69000000-0000-0000-0000-000000000001';
const talk = (n: number) => `69000000-0000-0000-0000-0000000000${n}`;
const busy = (n: number) => `69100000-0000-0000-0000-00000000000${n}`;
const asked = (n: number) => `6b000000-0000-0000-0000-00000000000${n}`;
const askedWith = 'عايز حد يتابع ليدز واتساب ويجهّز رسايل المتابعة، الليدز بتبرد قبل ما حد يرد عليها';
const agentRequest = (answer: 'waiting' | 'made' | 'declined') => ({
  admin: true as const,
  set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
       ('${asked(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-asked-lead','visual-asked-lead','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${asked(2)}','${rsLearning}','${asked(1)}','Lead','General',true);
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${asked(3)}','${rsLearning}','20000000-0000-0000-0000-000000000003','${asked(2)}','Lead','2026-06-10T09:40:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${asked(3)}','person','20000000-0000-0000-0000-000000000003',null,'مراجع','${askedWith}','${asked(4)}','visual-asked','2026-06-10T09:40:00Z'),
       ('${rsLearning}','${asked(3)}','agent',null,'${asked(2)}','Lead','فهمتك. مقدرش أعمل وكلاء غير بطلب من عمر، فجهّزت طلبك زي ما هيبقى بالظبط وبعته له. لسه مفيش وكيل اتعمل، وهقولك هنا أول ما يرد.',null,'visual-asked','2026-06-10T09:41:00Z');
      insert into public.lead_agent_requests(id,company_id,conversation_id,run_id,call_id,asked_by,asked_with,agent_name,job,apps,state,answered_by,answered_at,reason,created_at) overriding system value values
       (9001,'${rsLearning}','${asked(3)}','visual-asked','call-0','20000000-0000-0000-0000-000000000003','${askedWith}','FollowUp','بيفرز الليدز الجديدة، ويكتب رسالة متابعة لكل واحد حسب سؤاله.',array['WhatsApp Business','Google Sheets'],
        '${answer}',${answer === 'waiting' ? 'null,null' : `'20000000-0000-0000-0000-000000000001','2026-06-10T10:05:00Z'`},${answer === 'declined' ? `'Ads بيتابع ليدز واتساب دلوقتي، نجرّبه شهر الأول.'` : 'null'},'2026-06-10T09:41:00Z');
      ${answer === 'made' ? `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
       ('${asked(5)}','${rsLearning}','20000000-0000-0000-0000-000000000003','http://127.0.0.1:9/p/visual-asked-made','visual-asked-made','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,created_at,requested_by,apps) values
       ('${asked(6)}','${rsLearning}','${asked(5)}','FollowUp','بيفرز الليدز الجديدة، ويكتب رسالة متابعة لكل واحد حسب سؤاله.',false,'2026-06-10T10:05:00Z','20000000-0000-0000-0000-000000000003',array['WhatsApp Business','Google Sheets']);
      insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at) values ('${asked(3)}','visual-asked','call-0','${rsLearning}','${asked(6)}','2026-06-10T10:05:00Z');
      insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rsLearning}','20000000-0000-0000-0000-000000000003','${asked(6)}');` : ''}`,
  unset: `delete from public.lead_agent_requests where conversation_id='${asked(3)}';
      delete from public.lead_made_agents where conversation_id='${asked(3)}';
      delete from public.conversation_usage where conversation_id='${asked(3)}';
      delete from public.conversation_messages where conversation_id='${asked(3)}';
      delete from public.conversations where id='${asked(3)}';
      delete from public.member_agent_access where agent_id='${asked(6)}';
      delete from public.hermes_agents where id in ('${asked(2)}','${asked(6)}');
      delete from public.hermes_connections where id in ('${asked(1)}','${asked(5)}');`,
});
// Ads and the Card Omar's chat with it put In progress on June 10 (#144): the chat with its line and its corner pill.
const onBoard = (n: number) => `6d000000-0000-0000-0000-00000000000${n}`;
const onBoardAsk = 'خطة إعلانات Meta لكورس المحاسب الشامل';
// Ads and an idea under it with no chat yet (#145): the Card's sheet opens on the way to start one.
const cardIdea = (n: number) => `6e000000-0000-0000-0000-00000000000${n}`;
// Omar's chat with Ads that opens while its record is slow (#172).
const loading = (n: number) => `6f000000-0000-0000-0000-00000000000${n}`;
// #حملة ديسمبر (#24): the Owner, the Manager and the first Contributor with Meta Ads and SEO, SEO hidden from the
// Contributor everywhere else; the Manager calls SEO there, and wrote once in the general channel.
const team = (n: number) => `6c000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const screenStates: Record<string, { set: string, unset: string, admin?: true }> = {
  'agent-request': agentRequest('waiting'),
  'agent-request-made': agentRequest('made'),
  'agent-request-declined': agentRequest('declined'),
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
  'team-channel': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
       ('${team(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-team-lead','visual-team-lead','visual-no-key','unreachable'),
       ('${team(2)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-team-ads','visual-team-ads','visual-no-key','unreachable'),
       ('${team(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-team-seo','visual-team-seo','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
       ('${team(4)}','${rsLearning}','${team(1)}','Lead','General',true),
       ('${team(5)}','${rsLearning}','${team(2)}','Meta Ads','Runs the Meta ads.',false),
       ('${team(6)}','${rsLearning}','${team(3)}','SEO','Writes the blog.',false);
      insert into public.member_agent_access(company_id,person_id,agent_id) values
       ('${rsLearning}','20000000-0000-0000-0000-000000000002','${team(5)}'),('${rsLearning}','20000000-0000-0000-0000-000000000002','${team(6)}'),
       ('${rsLearning}','20000000-0000-0000-0000-000000000003','${team(5)}');
      insert into public.channels(id,company_id,kind,name,created_by,create_key,created_at) values
       ('${team(7)}','${rsLearning}','team','حملة ديسمبر','20000000-0000-0000-0000-000000000001','${team(8)}','2026-06-10T09:00:00Z');
      insert into public.channel_people(channel_id,company_id,person_id,added_by) select '${team(7)}','${rsLearning}',p,'20000000-0000-0000-0000-000000000001'
       from unnest(array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003']::uuid[]) p;
      insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
       ('${team(7)}','${rsLearning}','${team(5)}','20000000-0000-0000-0000-000000000001'),('${team(7)}','${rsLearning}','${team(6)}','20000000-0000-0000-0000-000000000001');
      insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key,created_at) values
       ('${rsLearning}','${general}','person','20000000-0000-0000-0000-000000000002','مدير','الدفعة الجديدة بتبدأ 1 ديسمبر.','${team(9)}','2026-06-10T09:05:00Z'),
       ('${rsLearning}','${team(7)}','person','20000000-0000-0000-0000-000000000002','مدير','@SEO محتاجين مقال لحملة ديسمبر يودّي على صفحة «المحاسب الشامل».','${team(10)}','2026-06-10T10:31:00Z');
      insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,attempts,attempted_at,run_id,outcome,created_at,closed_at)
       select id,company_id,channel_id,'${team(6)}','SEO','${team(11)}','مدير: '||body,1,'2026-06-10T10:31:00Z','visual-team','completed','2026-06-10T10:31:00Z','2026-06-10T10:32:00Z' from public.channel_messages where send_key='${team(10)}';
      insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to,created_at)
       select company_id,channel_id,'agent','${team(6)}','SEO','بدأت المقال على «كورس محاسب شامل اونلاين»، وهبعته هنا أول ما يخلص.',id,'2026-06-10T10:32:00Z' from public.channel_messages where send_key='${team(10)}';`,
    unset: `delete from public.channel_runs where channel_id='${team(7)}';
      delete from public.channel_messages where channel_id in ('${general}','${team(7)}');
      delete from public.channel_reads where channel_id='${team(7)}';
      update public.channel_reads set read_through=0 where channel_id='${general}';
      delete from public.channel_people where channel_id='${team(7)}';
      delete from public.channel_agents where channel_id='${team(7)}';
      delete from public.channels where id='${team(7)}';
      delete from public.member_agent_access where agent_id in ('${team(5)}','${team(6)}');
      delete from public.hermes_agents where id in ('${team(4)}','${team(5)}','${team(6)}');
      delete from public.hermes_connections where id in ('${team(1)}','${team(2)}','${team(3)}');`,
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
  'draft-shown': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${drafted(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-draft','visual-draft','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${drafted(2)}','${rsLearning}','${drafted(1)}','Ads','Runs the Meta and Google ads.');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${drafted(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${drafted(2)}','Ads','2026-06-10T11:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${drafted(3)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','نمشي بزاوية «من خريج لمحاسب شغال»','${drafted(4)}','visual-draft','2026-06-10T11:00:00Z'),
       ('${rsLearning}','${drafted(3)}','agent',null,'${drafted(2)}','Ads','تمام، دي خطة الحملة بزاوية «من خريج لمحاسب شغال». جهّزت 3 إعلانات فيديو و2 صور في Meta Ads كمسودة، ومحتاج موافقتك قبل ما أطلقها وأبدأ أصرف.',null,'visual-draft','2026-06-10T11:01:00Z');
      insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,created_at) values
       ('${rsLearning}','${drafted(3)}','visual-draft','call-0','draft','خطة الحملة','${JSON.stringify(plan)}','2026-06-10T11:01:00Z');`,
    unset: `delete from public.reply_cards where conversation_id='${drafted(3)}';
      delete from public.conversation_usage where conversation_id='${drafted(3)}';
      delete from public.conversation_messages where conversation_id='${drafted(3)}';
      delete from public.conversations where id='${drafted(3)}';
      delete from public.hermes_agents where id='${drafted(2)}';
      delete from public.hermes_connections where id='${drafted(1)}';`,
  },
  'review-shown': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${reviewed(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-review','visual-review','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${reviewed(2)}','${rsLearning}','${reviewed(1)}','Critic','Reviews every text before it goes out.');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${reviewed(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${reviewed(2)}','Critic','2026-06-10T10:35:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${reviewed(3)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','@Critic راجع نصوص إعلانات ديسمبر قبل ما Ads يرفعها.','${reviewed(4)}','visual-review','2026-06-10T10:35:00Z'),
       ('${rsLearning}','${reviewed(3)}','agent',null,'${reviewed(2)}','Critic','راجعت النصوص التلاتة سطر سطر:',null,'visual-review','2026-06-10T10:36:00Z');
      insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,created_at) values
       ('${rsLearning}','${reviewed(3)}','visual-review','call-0','review','مراجعة نصوص إعلانات ديسمبر','${JSON.stringify(review)}','2026-06-10T10:36:00Z');`,
    unset: `delete from public.reply_cards where conversation_id='${reviewed(3)}';
      delete from public.conversation_usage where conversation_id='${reviewed(3)}';
      delete from public.conversation_messages where conversation_id='${reviewed(3)}';
      delete from public.conversations where id='${reviewed(3)}';
      delete from public.hermes_agents where id='${reviewed(2)}';
      delete from public.hermes_connections where id='${reviewed(1)}';`,
  },
  'question-asked': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${questioned(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-question','visual-question','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${questioned(2)}','${rsLearning}','${questioned(1)}','Ads','Runs the Meta and Google ads.');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${questioned(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${questioned(2)}','Ads','2026-06-10T10:12:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${questioned(3)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','@Ads محتاجين حملة Meta لكورس «المحاسب الشامل». الدفعة الجديدة بتبدأ 1 ديسمبر، والميزانية 15,000 ج للشهر. الهدف ليدز على واتساب.','${questioned(4)}','visual-question','2026-06-10T10:12:00Z');
      insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at) values
       ('${rsLearning}','${questioned(3)}','visual-question','visual-prompt@1','question','${angle.question}','${JSON.stringify(angle)}','open','2026-06-10T10:14:00Z');`,
    unset: `delete from public.reply_cards where conversation_id='${questioned(3)}';
      delete from public.conversation_usage where conversation_id='${questioned(3)}';
      delete from public.conversation_messages where conversation_id='${questioned(3)}';
      delete from public.conversations where id='${questioned(3)}';
      delete from public.hermes_agents where id='${questioned(2)}';
      delete from public.hermes_connections where id='${questioned(1)}';`,
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
  'rule-suggested': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${suggested(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-suggested','visual-suggested','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${suggested(2)}','${rsLearning}','${suggested(1)}','Ads','Runs the Meta and Google ads.');
      insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rsLearning}','20000000-0000-0000-0000-000000000002','${suggested(2)}'),('${rsLearning}','20000000-0000-0000-0000-000000000003','${suggested(2)}');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${suggested(3)}','${rsLearning}','20000000-0000-0000-0000-000000000003','${suggested(2)}','Ads','2026-06-10T09:20:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${suggested(3)}','person','20000000-0000-0000-0000-000000000003',null,'مراجع','${suggestedRule}','${suggested(4)}','visual-suggested','2026-06-10T09:20:00Z'),
       ('${rsLearning}','${suggested(3)}','agent',null,'${suggested(2)}','Ads','تمام، هشتغل كده في شغلي معاك من دلوقتي. وعشان دي حاجة هتمشي على الفريق كله، اقترحتها على عمر ومدير، ولما حد فيهم يوافق هتبقى للكل.',null,'visual-suggested','2026-06-10T09:21:00Z');
      insert into public.agent_rules(id,company_id,agent_id,body,said_by,said_at,conversation_id,run_id,call_id,suggestion) values
       ('${suggested(5)}','${rsLearning}','${suggested(2)}','${suggestedRule}','20000000-0000-0000-0000-000000000003','2026-06-10T09:21:00Z','${suggested(3)}','visual-suggested','call-0','pending');
      insert into public.waiting_items(company_id,person_id,kind,title,body,asked_by,agent_rule_id,created_at) values
       ('${rsLearning}','20000000-0000-0000-0000-000000000001','rule_suggestion','${suggestedRule}','Ads','مراجع','${suggested(5)}','2026-06-10T09:21:00Z'),
       ('${rsLearning}','20000000-0000-0000-0000-000000000002','rule_suggestion','${suggestedRule}','Ads','مراجع','${suggested(5)}','2026-06-10T09:21:00Z');`,
    unset: `delete from public.waiting_items where agent_rule_id='${suggested(5)}';
      delete from public.agent_rules where conversation_id='${suggested(3)}';
      delete from public.conversation_usage where conversation_id='${suggested(3)}';
      delete from public.conversation_messages where conversation_id='${suggested(3)}';
      delete from public.conversations where id='${suggested(3)}';
      delete from public.member_agent_access where agent_id='${suggested(2)}';
      delete from public.hermes_agents where id='${suggested(2)}';
      delete from public.hermes_connections where id='${suggested(1)}';`,
  },
  'card-on-board': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${onBoard(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-on-board','visual-on-board','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${onBoard(2)}','${rsLearning}','${onBoard(1)}','Ads','Runs the Meta and Google ads.');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${onBoard(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${onBoard(2)}','Ads','2026-06-10T10:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${onBoard(3)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','${onBoardAsk}','${onBoard(4)}','visual-on-board','2026-06-10T10:00:00Z'),
       ('${rsLearning}','${onBoard(3)}','agent',null,'${onBoard(2)}','Ads','تمام، هبدأ بالجمهور وبعدها أكتب 3 إعلانات وأبعتهملك تشوفهم.',null,'visual-on-board','2026-06-10T10:01:00Z');
      insert into public.work_cards(id,company_id,stage_id,title,agent_id,conversation_id) overriding system value values
       (692001,'${rsLearning}',(select id from public.work_stages where company_id='${rsLearning}' and board_column='progress' order by position limit 1),'${onBoardAsk}','${onBoard(2)}','${onBoard(3)}');
      insert into public.member_agent_access(company_id,person_id,agent_id) values ('${rsLearning}','20000000-0000-0000-0000-000000000002','${onBoard(2)}');`,
    unset: `delete from public.member_agent_access where agent_id='${onBoard(2)}';
      delete from public.work_card_visits where card_id=692001;
      delete from public.work_cards where id=692001;
      delete from public.conversation_usage where conversation_id='${onBoard(3)}';
      delete from public.conversation_messages where conversation_id='${onBoard(3)}';
      delete from public.conversations where id='${onBoard(3)}';
      delete from public.hermes_agents where id='${onBoard(2)}';
      delete from public.hermes_connections where id='${onBoard(1)}';`,
  },
  'card-chat-empty': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${cardIdea(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-card-idea','visual-card-idea','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${cardIdea(2)}','${rsLearning}','${cardIdea(1)}','Ads','Runs the Meta and Google ads.');
      insert into public.work_cards(id,company_id,stage_id,title,agent_id) overriding system value values
       (692002,'${rsLearning}',(select id from public.work_stages where company_id='${rsLearning}' and board_column='ideas' order by position limit 1),'إعلانات Meta لدفعة ديسمبر','${cardIdea(2)}');`,
    unset: `delete from public.work_card_visits where card_id=692002;
      delete from public.work_cards where id=692002;
      delete from public.hermes_agents where id='${cardIdea(2)}';
      delete from public.hermes_connections where id='${cardIdea(1)}';`,
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
  // The chat and Numbers while their data is on its way (#172): reads only the waiting part makes are slowed, the
  // record's usage for Omar's chat with Ads about the Meta campaign (th-meta), and the log for Numbers' figures.
  'chat-loading': {
    admin: true,
    set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${loading(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-loading','visual-loading','visual-no-key','unreachable');
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${loading(2)}','${rsLearning}','${loading(1)}','Ads','Runs the Meta and Google ads.');
      insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values ('${loading(3)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${loading(2)}','Ads','2026-06-10T10:00:00Z');
      insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
       ('${rsLearning}','${loading(3)}','person','20000000-0000-0000-0000-000000000001',null,'Omar','${onBoardAsk}','${loading(4)}','visual-loading','2026-06-10T10:00:00Z'),
       ('${rsLearning}','${loading(3)}','agent',null,'${loading(2)}','Ads','تمام، هبدأ بالجمهور وبعدها أكتب 3 إعلانات وأبعتهملك تشوفهم.',null,'visual-loading','2026-06-10T10:01:00Z');
      insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,input_tokens,output_tokens,recorded_at) values ('${rsLearning}','${loading(3)}','visual-loading','completed',1200,300,'2026-06-10T10:01:00Z');
      `,
    unset: `delete from public.conversation_usage where conversation_id='${loading(3)}';
      delete from public.conversation_messages where conversation_id='${loading(3)}';
      delete from public.conversations where id='${loading(3)}';
      delete from public.hermes_agents where id='${loading(2)}';
      delete from public.hermes_connections where id='${loading(1)}';`,
  },
};
// The Agent details' Files tab (#21): Meta Ads with a file on its June brief Card and one in Omar's own Conversation with
// it, as the agent-details state holds them, written with triggers off and taken away after.
// Numbers' figures read this week's agent rows of the log; a filter is only weighed on rows the read finds, so the
// slowed log needs one, of an Agent the reader sees, for the figures to wait (#172).
screenStates['numbers-loading'] = {
  admin: true,
  set: `insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${loading(5)}','${rsLearning}','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9/p/visual-numbers','visual-numbers','visual-no-key','unreachable');
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${loading(6)}','${rsLearning}','${loading(5)}','Ads','Runs the Meta and Google ads.');
    insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at) values
     ('${rsLearning}','${loading(6)}','agent','Ads','agent','${loading(6)}','agent_changed','{"agent_name":"Ads"}','hermes_agent_audit',691172,now()-interval '1 hour');`,
  unset: `delete from public.company_log where source='hermes_agent_audit' and source_id=691172;
    delete from public.hermes_agents where id='${loading(6)}';
    delete from public.hermes_connections where id='${loading(5)}';`,
};
screenStates['agent-files'] = {
  admin: true,
  set: `${screenStates['agent-details'].set}
    insert into public.work_cards(id,company_id,stage_id,title,agent_id) overriding system value values (691010,'${rsLearning}',(select id from public.work_stages where company_id='${rsLearning}' order by position limit 1),'June brief','${busy(5)}');
    insert into public.work_comments(id,company_id,card_id,body,author_id) overriding system value values (691011,'${rsLearning}',691010,'The brief','20000000-0000-0000-0000-000000000001');
    insert into public.work_attachments(id,company_id,card_id,comment_id,name,content_type,size,path,created_by,created_at) overriding system value values
     (691012,'${rsLearning}',691010,691011,'brief-june-course.pdf','application/pdf',88064,'${rsLearning}/visual/brief-june-course.pdf','20000000-0000-0000-0000-000000000001','2026-06-10T09:00:00Z');
    insert into public.conversation_attachments(id,company_id,conversation_id,name,content_type,size,path,created_at) overriding system value values
     (691013,'${rsLearning}','${busy(6)}','audiences-june.csv','text/csv',18432,'${rsLearning}/conversations/${busy(6)}/audiences-june.csv','2026-06-12T09:00:00Z');`,
  unset: `delete from public.conversation_attachments where id=691013;
    delete from public.work_attachments where id=691012;
    delete from public.work_comments where id=691011;
    delete from public.work_cards where id=691010;
    ${screenStates['agent-details'].unset}`,
};

// An invitation in the Team table (#185): the visibility state's Agents, and Nour invited as a Contributor with Meta
// Ads switched on. Written as the administrator so the invitation leaves no row in the permanent Company log.
const invited = seen(7);
screenStates.invite = {
  admin: true,
  set: `${screenStates.visibility.set}
    insert into public.member_invitations(id,company_id,email,role,created_at) values ('${invited}','${rsLearning}','nour.hassan@example.com','contributor','2026-06-10T09:00:00Z');
    insert into public.invitation_agent_access(company_id,invitation_id,agent_id) values ('${rsLearning}','${invited}','${seen(5)}');`,
  unset: `delete from public.invitation_agent_access where invitation_id='${invited}';
    delete from public.member_invitations where id='${invited}';
    delete from public.member_agent_access where agent_id in ('${seen(5)}','${seen(6)}');
    ${screenStates.visibility.unset}`,
};

// Settings, Apps (#30) reads the Company's apps from its own profile in the Engine: a fake one, on a loopback address of
// this lane's own, holding Klaviyo connected, Notion needing attention and every other app off. RS Learning gets the
// bundled Connection and the profile record the worker would leave, written with triggers off, and loses them after.
const apps = (n: number) => `6b000000-0000-0000-0000-00000000000${n}`;
async function appsEngine() {
  const fake = await fakeHermes({ host: `127.0.0.${50 + lane}`, managementPort: 9119 });
  const profile = `co-${rsLearning.replaceAll('-', '')}`;
  const installed = (key: string) => ({ url: `https://mcp.${key}.example/mcp`, auth: 'oauth', ...appConfig(appByKey(key)!, `${appOrigin}/api/apps/callback/${key}`).mcp_servers[key] });
  fake.settings.profiles.set(profile, { soul: '', provider: 'auto', model: '', key: fake.settings.key, config: { mcp_servers: { klaviyo: installed('klaviyo'), notion: installed('notion') } }, credentials: {} });
  fake.settings.appTokens.add(`${profile}:klaviyo`);
  const key = encryptSecret(fake.settings.key, process.env.WEBHOOK_ENCRYPTION_KEY || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  const unset = `delete from public.company_profiles where company_id='${rsLearning}';
    delete from public.hermes_agent_audit where agent_id='${apps(2)}';
    delete from public.hermes_agents where id='${apps(2)}';
    delete from public.hermes_connections where id='${apps(1)}';`;
  asAdmin(unset);
  asAdmin(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${apps(1)}','${rsLearning}','20000000-0000-0000-0000-000000000001','${fake.address}','${profile}','${key}','connected');
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('${apps(2)}','${rsLearning}','${apps(1)}','Lead','General',true);
    insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values ('${rsLearning}','20000000-0000-0000-0000-000000000001','${apps(2)}','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','${apps(1)}'));
    insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${rsLearning}';`);
  return async () => { asAdmin(unset); await fake.close(); };
}

// A page whose reads its state slowed (#172), opened from the sidebar of the shown page: its placeholder. Every link
// prefetches its page whole and keeps it (lib/link.tsx), so the shown page is opened again with that page's requests
// held, and they go once the link is clicked. The page is still waiting while it is pictured, so the window is sized
// without waiting for the network to go quiet.
// The table is slowed only once Home is drawn: slowed from the start, Home's prefetch of every page that reads it holds
// a database connection each, and the opened page's own frame then waits behind them.
const openSlowly = (path: string, link: string, placeholder: string, table: string, seconds: number) => async (page: Page) => {
  const held = await holdPages(page, url => url.pathname === path);
  const slow = slowReads(table, seconds);
  const undo = async () => { asAdmin(slow.unset); held.letGo(); await held.stop(); };
  try {
    await page.reload();
    await expect(page.locator('.content').first()).toBeVisible();
    asAdmin(slow.set);
    await openNavigation(page);
    await page.locator(link).click();
    held.letGo();
    // The picture is of the placeholder's look: its first 400ms hidden (components/loading.test.tsx) is ended here.
    await page.locator(placeholder).waitFor({ state: 'attached', timeout: 15000 });
    await page.locator(placeholder).evaluate(element => element.getAnimations().forEach(animation => { if ((animation as CSSAnimation).animationName === 'gw-sk-hold') animation.finish(); }));
    await expect(page.locator(placeholder)).toBeVisible();
    await expect(page.locator('.sidebar.is-open')).toHaveCount(0);
    const width = page.viewportSize()!.width;
    await page.setViewportSize({ width, height: 900 });
    await showWholePage(page, width, shown => shown.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    await fixClockText(page);
    return undo;
  } catch (error) {
    await undo();
    throw error;
  }
};

// What a person does on a shown page to bring up something that does not stay, taken before its picture. Each returns
// what puts the page back.
const screenActs: Record<string, (page: Page, language: Language) => Promise<() => Promise<void>>> = {
  // The board's toast for a drop on "Waiting on you" (#157), raised from the keyboard on the first Idea, focused where it
  // is so a narrow board does not scroll to it. The page's clock stands still from before the toast until after the
  // picture, so the toast cannot leave during it. A Member's own window (`person`) keeps that clock away from every other
  // screen.
  'board-toast': async (page, language) => {
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 1000);
    await page.locator('.col[data-column="ideas"] .kcard a').first().evaluate(link => (link as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press(language === 'ar' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
    await expect(page.locator('.toast')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return () => page.clock.resume();
  },
  // The Team table's invitation form, opened from "Invite a member" with the focus in the email field (#185).
  'invite-open': async page => {
    await page.locator('#inv-toggle').click();
    await expect(page.locator('#inv-email')).toBeFocused();
    return async () => {};
  },
  'open-chat-slowly': openSlowly(`/c/rs-learning/conversations/${loading(3)}`, `#sb-recent a[href="/c/rs-learning/conversations/${loading(3)}"]`, '.chat .transcript [aria-busy="true"]', 'conversation_usage', 7),
  'open-numbers-slowly': openSlowly('/c/rs-learning/numbers', '.nav a[href="/c/rs-learning/numbers"]', '.numbers-page [aria-busy="true"]', 'company_log', 7),
  // Another Member's chat opens its Card on Log (#145); the Chat tab, picked as a person picks it, shows the lock.
  'sheet-chat-tab': async page => {
    await page.locator('.sheet #sh-tab-chat').click();
    await expect(page.locator('.sheet .priv-sheet')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return async () => {};
  },
  // The account menu moved through with the keyboard (#173): Arrow Down from the chosen language shows the next entry's
  // focus ring, kept for the picture. On a phone the account row is inside the drawer.
  'account-menu-keys': async page => {
    await openNavigation(page);
    await page.locator('#btn-me').click();
    await expect(page.locator('#me-menu [aria-checked="true"]').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#me-menu .menu__item:focus-visible')).toHaveCount(1);
    return async () => { await page.keyboard.press('Escape'); };
  },
  // "N" on the board (#173) opens the new chat with its composer focused, kept for the picture.
  'new-chat-key': async page => {
    await page.keyboard.press('KeyN');
    await expect(page).toHaveURL(/\/c\/rs-learning\/chat$/);
    await expect(page.locator('.composer__input')).toBeFocused();
    await idle(page);
    await showWholePage(page, page.viewportSize()!.width);
    return async () => {};
  },
};

async function showScreen(page: Page, screen: (typeof screens)[number], width: number) {
  await page.emulateMedia({ colorScheme: screen.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(screen.path);
  await expect(page.locator(screen.ready ?? '.content').first()).toBeVisible();
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
  // The question and the dialogs cover the window over an inert page: the window keeps its size, as a person sees it.
  if (!['first-run-question', 'ready-roles', 'new-channel'].includes(screen.name.replace('-dark', ''))) await showWholePage(page, width);
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
  // A screen of another Member (`person`) is drawn in their own window, signed in once. Their language is saved to their
  // account as choosing it in their settings does, and put back to the seed's English at the end.
  const others = new Map<string, { context: BrowserContext, page: Page }>();
  const languageOf = (email: string, language: Language) => query(`update public.people set language='${language}' where id=(select id from auth.users where email='${email}')`);
  async function windowOf(browser: import('@playwright/test').Browser, email: string, language: Language) {
    languageOf(email, language);
    if (!others.has(email)) {
      const own = await browser.newContext(contextOptions);
      const opened = { context: own, page: await own.newPage() };
      await signIn(opened.page, email, '/c/rs-learning/home');
      others.set(email, opened);
    }
    return others.get(email)!.page;
  }
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
      for (const [email, other] of others) { languageOf(email, 'en'); await other.context.close(); }
    }
  });

  for (const language of languages as Language[]) for (const width of widths) for (const screen of screens.filter(s => !s.anonymous)) {
    test(`${screen.name} ${language} ${width}`, async ({ browser }) => {
      const person = 'person' in screen && typeof screen.person === 'string' ? screen.person : null;
      if (!person && current !== language) {
        await chooseLanguage(page, language);
        current = language;
      }
      const shown = person ? await windowOf(browser, person, language) : page;
      const state = 'state' in screen && typeof screen.state === 'string' ? screenStates[screen.state] : undefined;
      const write = state?.admin ? asAdmin : query;
      if (state) { write(state.unset); write(state.set); }
      const engine = 'state' in screen && screen.state === 'apps' ? await appsEngine() : undefined;
      const act = 'act' in screen && typeof screen.act === 'string' ? screenActs[screen.act] : undefined;
      let undoAct: (() => Promise<void>) | undefined;
      try {
        await showScreen(shown, screen, width);
        undoAct = await act?.(shown, language);
        if (screen.dark) await expectDarkContrast(shown);
        await expect(shown).toHaveScreenshot(`${snapshotName(screen, language, width)}.png`, { fullPage: true });
        if (!screen.dark && quietText[screen.name]) await expectQuietContrast(shown, quietText[screen.name]);
      } finally {
        await undoAct?.();
        if (state) write(state.unset);
        await engine?.();
      }
    });
  }
});

// Secondary text in the light theme: each quiet label keeps 4.5:1 on what is behind it and stays weaker than the body
// text there. Measured after the picture, on the screens that draw it; on a phone the sidebar's labels are read with the
// drawer open.
const quietText: Record<string, [kind: string, selector: string, pseudo?: string][]> = {
  home: [['chart subtitle', '.home-charts article h2 + span'], ['sidebar heading', '.sidebar .sb-label'], ['account role', '.sidebar .me__role']],
  board: [['toolbar label', '.work-toolbar .tabs a:not(.active), .work-toolbar .tabs button:not(.active)']],
  card: [['comment placeholder', '.modal textarea[name=body]', '::placeholder']],
};
for (const name of Object.keys(quietText)) if (!screens.some(screen => screen.name === name)) throw new Error(`${name}: quiet text is measured only on a compared screen`);

async function expectQuietContrast(page: Page, checks: (typeof quietText)[string]) {
  if (checks.some(([, selector]) => selector.startsWith('.sidebar'))) await openNavigation(page);
  for (const [kind, selector, pseudo] of checks) {
    const found = await textContrast(page, selector, pseudo);
    expect(found.length, `${kind}: nothing to measure`).toBeGreaterThan(0);
    for (const item of found) {
      expect(item.secondary, `${kind} "${item.text}"`).toBeGreaterThanOrEqual(4.5);
      expect(item.secondary, `${kind} "${item.text}" must stay weaker than body text`).toBeLessThan(item.body);
    }
  }
}

// Contrast is computed from what the browser draws: the text color (with its own opacity and its parents' opacity) laid over
// the background colors stacked behind it, so a faded copy of a darker color is measured as faded.
async function textContrast(page: Page, selector: string, pseudo?: string) {
  return page.evaluate(({ selector, pseudo }) => {
    const context = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = '#000'; context.fillStyle = css; context.fillRect(0, 0, 1, 1); const d = context.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top: number[], below: number[]) => [0, 1, 2].map(i => top[i] * top[3] + below[i] * (1 - top[3]));
    const light = (color: number[]) => { const [r, g, b] = color.slice(0, 3).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: number[], b: number[]) => { const [x, y] = [light(a), light(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const bodyColor = rgba(getComputedStyle(document.body).color);
    return Array.from(document.querySelectorAll(selector)).filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'; }).map(element => {
      let background = [255, 255, 255];
      const chain: Element[] = []; let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) { chain.unshift(node); opacity *= Number(getComputedStyle(node).opacity); }
      for (const node of chain) background = over(rgba(getComputedStyle(node).backgroundColor), background);
      const style = getComputedStyle(element, pseudo);
      const color = rgba(style.color);
      const shown = over([color[0], color[1], color[2], color[3] * opacity * (pseudo ? Number(style.opacity) : 1)], background);
      const body = over([bodyColor[0], bodyColor[1], bodyColor[2], bodyColor[3]], background);
      return { text: (element.textContent || (element as HTMLTextAreaElement).placeholder || '').trim(), secondary: ratio(shown, background), body: ratio(body, background) };
    });
  }, { selector, pseudo });
}

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
