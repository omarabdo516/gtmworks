/* gtmworks prototype — state, rendering and interactions (no build step). */
(() => {
'use strict';

/* ================= interface language =================
   English is the default interface; Arabic is an option. Chats with the agents stay Arabic either way.
   Switching language reloads the prototype, the way most products apply a language change. */
const LANG = (() => {
  try { const q = new URLSearchParams(window.location.search).get('lang'); if (q === 'ar' || q === 'en') return q; } catch (err) { /* no query */ }
  try { return localStorage.getItem('gtm-lang') === 'ar' ? 'ar' : 'en'; } catch (err) { return 'en'; }
})();
const RTL = LANG === 'ar';
const lng = (ar, en) => (RTL ? ar : en);
document.documentElement.lang = LANG;
document.documentElement.dir = RTL ? 'rtl' : 'ltr';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
/* escape + isolate every Latin run (Ads, Meta, GA4 …) in <bdi> so it sits right next to the Arabic */
const LATIN = /@[A-Za-z][A-Za-z0-9]*|[A-Za-z](?:[A-Za-z0-9+&\-]|\.(?=[A-Za-z0-9]))*(?:[ \u00a0](?:&[ \u00a0])?[A-Za-z0-9](?:[A-Za-z0-9+&\-]|\.(?=[A-Za-z0-9]))*)*/g;
/* no orphans: glue the last word to the one before it (and the one before that when the last is tiny, like «ج») */
function nb(str) {
  if (str.indexOf('\n') >= 0 || str.split(' ').length < 4) return str;
  const glue = (x) => { const i = x.lastIndexOf(' '); return i > 0 ? x.slice(0, i) + '\u00a0' + x.slice(i + 1) : x; };
  const last = str.slice(str.lastIndexOf(' ') + 1);
  const once = glue(str);
  return last.length <= 3 ? glue(once) : once;
}
/* In the English interface, a line that starts in English keeps English as its base and isolates the
   Arabic it quotes (card titles, ad copy) instead; Arabic lines keep the Latin-run isolation above. */
const AR_RUN = /[\u0600-\u06FF][^A-Za-z“”"]*/g;
const MENTION = /@[A-Za-z][A-Za-z0-9]*/g;
const latinFirst = (s) => { const m = s.replace(MENTION, '').match(/[A-Za-z\u0600-\u06FF]/); return !!m && /[A-Za-z]/.test(m[0]); };
function bxLtr(s) {
  const plain = (x) => esc(x).replace(MENTION, (m) => `<bdi class="mention">${m}</bdi>`);
  let out = ''; let last = 0;
  s.replace(AR_RUN, (m, off) => {
    const core = m.replace(/[^\u0600-\u06FF0-9»)]+$/, '');
    out += plain(s.slice(last, off)) + `<bdi dir="rtl">${esc(core)}</bdi>`;
    last = off + core.length; return m;
  });
  return (out + plain(s.slice(last))).replace(/(\d|×) ج(?=$|[\s\u00a0.,،)<])/g, '$1\u00a0ج');
}
function bx(raw) {
  const s = nb(String(raw == null ? '' : raw));
  if (!RTL && latinFirst(s)) return bxLtr(s);
  let out = ''; let last = 0;
  s.replace(LATIN, (m, off) => {
    out += esc(s.slice(last, off));
    out += m[0] === '@' ? `<bdi class="mention">${esc(m)}</bdi>` : `<bdi>${esc(m)}</bdi>`;
    last = off + m.length; return m;
  });
  return (out + esc(s.slice(last))).replace(/(\d|×) ج(?=$|[\s\u00a0.,،)])/g, '$1\u00a0ج');
}
const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!(mq && mq.matches);
const overlayDetails = () => window.matchMedia('(max-width: 1023px)').matches;
const fmt = (n) => Number(n).toLocaleString('en-US');
const fmt1 = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
let uid = 100;
const nid = (p) => `${p}-${++uid}`;
const nowTime = () => {
  const d = new Date();
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const pm = h >= 12; h = h % 12 || 12;
  return `${h}:${m} ${pm ? lng('م', 'PM') : lng('ص', 'AM')}`;
};
const later = (ms, fn) => window.setTimeout(fn, reduced() ? Math.min(ms, 120) : ms);

/* ================= icons (one stroke family) ================= */
const ICONS = {
  hash: '<path d="M9.5 4L8 20M16 4l-1.5 16M4.5 9h15.5M4 15h15.5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4.5V9h4.5"/><path d="M12 8v4.5l3 2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  chat: '<path d="M4 5.5h16v10.5H9l-5 4z"/>',
  board: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10.5" y="4" width="5" height="10" rx="1.5"/><rect x="17.5" y="4" width="3.5" height="13" rx="1.5"/>',
  chart: '<path d="M4 20h17"/><path d="M6.5 16v-5"/><path d="M11.5 16V6"/><path d="M16.5 16v-8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  chevron: '<path d="M15 6l-6 6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  up: '<path d="M7 14l5-5 5 5"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  compose: '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  clip: '<path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/>',
  at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7"/>',
  slash: '<path d="M15 4L9 20"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 2.5v3M14 2.5v3M10 18.5v3M14 18.5v3M2.5 10h3M2.5 14h3M18.5 10h3M18.5 14h3"/>',
  hand: '<path d="M8 11.5V6a1.5 1.5 0 0 1 3 0v5"/><path d="M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v5.5"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.7-2.3l-3.3-4.2a1.6 1.6 0 0 1 2.4-2.1L8 13.8"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  team: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M16.2 14.6a4.5 4.5 0 0 1 4.3 4.4"/>',
  arrow: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  arrowLtr: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  review: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 14.5l2 2 3.5-4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  stopFill: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  plug: '<path d="M9 3.5v4.5M15 3.5v4.5"/><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v3.5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.75"/><path d="M20.5 15.5l-5-5-9 9"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
};
/* left-to-right interface: directional glyphs point the other way */
const FLIP = { chevron: 'chevronRight', chevronRight: 'chevron', arrow: 'arrowLtr' };
const icon = (n0, cls = '') => { const n = (!RTL && FLIP[n0]) || n0; return `<svg class="od-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>` };

/* ================= agents & faces ================= */
const AGENT_ORDER = ['lead', 'ads', 'seo', 'analyst', 'critic'];
const AGENTS = {
  /* the company's main agent (الرئيسي): the front door. It greets each member, hands work to the right agent
     inside the same chat, and prepares new-agent proposals for the Owner. Which agent is main lives in state.main. */
  lead: {
    name: 'Lead', handle: '@Lead', role: lng('منسّق التسويق', 'Marketing lead'),
    desc: lng('نقطة التواصل الأساسية للفريق. بيبعت صباح الخير، بيتابع اللي مستني كل واحد، وبيسلّم الشغل للوكيل المناسب في نفس المحادثة.', 'The team’s main point of contact. Sends the good-morning message, follows what is waiting on each person, and hands work to the right agent in the same chat.'),
    conns: ['sheets'],
    routines: [
      { t: 'متابعة الكروت اللي واقفة', d: 'كل يوم 4:00 العصر', on: true, sched: { kind: 'daily', h: 16, m: 0 } },
    ],
    files: [{ n: 'مين-بيعمل-إيه.pdf', d: lng('86 KB · من عمر', '86 KB · from Omar') }],
    perms: [],
  },
  ads: {
    name: 'Ads', handle: '@Ads', role: lng('وكيل الإعلانات', 'Ads agent'),
    desc: lng('بيخطط ويطلق ويتابع حملات Meta وGoogle. بيستأذنك قبل أي صرف أو إطلاق.', 'Plans, launches and monitors Meta and Google campaigns. Asks you before any spend or launch.'),
    conns: ['meta', 'gads', 'ga4', 'tiktok'],
    routines: [
      { t: 'متابعة أداء الحملات', d: 'كل يوم 9:00 الصبح', on: true, sched: { kind: 'daily', h: 9, m: 0 } },
      { t: 'وقف الإعلان لو تكلفة الليد عدّت 45 ج', d: 'أول ما يحصل', on: true, sched: { kind: 'trigger' } },
      { t: 'ملخص الصرف الأسبوعي', d: 'كل سبت 10:00 الصبح', on: false, sched: { kind: 'weekly', dow: 6, h: 10, m: 0 } },
    ],
    files: [
      { n: 'brief-المحاسب-الشامل.pdf', d: lng('240 KB · من سارة', '240 KB · from Sara') },
      { n: 'audiences-oct.csv', d: '18 KB · Meta Ads' },
      { n: 'creatives-dec-v2.zip', d: lng('12.4 MB · 5 إعلانات', '12.4 MB · 5 ads') },
    ],
    perms: [],
  },
  seo: {
    name: 'SEO & Content', handle: '@SEO', role: lng('وكيل المحتوى والسيو', 'Content & SEO agent'),
    desc: lng('بيبحث عن الكلمات، بيكتب المقالات والإيميلات، وبيبعت كل حاجة للمراجع قبل النشر.', 'Researches keywords, writes articles and emails, and sends everything to the reviewer before publishing.'),
    conns: ['gsc', 'wp', 'ga4', 'canva'],
    routines: [
      { t: 'بحث كلمات جديدة', d: 'كل اتنين 11:00 الصبح', on: true, sched: { kind: 'weekly', dow: 1, h: 11, m: 0 } },
      { t: 'تحديث المقالات اللي ترتيبها نزل', d: 'كل أسبوعين', on: true, sched: { kind: 'biweekly', dow: 1, h: 10, m: 0 } },
    ],
    files: [
      { n: 'keywords-accounting-nov.csv', d: '32 KB · Search Console' },
      { n: 'مقال-كورس-محاسبة-اونلاين.docx', d: lng('1,850 كلمة', '1,850 words') },
    ],
    perms: [],
  },
  analyst: {
    name: 'Analyst', handle: '@Analyst', role: lng('المحلل', 'Analyst'),
    desc: lng('بيقرا الأرقام بس، مبيغيّرش أي حاجة. بيكتب التقرير الأسبوعي وبينبّهك لو حاجة غريبة حصلت.', 'Reads the numbers only and never changes anything. Writes the weekly report and flags anything unusual.'),
    conns: ['meta', 'gads', 'ga4', 'sheets'],
    routines: [
      { t: 'التقرير الأسبوعي', d: 'كل خميس 4:00 العصر', on: true, sched: { kind: 'weekly', dow: 4, h: 16, m: 0 } },
      { t: 'تنبيه لو الليدز قلّت 30% عن المتوسط', d: 'كل ساعة', on: true, sched: { kind: 'hourly' } },
    ],
    files: [
      { n: 'weekly-report-28oct-3nov.pdf', d: '410 KB' },
      { n: 'leads-by-hour.xlsx', d: '64 KB · Google Sheets' },
    ],
    perms: [],
  },
  critic: {
    name: 'Critic', handle: '@Critic', role: lng('المراجع', 'Reviewer'),
    desc: lng('بيراجع أي إعلان أو مقال قبل ما يطلع: الوعود المبالغ فيها، الأرقام، واللهجة.', 'Reviews every ad or article before it goes out: overpromises, numbers and tone.'),
    conns: [],
    routines: [{ t: 'مراجعة أي نص قبل النشر', d: 'تلقائي', on: true, sched: { kind: 'auto' } }],
    files: [{ n: 'دليل-صوت-الأكاديمية.pdf', d: '1.1 MB' }],
    perms: [],
  },
};
/* setup (gear view) + memory: per agent, demo content for RS Learning */
const EFFORTS = [
  { k: 'low', l: lng('قليل', 'Low'), h: lng('أسرع وأرخص. كويس للردود القصيرة والمهام اللي بتتكرر.', 'Faster and cheaper. Good for short replies and repeat tasks.') },
  { k: 'medium', l: lng('متوسط', 'Medium'), h: lng('توازن كويس لمعظم الشغل اليومي.', 'A good balance for most daily work.') },
  { k: 'high', l: lng('عالي', 'High'), h: lng('بياخد وقت أطول ويفكر أعمق. مناسب للخطط وتوزيع الميزانيات.', 'Takes longer and thinks deeper. Right for plans and budget splits.') },
  { k: 'max', l: lng('أقصى', 'Max'), h: lng('أبطأ وأغلى مستوى. للقرارات الكبيرة زي خطة الربع كله.', 'The slowest, most expensive level. For big calls like a full quarter plan.') },
];
const INSTR_MAX = 8000;
const INSTR_PH = {
  lead: 'مثلاً: سلّم أسئلة الميزانية لـ Ads على طول، وابعتلي ملخص آخر اليوم 6 بالليل.',
  ads: 'مثلاً: خلّي التحديثات 3 نقط بس. ماتعليش ميزانية أي حملة فوق 500 ج في اليوم من غير ما تسألني.',
  seo: 'مثلاً: ابدأ كل مقال بإجابة السؤال في أول فقرة. ماتبعتش مقال للنشر قبل ما Critic يراجعه.',
  analyst: 'مثلاً: ابدأ التقرير بالخلاصة في 3 نقط، وقارن دايماً بنفس الفترة اللي قبلها.',
  critic: 'مثلاً: علّق على كل سطر لوحده، واقترح البديل جنب كل ملاحظة.',
};
const VOICE_SAMPLE = {
  lead: 'مين مستني إيه النهارده، وفيه حاجة واقفة عندي؟',
  ads: 'عايز أعرف ليه تكلفة الليد في Google زادت الأسبوع ده، وإيه اللي نعمله قبل الدفعة الجديدة',
  seo: 'اقترح عليا 3 مقالات عن دبلومة الضرائب نكتبهم الشهر ده',
  analyst: 'ابعتلي ملخص آخر 7 أيام لكل القنوات',
  critic: 'راجع نص إعلان الريلز الجديد قبل ما يتنشر',
};
/* voice: Egyptian Arabic first (dictation + spoken replies are simulated in the prototype) */
const VOICE_LANGS = [['ar-EG', lng('عربي (مصر)', 'Arabic (Egypt)')], ['ar-SA', lng('عربي (السعودية)', 'Arabic (Saudi Arabia)')], ['ar-AE', lng('عربي (الإمارات)', 'Arabic (UAE)')], ['en', 'English']];
const langName = (k) => (VOICE_LANGS.find((l) => l[0] === k) || VOICE_LANGS[0])[1];
const VOICES = [
  { k: 'karim', n: lng('كريم', 'Karim'), d: lng('صوت رجالي هادي', 'Calm male voice') },
  { k: 'noor', n: lng('نور', 'Nour'), d: lng('صوت ستاتي واضح', 'Clear female voice') },
  { k: 'yassin', n: lng('ياسين', 'Yassin'), d: lng('صوت رجالي سريع شوية', 'Slightly faster male voice') },
  { k: 'laila', n: lng('ليلى', 'Laila'), d: lng('صوت ستاتي دافي', 'Warm female voice') },
  { k: 'salma', n: lng('سلمى', 'Salma'), d: lng('صوت ستاتي رسمي شوية', 'Slightly formal female voice') },
];
const SPEEDS = ['0.7', '0.85', '1', '1.25', '1.5'];
const DICT_SAMPLE = {
  'ar-SA': 'أبغى أعرف ليش تكلفة الليد في Google زادت هالأسبوع، وش نسوي قبل الدفعة الجديدة',
  'ar-AE': 'أبا أعرف شو صار في تكلفة الليد في Google هالأسبوع، وشو نسوي قبل الدفعة الياية',
  en: 'Why did the cost per lead on Google go up this week, and what should we do before the new cohort?',
};
const TEAM_SAMPLE = 'خلّي Ads يكتب نصين للرياض بلهجة سعودية، وCritic يراجعهم قبل ما يطلعوا';
const VOICE_PREVIEW = {
  'ar-EG': 'أهلاً يا سارة، خلصت تحليل حملة ديسمبر وعندي تلات زوايا جديدة.',
  'ar-SA': 'هلا سارة، خلصت تحليل حملة ديسمبر وعندي ثلاث زوايا جديدة.',
  'ar-AE': 'هلا سارة، خلّصت تحليل حملة ديسمبر وعندي ثلاث أفكار يديدة.',
  en: 'Hi Sara, I finished the December campaign analysis and I have three new angles.',
};
let memSeq = 0;
const mem = (g, src, t, from) => ({ id: `mem-${++memSeq}`, g, src, t, from });
Object.assign(AGENTS.ads, {
  model: 'Opus 5.5', effort: 'high', instr: '', paused: false,
  checkinOn: true, checkinTime: '9:00',
  skills: [
    { t: lng('نصوص إعلانات بالعامية', 'Colloquial ad copy'), d: lng('Meta وGoogle، بلهجة مصر أو السعودية حسب الجمهور', 'Meta and Google, in Egyptian or Saudi dialect depending on the audience'), on: true },
    { t: lng('توزيع الميزانية على الأيام', 'Daily budget pacing'), d: lng('بيقسّم ميزانية الشهر حسب أحسن ساعات الليدز', 'Splits the monthly budget across the best lead hours'), on: true },
    { t: lng('إعادة استهداف زوار الصفحة', 'Page-visitor retargeting'), d: lng('جمهور زوار صفحة الكورس آخر 30 يوم', 'Audience of course-page visitors in the last 30 days'), on: true },
    { t: lng('مقارنة إعلانين قصاد بعض', 'A/B ad tests'), d: lng('بيشغّل الاتنين لحد 7 أيام وبعدين يكمّل بالأرخص', 'Runs both for up to 7 days, then keeps the cheaper one'), on: false },
  ],
  memory: [
    mem('voice', 'told', 'إعلانات مصر بالعامية المصرية، وإعلانات الرياض وجدة بلهجة سعودية خفيفة.', lng('سارة · 28 أكتوبر', 'Sara · Oct 28')),
    mem('voice', 'told', 'اسم RS Learning بيتكتب بالإنجليزي دايماً، من غير ترجمة.', lng('سارة · 28 أكتوبر', 'Sara · Oct 28')),
    mem('voice', 'told', 'مفيش علامات تعجب ولا إيموجي في نص الإعلان.', lng('سارة · 2 نوفمبر', 'Sara · Nov 2')),
    mem('audience', 'learned', 'أحسن جمهور للمحاسب الشامل: خريجين تجارة 22–30 سنة في القاهرة والجيزة والإسكندرية، بـ 27 ج لليد.', lng('من حملات أغسطس–أكتوبر', 'From Aug–Oct campaigns')),
    mem('audience', 'learned', 'جمهور الرياض بيرد على «شهادة معتمدة» أكتر من «أول شغلانة بسرعة».', lng('من حملة سبتمبر', 'From the September campaign')),
    mem('audience', 'learned', '38% من ليدز Google بتيجي بعد 10 بالليل.', lng('من Analyst · النهارده', 'From Analyst · Today')),
    mem('banned', 'told', '«شغل مضمون» أو «وظيفة مضمونة 100%»: وعد مقدرش نثبته.', lng('سارة · 30 أكتوبر', 'Sara · Oct 30')),
    mem('banned', 'learned', '«أرخص كورس في مصر»: مفيش مصدر للمقارنة.', lng('من مراجعة Critic · امبارح', 'From a Critic review · Yesterday')),
    mem('banned', 'told', 'مانذكرش أسماء شركات بتوظّف خريجينا من غير إذن مكتوب منهم.', lng('سارة · 5 نوفمبر', 'Sara · Nov 5')),
    mem('lessons', 'learned', 'الفيديو القصير جاب ليدز أرخص بـ 22% من الصور.', lng('من حملات أغسطس–أكتوبر', 'From Aug–Oct campaigns')),
    mem('lessons', 'learned', 'وقف أي إعلان تكلفة الليد فيه عدّت 45 ج وفّر 1,240 ج الأسبوع اللي فات.', lng('من روتين المتابعة · الاثنين', 'From the monitoring routine · Monday')),
    mem('lessons', 'learned', 'إعادة الاستهداف بـ 250 ج في اليوم كفاية. أكتر من كده الإعلان بيتكرر على نفس الناس.', lng('من حملة أكتوبر', 'From the October campaign')),
  ],
});
Object.assign(AGENTS.seo, {
  model: 'Opus 5.5', effort: 'medium', paused: false,
  instr: 'ابدأ كل مقال بإجابة السؤال في أول فقرة، وبعدين التفاصيل.\nأي رقم عن الرواتب أو الوظايف لازم يكون له مصدر.\nماتبعتش مقال للنشر قبل ما Critic يراجعه.',
  skills: [
    { t: lng('بحث الكلمات المفتاحية', 'Keyword research'), d: lng('من Search Console ومقالات المنافسين', 'From Search Console and competitor articles'), on: true },
    { t: lng('مقالات طويلة 1,500+ كلمة', 'Long-form articles, 1,500+ words'), d: lng('عناوين فرعية وأسئلة شائعة وروابط داخلية', 'Subheadings, FAQs and internal links'), on: true },
    { t: lng('تحديث المقالات القديمة', 'Refreshing old articles'), d: lng('لما الترتيب ينزل أكتر من 3 مراكز', 'When rankings drop by more than 3 positions'), on: true },
    { t: lng('إيميلات المشتركين', 'Subscriber emails'), d: lng('نشرة أسبوعية لقايمة المشتركين القدام', 'Weekly newsletter for the existing subscriber list'), on: false },
  ],
  memory: [
    mem('voice', 'told', 'المقالات بفصحى بسيطة، مش عامية، والعنوان فيه السنة 2026.', lng('سارة · 20 أكتوبر', 'Sara · Oct 20')),
    mem('audience', 'learned', 'اللي بيدوّروا على «كورس محاسبة اونلاين» أغلبهم بيقارنوا الأسعار قبل ما يسجّلوا.', lng('من Search Console', 'From Search Console')),
    mem('banned', 'told', 'مانكتبش أرقام رواتب من غير مصدر واضح.', lng('سارة · 20 أكتوبر', 'Sara · Oct 20')),
    mem('lessons', 'learned', 'المقالات اللي فيها أسئلة شائعة في الآخر ترتيبها أحسن بـ 4 مراكز في المتوسط.', lng('من آخر 12 مقال', 'From the last 12 articles')),
  ],
});
Object.assign(AGENTS.analyst, {
  model: 'Opus 5.5', effort: 'medium', paused: false,
  instr: 'ابدأ التقرير بالخلاصة في 3 نقط.\nقارن دايماً بنفس الفترة اللي قبلها، ووضّح لو فيها إجازة أو عيد.',
  skills: [
    { t: lng('التقرير الأسبوعي', 'Weekly report'), d: lng('الصرف والليدز والمبيعات لكل قناة', 'Spend, leads and sales per channel'), on: true },
    { t: lng('كشف الأرقام الغريبة', 'Anomaly detection'), d: lng('بينبّهك لو حاجة اتغيرت أكتر من 30%', 'Flags anything that moved more than 30%'), on: true },
    { t: lng('العائد لكل قناة', 'Return per channel'), d: lng('محتاج GA4 أو شيت المبيعات', 'Needs GA4 or the sales sheet'), on: true },
  ],
  memory: [
    mem('voice', 'told', 'التقرير يبدأ بالخلاصة في 3 نقط، وبعدين الجداول.', lng('سارة · 15 أكتوبر', 'Sara · Oct 15')),
    mem('audience', 'told', 'التقرير بيروح لسارة ولمدير الأكاديمية، ومدير الأكاديمية بيقرا أول سطرين بس.', lng('سارة · 15 أكتوبر', 'Sara · Oct 15')),
    mem('banned', 'told', 'مانقارنش أسبوع فيه إجازة بأسبوع عادي من غير ما نوضّح ده.', lng('سارة · 3 نوفمبر', 'Sara · Nov 3')),
    mem('lessons', 'learned', 'Meta أرخص قناة مدفوعة من أغسطس، Google أغلى بس الليد بيشتري أكتر.', lng('من آخر 3 تقارير', 'From the last 3 reports')),
  ],
});
Object.assign(AGENTS.critic, {
  model: 'Opus 5.5', effort: 'high', paused: false,
  instr: 'ارجع لدليل صوت الأكاديمية في كل مراجعة.\nعلّق على كل سطر لوحده، مش رأي عام.',
  skills: [
    { t: lng('مراجعة الوعود والأرقام', 'Claims and numbers check'), d: lng('أي رقم من غير مصدر بيرجع بملاحظة', 'Any unsourced number comes back with a note'), on: true },
    { t: lng('مطابقة دليل الصوت', 'Brand-voice match'), d: 'دليل-صوت-الأكاديمية.pdf', on: true },
    { t: lng('مراجعة اللهجة', 'Dialect check'), d: lng('المصرية في إعلانات مصر، والسعودية في إعلانات الخليج', 'Egyptian for Egypt ads, Saudi for Gulf ads'), on: true },
  ],
  memory: [
    mem('voice', 'told', 'دليل صوت الأكاديمية هو المرجع لو فيه خلاف على كلمة.', lng('سارة · 10 أكتوبر', 'Sara · Oct 10')),
    mem('banned', 'told', 'مضمون، 100%، الأول في مصر، أرخص سعر.', lng('سارة · 10 أكتوبر', 'Sara · Oct 10')),
    mem('lessons', 'learned', 'نص الفيديو لازم الفكرة تبان في أول 3 ثواني، وإلا بيترفض.', lng('من مراجعات أكتوبر', 'From October reviews')),
  ],
});
Object.assign(AGENTS.lead, {
  model: 'Opus 5.5', effort: 'medium', paused: false, checkinOn: true, checkinTime: '9:00',
  instr: 'سلّم أي شغلانة للوكيل المسؤول عنها في نفس المحادثة، ومتفتحش محادثة جديدة.\nماتسلّمش لوكيل الشخص مش مسموحله بيه، واعرض عليه تطلبه من سارة.\nأي وكيل جديد بيتعمل بس بعد موافقة عمر.',
  skills: [
    { t: lng('توزيع الشغل', 'Routing work'), d: lng('بيعرف كل طلب يروح لأنهي وكيل', 'Knows which agent each request goes to'), on: true },
    { t: lng('صباح الخير', 'Good morning'), d: lng('اللي مستني كل واحد واللي اشتغل بالليل', 'What waits on each person and what ran overnight'), on: true },
    { t: lng('اقتراح وكلاء جداد', 'Proposing new agents'), d: lng('بيجهّز الاقتراح ويستنى موافقة المالك', 'Prepares the proposal and waits for the Owner’s OK'), on: true },
  ],
  memory: [
    mem('voice', 'told', 'صباح الخير قصير: اللي مستنيك الأول، وبعدين اللي اشتغل بالليل.', lng('عمر · 9 نوفمبر', 'Omar · Nov 9')),
    mem('lessons', 'learned', 'أغلب أسئلة تكلفة الليد بتروح لـ Ads، وأسئلة التقارير لـ Analyst.', lng('من آخر 30 محادثة', 'From the last 30 chats')),
    mem('banned', 'told', 'مفيش وكيل جديد يشتغل قبل ما عمر يوافق عليه.', lng('عمر · 10 نوفمبر', 'Omar · Nov 10')),
  ],
});
Object.keys(AGENTS).forEach((k) => { AGENTS[k].toolsOn = {}; AGENTS[k].conns.forEach((c) => { AGENTS[k].toolsOn[c] = true; }); });
Object.assign(AGENTS.lead, { voiceLang: 'ar-EG', voice: 'salma', voiceSpeed: '1' });
Object.assign(AGENTS.ads, { voiceLang: 'ar-EG', voice: 'karim', voiceSpeed: '1' });
Object.assign(AGENTS.seo, { voiceLang: 'ar-EG', voice: 'noor', voiceSpeed: '1' });
Object.assign(AGENTS.analyst, { voiceLang: 'ar-EG', voice: 'yassin', voiceSpeed: '1.25' });
Object.assign(AGENTS.critic, { voiceLang: 'ar-EG', voice: 'laila', voiceSpeed: '1' });

/* calm, low-saturation faces: one ink per face, no pink */
const FACES = {
  /* Lead: a headset band over the eyes (sky fill, no pink) */
  lead: { bg: '#DCE7F0', ink: '#123047', parts: '<path d="M8.6 14.2a7.4 7.4 0 0 1 14.8 0" stroke-width="1.6" stroke-linecap="round"/><path d="M23.4 14.2v2.6c0 1.7-1.3 2.8-3 2.8" stroke-width="1.4" stroke-linecap="round"/><circle cx="12.4" cy="15.6" r="1.8" stroke="none"/><circle cx="18.8" cy="15.6" r="1.8" stroke="none"/><path d="M12.6 21.4c1.9 1.4 4.6 1.4 6.4 0" stroke-width="1.8" stroke-linecap="round"/>' },
  ads: { bg: '#D7E9E6', ink: '#0B3D39', parts: '<path d="M16 4.5v3" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="4" r="1.4" stroke="none"/><circle cx="12" cy="15" r="1.9" stroke="none"/><circle cx="20" cy="15" r="1.9" stroke="none"/><path d="M11.5 20c2.5 2.6 6.5 2.6 9 0" stroke-width="1.8" stroke-linecap="round"/>' },
  seo: { bg: '#E1E5EB', ink: '#1E293B', parts: '<rect x="7.5" y="12.5" width="6.5" height="5" rx="2" stroke-width="1.5"/><rect x="18" y="12.5" width="6.5" height="5" rx="2" stroke-width="1.5"/><path d="M14 14.5h4" stroke-width="1.5"/><circle cx="10.75" cy="15" r="1.1" stroke="none"/><circle cx="21.25" cy="15" r="1.1" stroke="none"/><path d="M13 22h6" stroke-width="1.8" stroke-linecap="round"/>' },
  analyst: { bg: '#E4E7DF', ink: '#2A3520', parts: '<path d="M11 9.5V8M14 9.5V6.5M17 9.5V7.5M20 9.5V5.5" stroke-width="1.6" stroke-linecap="round"/><rect x="10.5" y="13.5" width="3.2" height="3.2" rx=".8" stroke="none"/><rect x="18.3" y="13.5" width="3.2" height="3.2" rx=".8" stroke="none"/><path d="M12 21.2c1.8 1 6.2 1 8 0" stroke-width="1.8" stroke-linecap="round"/>' },
  critic: { bg: '#E6E3E9', ink: '#33263D', parts: '<path d="M9.5 11.2l4.2.7M18.5 11l4-1.8" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="15.2" r="1.8" stroke="none"/><circle cx="20" cy="15.2" r="1.8" stroke="none"/><path d="M12.5 21.5h7" stroke-width="1.8" stroke-linecap="round"/>' },
};
/* filled marks at eye height are the eyes: they blink and squint. The features group follows the pointer. */
const eyeY = (attrs) => { const m = attrs.match(/\b(?:cy|y)="([\d.]+)"/); return m ? Number(m[1]) : 0; };
const markEyes = (parts) => parts.replace(/<(circle|rect)\b([^>]*?)stroke="none"\/>/g, (all, tag, attrs) => {
  const y = eyeY(attrs);
  return y >= 12 && y <= 17.5 ? `<${tag} class="face__eye"${attrs}stroke="none"/>` : all;
});
const faceSVG = (f, size, label, id) => `<svg class="face${size >= 24 ? ' face--look' : ''}"${id ? ` data-face="${id}"` : ''} width="${size}" height="${size}" viewBox="0 0 32 32" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'} style="color:${f.ink}"><circle cx="16" cy="16" r="16" fill="${f.bg}"/><g class="face__f" fill="currentColor" stroke="currentColor">${markEyes(f.parts.replace(/stroke-width/g, 'fill="none" stroke-width'))}</g></svg>`;
const face = (id, size = 28) => {
  const f = FACES[id];
  if (!f) return '';
  return faceSVG(f, size, AGENTS[id].name, id);
};
/* the look picker for new agents: our own glyphs on fixed pastel fills (same in both themes) */
const LOOK_SHAPES = [
  ['spark', FACES.ads.parts],
  ['specs', FACES.seo.parts],
  ['bars', FACES.analyst.parts],
  ['brow', FACES.critic.parts],
  ['calm', '<path d="M9.8 15.2c1.1-1.5 3.3-1.5 4.4 0M17.8 15.2c1.1-1.5 3.3-1.5 4.4 0" stroke-width="1.7" stroke-linecap="round"/><path d="M12.8 20.4c1.9 1.3 4.5 1.3 6.4 0" stroke-width="1.8" stroke-linecap="round"/>'],
  ['round', '<circle cx="12" cy="14.6" r="2.3" stroke="none"/><circle cx="20" cy="14.6" r="2.3" stroke="none"/><circle cx="16" cy="21.2" r="1.5" stroke="none"/><path d="M10 9.6h4M18 9.6h4" stroke-width="1.6" stroke-linecap="round"/>'],
];
const LOOK_COLORS = [
  ['mint', '#D7E9E6', '#0B3D39', lng('نعناعي', 'Mint')],
  ['slate', '#E1E5EB', '#1E293B', lng('رمادي أزرق', 'Blue grey')],
  ['sage', '#E4E7DF', '#2A3520', lng('زيتي فاتح', 'Light olive')],
  ['lilac', '#E6E3E9', '#33263D', lng('بنفسجي فاتح', 'Lilac')],
  ['sky', '#DCE7F0', '#123047', lng('سماوي', 'Sky')],
  ['stone', '#E4E4E2', '#262626', lng('رمادي', 'Grey')],
];
const SHAPE_NAMES = { spark: lng('أنتينا', 'Antenna'), specs: lng('نضارة', 'Glasses'), bars: lng('شعر واقف', 'Spiky hair'), brow: lng('حواجب', 'Brows'), calm: lng('مبسوط', 'Happy'), round: lng('عيون واسعة', 'Wide eyes') };
const lookFill = (look) => {
  const c = LOOK_COLORS.find((x) => x[0] === look.color) || LOOK_COLORS[0];
  const sh = LOOK_SHAPES.find((x) => x[0] === look.shape) || LOOK_SHAPES[0];
  return { bg: c[1], ink: c[2], parts: sh[1] };
};
const lookFace = (look, size, label) => faceSVG(lookFill(look), size, label);
const faceDot = (id, size, st, lg = false) => `<span class="face-wrap${lg ? ' face-wrap--lg' : ''}">${face(id, size)}<span class="dot dot--${st}" aria-hidden="true"></span></span>`;
/* overlapping faces for a team; ring = the surface the stack sits on */
const faceStack = (ids, size, ring = 'var(--bg-pane)') => `<span class="fstack" style="--fstack-size:${size}px;--fstack-ring:${ring}" aria-hidden="true">${ids.map((a) => face(a, size)).join('')}</span>`;
const namesOf = (ids) => ids.map((a) => (AGENTS[a] ? AGENTS[a].name : '')).join(lng('، ', ', '));
/* the same list as HTML: each name isolated so «SEO & Content» never flips inside Arabic text */
const namesHTML = (ids) => ids.filter((a) => AGENTS[a]).map((a) => `<bdi>${esc(AGENTS[a].name)}</bdi>`).join(lng('، ', ', '));

const CONNS = {
  meta: { name: 'Meta Ads', mark: 'M', d: lng('حساب الأكاديمية الإعلاني', 'Academy ad account') },
  gads: { name: 'Google Ads', mark: 'G', d: lng('حملتين Search شغالين', '2 active Search campaigns') },
  ga4: { name: 'GA4', mark: 'GA', d: lng('محتاج عشان نحسب المبيعات من كل قناة', 'Needed to attribute sales to each channel') },
  gsc: { name: 'Search Console', mark: 'SC', d: lng('موقع الأكاديمية', 'Academy website') },
  wp: { name: 'WordPress', mark: 'W', d: lng('نشر المقالات', 'Publishing articles') },
  sheets: { name: 'Google Sheets', mark: 'S', d: lng('شيت الليدز والمبيعات', 'Leads and sales sheet') },
  wa: { name: 'WhatsApp Business', mark: 'WA', d: lng('رقم الأكاديمية · قراية الرسايل بس', 'Academy number · read messages only') },
  mail: { name: 'Mailchimp', mark: 'MC', d: lng('قايمة المشتركين · 4,180 مشترك', 'Subscriber list · 4,180 subscribers') },
  /* added with the apps catalogue: letter marks, no borrowed logos */
  li: { name: 'LinkedIn', mark: 'in', d: lng('صفحة الأكاديمية · بوستات وإعلانات للشركات', 'Academy page · posts and company ads') },
  tiktok: { name: 'TikTok Ads', mark: 'TT', d: lng('من شاشة الوكيل · حساب RS Learning', 'Via the agent’s screen · RS Learning account') },
  ig: { name: 'Instagram', mark: 'IG', d: lng('حساب الأكاديمية · ريلز وبوستات', 'Academy account · reels and posts') },
  hubspot: { name: 'HubSpot', mark: 'HS', d: lng('الصفقات ومراحل البيع', 'Deals and sales stages') },
  slack: { name: 'Slack', mark: 'SL', d: lng('قناة التسويق · ملخصات وتنبيهات', 'Marketing channel · summaries and alerts') },
  gmail: { name: 'Gmail', mark: 'GM', d: lng('إيميل التسويق · مسودات بس', 'Marketing inbox · drafts only') },
  canva: { name: 'Canva', mark: 'Ca', d: lng('من شاشة الوكيل · صور المقالات', 'Via the agent’s screen · article images') },
  odoo: { name: 'Odoo', mark: 'O', d: lng('الفواتير والتحصيل · قراية بس', 'Invoices and collections · read only') },
};
// Real brand marks (shapes from Simple Icons, CC0; colours from each brand's official palette)
const LOGOS = {
  meta: '<path fill="#0081FB" d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"/>',
  gads: '<path fill="#FBBC04" d="M7.5137 4.8438L1.5645 15.1484A4.5 4.5 0 0 1 4 14.4297c2.5597-.0075 4.6248 2.1585 4.4941 4.7148l3.2168-5.5723-3.6094-6.25c-.4499-.7793-.6322-1.6394-.5878-2.4784z"/><path fill="#4285F4" d="M23.4641 16.9287L15.4632 3.072C14.3586 1.1587 11.9121.5028 9.9988 1.6074S7.4295 5.1585 8.5341 7.0718l8.0009 13.8567c1.1046 1.9133 3.5511 2.5679 5.4644 1.4646 1.9134-1.1046 2.568-3.5511 1.4647-5.4644z"/><circle fill="#34A853" cx="3.9998" cy="18.9293" r="3.9998"/>',
  ga4: '<path fill="#F9AB00" d="M22.84 2.9982v17.9987c.0086 1.6473-1.3197 2.9897-2.967 2.9984a2.9808 2.9808 0 01-.3677-.0208c-1.528-.226-2.6477-1.5558-2.6105-3.1V3.1204c-.0369-1.5458 1.0856-2.8762 2.6157-3.1 1.6361-.1915 3.1178.9796 3.3093 2.6158.014.1201.0208.241.0202.3619z"/><path fill="#F9AB00" d="M12.0054 9.045c-.0171 0-.0342 0-.0513.0003-1.6495.0904-2.9293 1.474-2.891 3.1256v7.9846c0 2.167.9535 3.4825 2.3505 3.763 1.6118.3266 3.1832-.7152 3.5098-2.327.04-.1974.06-.3983.0593-.5998v-8.9585c.003-1.6474-1.33-2.9852-2.9773-2.9882z"/><circle fill="#E37400" cx="4.1326" cy="21.0274" r="2.9726"/>',
  gsc: '<path fill="#4285F4" d="M3 5.5A2.5 2.5 0 0 1 5.5 3h11A2.5 2.5 0 0 1 19 5.5V9h-2.2V6.6H5.2v9.2h4.6V18H5.5A2.5 2.5 0 0 1 3 15.5z"/><circle cx="15.2" cy="15.2" r="3.9" fill="none" stroke="#34A853" stroke-width="2.2"/><path d="M18.1 18.1l3.1 3.1" stroke="#EA4335" stroke-width="2.4" stroke-linecap="round"/>',
  wp: '<circle cx="12" cy="12" r="11" fill="#21759B"/><circle cx="12" cy="12" r="9.2" fill="none" stroke="#FFFFFF" stroke-width="1"/><path d="M6.4 8.6l2.7 7.6 2.5-6.2 2.5 6.2 2.7-7.6" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  sheets: '<path fill="#0F9D58" d="M6 1.5h8.6L20 6.9V20a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 20V4a2.5 2.5 0 0 1 2-2.5z"/><path fill="#87CEAC" d="M14.6 1.5v5.4H20z"/><path fill="#FFFFFF" d="M7.4 10.6h9.2v7.6H7.4z"/><path fill="#0F9D58" d="M8.6 11.8h2.8v1.9H8.6zm4 0h2.8v1.9h-2.8zm-4 3.1h2.8v1.9H8.6zm4 0h2.8v1.9h-2.8z"/>',
  claude: '<path fill="#D97757" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>',
  openai: '<path fill="#0D0D0D" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>',
  gemini: '<defs><linearGradient id="gm-grad" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1C7DFF"/><stop offset=".55" stop-color="#9168C0"/><stop offset="1" stop-color="#E26A6F"/></linearGradient></defs><path fill="url(#gm-grad)" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/>',
};
const tile = (k, lg = false) => {
  const c = CONNS[k];
  const inner = LOGOS[k]
    ? `<svg class="od-icon tool-logo" viewBox="0 0 24 24" focusable="false">${LOGOS[k]}</svg>`
    : esc(c ? c.mark : '·');
  return `<span class="tool-tile${lg ? ' tool-tile--lg' : ''}" aria-hidden="true">${inner}</span>`;
};

/* ================= board columns («مستنيك» first = rightmost in RTL) ================= */
const COLS = [
  { id: 'waiting', name: lng('مستنيك', 'Waiting on you'), empty: [lng('مفيش حاجة مستنياك', 'Nothing waiting on you'), lng('كل الوكلاء ماشيين لوحدهم', 'All agents are running on their own')] },
  { id: 'ideas', name: lng('أفكار', 'Ideas'), empty: [lng('مفيش أفكار', 'No ideas yet'), lng('ضيف فكرة وأي وكيل يقدر يبدأ فيها', 'Add an idea and any agent can pick it up')] },
  { id: 'planned', name: lng('متخطط', 'Planned'), empty: [lng('مفيش حاجة متخططة', 'Nothing planned'), lng('الأفكار اللي اتفقتوا عليها بتنزل هنا', 'Ideas you agree on land here')] },
  { id: 'progress', name: lng('شغالين عليه', 'In progress'), empty: [lng('مفيش وكيل شغال دلوقتي', 'No agent is working right now'), lng('افتح أي فكرة وكلّم الوكيل يبدأ', 'Open any idea and ask an agent to start')] },
  { id: 'live', name: lng('شغال لايف', 'Live'), empty: [lng('مفيش حاجة لايف', 'Nothing live'), lng('الحملات والمقالات المنشورة بتظهر هنا', 'Published campaigns and articles show up here')] },
  { id: 'done', name: lng('خلص', 'Done'), empty: [lng('لسه مفيش حاجة خلصت', 'Nothing done yet'), ''] },
];
const colName = (id) => (COLS.find((c) => c.id === id) || {}).name || '';

/* ================= dashboard data (demo, internally consistent) ================= */
const PRICE = 2400;
const DATA = {
  '7': {
    ch: {
      meta: { spend: 3480, leads: 104, sales: 12 },
      google: { spend: 2150, leads: 51, sales: 6 },
      seo: { spend: 0, leads: 37, sales: 5 },
    },
    prev: { spend: 5210, leads: 171, revenue: 50400 },
    series: { meta: [12, 16, 14, 18, 13, 15, 16], google: [6, 8, 7, 9, 6, 7, 8], seo: [5, 4, 6, 5, 6, 5, 6] },
  },
  '30': {
    ch: {
      meta: { spend: 14900, leads: 452, sales: 49 },
      google: { spend: 9300, leads: 221, sales: 24 },
      seo: { spend: 0, leads: 168, sales: 19 },
    },
    prev: { spend: 22800, leads: 790, revenue: 196800 },
    series: null,
  },
};
function makeSeries(total, n, seed) {
  const w = [];
  for (let i = 0; i < n; i++) {
    let v = 1 + 0.22 * Math.sin(i * 1.3 + seed) + 0.14 * Math.cos(i * 0.7 + seed * 2) + i * 0.006;
    if (i % 7 === 6) v -= 0.18;
    w.push(v);
  }
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((v) => Math.round((v / sum) * total));
  const diff = total - out.reduce((a, b) => a + b, 0);
  out[n - 1] += diff;
  return out;
}
DATA['30'].series = {
  meta: makeSeries(452, 30, 1), google: makeSeries(221, 30, 2.4), seo: makeSeries(168, 30, 3.7),
};
const MONTHS = [lng('يناير', 'Jan'), lng('فبراير', 'Feb'), lng('مارس', 'Mar'), lng('أبريل', 'Apr'), lng('مايو', 'May'), lng('يونيو', 'Jun'), lng('يوليو', 'Jul'), lng('أغسطس', 'Aug'), lng('سبتمبر', 'Sep'), lng('أكتوبر', 'Oct'), lng('نوفمبر', 'Nov'), lng('ديسمبر', 'Dec')];
const TODAY = new Date(2026, 10, 11);
const dayLabel = (back) => { const d = new Date(TODAY); d.setDate(d.getDate() - back); return RTL ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
/* agents always talk in Arabic, so their dates keep the Arabic month names */
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function totals(p) {
  const c = DATA[p].ch; const t = { spend: 0, leads: 0, sales: 0 };
  Object.keys(c).forEach((k) => { t.spend += c[k].spend; t.leads += c[k].leads; t.sales += c[k].sales; });
  t.revenue = t.sales * PRICE; t.cpl = t.spend / t.leads;
  return t;
}

/* ================= state ================= */
const state = {
  view: 'chat',
  chatThread: 'th-meta',
  newChatAgent: 'ads',
  detailsAgent: 'ads',
  detailsOpen: true,
  dpTab: 'activity',
  dpSettings: false,
  dpManageTools: false,
  dpAddingRoutine: false,
  drafts: {},          // unsaved agent settings, per agent
  dpConfirm: null,     // { a, kind: 'pause' | 'delete' } in the danger zone
  memQuery: '',
  memAdding: false,
  memEditing: null,
  memUndo: null,
  period: '7',
  dashLoaded: false,
  dashLoading: false,
  chatBooted: false,
  boardFilter: 'all',
  addingIdea: false,
  sheetCard: null,
  sbQuery: '',
  fileTarget: null,
  attach: { main: [], sheet: [] },
  conns: { meta: 'connected', gads: 'connected', ga4: 'missing', gsc: 'connected', wp: 'connected', sheets: 'connected', wa: 'connected', mail: 'missing',
    tiktok: 'connected', canva: 'connected', li: 'missing', ig: 'missing', hubspot: 'missing', slack: 'missing', gmail: 'missing', odoo: 'missing' },
  connLater: {},
  modal: null,         // agent gallery / create step
  rtRunning: {},       // routines running right now ("agent:idx")
  handoff: { done: false, at: '' }, // the morning «اتسلّمتلك» item
  teamAdding: false,   // members card: picking an agent to add
  voicePlaying: null,  // voice preview in settings
  events: [
    { agent: 'analyst', t: lng('لقى إن 38% من ليدز Google بتيجي بعد 10 بالليل، واقترح نزوّد الميزانية في الوقت ده', 'Found that 38% of Google leads come in after 10 PM and suggested raising the budget for that window'), m: lng('النهارده · 8:40 ص', 'Today · 8:40 AM') },
    { agent: 'critic', t: lng('رجّع 3 نصوص إعلانات بملاحظات على وعود «شغل مضمون»', 'Sent back 3 ad scripts with notes on “guaranteed job” claims'), m: lng('امبارح · 6:15 م', 'Yesterday · 6:15 PM') },
    { agent: 'seo', t: lng('كتب مقال «كورس محاسبة اونلاين» (1,850 كلمة) وبعته للمراجعة', 'Wrote the “كورس محاسبة اونلاين” article (1,850 words) and sent it for review'), m: lng('امبارح · 1:30 م', 'Yesterday · 1:30 PM') },
    { agent: 'ads', t: lng('وقّف إعلانين تكلفة الليد فيهم عدّت 45 ج ووفّر 1,240 ج', 'Paused 2 ads whose cost per lead passed EGP 45, saving EGP 1,240'), m: lng('الاثنين · 9:05 ص', 'Monday · 9:05 AM') },
    { agent: 'ads', t: lng('أطلق حملة إعادة استهداف لزوار صفحة الكورس بميزانية 250 ج يومياً', 'Launched a retargeting campaign for course-page visitors at EGP 250/day'), m: lng('الأحد · 11:20 ص', 'Sunday · 11:20 AM') },
  ],
};

/* ================= the team: people, roles, which agents each member works with =================
   One company, one set of agents, one memory. The Owner (and a Manager) choose per member which agents they work with;
   an agent a member isn't allowed is never shown to them. The main agent is shown to everyone. «شايف كـ» in the
   account menu switches the whole prototype between three people (a prototype aid only). */
const PEOPLE = {
  omar: { name: lng('عمر', 'Omar'), first: lng('عمر', 'Omar'), av: lng('ع', 'O'), role: 'owner', title: lng('مالك', 'Owner') },
  sara: { name: lng('سارة منصور', 'Sara Mansour'), first: lng('سارة', 'Sara'), av: lng('س', 'S'), role: 'manager', title: lng('مديرة', 'Manager') },
  youssef: { name: lng('يوسف حمدي', 'Youssef Hamdy'), first: lng('يوسف', 'Youssef'), av: lng('ي', 'Y'), role: 'contributor', title: lng('مساهم', 'Contributor'), job: lng('ميديا باير', 'Media buyer') },
  mona: { name: lng('منى عادل', 'Mona Adel'), first: lng('منى', 'Mona'), av: lng('م', 'M'), role: 'viewer', title: lng('مشاهدة', 'Viewer') },
  /* the site developer: works with Coder and reviews its merge requests */
  karim: { name: lng('كريم صلاح', 'Karim Salah'), first: lng('كريم', 'Karim'), av: lng('ك', 'K'), role: 'contributor', title: lng('مساهم', 'Contributor'), job: lng('مطوّر الموقع', 'Website developer') },
};
const TEAM_ORDER = ['omar', 'sara', 'youssef', 'mona', 'karim'];
const SWITCH_PEOPLE = ['omar', 'sara', 'youssef', 'mona']; // the «شايف كـ» switcher: people of the same company
/* agents each member works with (the main agent is always added on top; the Owner sees every agent) */
const ACCESS = { sara: ['ads', 'seo', 'analyst', 'critic', 'coder'], youssef: ['ads', 'analyst'], mona: ['seo', 'analyst', 'coder'], karim: ['coder'] };
state.as = 'omar';     // the person the prototype is shown as
state.main = 'lead';   // the company's main agent (exactly one)
state.ask = {};        // «اطلب من المديرة» answers, per message
const me = () => PEOPLE[state.as];
const isOwner = () => me().role === 'owner';
const canManage = () => me().role === 'owner' || me().role === 'manager';
const canWrite = () => me().role !== 'viewer';
const isMain = (a) => a === state.main;
/* an agent exists in a workspace only once it is in its list (Coder is added from the gallery, per workspace) */
/* which workspace an agent lives in: the seeded company (team and alone), or the fresh one a first run opens.
   An agent made by Lead lives only where it was made; alone shows fewer agents than the team. */
const inWorld = (a) => { if (a === state.main) return true; const W = AGENTS[a] && AGENTS[a].worlds; return W ? W.includes(state.world) : state.world !== 'fresh'; };
const allowedFor = (p, a) => !!AGENTS[a] && AGENT_ORDER.includes(a) && inWorld(a) && (isMain(a) || PEOPLE[p].role === 'owner' || (ACCESS[p] || []).includes(a));
const canSee = (a) => allowedFor(state.as, a);
/* ---- one system for a person alone and for a team ----
   Every workspace has a roster. With one person in it (the Owner) the team parts are simply not drawn: channels and
   channel creation, per-member agent switches, «مين يشوفه» in a proposal, every member picker. Everything else is the
   same screen. Inviting the first member brings the team parts back by themselves. `world` only picks which workspace
   the prototype shows: the seeded RS Learning team, or one that started alone (first run / «شايف كـ»). */
state.world = 'team';
state.roster = { team: TEAM_ORDER.slice(), solo: ['omar'], fresh: ['omar'] };
const roster = () => state.roster[state.world];
const inWs = (p) => roster().includes(p);
const isSolo = () => roster().length === 1;
const chanOk = (t) => !isSolo() && (t.ws || 'team') === state.world;
/* the agent list as this person sees it: the main agent first, then the rest in company order */
const visibleAgents = () => [state.main].concat(AGENT_ORDER.filter((a) => a !== state.main)).filter(canSee);
/* a main-agent chat that handed work to an agent this person isn't allowed is hidden with it */
const inChannel = (t, p) => !!(t && t.channel && t.people.includes(p || state.as));
/* inside a channel every member sees the channel's agents, even one hidden from them elsewhere */
const seeIn = (t, a) => canSee(a) || (!!t && !!t.channel && inChannel(t) && t.team.includes(a));
/* a chat somebody outside this workspace wrote in (Youssef's proposal, for one) isn't part of it */
/* the fresh workspace (first run) has its own chats, cards and log; the seeded company never shows them, and back */
const wsOk = (x) => (state.world === 'fresh' ? x.ws === 'fresh' : x.ws !== 'fresh');
const threadOk = (t) => !!t && (t.channel ? chanOk(t) && inChannel(t) : wsOk(t) && canSee(t.agent) && (!t.team || t.team.every(canSee)) && (t.about || []).every(canSee)
  && !t.msgs.some((m) => m.by && !inWs(m.by))
  && !(isMain(t.agent) && t.msgs.some((m) => (m.role === 'agent' && m.agent && !canSee(m.agent)) || (m.role === 'handoff' && !(canSee(m.from) && canSee(m.to))))));
/* a member's direct chat with an agent is theirs alone. Shared work lives in channels and on cards. */
const threadMine = (t) => !!t && (t.channel || !t.owner || t.owner === state.as);
const threadVisible = (t) => threadOk(t) && threadMine(t);
const cardVisible = (c) => !!c && wsOk(c) && canSee(c.agent) && (!c.code || (c.ws || 'team') === state.world) && (!c.thread || !threads[c.thread] || threadOk(threads[c.thread])) && (!c.proposal || isOwner()) && (!c.request || isOwner()) && (!c.change || isOwner()) && (c.about || []).every(canSee);
/* a card waits on me only when its conversation is mine (or shared); another member's private chat waits on them */
const cardMine = (c) => !c.thread || !threads[c.thread] || threadMine(threads[c.thread]);
const whoManages = () => lng('عمر (المالك) وسارة (المديرة)', 'Omar (Owner) and Sara (Manager)');
const ANGLES = [
  { t: 'من خريج لمحاسب شغال', d: 'قصة تحوّل: من غير خبرة لأول شغلانة في 3 شهور. أقوى زاوية مع حديثي التخرج.', tag: lng('متوقع 26–30 ج لليد', 'Est. EGP 26–30 / lead') },
  { t: 'Excel وOdoo في كورس واحد', d: 'تركيز على المهارات اللي الشركات بتطلبها في إعلانات الوظايف.', tag: lng('متوقع 30–35 ج لليد', 'Est. EGP 30–35 / lead') },
  { t: 'شهادة معتمدة وتدريب عملي', d: 'ثقة ومصداقية: شهادة وحالات عملية من شركات حقيقية.', tag: lng('متوقع 33–38 ج لليد', 'Est. EGP 33–38 / lead') },
];

/* day: 0 = today, 1 = yesterday; ts orders the recents (latest first) */
const threads = {
  'th-meta': {
    id: 'th-meta', agent: 'ads', title: 'حملة Meta: المحاسب الشامل', time: lng('10:12 ص', '10:12 AM'), day: 0, ts: 612, card: 'c-meta',
    msgs: [
      { id: 'm1', role: 'user', text: '@Ads محتاجين حملة Meta لكورس «المحاسب الشامل». الدفعة الجديدة بتبدأ 1 ديسمبر، والميزانية 15,000 ج للشهر. الهدف ليدز على واتساب.', time: lng('10:12 ص', '10:12 AM') },
      { id: 'm2', role: 'agent', agent: 'ads', time: lng('10:12 ص', '10:12 AM'), text: 'قبل ما أبدأ محتاج أقرا جماهير صفحة الأكاديمية على Meta، عشان أبني الاستهداف على بيانات حقيقية مش تخمين.',
        steps: [{ tool: 'meta', label: lng('طلب صلاحية قراءة جماهير الصفحة', 'Permission to read page audiences'), state: 'done' }],
        card: { type: 'approval', status: 'once', resolvedAt: lng('10:13 ص', '10:13 AM'), tool: 'meta', title: lng('قراءة جماهير صفحة الأكاديمية', 'Read the academy page’s audiences'), sub: lng('قراءة بس · مفيش صرف', 'Read only · no spend'), rows: [] } },
      { id: 'm3', role: 'agent', agent: 'ads', time: lng('10:14 ص', '10:14 AM'), bootStream: true,
        text: 'قريت نتايج آخر 3 حملات للكورس (من أغسطس لأكتوبر):\n• 412 ليد بمتوسط 34 ج لليد\n• أحسن جمهور: خريجين تجارة من 22 لـ 30 سنة في القاهرة والجيزة والإسكندرية، تكلفة الليد عندهم 27 ج\n• الفيديو القصير جاب ليدز أرخص بـ 22% من الصور',
        connect: { k: 'ga4', why: 'GA4 مش متوصل، فمقدرتش أعرف مين من الليدز اشترى فعلاً. لو وصّلته هقدر أحسب العائد بدقة.' },
        after: 'قبل ما أكتب الإعلانات، اختار الزاوية اللي هنمشي بيها:',
        steps: [
          { tool: 'meta', label: lng('قرا نتايج آخر 3 حملات للكورس', 'Read results from the course’s last 3 campaigns'), state: 'done' },
          { tool: 'meta', label: lng('راجع 6 جماهير محفوظة', 'Reviewed 6 saved audiences'), state: 'done' },
          { tool: 'ga4', label: lng('GA4 مش متوصل، اتخطى المبيعات', 'GA4 isn’t connected, skipped sales'), state: 'skipped' },
          { tool: 'sheets', label: lng('حسب توزيع الميزانية على 30 يوم', 'Calculated budget split over 30 days'), state: 'done' },
        ], stepsDur: lng('41 ثانية', '41 sec'),
        card: { type: 'choice', status: 'pending', q: 'اختار زاوية الإعلان', options: ANGLES, answer: null, card: 'c-meta' } },
    ],
  },
  'th-seo': {
    id: 'th-seo', agent: 'seo', title: 'مقال SEO: كورس محاسبة اونلاين', time: lng('1:30 م', '1:30 PM'), day: 1, ts: 810, card: 'c-seo',
    msgs: [
      { id: 's1', role: 'user', text: '@SEO عايزين مقال يجيب ترتيب على «كورس محاسبة اونلاين»، ويودّي على صفحة المحاسب الشامل.', time: lng('امبارح 11:02 ص', 'Yesterday 11:02 AM') },
      { id: 's2', role: 'agent', agent: 'seo', time: lng('امبارح 1:30 م', 'Yesterday 1:30 PM'),
        text: 'المقال جاهز: «كورس محاسبة اونلاين: دليلك الكامل 2026».\n• الكلمة بيتدوّر عليها 2,900 مرة في الشهر في مصر والسعودية\n• 1,850 كلمة، 6 عناوين فرعية، وأسئلة شائعة في الآخر\n• 3 روابط لصفحة المحاسب الشامل\n\nCritic راجعه وطلب تعديلين: شيلنا جملة «شغل مضمون» وظبطنا رقم ساعات الكورس. محتاج موافقتك عشان أنشره.',
        steps: [
          { tool: 'gsc', label: lng('بحث 40 كلمة قريبة في Search Console', 'Searched 40 related keywords in Search Console'), state: 'done' },
          { tool: 'wp', label: lng('راجع 5 مقالات منافسة', 'Reviewed 5 competing articles'), state: 'done' },
          { tool: 'wp', label: lng('كتب المسودة على WordPress', 'Wrote the draft in WordPress'), state: 'done' },
        ], stepsDur: lng('6 دقايق', '6 min'),
        card: { type: 'approval', status: 'pending', tool: 'wp', title: lng('نشر المقال على موقع الأكاديمية', 'Publish the article on the academy website'), sub: lng('WordPress · بيتنشر للعامة', 'WordPress · goes public'), effect: 'publish-seo',
          rows: [[lng('العنوان', 'Title'), 'كورس محاسبة اونلاين: دليلك الكامل 2026'], [lng('الطول', 'Length'), lng('1,850 كلمة', '1,850 words')], [lng('المراجعة', 'Review'), lng('Critic: مقبول بعد تعديلين', 'Critic: approved after 2 edits')]] } },
    ],
  },
  'th-report': {
    id: 'th-report', agent: 'analyst', title: 'التقرير الأسبوعي', time: lng('9:30 ص', '9:30 AM'), day: 0, ts: 570, card: 'c-report',
    msgs: [
      { id: 'r1', role: 'agent', agent: 'analyst', time: lng('9:30 ص', '9:30 AM'),
        text: 'بدأت التقرير الأسبوعي (5 – 11 نوفمبر). أرقام Meta وGoogle اتجمعت.\nلسه ناقصني بيانات المبيعات من GA4، ولو متوصلش لحد الخميس هكتب التقرير بالليدز بس وهوضّح ده في أوله.',
        connect: { k: 'ga4', why: lng('محتاجه عشان أضيف المبيعات للتقرير الأسبوعي قبل الخميس.', 'Needed to add sales to the weekly report before Thursday.') },
        steps: [
          { tool: 'meta', label: lng('جمع صرف وليدز Meta', 'Collected Meta spend and leads'), state: 'done' },
          { tool: 'gads', label: lng('جمع صرف وليدز Google Ads', 'Collected Google Ads spend and leads'), state: 'done' },
          { tool: 'ga4', label: lng('GA4 مش متوصل', 'GA4 isn’t connected'), state: 'skipped' },
        ], stepsDur: lng('1 دقيقة', '1 min') },
    ],
  },
  'th-critic': {
    id: 'th-critic', agent: 'critic', title: 'مراجعة نصوص إعلانات ديسمبر', time: lng('6:15 م', '6:15 PM'), day: 1, ts: 1095, card: 'c-critic',
    msgs: [
      { id: 'k1', role: 'user', text: '@Critic راجع نصوص إعلانات ديسمبر قبل ما Ads يرفعها.', time: lng('امبارح 5:40 م', 'Yesterday 5:40 PM') },
      { id: 'k2', role: 'agent', agent: 'critic', time: lng('امبارح 6:15 م', 'Yesterday 6:15 PM'),
        text: 'راجعت 8 نصوص، 5 تمام و3 محتاجين تعديل:\n• «شغل مضمون بعد الكورس»: وعد مقدرش نثبته، الأحسن «تدريب على شغل حقيقي»\n• «أرخص كورس في مصر»: مفيش مصدر للمقارنة\n• نص الفيديو التالت طويل، أول 3 ثواني مفيهاش الفكرة\n\nببعت الملاحظات لـ Ads دلوقتي.' },
      { id: 'k3', role: 'handoff', from: 'critic', to: 'ads', text: lng('Critic بعت الملاحظات لـ Ads', 'Critic sent the notes to Ads'), detail: lng('3 ملاحظات', '3 notes'), time: lng('امبارح 6:16 م', 'Yesterday 6:16 PM') },
    ],
  },
};
/* a team thread: Ads, Critic and SEO pass the December campaign between them (G54/G55/J04) */
threads['th-team'] = {
  id: 'th-team', agent: 'ads', team: ['ads', 'critic', 'seo'], title: 'حملة ديسمبر · فريق', time: lng('10:40 ص', '10:40 AM'), day: 0, ts: 640, card: 'c-team',
  msgs: [
    { id: 't1', role: 'user', time: lng('10:31 ص', '10:31 AM'), text: 'عايزين نجهّز حملة ديسمبر للمحاسب الشامل: 3 نصوص إعلانات Meta ومقال SEO يودّي على صفحة الكورس. أي حاجة تعدّي على Critic قبل ما تطلع.' },
    { id: 't2', role: 'agent', agent: 'ads', time: lng('10:32 ص', '10:32 AM'),
      text: 'كتبت 3 نصوص بزاوية «من خريج لمحاسب شغال»:\n• «من خريج تجارة لمحاسب شغال في 3 شهور»\n• «أضمن طريق لأول وظيفة محاسبة»\n• «Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج»',
      steps: [{ tool: 'meta', label: lng('قرا نتايج حملات أكتوبر', 'Read October campaign results'), state: 'done' }, { tool: 'meta', label: lng('كتب 3 نصوص بالزاوية', 'Wrote 3 scripts with the angle'), state: 'done' }], stepsDur: lng('48 ثانية', '48 sec') },
    { id: 't3', role: 'handoff', from: 'ads', to: 'critic', text: lng('Ads بعت النصوص لـ Critic', 'Ads sent the scripts to Critic'), detail: lng('3 نصوص', '3 scripts'), time: lng('10:33 ص', '10:33 AM') },
    { id: 't4', role: 'agent', agent: 'seo', time: lng('10:34 ص', '10:34 AM'),
      text: 'وأنا بدأت المقال على «كورس محاسب شامل اونلاين»، الكلمة دي بيتدوّر عليها 1,300 مرة في الشهر. هبعته لـ Critic أول ما يخلص.',
      steps: [{ tool: 'gsc', label: lng('بحث الكلمة و12 كلمة قريبة', 'Researched the keyword and 12 related ones'), state: 'done' }], stepsDur: lng('20 ثانية', '20 sec') },
    { id: 't5', role: 'agent', agent: 'critic', to: 'ads', time: lng('10:36 ص', '10:36 AM'), text: 'راجعت النصوص التلاتة سطر سطر:',
      card: { type: 'review', title: 'مراجعة نصوص إعلانات ديسمبر', sub: '3 نصوص · Meta Ads · قبل ما تطلع', items: [
        { q: 'من خريج تجارة لمحاسب شغال في 3 شهور', ok: true, note: 'الوعد واضح، ومعانا قصص طلبة تثبته.' },
        { q: 'أضمن طريق لأول وظيفة محاسبة', ok: false, note: '«أضمن» وعد مقدرش نثبته. البديل: «أقصر طريق لأول شغلانة محاسبة».' },
        { q: 'Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج', ok: true, note: 'السعر مطابق لصفحة الكورس.' },
      ], decision: '2 جاهزين، و1 رجع لـ Ads بالبديل' } },
    { id: 't6', role: 'handoff', from: 'critic', to: 'ads', text: lng('Critic رجّع نص 2 لـ Ads بالبديل', 'Critic sent script 2 back to Ads with an alternative'), time: lng('10:36 ص', '10:36 AM') },
    { id: 't7', role: 'agent', agent: 'ads', to: 'critic', time: lng('10:37 ص', '10:37 AM'), text: 'عدّلت نص 2 لـ «أقصر طريق لأول شغلانة محاسبة». التلات نصوص جاهزين مسودة، ومش هرفع ولا هصرف حاجة قبل موافقتك.' },
    { id: 't8', role: 'handoff', from: 'seo', to: 'critic', text: lng('SEO بعت المقال لـ Critic', 'SEO sent the article to Critic'), detail: lng('1,600 كلمة', '1,600 words'), time: lng('10:38 ص', '10:38 AM') },
    { id: 't9', role: 'agent', agent: 'critic', to: 'seo', time: lng('10:39 ص', '10:39 AM'), text: 'المقال تمام بعد تعديل واحد: رقم متوسط المرتبات كان من غير مصدر، فشلناه. الباقي مطابق لدليل صوت الأكاديمية.' },
    { id: 't10', role: 'agent', agent: 'seo', time: lng('10:40 ص', '10:40 AM'), text: 'المقال جاهز مسودة على WordPress. النشر عليك انت:',
      card: { type: 'hand', status: 'pending', tool: 'wp', card: 'c-team', title: lng('انشر مقال «كورس محاسب شامل اونلاين: هتتعلم إيه وهتشتغل فين»', 'Publish the article “كورس محاسب شامل اونلاين: هتتعلم إيه وهتشتغل فين”'), sub: lng('SEO سابه مسودة على WordPress، وانت اللي تدوس نشر.', 'SEO left it as a draft in WordPress. You press Publish.'),
        rows: [[lng('الطول', 'Length'), lng('1,600 كلمة · 5 عناوين فرعية', '1,600 words · 5 subheadings')], [lng('الروابط', 'Links'), lng('3 روابط لصفحة المحاسب الشامل', '3 links to the المحاسب الشامل page')], [lng('المراجعة', 'Review'), lng('Critic: مقبول بعد تعديل واحد', 'Critic: approved after 1 edit')]] } },
  ],
};
/* the morning check-in from the main agent (Lead): first thread of today, nothing on quiet days (no thread yesterday) */
threads['th-morning'] = {
  id: 'th-morning', agent: 'lead', title: 'صباح الخير · الأربع 11 نوفمبر', time: lng('9:00 ص', '9:00 AM'), day: 0, ts: 9999, card: null, checkin: true,
  msgs: [{ id: 'mg1', role: 'agent', agent: 'lead', time: lng('9:00 ص', '9:00 AM'), text: 'صباح الخير يا عمر. ده اللي مستنيك النهارده، واللي اشتغل بالليل.', checkin: true }],
};
const OVERNIGHT = [
  { agent: 'ads', t: lng('وقّف إعلان «فيديو 2 · الرياض» لما تكلفة الليد وصلت 52 ج', 'Paused the “فيديو 2 · الرياض” ad when cost per lead hit EGP 52'), m: lng('2:40 ص · روتين وقف الإعلان', '2:40 AM · Ad-pause routine') },
  { agent: 'ads', t: lng('إعادة الاستهداف جابت 11 ليد بالليل بـ 24 ج لليد', 'Retargeting brought 11 leads overnight at EGP 24/lead'), m: lng('من 12 بالليل لـ 8 الصبح', 'From midnight to 8 AM') },
  { agent: 'analyst', t: lng('فحص الليدز 9 مرات ومفيش نزول غريب', 'Checked leads 9 times, no unusual drop'), m: lng('كل ساعة · تنبيه الليدز', 'Hourly · Leads alert') },
  { agent: 'seo', t: lng('مقال «إزاي تبقى محاسب من البيت» طلع للمركز السادس على Google', 'The “إزاي تبقى محاسب من البيت” article moved up to #6 on Google'), m: lng('6:05 ص · من Search Console', '6:05 AM · From Search Console') },
];
const HANDOFF = {
  title: lng('ابعت عرض الدفعة الجديدة لـ 38 ليد على واتساب', 'Send the new-cohort offer to 38 leads on WhatsApp'),
  sub: lng('Ads جهّز الرسالة والقايمة، وانت اللي تبعت من رقم الأكاديمية.', 'Ads prepared the message and the list. You send it from the academy number.'),
  msg: 'أهلاً يا {الاسم}، الدفعة الجديدة من «المحاسب الشامل» بتبدأ 1 ديسمبر. لو سجّلت قبل 20 نوفمبر هتاخد خصم 15%، يعني 2,040 ج بدل 2,400 ج. تحب أحجزلك مكان؟',
  rows: [[lng('القايمة', 'List'), lng('38 ليد سألوا عن الكورس آخر 7 أيام ومحدش رد عليهم', '38 leads who asked about the course in the last 7 days and got no reply')], [lng('الملف', 'File'), 'leads-followup-11nov.csv']],
};
let tsSeq = 2000;
const sortedThreads = () => Object.values(threads).sort((a, b) => (a.day - b.day) || (b.ts - a.ts));

const cards = [
  { id: 'c-idea1', col: 'ideas', title: 'فيديو ريلز: يوم في حياة محاسب', agent: 'seo', chan: 'Instagram', due: '', thread: null, prog: lng('فكرة من سارة', 'Idea from Sara') },
  { id: 'c-idea2', col: 'ideas', title: 'حملة Google Search: دبلومة الضرائب', agent: 'ads', chan: 'Google', due: '', thread: null, prog: lng('محتاجة ميزانية', 'Needs a budget') },
  { id: 'c-plan1', col: 'planned', title: 'إيميل للمشتركين القدام: خصم الدفعة الجديدة', agent: 'seo', chan: 'Email', due: lng('20 نوفمبر', 'Nov 20'), thread: null, prog: lng('هيبدأ الأسبوع الجاي', 'Starts next week') },
  { id: 'c-plan2', col: 'planned', title: 'مقال SEO: الفرق بين المحاسب والمراجع', agent: 'seo', chan: 'SEO', due: lng('24 نوفمبر', 'Nov 24'), thread: null, prog: lng('الكلمة اتختارت', 'Keyword picked') },
  { id: 'c-critic', col: 'progress', title: 'مراجعة نصوص إعلانات ديسمبر', agent: 'critic', chan: 'Meta', due: lng('13 نوفمبر', 'Nov 13'), thread: 'th-critic', pct: 62, touched: ['critic', 'ads'],
    ticks: [lng('بيراجع نص الفيديو التالت', 'Reviewing the third video script'), lng('بيقارن النصوص بدليل الصوت', 'Checking scripts against the voice guide'), lng('بيكتب الملاحظات لـ Ads', 'Writing notes for Ads')], tick: 0 },
  { id: 'c-report', col: 'progress', title: 'التقرير الأسبوعي', agent: 'analyst', chan: lng('كل القنوات', 'All channels'), due: lng('الخميس', 'Thursday'), thread: 'th-report', pct: 40,
    ticks: [lng('بيجمع أرقام Google Ads', 'Collecting Google Ads numbers'), lng('بيحسب تكلفة الليد لكل قناة', 'Calculating cost per lead per channel'), lng('بيكتب الملخص', 'Writing the summary')], tick: 0 },
  { id: 'c-meta', col: 'waiting', title: 'حملة Meta: المحاسب الشامل', agent: 'ads', chan: 'Meta', due: lng('12 نوفمبر', 'Nov 12'), thread: 'th-meta', wait: lng('مستني تختار زاوية الإعلان', 'Waiting for you to pick an ad angle') },
  { id: 'c-seo', col: 'waiting', title: 'مقال SEO: كورس محاسبة اونلاين', agent: 'seo', chan: 'SEO', due: lng('14 نوفمبر', 'Nov 14'), thread: 'th-seo', wait: lng('مستني موافقتك على النشر', 'Waiting for your OK to publish'), touched: ['seo', 'critic'] },
  { id: 'c-team', col: 'waiting', title: 'حملة ديسمبر: الإعلانات والمقال', agent: 'ads', chan: lng('Meta وSEO', 'Meta & SEO'), due: lng('15 نوفمبر', 'Nov 15'), thread: 'th-team', wait: lng('اتسلّمتلك: انشر المقال على WordPress', 'Handed to you: publish the article on WordPress'), touched: ['ads', 'critic', 'seo'] },
  { id: 'c-live1', col: 'live', title: 'حملة Meta: إعادة استهداف زوار الصفحة', agent: 'ads', chan: 'Meta', due: '', thread: null, prog: lng('18 ليد امبارح · 27 ج لليد', '18 leads yesterday · EGP 27/lead') },
  { id: 'c-live2', col: 'live', title: 'Google Search: كورس محاسبة', agent: 'ads', chan: 'Google', due: '', thread: null, prog: lng('7 ليد امبارح · 41 ج لليد', '7 leads yesterday · EGP 41/lead') },
  { id: 'c-done1', col: 'done', title: 'التقرير الأسبوعي (29 أكتوبر – 4 نوفمبر)', agent: 'analyst', chan: lng('كل القنوات', 'All channels'), due: '', thread: null, prog: lng('اتبعت للفريق الخميس', 'Sent to the team on Thursday') },
  { id: 'c-done2', col: 'done', title: 'مقال SEO: إزاي تبقى محاسب من البيت', agent: 'seo', chan: 'SEO', due: '', thread: null, prog: lng('الترتيب السابع على Google', 'Ranked #7 on Google'), touched: ['seo', 'critic'] },
];
const cardById = (id) => cards.find((c) => c.id === id) || null;
const addTouched = (c, a) => { if (!c || !a) return; if (!c.touched) c.touched = [c.agent]; if (!c.touched.includes(a)) c.touched.push(a); };

function agentStatus(a) {
  if (AGENTS[a] && AGENTS[a].paused) return 'paused';
  if (cards.some((c) => c.agent === a && c.col === 'waiting' && cardVisible(c) && cardMine(c))) return 'waiting';
  if (cards.some((c) => c.agent === a && c.col === 'progress')) return 'working';
  return 'idle';
}
const STATUS_TXT = { waiting: lng('مستنيك', 'Waiting on you'), working: lng('شغال', 'Working'), idle: lng('فاضي', 'Idle'), paused: lng('واقف مؤقتاً', 'Paused') };
const waitingCards = () => cards.filter((c) => c.col === 'waiting' && cardVisible(c) && cardMine(c));

/* ================= toast ================= */
let toastTimer = 0;
function toast(text, ic = 'check', act) {
  const host = $('#toast-host');
  /* a modal dialog sits in the top layer: the toast moves into the open one so it stays visible */
  const top = $$('dialog[open]').pop();
  const home = top || document.body;
  if (host.parentElement !== home) home.appendChild(host);
  host.innerHTML = `<div class="toast">${icon(ic)}<span>${bx(text)}</span>${act ? `<button type="button" class="toast__act" data-action="${act.action}"${act.thread ? ` data-thread="${esc(act.thread)}"` : ''}>${esc(act.label)}</button>` : ''}</div>`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    const el = host.firstElementChild;
    if (!el || reduced()) { host.innerHTML = ''; return; }
    el.classList.add('is-leaving');
    window.setTimeout(() => { if (host.firstElementChild === el) host.innerHTML = ''; }, 140);
  }, act ? 6000 : 2800);
}

/* ================= sidebar ================= */
function currentThreadAgent() { const t = threads[state.chatThread]; return t ? t.agent : state.newChatAgent; }
function renderSidebar() {
  $('#btn-newchat').innerHTML = icon('compose');
  $('#btn-newchat').hidden = !canWrite(); // a viewer reads; there is no new chat to start
  $('#btn-search').innerHTML = icon('search');
  const w = (canWrite() ? waitingCards().length : 0) + unreadMentions().length; // cards wait on writers; mentions of me reach everyone
  const nav = [
    { v: 'chat', ic: 'chat', t: lng('المحادثات', 'Chats') },
    { v: 'board', ic: 'board', t: lng('لوحة التسويق', 'Marketing board'), count: w },
    { v: 'dashboard', ic: 'chart', t: lng('الأرقام', 'Numbers') },
    { v: 'log', ic: 'history', t: lng('سجل النشاط', 'Activity log') },
  ];
  $('#sb-nav').innerHTML = nav.map((n) => `
    <button type="button" class="sb-item" data-action="nav" data-view="${n.v}" ${state.view === n.v ? 'aria-current="page"' : ''}>
      ${icon(n.ic)}<span class="od-fill">${n.t}</span>${n.count ? `<span class="sb-count" aria-label="${n.count} ${lng('حاجات مستنياك', 'things waiting on you')}">${n.count}</span>` : ''}
    </button>`).join('');
  $('#sb-agents').innerHTML = visibleAgents().map((a) => {
    const st = agentStatus(a);
    const ct = threads[state.chatThread];
    const active = state.view === 'chat' && !(ct && ct.team) && currentThreadAgent() === a;
    const main = isMain(a); const nw = !main && AGENTS[a].isNew;
    return `<div role="listitem"><button type="button" class="agent-tile${main ? ' agent-tile--main' : ''}${nw ? ' agent-tile--fresh' : ''}" data-action="open-agent" data-agent="${a}" ${active ? 'aria-current="true"' : ''} aria-label="${esc(AGENTS[a].name)}${main ? ` · ${lng('الرئيسي', 'Main')}` : ''}${nw ? ` · ${lng('جديد', 'New')}` : ''}${AGENTS[a].role ? ' · ' + esc(AGENTS[a].role) : ''} · ${STATUS_TXT[st]}" title="${esc(AGENTS[a].name)}${AGENTS[a].role ? ' · ' + esc(AGENTS[a].role) : ''}">
      ${faceDot(a, 52, st)}<bdi class="agent-tile__name">${esc(AGENTS[a].name)}</bdi>${main ? `<span class="agent-tile__main" aria-hidden="true">${lng('الرئيسي', 'Main')}</span>` : ''}${nw ? `<span class="agent-tile__new" aria-hidden="true">${lng('جديد', 'New')}</span>` : ''}</button></div>`;
  }).join('') + (canWrite() ? `<div role="listitem"><button type="button" class="agent-tile agent-tile--new" data-action="new-agent">
      <span class="agent-tile__plus">${icon('plus')}</span><span class="agent-tile__name">${isOwner() ? lng('وكيل جديد', 'New agent') : lng('اطلب وكيل', 'Ask for an agent')}</span></button></div>` : '');
  renderMe();
  renderThreadList();
  const dark = document.documentElement.dataset.theme === 'dark';
  const tb = $('#btn-theme');
  tb.innerHTML = icon(dark ? 'sun' : 'moon');
  tb.setAttribute('aria-pressed', String(dark));
  tb.setAttribute('aria-label', dark ? lng('الوضع الفاتح', 'Light mode') : lng('الوضع الغامق', 'Dark mode'));
  { const ch = $('#me-chev'); if (ch) ch.innerHTML = icon('up'); }
  $('#mobile-menu').innerHTML = icon('menu');
  $('#mobile-title').textContent = { chat: lng('المحادثات', 'Chats'), board: lng('لوحة التسويق', 'Marketing board'), dashboard: lng('الأرقام', 'Numbers'), log: lng('سجل النشاط', 'Activity log') }[state.view];
  renderAppsBtn();
}
/* the account row: the person the prototype is shown as */
function renderMe() {
  const P = me();
  const av = $('#btn-me .me__av'); if (av) av.textContent = P.av;
  const nm = $('#btn-me .me__name'); if (nm) nm.textContent = P.name;
  const rl = $('#btn-me .me__role'); if (rl) rl.textContent = P.job ? `${P.title} · ${P.job}` : P.title;
  const b = $('#btn-me'); if (b) b.setAttribute('aria-label', `${P.name} · ${P.title} · ${lng('إعدادات المساحة واللغة', 'Workspace settings and language')}`);
}
function renderThreadList() {
  const q = state.sbQuery.trim().toLowerCase();
  const all = sortedThreads().filter((t) => threadVisible(t) && (!q || t.title.toLowerCase().includes(q)));
  const chans = all.filter((t) => t.channel).sort((a, b) => ((b.general ? 1 : 0) - (a.general ? 1 : 0)) || (a.day - b.day) || (b.ts - a.ts));
  const list = all.filter((t) => !t.channel);
  const cur = (t) => state.view === 'chat' && state.chatThread === t.id;
  const badge = (t) => { const n = unreadOf(t); return n ? `<span class="sb-unread num" aria-label="${n} ${n === 1 ? lng('رسالة جديدة', 'new message') : lng('رسايل جديدة', 'new messages')}">${n}</span>` : ''; };
  const add = canManage() ? `<button type="button" class="sb-add" data-action="channel-new" aria-label="${lng('قناة جديدة', 'New channel')}" title="${lng('قناة جديدة', 'New channel')}">${icon('plus')}</button>` : '';
  const chHTML = chans.length ? `<div class="thread-group"><div class="sb-label-row"><h2 class="sb-label" id="lbl-ch">${lng('القنوات', 'Channels')}</h2>${add}</div>
    <div role="list" aria-labelledby="lbl-ch">${chans.map((t) => `<div role="listitem"><button type="button" class="sb-item thread-item ch-item${unreadOf(t) ? ' is-unread' : ''}" data-action="open-thread" data-thread="${t.id}" ${cur(t) ? 'aria-current="true"' : ''}>${icon('hash')}<span class="od-truncate">${bx(t.title)}</span>${badge(t)}</button></div>`).join('')}</div></div>` : '';
  const groups = [[0, lng('النهارده', 'Today')], [1, lng('امبارح', 'Yesterday')], [2, lng('أقدم', 'Earlier')]];
  const html = groups.map(([day, label]) => {
    const items = list.filter((t) => (day === 2 ? t.day >= 2 : t.day === day));
    if (!items.length) return '';
    return `<div class="thread-group"><h2 class="sb-label" id="lbl-day-${day}">${label}</h2><div role="list" aria-labelledby="lbl-day-${day}">${items.map((t) => `<div role="listitem"><button type="button" class="sb-item thread-item${unreadOf(t) ? ' is-unread' : ''}" data-action="open-thread" data-thread="${t.id}" ${cur(t) ? 'aria-current="true"' : ''}>
        <span class="od-truncate">${bx(t.title)}</span>${unreadOf(t) ? badge(t) : `<span class="thread-item__time">${esc(t.time)}</span>`}</button></div>`).join('')}</div></div>`;
  }).join('');
  $('#sb-threads').innerHTML = (chHTML + html) || (state.sbQuery.trim() ? `<p class="sb-empty">${lng('مفيش محادثة فيها «', 'No chats match “')}${esc(state.sbQuery.trim())}${lng('»', '”')}</p>`
    : `<p class="sb-empty">${lng('لسه مفيش محادثات. أول ما تكتب لـ Lead هتلاقيها هنا.', 'No chats yet. As soon as you write to Lead, you’ll find it here.')}</p>`);
}

/* ================= transcript ================= */
function renderText(msg) {
  const full = msg.text || '';
  if (msg.streaming) return bx(full.slice(0, msg.shown || 0));
  return full.split('\n').map((ln) => (ln.startsWith('• ') ? `<span class="li">${mx(ln)}</span>` : mx(ln) + '\n')).join('').replace(/\n$/, '');
}
function stepsHTML(t, m) {
  if (!m.steps || !m.steps.length) return '';
  const open = !!m.stepsOpen;
  const just = open && m.stepsJust && Date.now() - m.stepsJust < 700;
  const listId = `st-${t.id}-${m.id}`;
  return `<div class="steps">
    <button type="button" class="steps__toggle" data-action="toggle-steps" data-thread="${t.id}" data-msg="${m.id}" aria-expanded="${open}" aria-controls="${listId}">
      <span>${lng('استخدم', 'Used')} ${m.steps.length} ${(RTL ? m.steps.length > 2 : m.steps.length !== 1) ? lng('أدوات', 'tools') : lng('أداة', 'tool')}${m.stepsDur ? ` · ${esc(m.stepsDur)}` : ''}</span>${icon('chevronDown', 'chev')}
    </button>
    <ol class="steps__list${just ? ' is-just' : ''}" id="${listId}" ${open ? '' : 'hidden'}>
      ${m.steps.map((s, i) => `<li class="step step--${s.state}" style="--i:${i}"><span class="step__dot" aria-hidden="true"></span><span class="step__label">${bx(s.label)}</span>
        <span class="step__state">${s.state === 'done' ? `${icon('check', 'step__ck')}${lng('تم', 'Done')}` : lng('اتخطى', 'Skipped')}</span></li>`).join('')}
    </ol></div>`;
}
const OUTCOME = { once: lng('سمحت مرة واحدة', 'Allowed once'), always: lng('سمحت دايماً', 'Always allowed'), denied: lng('مسمحتش', 'Not allowed') };
const justCls = (c) => (c && c.justAt && Date.now() - c.justAt < 900 ? ' is-just' : '');
const kvHTML = (rows) => (rows && rows.length ? `<dl class="kv">${rows.map((r) => `<div class="kv__row"><dt>${bx(r[0])}</dt><dd>${bx(r[1])}</dd></div>`).join('')}</dl>` : '');
function cardHTML(t, m) {
  const c = m.card;
  if (!c) return '';
  const fresh = m.fresh ? ' card-in' : '';
  if (c.type === 'choice') {
    const letters = ['أ', 'ب', 'ج', 'د'];
    const cost = (o) => o.tag.replace('متوقع ', '');
    if (c.status !== 'pending') {
      const o = c.options[c.answer];
      return `<div class="card qcard is-resolved${fresh}${justCls(c)}" dir="rtl" role="group" aria-label="${esc(c.q)}: اتجاوب">
        <div class="qcard__head"><span class="qcard__q">${bx(c.q)}</span><span class="qcard__hint">اتجاوب</span></div>
        <div class="qcard__opts"><div class="opt is-chosen">
          <span class="opt__key" aria-hidden="true">${letters[c.answer]}</span><span class="opt__t">${bx(o.t)}</span>
          <span class="opt__chip">${bx(cost(o))}</span>${icon('check', 'opt__check')}
          <span class="opt__d">${bx(o.d)}</span>
        </div></div></div>`;
    }
    if (!canWrite()) {
      return `<div class="card qcard${fresh}" dir="rtl" role="group" aria-label="${esc(c.q)}">
      <div class="qcard__head"><span class="qcard__q">${bx(c.q)}</span><span class="qcard__hint">${lng('مستني حد من الفريق يختار', 'Waiting for someone on the team to pick')}</span></div>
      <div class="qcard__opts">${c.options.map((o, i) => `<div class="opt opt--static"><span class="opt__key" aria-hidden="true">${letters[i]}</span><span class="opt__t">${bx(o.t)}</span><span class="opt__chip">${bx(cost(o))}</span><span class="opt__d">${bx(o.d)}</span></div>`).join('')}</div></div>`;
    }
    return `<div class="card qcard${fresh}" dir="rtl" role="group" aria-label="${esc(c.q)}">
      <div class="qcard__head"><span class="qcard__q">${bx(c.q)}</span>
        <span class="qcard__hint">جنب كل زاوية التكلفة المتوقعة لكل ليد. اختار واحدة، أو اكتب رأيك في الرسالة.</span></div>
      <div class="qcard__opts">${c.options.map((o, i) => `
        <button type="button" class="opt" data-action="choose" data-thread="${t.id}" data-msg="${m.id}" data-idx="${i}" aria-describedby="od-${m.id}-${i}">
          <span class="opt__key" aria-hidden="true">${letters[i]}</span><span class="opt__t">${bx(o.t)}</span>
          <span class="opt__chip">${bx(cost(o))}</span>
          <span class="opt__d" id="od-${m.id}-${i}">${bx(o.d)}</span>
        </button>`).join('')}</div></div>`;
  }
  if (c.type === 'approval') {
    const pending = c.status === 'pending';
    const out = pending && !canWrite() ? waitLineHTML(lng('مستني موافقة حد من الفريق', 'Waiting for someone on the team to approve'))
      : pending ? `<div class="card__actions">
        <button type="button" class="btn btn--secondary" data-action="approve" data-decision="denied" data-thread="${t.id}" data-msg="${m.id}">${lng('متسمحش', 'Don’t allow')}</button>
        <button type="button" class="btn btn--secondary" data-action="approve" data-decision="always" data-thread="${t.id}" data-msg="${m.id}">${lng('اسمح دايماً', 'Always allow')}</button>
        <button type="button" class="btn btn--primary" data-action="approve" data-decision="once" data-thread="${t.id}" data-msg="${m.id}">${lng('اسمح مرة', 'Allow once')}</button>
      </div>`
      : `<div class="card__outcome">${icon(c.status === 'denied' ? 'x' : 'check')}<span>${OUTCOME[c.status]} · ${esc(c.resolvedAt || '')}</span></div>`;
    return `<div class="card${pending ? '' : ' is-resolved'}${fresh}${justCls(c)}" role="group" aria-label="${lng('طلب موافقة:', 'Approval request:')} ${esc(c.title)}">
      <div class="card__head">${tile(c.tool, true)}<div class="card__titles"><span class="card__title">${bx(c.title)}</span><span class="card__sub">${bx(c.sub)}</span></div></div>
      ${kvHTML(c.rows)}${out}</div>`;
  }
  if (c.type === 'plan') {
    return `<div class="card card--draft${fresh}" dir="rtl" role="group" aria-label="${esc(c.title)}">
      <div class="card__head"><span class="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true">${icon('file')}</span>
        <div class="card__titles"><span class="card__title">${bx(c.title)}</span><span class="card__sub">${bx(c.sub || 'مسودة · Meta Ads')}</span></div></div>
      ${kvHTML(c.rows)}</div>`;
  }
  /* Critic's reply: one verdict per line, then the decision */
  if (c.type === 'review') {
    return `<div class="card rvcard${fresh}" dir="rtl" role="group" aria-label="مراجعة: ${esc(c.title)}">
      <div class="card__head"><span class="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true">${icon('review')}</span>
        <div class="card__titles"><span class="card__title">${bx(c.title)}</span><span class="card__sub">${bx(c.sub)}</span></div></div>
      <ol class="rv-list">${c.items.map((it, i) => `<li class="rv-item">
        <div class="rv-item__top"><span class="rv-n num">${i + 1}</span><span class="rv-q">«${bx(it.q)}»</span>
          <span class="badge rv-badge${it.ok ? '' : ' is-fix'}">${icon(it.ok ? 'check' : 'pencil')}${it.ok ? 'تمام' : 'يتعدّل'}</span></div>
        <p class="rv-note">${bx(it.note)}</p></li>`).join('')}</ol>
      <div class="rv-decision"><span class="rv-decision__l">القرار</span><span>${bx(c.decision)}</span></div></div>`;
  }
  /* a step the agent never does alone (publish, pay, send to a customer): handed to the person */
  if (c.type === 'hand') {
    const pending = c.status === 'pending';
    /* a step the agent stopped at on its own screen: the secondary action opens that screen */
    const openBtn = c.screen
      ? `<button type="button" class="btn btn--secondary" data-action="scr-watch" data-agent="${c.screen}">${icon('monitor')}<span>${lng('افتح الشاشة', 'Open the screen')}</span></button>`
      : `<button type="button" class="btn btn--secondary" data-action="hand-open" data-thread="${t.id}" data-msg="${m.id}">${icon('open')}<span>${c.code ? lng('افتح طلب الدمج', 'Open the merge request') : lng('افتح المسودة', 'Open the draft')}</span></button>`;
    const out = pending && !canWrite() ? waitLineHTML(lng('مستني حد من الفريق يعملها', 'Waiting for someone on the team to do it'))
      : pending ? `<div class="card__actions">
        ${openBtn}
        <button type="button" class="btn btn--primary" data-action="hand-done" data-thread="${t.id}" data-msg="${m.id}">${lng('عملتها', 'Done it')}</button></div>`
      : `<div class="card__outcome">${icon('check')}<span>${bx(`${lng('عملتها ·', 'Done ·')} ${c.at}. ${c.doneNote || lng('SEO هيتابع ترتيبه في Search Console.', 'SEO will track its ranking in Search Console.')}`)}</span></div>`;
    return `<div class="card hcard${pending ? '' : ' is-resolved'}${fresh}${justCls(c)}" role="group" aria-label="${lng('اتسلّمتلك:', 'Handed to you:')} ${esc(c.title)}">
      <div class="hcard__top"><span class="badge ck-badge">${icon('hand')}${lng('اتسلّمتلك', 'Handed to you')}</span></div>
      <div class="card__head">${tile(c.tool, true)}<div class="card__titles"><span class="card__title">${bx(c.title)}</span><span class="card__sub">${bx(c.sub)}</span></div></div>
      ${kvHTML(c.rows)}${out}</div>`;
  }
  if (c.type === 'proposal') return proposalHTML(t, m);
  if (c.type === 'agentcard') return agentCardHTML(t, m);
  if (c.type === 'ask1') return ask1HTML(t, m);
  if (c.type === 'change') return chgHTML(t, m);
  if (c.type === 'askmgr') return askMgrHTML(t, m);
  return '';
}
const waitLineHTML = (txt) => `<div class="card__outcome">${icon('clock')}<span>${bx(txt)}</span></div>`;
function connectHTML(t, m) {
  const cn = m.connect; if (!cn) return '';
  const k = cn.k; const s = state.conns[k]; const C = CONNS[k];
  const head = `<div class="card__head">${tile(k, true)}<div class="card__titles"><span class="card__title">${lng('وصّل', 'Connect')} ${bx(C.name)}</span><span class="card__sub">${bx(cn.why)}</span></div></div>`;
  if (s === 'connected') {
    return `<div class="card is-resolved" role="group" aria-label="${esc(C.name)} ${lng('اتوصل', 'connected')}">${head}<div class="card__outcome">${icon('check')}<span>${bx(C.name)} ${lng('اتوصل', 'connected')}</span></div></div>`;
  }
  if (state.connLater[k] && s !== 'connecting') {
    return `<div class="card is-resolved" role="group" aria-label="${esc(C.name)} ${lng('اتأجل', 'postponed')}">${head}
      <div class="card__outcome"><span>${lng('اتأجل · تقدر توصّله من التفاصيل في أي وقت', 'Postponed · you can connect it from the details any time')}</span></div></div>`;
  }
  if (!canManage()) return `<div class="card" role="group" aria-label="${lng('وصّل', 'Connect')} ${esc(C.name)}">${head}${waitLineHTML(`${lng('ربط التطبيقات بيعمله', 'Apps are connected by')} ${whoManages()}`)}</div>`;
  return `<div class="card" role="group" aria-label="${lng('وصّل', 'Connect')} ${esc(C.name)}">${head}
    <div class="card__actions">
      <button type="button" class="btn btn--secondary" data-action="connect-later" data-conn="${k}" ${s === 'connecting' ? 'disabled' : ''}>${lng('بعدين', 'Later')}</button>
      <button type="button" class="btn btn--primary" data-action="connect" data-conn="${k}" ${s === 'connecting' ? 'disabled' : ''}>${s === 'connecting' ? lng('بيتوصل…', 'Connecting…') : lng('وصّل', 'Connect')}</button>
    </div></div>`;
}
function filesHTML(files) {
  if (!files || !files.length) return '';
  return `<div class="msg-files">${files.map((f) => `<span class="file-chip">${icon('clip')}<bdi dir="auto">${esc(f)}</bdi></span>`).join('')}</div>`;
}
function msgHTML(t, m) {
  /* in a channel, another member's message: their initial and name, on the start side like the agents */
  if (m.role === 'user' && t.channel && m.by && m.by !== state.as) {
    const Q = PEOPLE[m.by];
    return `<div class="turn turn--peer${m.fresh ? ' msg-in' : ''}" data-msg="${m.id}">
      <div class="sender">${personAv(m.by, 20)}<span>${esc(Q.first)}</span><span class="sender__role">${esc(Q.job || Q.title)}</span><span class="sender__time">${esc(m.time)}</span></div>
      ${m.text ? `<div class="bubble bubble--peer" dir="auto">${renderText(m)}</div>` : ''}${filesHTML(m.files)}</div>`;
  }
  if (m.role === 'user') {
    return `<div class="turn turn--user${m.queued ? ' is-queued' : ''}${m.fresh ? ' msg-in' : ''}" data-msg="${m.id}">
      ${m.text ? `<div class="bubble-row"><span class="bubble__time">${esc(m.time)}</span><div class="bubble bubble--user" dir="auto">${renderText(m)}</div></div>` : ''}
      ${filesHTML(m.files)}${m.queued ? `<span class="queued">${icon('clock')}${lng('هيقراها بعد الخطوة دي', 'It’ll read this after this step')}</span>` : ''}</div>`;
  }
  if (m.role === 'note') {
    const ln = m.link && (!m.link.need || sovHas(m.link.need)) ? ` <button type="button" class="link-btn note__link" data-action="${m.link.action}" data-agent="${esc(m.link.agent || '')}"${m.link.learn ? ` data-learn="${esc(m.link.learn)}"` : ''}>${esc(m.link.label)}</button>` : '';
    return `<div class="note${m.saved ? ' note--saved' : ''}${m.fresh ? ' msg-in' : ''}" data-msg="${m.id}">${m.icon ? icon(m.icon, 'note__icon') : ''}${m.saved ? `<b class="note__saved">${lng('اتحفظت', 'Saved')}</b>` : ''}<span>${bx(m.text)}</span>${ln}</div>`;
  }
  /* agent-to-agent handoff: a quiet system row between turns */
  if (m.role === 'handoff') {
    if (!seeIn(t, m.from) || !seeIn(t, m.to)) return '';
    return `<div class="handoff${m.fresh ? ' msg-in' : ''}" data-msg="${m.id}" role="note">
      <span class="handoff__faces">${face(m.from, 18)}${icon('arrow')}${face(m.to, 18)}</span>
      <span class="handoff__t">${bx(m.text)}</span>${m.detail ? `<span class="handoff__d">· ${bx(m.detail)}</span>` : ''}</div>`;
  }
  if (m.agent && !seeIn(t, m.agent)) return '';
  const a = AGENTS[m.agent];
  const to = m.to && AGENTS[m.to] && seeIn(t, m.to) ? `<span class="sender__to">${lng('لـ', 'to')} <bdi>${esc(AGENTS[m.to].name)}</bdi></span>` : '';
  const sender = `<div class="sender">${face(m.agent, 20)}<bdi>${esc(a.name)}</bdi>${to}<span class="sender__time">${esc(m.time || '')}</span></div>`;
  if (m.pending) {
    return `<div class="turn turn--agent msg-in" data-msg="${m.id}">${sender}<div class="thinking"><span class="shimmer" data-pending="${m.id}">${esc(m.pendingText || lng('بيفكر', 'Thinking'))}…</span></div></div>`;
  }
  const text = m.text ? `<div class="bubble bubble--agent" dir="rtl"><span data-stream="${t.id}:${m.id}">${renderText(m)}</span>${m.streaming ? '<span class="caret" aria-hidden="true"></span>' : ''}</div>` : '';
  const rest = m.streaming ? '' : `${connectHTML(t, m)}${m.after ? `<div class="bubble bubble--agent">${bx(m.after)}</div>` : ''}${cardHTML(t, m)}${m.checkin ? checkinHTML(m) : ''}`;
  return `<div class="turn turn--agent${m.fresh ? ' msg-in' : ''}" data-msg="${m.id}">${sender}${stepsHTML(t, m)}${text}${rest}</div>`;
}
function skeletonHTML() {
  const line = (w) => `<div class="sk sk-line" style="width:${w}%"></div>`;
  return `<div class="transcript__col" aria-busy="true" aria-label="${lng('بيحمّل المحادثة', 'Loading the chat')}">
    <div class="sk-msg" style="align-self:flex-end;width:55%">${line(100)}${line(70)}</div>
    <div class="sk-msg" style="width:80%"><div class="sk" style="width:20px;height:20px;border-radius:50%"></div>${line(90)}${line(95)}${line(60)}</div>
    <div class="sk-msg" style="width:90%">${line(100)}${line(80)}<div class="sk" style="height:180px;border-radius:24px;width:100%"></div></div>
  </div>`;
}
function emptyChatHTML(mode, card) {
  if (mode === 'sheet') {
    const a = AGENTS[card.agent];
    return `<div class="transcript__col"><div class="empty-chat">
      <div class="empty-chat__faces">${face(card.agent, 52)}</div>
      <h2 style="font-size:var(--fs-lg)">${lng('لسه مفيش محادثة على الكارت ده', 'No chat on this card yet')}</h2>
      <p>${lng('اكتب لـ', 'Write to')} <bdi>${esc(a.name)}</bdi> ${lng('تحت وهو هيبدأ يشتغل عليه ويحدّث الكارت.', 'below and it’ll start working on it and keep the card updated.')}</p>
    </div></div>`;
  }
  const ag = state.newChatAgent;
  if (isMain(ag)) return mainEmptyHTML(ag);
  if (ag === 'coder' && !Object.values(threads).some((th) => th.agent === ag)) return coderEmptyHTML();
  if (AGENTS[ag].custom && !Object.values(threads).some((th) => th.agent === ag)) return newAgentEmptyHTML(ag);
  const SUG = {
    ads: [['خطة حملة Meta جديدة', 'لدبلومة الضرائب بميزانية 8,000 ج'], ['ليه تكلفة الليد زادت؟', 'قارن الأسبوع ده باللي فات']],
    seo: [['اقترح 5 مقالات', 'حوالين كورس المحاسب الشامل'], ['حدّث مقال قديم', 'ترتيبه نزل الشهر ده']],
    analyst: [['/report', 'ملخص آخر 7 أيام لكل القنوات'], ['أنهي قناة أرخص؟', 'تكلفة الليد والمبيعات']],
    critic: [['راجع نص إعلان', 'الصق النص وأنا أعلّق عليه'], ['راجع صفحة الهبوط', 'الوعود والأرقام واللهجة']],
  };
  return `<div class="transcript__col"><div class="empty-chat">
    <div class="empty-chat__faces">${visibleAgents().map((a) => face(a, 40)).join('')}</div>
    <h2>${lng('تحب نشتغل على إيه النهارده؟', 'What should we work on today?')}</h2>
    <p>${lng('اختار الوكيل اللي هتكلمه، أو اكتب', 'Pick the agent you want to talk to, or type')} <bdi>@</bdi> ${lng('في الرسالة عشان تنادي أي حد فيهم.', 'in your message to call any of them.')}</p>
    <div class="agent-picker" role="group" aria-label="${lng('اختار الوكيل', 'Pick an agent')}">${visibleAgents().map((a) => `
      <button type="button" class="chip" data-action="pick-new-agent" data-agent="${a}" aria-pressed="${a === ag}">${face(a, 22)}<bdi>${esc(AGENTS[a].name)}</bdi></button>`).join('')}</div>
    <div class="suggest"${canWrite() ? '' : ' hidden'}>${(SUG[ag] || [['قولي بتعرف تعمل إيه', 'والأدوات اللي محتاجها'], ['ابدأ بأول شغلانة', AGENTS[ag].example || 'اكتبله اللي محتاجه']]).map((s) => `<button type="button" data-action="suggest" data-text="${esc(s[0] + (s[0].startsWith('/') ? ' ' : ': ') + s[1])}"><b>${bx(s[0])}</b><span>${bx(s[1])}</span></button>`).join('')}</div>
  </div></div>`;
}
/* a freshly added agent: its face, what it does, and one sentence to start with */
function newAgentEmptyHTML(ag) {
  const A = AGENTS[ag];
  const kind = A.kind === 'team' ? lng('شغال مع الفريق كله', 'Works with the whole team') : lng('شغال معاك انت', 'Works with you');
  return `<div class="transcript__col"><div class="empty-chat empty-chat--agent">
    <div class="empty-chat__faces">${face(ag, 64)}</div>
    <h2><bdi>${esc(A.name)}</bdi></h2>
    <p class="empty-chat__role">${A.role ? bx(A.role) + ' · ' : ''}${kind}</p>
    ${bornHTML(ag, 'empty')}
    <p>${bx(A.line || lng('اديله أول شغلانة، وهو يسألك عن اللي ناقصه ويكمّلها.', 'Give it a first job. It’ll ask you for anything missing and get it done.'))}</p>
    ${A.handoff ? `<p class="empty-chat__hand">${icon('hand')}<span>${bx(A.handoff)}</span></p>` : ''}
    <div class="try-one"${canWrite() ? '' : ' hidden'}><span class="try-one__l">${lng('جرّب تبدأ بالجملة دي', 'Try starting with this sentence')}</span>
      <button type="button" class="try-one__btn" data-action="suggest" data-text="${esc(A.example)}">${bx(A.example)}</button></div>
  </div></div>`;
}
/* the main agent's empty chat (G11): the front door. One sentence on what it is, then three ways in. */
function mainEmptyHTML(ag) {
  const A = AGENTS[ag];
  /* the first run: Lead alone, one line on what it is for, one sentence to try. Nothing else. */
  if (state.world === 'fresh') {
    return `<div class="transcript__col"><div class="empty-chat empty-chat--agent empty-chat--fresh">
    <div class="empty-chat__faces">${face(ag, 64)}</div>
    <h2 class="main-h"><bdi>${esc(A.name)}</bdi><span class="badge main-badge">${lng('الرئيسي', 'Main')}</span></h2>
    <p>${bx(lng('أنا Lead، بمسك شغل التسويق معاك. محتاج وكيل لأي شغلانة؟ قولّي بكلامك وأنا أعمله.', 'I’m Lead and I run your marketing work with you. Need an agent for any job? Tell me in your own words and I’ll make it.'))}</p>
    ${canWrite() ? `<div class="try-one"><span class="try-one__l">${lng('جرّب تقول', 'Try saying')}</span>
      <button type="button" class="try-one__btn" data-action="suggest" data-text="عايز حد يمسك إعلانات Meta وGoogle">${bx('عايز حد يمسك إعلانات Meta وGoogle')}</button></div>` : ''}
  </div></div>`;
  }
  const sug = [
    [lng('ليه تكلفة الليد زادت؟', 'Why did cost per lead go up?'), lng('بيسلّمها للوكيل المسؤول هنا', 'Hands it to the right agent, right here'), 'ليه تكلفة الليد في Google زادت الأسبوع ده؟'],
    [lng('مقال SEO جديد', 'A new SEO article'), lng('عن دبلومة الضرائب', 'About the tax diploma'), 'محتاج مقال SEO عن دبلومة الضرائب يودّي على صفحة الكورس'],
    [isOwner() ? lng('اعمل وكيل جديد', 'Make a new agent') : lng('اطلب وكيل جديد', 'Ask for a new agent'), lng('بكلامك: يمسك السوشيال', 'In your words: one for social'), 'عايز حد يمسك السوشيال: بوستات وريلز لصفحة الأكاديمية'],
    [lng('مين مستني إيه؟', 'Who is waiting on what?'), lng('ملخص اللي واقف النهارده', 'What is stuck today'), 'مين مستني إيه النهارده، وفيه حاجة واقفة؟'],
  ];
  return `<div class="transcript__col"><div class="empty-chat empty-chat--agent">
    <div class="empty-chat__faces">${face(ag, 64)}</div>
    <h2 class="main-h"><bdi>${esc(A.name)}</bdi><span class="badge main-badge">${lng('الرئيسي', 'Main')}</span></h2>
    <p class="empty-chat__role">${bx(A.role || '')}</p>
    <p>${bx(isSolo() ? lng('نقطة التواصل الأساسية ليك: بيتابع معاك كل يوم، وبيسلّم الشغل للوكيل المناسب هنا في نفس المحادثة. ولو محتاج وكيل جديد، قوله بكلامك وهو يعمله.', 'Your main point of contact: it checks in with you every day and hands work to the right agent, right here in the same chat. Need a new agent? Tell it in your own words and it makes it.') : isOwner() ? lng('نقطة التواصل الأساسية للفريق: بيتابع معاك كل يوم، وبيسلّم الشغل للوكيل المناسب هنا في نفس المحادثة. ولو محتاج وكيل جديد، قوله بكلامك وهو يعمله.', 'The team’s main point of contact: it checks in with you every day and hands work to the right agent, right here in the same chat. Need a new agent? Tell it in your own words and it makes it.') : lng('نقطة التواصل الأساسية للفريق: بيتابع معاك كل يوم، وبيسلّم الشغل للوكيل المناسب هنا في نفس المحادثة. ولو محتاج وكيل جديد، قوله وهو يجهّز الطلب لعمر.', 'The team’s main point of contact: it checks in with you every day and hands work to the right agent, right here in the same chat. Need a new agent? Tell it and it prepares the request for Omar.'))}</p>
    ${canWrite() ? `<div class="suggest">${sug.map((x) => `<button type="button" data-action="suggest" data-text="${esc(x[2])}"><b>${bx(x[0])}</b><span>${bx(x[1])}</span></button>`).join('')}</div>` : ''}
  </div></div>`;
}
/* where the composer was, for a viewer: one quiet line (in the main agent's chat it also says a viewer can't ask for agents) */
const roLineHTML = (ag) => `<p class="ro-line">${icon('eye')}<span>${ag && isMain(ag) ? lng('حسابك للمشاهدة بس: بتقرا من غير كتابة أو موافقة، ومينفعش تطلب وكيل جديد.', 'Your account is view-only: you read without writing or approving, and you can’t ask for a new agent.') : lng('حسابك للمشاهدة بس: بتقرا كل اللي مسموحلك بيه، من غير كتابة أو موافقة أو تعديل.', 'Your account is view-only: you can read everything you’re allowed to, without writing, approving or changing anything.')}</span></p>`;
/* an empty team thread: who is in it and how routing works */
function teamEmptyHTML(t) {
  const first = t.team[0];
  return `<div class="transcript__col"><div class="empty-chat">
    <div class="empty-chat__faces">${t.people.map((p) => personAv(p, 40)).join('')}${t.team.map((a) => face(a, 40)).join('')}</div>
    <h2><span class="od-nowrap">#${bx(t.title)}</span></h2>
    <p>${bx(`${lng('قناة فيها', 'A channel with')} ${memberNames(t.people)}${t.team.length ? `${lng('، والوكلاء:', ', and the agents')} ${namesOf(t.team)}` : ''}.`)}</p>
    <p class="team-tip">${icon('at')}<span>${ROUTE_TIP()}</span></p>
    ${canWrite() ? `<div class="suggest">
      <button type="button" data-action="suggest" data-text="صباح الخير يا جماعة، نتفق على مواعيد الحملة هنا"><b>${lng('كلام للفريق بس', 'Just for the team')}</b><span>${lng('من غير @ محدش من الوكلاء هيقرا أو يرد', 'Without @ no agent reads or replies')}</span></button>
      ${first ? `<button type="button" data-action="suggest" data-text="${esc(`${AGENTS[first].handle} ابدأ معانا: قولنا هتحتاج إيه عشان الحملة دي`)}"><b>${bx(`${AGENTS[first].handle} ${lng('بس', 'only')}`)}</b><span>${lng('اللي هتناديه بالاسم هو بس اللي هيرد', 'Only the agent you call by name replies')}</span></button>` : ''}
    </div>` : ''}
  </div></div>`;
}
function renderTranscript(el, threadId, mode, card) {
  if (!el) return;
  const t = threadId ? threads[threadId] : null;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.dataset.threadMount = threadId || '';
  const priv = mode === 'main' ? privLineHTML(t) : '';
  if (!t || !t.msgs.length) { el.innerHTML = t && t.team ? teamEmptyHTML(t) : emptyChatHTML(mode, card); const col = priv && el.querySelector('.transcript__col'); if (col) col.insertAdjacentHTML('afterbegin', priv); return; }
  el.innerHTML = `<div class="transcript__col">${priv}${t.channel ? chIntroHTML(t) : ''}<div class="divider">${t.day === 0 ? lng('النهارده', 'Today') : t.day === 1 ? lng('امبارح', 'Yesterday') : esc(t.dayLabel || lng('أقدم', 'Earlier'))}</div>${t.msgs.map((m) => msgHTML(t, m)).join('')}</div>`;
  t.msgs.forEach((m) => { m.fresh = false; });
  if (atBottom || el.dataset.forceBottom === '1') { el.scrollTop = el.scrollHeight; el.dataset.forceBottom = ''; }
}
function refreshThread(threadId) {
  $$(`[data-thread-mount="${threadId}"]`).forEach((el) => {
    const mode = el.id === 'sheet-transcript' ? 'sheet' : 'main';
    renderTranscript(el, threadId, mode, state.sheetCard ? cardById(state.sheetCard) : null);
  });
}
function refreshMounted() {
  const ids = new Set($$('[data-thread-mount]').map((el) => el.dataset.threadMount).filter(Boolean));
  ids.forEach((id) => {
    const t = threads[id];
    if (t && t.msgs.some((m) => m.streaming)) return; // never interrupt a streaming reply
    refreshThread(id);
  });
}
function scrollMounts(threadId) {
  $$(`[data-thread-mount="${threadId}"]`).forEach((el) => { el.scrollTop = el.scrollHeight; });
}

/* streaming */
function stream(threadId, msg, done) {
  msg.streaming = true; msg.shown = 0;
  const total = msg.text.length;
  if (reduced()) { msg.shown = total; msg.streaming = false; refreshThread(threadId); scrollMounts(threadId); if (done) done(); return; }
  refreshThread(threadId); scrollMounts(threadId);
  const step = () => {
    if (!msg.streaming) return; // stopped by the person
    msg.shown = Math.min(total, msg.shown + 3 + Math.floor(Math.random() * 4));
    const shownText = renderText(msg);
    $$(`[data-stream="${threadId}:${msg.id}"]`).forEach((n) => { n.innerHTML = shownText; });
    scrollMounts(threadId);
    if (msg.shown < total) { window.setTimeout(step, 22); return; }
    msg.streaming = false;
    refreshThread(threadId); scrollMounts(threadId);
    if (done) done();
  };
  window.setTimeout(step, 22);
}

/* ---- a run: an agent (or a chain of agents) working on a thread ----
   While it runs: one live activity line under the transcript, the send arrow becomes a stop square,
   and anything the person types waits in a queue («هيقراها بعد الخطوة دي») until the current step ends. */
const ACT = {
  lead: [lng('بيقرا طلبك', 'Reading your request'), lng('بيشوف مين المسؤول', 'Checking who owns this'), lng('بيكتب الرد', 'Writing the reply')],
  ads: [lng('بيفتح حسابات Meta', 'Opening Meta accounts'), lng('بيقرا نتايج الحملات', 'Reading campaign results'), lng('بيكتب الرد', 'Writing the reply')],
  seo: [lng('بيفتح Search Console', 'Opening Search Console'), lng('بيدوّر على الكلمات', 'Looking for keywords'), lng('بيكتب الرد', 'Writing the reply')],
  analyst: [lng('بيقرا الأرقام', 'Reading the numbers'), lng('بيحسب تكلفة الليد', 'Calculating cost per lead'), lng('بيكتب الملخص', 'Writing the summary')],
  critic: [lng('بيقرا النصوص', 'Reading the scripts'), lng('بيقارن بدليل صوت الأكاديمية', 'Checking against the academy voice guide'), lng('بيكتب الملاحظات', 'Writing notes')],
  other: [lng('بيفكر', 'Thinking'), lng('بيكتب الرد', 'Writing the reply')],
};
const STEP_MS = 1100;
function threadOfKey(key) {
  if (key === 'sheet') { const c = cardById(state.sheetCard); return c && c.thread ? c.thread : null; }
  return threads[state.chatThread] ? state.chatThread : null;
}
const runOf = (threadId) => (threadId && threads[threadId] ? threads[threadId].run : null);
function beginRun(threadId) {
  const t = threads[threadId];
  if (!t.run) t.run = { depth: 0, queue: [], timers: [], agent: null, line: '', onStop: null, stopped: false };
  return t.run;
}
function maybeEnd(threadId, run) {
  const t = threads[threadId];
  if (!t || t.run !== run || run.stopped || run.depth > 0) return;
  t.run = null; syncRunUI(threadId);
}
function syncActivityKey(key) {
  const el = $(`[data-activity="${key}"]`); if (!el) return;
  const run = runOf(threadOfKey(key));
  if (!run || !run.agent || !AGENTS[run.agent] || !seeIn(threads[threadOfKey(key)], run.agent)) { el.hidden = true; el.innerHTML = ''; el.dataset.line = ''; return; }
  const changed = el.dataset.line !== `${run.agent}:${run.line}`;
  el.dataset.line = `${run.agent}:${run.line}`;
  el.hidden = false;
  el.innerHTML = `<span class="dot dot--working" aria-hidden="true"></span>${face(run.agent, 16)}<bdi class="activity__who">${esc(AGENTS[run.agent].name)}</bdi><span class="activity__t shimmer${changed ? ' is-swap' : ''}">${bx(run.line)}…</span>`;
}
function syncRunUI(threadId) {
  ['main', 'sheet'].forEach((k) => { if (threadOfKey(k) === threadId) syncComposer(k); });
  scheduleLive();
}
function setRunLine(threadId, run, agent, line) {
  run.agent = agent; run.line = line; syncRunUI(threadId);
}
/* the reply to a message that waited in the queue: the agent changes course */
function steerReply(agentId, texts) {
  const q = texts.join(' ').trim();
  const short = q.length > 64 ? q.slice(0, 62) + '…' : q;
  let change;
  if (/الرياض|السعودية|جدة|الخليج|سعودي/.test(q)) change = 'هكتب الجاي بلهجة سعودية خفيفة لجمهور الرياض وجدة، ونصوص مصر زي ما هي.';
  else if (/فيديو|ريلز/.test(q)) change = 'هخلّي التركيز على الفيديو القصير، لأنه جاب ليدز أرخص بـ 22% من الصور.';
  else if (/ميزاني|جنيه|\d+\s*ج/.test(q)) change = 'هظبط الميزانية على كلامك، ومش هصرف أي حاجة قبل موافقتك.';
  else if (/قصير|اختصر|أقصر|اقصر/.test(q)) change = 'هختصر كل نص لسطرين بالكتير.';
  else if (/استنى|متكملش|ماتكملش|وقف/.test(q)) change = 'هقف عند الخطوة دي، ومش هكمّل غير لما تقولي.';
  else change = 'همشي بكلامك ده من الخطوة الجاية.';
  return { text: `قريت رسالتك «${short}». ${change}`, activity: [lng('بيقرا رسالتك', 'Reading your message')] };
}
function stopRun(threadId) {
  const t = threads[threadId]; const run = t && t.run; if (!run) return;
  run.stopped = true;
  run.timers.forEach((id) => window.clearTimeout(id));
  const who = run.agent && AGENTS[run.agent] ? AGENTS[run.agent].name : lng('الوكيل', 'The agent');
  const line = run.line;
  for (let i = t.msgs.length - 1; i >= 0; i--) if (t.msgs[i].pending) t.msgs.splice(i, 1);
  const st = t.msgs.find((m) => m.streaming);
  if (st) { st.streaming = false; st.text = st.text.slice(0, st.shown || 0).replace(/\s+\S*$/, '') + '…'; }
  run.queue.forEach((id) => { const m = t.msgs.find((x) => x.id === id); if (m) m.queued = false; });
  t.msgs.push({ id: nid('n'), role: 'note', icon: 'stop', fresh: true,
    text: st ? `${lng('وقّفته.', 'Stopped.')} ${who} ${lng('وقف في نص الرد', 'stopped mid-reply')}` : `${lng('وقّفته.', 'Stopped.')} ${who} ${lng('وقف عند «', 'stopped at “')}${line}${lng('»', '”')}` });
  t.run = null;
  if (run.onStop) run.onStop();
  refreshThread(threadId); scrollMounts(threadId); rerenderAll(); syncRunUI(threadId);
}
function agentSays(threadId, agentId, payload, done, pendingText, onStop) {
  const t = threads[threadId];
  const run = beginRun(threadId);
  run.depth += 1; if (onStop) run.onStop = onStop;
  const lines = payload.activity || (pendingText ? [pendingText, lng('بيكتب الرد', 'Writing the reply')] : (ACT[agentId] || ACT.other));
  const pend = { id: nid('p'), role: 'agent', agent: agentId, pending: true, pendingText: lines[0], time: nowTime() };
  t.msgs.push(pend);
  refreshThread(threadId); scrollMounts(threadId);
  setRunLine(threadId, run, agentId, lines[0]);
  let k = 0;
  const finish = () => {
    if (run.stopped) return;
    run.depth -= 1;
    /* steer: messages typed during this step are read now, and the agent answers them before going on */
    if (run.queue.length) {
      const ids = run.queue.splice(0); const texts = [];
      ids.forEach((id) => { const m = t.msgs.find((x) => x.id === id); if (m) { m.queued = false; texts.push(m.text); } });
      refreshThread(threadId);
      agentSays(threadId, agentId, steerReply(agentId, texts), done);
      return;
    }
    if (done) done();
    maybeEnd(threadId, run);
  };
  const tick = () => {
    if (run.stopped) return;
    k += 1;
    if (k < lines.length) {
      pend.pendingText = lines[k];
      $$(`[data-pending="${pend.id}"]`).forEach((n) => { n.textContent = `${lines[k]}…`; n.classList.remove('is-swap'); void n.offsetWidth; n.classList.add('is-swap'); });
      setRunLine(threadId, run, agentId, lines[k]);
      run.timers.push(later(STEP_MS, tick));
      return;
    }
    const i = t.msgs.indexOf(pend);
    const msg = Object.assign({ id: nid('a'), role: 'agent', agent: agentId, time: nowTime(), fresh: true }, payload);
    delete msg.activity;
    if (i >= 0) t.msgs.splice(i, 1, msg); else t.msgs.push(msg);
    noteUnread(threadId);
    setRunLine(threadId, run, agentId, lng('بيكتب الرد', 'Writing the reply'));
    if (msg.text) stream(threadId, msg, finish);
    else { refreshThread(threadId); scrollMounts(threadId); finish(); }
  };
  run.timers.push(later(STEP_MS, tick));
}
/* a chain of replies and handoff rows, as one run (stop halts the whole chain) */
function runSteps(threadId, steps, onReply, done) {
  const t = threads[threadId];
  const run = beginRun(threadId); run.depth += 1;
  let i = 0;
  const next = () => {
    if (run.stopped) return;
    const s = steps[i++];
    if (!s) { run.depth -= 1; if (done) done(); maybeEnd(threadId, run); return; }
    if (s.kind === 'reply') {
      if (onReply) onReply(s.a);
      agentSays(threadId, s.a, s.payload, () => { run.timers.push(later(300, next)); });
      return;
    }
    if (s.kind === 'handoff') {
      t.msgs.push({ id: nid('h'), role: 'handoff', from: s.from, to: s.to, text: s.text, detail: s.detail, time: nowTime(), fresh: true });
      logAuto(WHO.a(s.from), `${lng('سلّم لـ', 'handed to')} ${AGENTS[s.to].name}`, { card: t.card && cardById(t.card) ? t.card : null, agent: s.to, to: s.detail || null });
      setRunLine(threadId, run, s.from, `${lng('بيبعت لـ', 'Sending to')} ${AGENTS[s.to].name}`);
    } else {
      t.msgs.push({ id: nid('n'), role: 'note', icon: s.icon, text: s.text, link: s.link, fresh: true });
    }
    refreshThread(threadId); scrollMounts(threadId);
    run.timers.push(later(s.kind === 'handoff' ? 600 : 250, next));
  };
  next();
}

/* ================= chat view ================= */
/* mic: hold to dictate (release to finish) or click to start/stop; Esc cancels. A waveform replaces the field,
   then the words land in the composer in the agent's speech language (prototype: simulated, no real mic) */
const recs = {};
const recClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const composerAgent = (key) => (key === 'sheet' ? ((cardById(state.sheetCard) || {}).agent || currentThreadAgent()) : currentThreadAgent());
const WAVE_N = 28;
const isTeamKey = (key) => { const t = threads[threadOfKey(key)]; return !!(t && t.team); };
const phFor = (key) => { const ch = chanOf(key); return ch ? lng(`اكتب في #${ch.title}… والوكيل بيرد بس لو ناديته باسمه`, `Write in #${ch.title}… an agent replies only when called by name`) : `اكتب لـ ${AGENTS[composerAgent(key)].name}…`; };
function syncMic(key) {
  const r = recs[key];
  const btn = $(`[data-action="mic"][data-key="${key}"]`); const lab = $(`[data-rec="${key}"]`); const ta = $(`#ta-${key}`);
  const comp = $(`[data-composer="${key}"]`); const wave = $(`[data-wave="${key}"]`);
  const plus = $(`[data-action="plus-menu"][data-key="${key}"]`); const cancel = $(`[data-action="mic-cancel"][data-key="${key}"]`);
  if (btn) {
    btn.setAttribute('aria-pressed', String(!!r));
    btn.setAttribute('aria-label', r ? lng('خلّص التسجيل', 'Finish recording') : lng('إملاء بالصوت: اضغط واتكلم، أو دوس مرة تبدأ', 'Voice dictation: hold and talk, or click once to start'));
    btn.title = r ? lng('خلّص التسجيل', 'Finish recording') : lng('اضغط واتكلم، أو دوس مرة تبدأ · Esc يلغي', 'Hold and talk, or click once to start · Esc cancels');
    btn.innerHTML = icon(r ? 'stop' : 'mic');
  }
  if (lab) lab.hidden = !r;
  if (comp) comp.classList.toggle('is-rec', !!r);
  if (wave) wave.hidden = !r;
  if (plus) plus.hidden = !!r;
  if (cancel) cancel.hidden = !r;
  const hint = $(`[data-wave-hint="${key}"]`);
  if (hint && r) {
    const lang = langName(AGENTS[composerAgent(key)].voiceLang || 'ar-EG');
    hint.textContent = r.mode === 'hold' ? `${lng('بسمعك ·', 'Listening ·')} ${lang} ${lng('· سيب الزرار لما تخلّص', '· release the button when you’re done')}` : r.mode === 'click' ? `${lng('بسمعك ·', 'Listening ·')} ${lang} ${lng('· دوس تاني لما تخلّص، أو Esc للإلغاء', '· click again when you’re done, or Esc to cancel')}` : `${lng('بسمعك ·', 'Listening ·')} ${lang}`;
  }
  const t = $(`[data-rec-t="${key}"]`); if (t) t.textContent = recClock(r ? r.sec : 0);
}
function waveTick(key) {
  const r = recs[key]; if (!r) return;
  r.phase += 0.55;
  const bars = $$(`[data-wave="${key}"] .wave__bar`);
  bars.forEach((b, i) => {
    const env = 0.35 + 0.65 * Math.abs(Math.sin(r.phase * 0.45 + i * 0.32));
    const v = reduced() ? 0.3 + 0.5 * Math.abs(Math.sin(i * 0.9)) : Math.max(0.12, Math.min(1, env * (0.4 + Math.random() * 0.6)));
    b.style.transform = `scaleY(${v.toFixed(2)})`;
  });
}
function startMic(key, mode) {
  closePlus(key); closePop(key);
  const r = { sec: 0, mode: mode || 'press', phase: 0 };
  r.timer = window.setInterval(() => {
    r.sec += 1;
    const t = $(`[data-rec-t="${key}"]`); if (t) t.textContent = recClock(r.sec);
    if (r.sec >= 60) stopMic(key, true);
  }, 1000);
  recs[key] = r; syncMic(key);
  waveTick(key);
  if (!reduced()) r.wave = window.setInterval(() => waveTick(key), 140);
}
function stopMic(key, keep) {
  const r = recs[key]; if (!r) return;
  window.clearInterval(r.timer); window.clearInterval(r.wave); delete recs[key];
  syncMic(key);
  const ta = $(`#ta-${key}`); const ag = composerAgent(key);
  if (!ta) return;
  if (!keep) { ta.placeholder = phFor(key); ta.focus(); return; }
  ta.placeholder = lng('بيكتب كلامك…', 'Writing what you said…');
  later(700, () => {
    const t2 = $(`#ta-${key}`); if (!t2) return;
    t2.placeholder = phFor(key);
    const lang = AGENTS[ag].voiceLang || 'ar-EG';
    const words = lang !== 'ar-EG' ? DICT_SAMPLE[lang] : isTeamKey(key) ? TEAM_SAMPLE : (VOICE_SAMPLE[ag] || VOICE_SAMPLE.ads);
    insertAtCaret(key, words);
  });
}
function composerHTML(key, agentId) {
  const bars = Array.from({ length: WAVE_N }, () => '<span class="wave__bar"></span>').join('');
  const r = recs[key];
  return `<div class="activity" data-activity="${key}" role="status" aria-live="polite" hidden></div>
  <div class="composer${r ? ' is-rec' : ''}" data-composer="${key}">
    <div class="menu" data-pop="${key}" role="listbox" aria-label="${lng('اقتراحات', 'Suggestions')}" hidden></div>
    <div class="menu" data-plus-menu="${key}" role="menu" aria-label="${lng('إضافات', 'More')}" hidden></div>
    <div class="composer__files" data-files="${key}" hidden></div>
    <div class="composer__row">
      <button type="button" class="composer__btn" data-action="plus-menu" data-key="${key}" aria-haspopup="menu" aria-expanded="false" aria-label="${plusLabel(key)}" ${r ? 'hidden' : ''}>${icon('plus')}</button>
      <button type="button" class="composer__btn" data-action="mic-cancel" data-key="${key}" aria-label="${lng('الغي التسجيل', 'Cancel recording')}" ${r ? '' : 'hidden'}>${icon('x')}</button>
      <label class="sr-only" for="ta-${key}">${isTeamKey(key) ? lng('اكتب رسالتك في القناة', 'Write your message in the channel') : `${lng('اكتب رسالتك لـ', 'Write your message to')} ${esc(AGENTS[agentId].name)}`}</label>
      <textarea class="composer__input" id="ta-${key}" rows="1" dir="auto" data-ta="${key}" placeholder="${esc(r ? lng('بسمعك…', 'Listening…') : phFor(key))}" aria-autocomplete="list" aria-expanded="false"></textarea>
      <div class="wave" data-wave="${key}" ${r ? '' : 'hidden'}><span class="wave__bars" aria-hidden="true">${bars}</span><span class="wave__hint" data-wave-hint="${key}"></span></div>
      <span class="composer__rec" data-rec="${key}" ${r ? '' : 'hidden'}><span class="rec-dot" aria-hidden="true"></span><span class="num" data-rec-t="${key}">${recClock(r ? r.sec : 0)}</span></span>
      <button type="button" class="composer__btn composer__mic" data-action="mic" data-key="${key}" aria-pressed="${!!r}" aria-label="${r ? lng('خلّص التسجيل', 'Finish recording') : lng('إملاء بالصوت: اضغط واتكلم، أو دوس مرة تبدأ', 'Voice dictation: hold and talk, or click once to start')}" title="${lng('اضغط واتكلم، أو دوس مرة تبدأ · Esc يلغي', 'Hold and talk, or click once to start · Esc cancels')}">${icon(r ? 'stop' : 'mic')}</button>
      <button type="button" class="composer__send" data-action="send" data-key="${key}" data-icon="send" aria-label="${lng('ابعت', 'Send')}" disabled>${icon('send')}</button>
    </div>
  </div>`;
}
function renderChat() {
  const v = $('#view-chat');
  const t = threads[state.chatThread];
  const ag = t ? t.agent : state.newChatAgent;
  const c = t && t.card ? cardById(t.card) : null;
  const pillOpen = overlayDetails() ? $('#details').classList.contains('is-open') : state.detailsOpen;
  const team = t && t.team;
  if (t && t.unread) t.unread[state.as] = 0; // opening it reads it
  v.innerHTML = `<div class="chat">
    <div class="chat__top">
      <button type="button" class="head-pill" data-action="toggle-details" aria-controls="details" aria-expanded="${pillOpen}" id="btn-details" aria-label="${esc(t ? t.title : lng('محادثة جديدة', 'New chat'))} · ${team ? lng('تفاصيل القناة', 'Channel details') : `${lng('تفاصيل', 'Details:')} ${esc(AGENTS[ag].name)}`}">
        ${t && t.channel ? `<span class="hp-hash" aria-hidden="true">${icon('hash')}</span>` : team ? faceStack(t.team, 24) : face(ag, 24)}<span class="head-pill__title od-truncate">${bx(t ? t.title : lng('محادثة جديدة', 'New chat'))}</span>
      </button>
      ${c ? `<div class="chat__corner"><button type="button" class="corner-pill${c.col === 'waiting' ? ' is-waiting' : ''}" data-action="show-on-board" data-card="${c.id}" aria-label="${lng('على اللوحة:', 'On the board:')} ${esc(colName(c.col))}">
        <span class="dot dot--${c.col === 'waiting' ? 'waiting' : 'idle'}" aria-hidden="true"></span><span class="corner-pill__lbl">${lng('على اللوحة:', 'On the board:')}</span><span class="corner-pill__col">${esc(c.col === 'waiting' && !canWrite() ? lng('مستني الفريق', 'Waiting on the team') : colName(c.col))}</span></button></div>` : ''}
    </div>
    <div class="transcript" id="chat-transcript" tabindex="-1"></div>
    <div class="composer-area">${canWrite() ? newHintHTML() + composerHTML('main', ag) : roLineHTML(ag)}</div>
  </div>`;
  syncFiles('main');
  if (recs.main) syncMic('main');
  const tr = $('#chat-transcript');
  if (!state.chatBooted && state.chatThread === 'th-meta') {
    tr.innerHTML = skeletonHTML();
    tr.dataset.threadMount = '';
    state.chatBooted = true;
    later(700, () => {
      if (state.view !== 'chat' || state.chatThread !== 'th-meta') return;
      const live = $('#chat-transcript'); if (!live) return;
      const th = threads['th-meta'];
      const boot = th.msgs.find((m) => m.bootStream);
      live.dataset.threadMount = 'th-meta'; live.dataset.forceBottom = '1';
      if (boot) { boot.bootStream = false; boot.fresh = true; stream('th-meta', boot); }
      else renderTranscript(live, 'th-meta', 'main');
    });
  } else {
    state.chatBooted = true;
    threads['th-meta'].msgs.forEach((m) => { m.bootStream = false; });
    tr.dataset.forceBottom = '1';
    renderTranscript(tr, state.chatThread, 'main');
  }
}

/* ================= details panel ================= */
const MODELS = [
  { n: 'Opus 5.5', logo: 'claude', d: lng('أدق في التخطيط', 'Sharpest at planning') },
  { n: 'GPT-5', logo: 'openai', d: lng('متوازن', 'Balanced') },
  { n: 'Gemini 2.5 Pro', logo: 'gemini', d: lng('أسرع في الأرقام الكبيرة', 'Fastest with big numbers') },
];
const detailsAgent = () => (state.sov && state.sov.agent ? state.sov.agent : state.view === 'chat' ? currentThreadAgent() : state.detailsAgent);
/* ---- settings draft: edits live here until «احفظ» ---- */
const settingsSnap = (a) => {
  const A = AGENTS[a];
  return { name: A.name, role: A.role, desc: A.desc, instr: A.instr, model: A.model, effort: A.effort, tools: Object.assign({}, A.toolsOn), skills: A.skills.map((s) => s.on), checkinOn: A.checkinOn, checkinTime: A.checkinTime,
    voiceLang: A.voiceLang || 'ar-EG', voice: A.voice || 'noor', voiceSpeed: A.voiceSpeed || '1' };
};
const draftOf = (a) => state.drafts[a] || (state.drafts[a] = settingsSnap(a));
const isDirty = (a) => !!state.drafts[a] && JSON.stringify(state.drafts[a]) !== JSON.stringify(settingsSnap(a));
function syncSaveBar() {
  const bar = $('#dp-savebar'); if (!bar) return;
  bar.hidden = !isDirty(detailsAgent());
}
function nudgeSaveBar() {
  const bar = $('#dp-savebar'); if (!bar || bar.hidden) return;
  bar.classList.remove('is-flash'); void bar.offsetWidth; bar.classList.add('is-flash');
  const b = $('[data-action="save-settings"]', bar); if (b) b.focus();
  toast(lng('احفظ التعديلات أو الغيها الأول', 'Save or discard your changes first'));
}
/* while the settings overlay is open, the agent's settings and memory render inside it */
function renderDetails() { if (state.sov) { renderSov(); return; } renderDetailsPanel(); }
function renderDetailsPanel() {
  const d = $('#details');
  const ct = state.view === 'chat' ? threads[state.chatThread] : null;
  if (ct && ct.team) { renderTeamDetails(d, ct); return; }
  const a = detailsAgent();
  const A = AGENTS[a];
  const st = agentStatus(a);
  /* keep scroll position and the focused field across re-renders */
  const viewKey = `${a}:${state.dpSettings ? 'settings' : state.dpTab}`;
  const oldScroll = $('.dp-scroll', d);
  const keepTop = oldScroll && d.dataset.viewKey === viewKey ? oldScroll.scrollTop : 0;
  const ae = document.activeElement;
  const fid = ae && ae.id && d.contains(ae) ? ae.id : null;
  let sel = null;
  if (fid && /INPUT|TEXTAREA/.test(ae.tagName)) { try { sel = [ae.selectionStart, ae.selectionEnd]; } catch (err) { sel = null; } }

  const D = state.dpSettings && canManage() ? draftOf(a) : null;
  const shownName = D ? (D.name.trim() || A.name) : A.name;
  const shownRole = D ? D.role.trim() : A.role;
  const top = `<div class="dp-top">
      <button type="button" class="circle-btn" data-action="dp-settings" aria-haspopup="dialog" aria-label="${lng('إعدادات', 'Settings for')} ${esc(A.name)}" title="${lng('الإعدادات', 'Settings')}">${icon('gear')}</button>
      <button type="button" class="circle-btn" data-action="close-details" aria-label="${lng('اقفل التفاصيل', 'Close details')}">${icon('x')}</button></div>`;
  const id = `<div class="dp-id">${faceDot(a, 64, st, true)}
      <div><div class="dp-id__name"><bdi id="dp-id-name">${esc(shownName)}</bdi>${isMain(a) ? lng('<span class="badge dp-id__badge" title="نقطة التواصل الأساسية: بيبعت صباح الخير وبيسلّم الشغل للوكيل المناسب">الرئيسي</span>', '<span class="badge dp-id__badge" title="The main point of contact: sends the good-morning message and hands work to the right agent">Main</span>') : ''}</div>
      <div class="dp-id__role"><span id="dp-id-role">${shownRole ? bx(shownRole) + ' · ' : ''}</span>${STATUS_TXT[st]}</div>${bornHTML(a, 'panel')}</div></div>`;
  let body;
  if (state.dpSettings) {
    body = canManage() ? settingsHTML(a) : settingsReadHTML(a);
  } else {
    const tabs = [['activity', lng('نشاط', 'Activity')], ['tasks', lng('مهام', 'Tasks')], ['files', lng('ملفات', 'Files')], ['memory', lng('ذاكرة', 'Memory')], ['log', lng('السجل', 'Log')]];
    const panel = { activity: activityHTML, tasks: tasksHTML, files: filesTabHTML, memory: memoryHTML, log: agentLogHTML }[state.dpTab] || activityHTML;
    body = `<div class="segmented" role="tablist" aria-label="${lng('تفاصيل', 'Details:')} ${esc(A.name)}">${tabs.map(([k, l]) => `
        <button type="button" role="tab" id="dp-tab-${k}" aria-selected="${state.dpTab === k}" aria-controls="dp-panel" tabindex="${state.dpTab === k ? 0 : -1}" data-action="dp-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="dp-panel" role="tabpanel" aria-labelledby="dp-tab-${state.dpTab}" class="dp-sections">${panel(a)}</div>`;
  }
  const bar = state.dpSettings && canManage() ? `<div class="dp-savebar" id="dp-savebar" role="region" aria-label="${lng('حفظ الإعدادات', 'Save settings')}" hidden>
      <span class="dp-savebar__t">${lng('فيه تعديلات مش متحفظة', 'You have unsaved changes')}</span>
      <button type="button" class="btn btn--secondary btn--sm" data-action="discard-settings">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary btn--sm" data-action="save-settings">${lng('احفظ', 'Save')}</button></div>` : '';
  d.innerHTML = top + `<div class="dp-scroll">${id}${body}</div>` + bar;
  d.dataset.viewKey = viewKey;
  const ns = $('.dp-scroll', d); if (ns && keepTop) ns.scrollTop = keepTop;
  if (fid) {
    const n = document.getElementById(fid);
    if (n) { n.focus({ preventScroll: true }); if (sel) { try { n.setSelectionRange(sel[0], sel[1]); } catch (err) { /* not a text field */ } } }
  }
  syncSaveBar();
}

/* ---- team thread details: members, «ضيف وكيل», routing hint, board card, handoffs ---- */
function renderTeamDetails(d, t) {
  const keep = d.dataset.viewKey === `team:${t.id}` ? ($('.dp-scroll', d) || {}).scrollTop || 0 : 0;
  const ae = document.activeElement; const fid = ae && ae.id && d.contains(ae) ? ae.id : null;
  const mgr = canManage();
  const busy = t.team.filter((a) => agentStatus(a) === 'working').length;
  const rm = (id, act, attr, label) => `<button type="button" class="link-btn" id="${id}" data-action="${act}" ${attr} aria-label="${lng('شيل', 'Remove')} ${esc(label)} ${lng('من القناة', 'from the channel')}">${lng('شيل', 'Remove')}</button>`;
  /* people */
  const pRows = t.people.map((p) => { const Q = PEOPLE[p]; return `<li class="panel-row">${personAv(p, 28)}
      <span class="panel-row__text"><span class="panel-row__t">${esc(Q.name)}${p === state.as ? ` <span class="ch-you">${lng('(انت)', '(you)')}</span>` : ''}</span><span class="panel-row__d">${esc(Q.title)}${Q.job ? ` · ${esc(Q.job)}` : ''}${Q.role === 'viewer' ? ` · ${lng('بتقرا بس', 'reads only')}` : ''}${Q.pending ? ` · ${lng('اتبعتله دعوة', 'Invite sent')}` : ''}</span></span>
      ${mgr && !t.general && p !== state.as ? rm(`ch-rm-${p}`, 'ch-remove', `data-person="${p}"`, Q.name) : ''}</li>`; }).join('');
  const pCands = roster().filter((p) => !t.people.includes(p));
  const pPick = state.chAddingPerson && mgr ? (pCands.length ? pCands.map((p) => `<li class="panel-row tm-cand">${personAv(p, 28)}
      <span class="panel-row__text"><span class="panel-row__t">${esc(PEOPLE[p].name)}</span><span class="panel-row__d">${esc(PEOPLE[p].title)}${PEOPLE[p].job ? ` · ${esc(PEOPLE[p].job)}` : ''}</span></span>
      <button type="button" class="btn btn--secondary btn--sm" id="ch-add-${p}" data-action="ch-add" data-person="${p}">${lng('ضيف', 'Add')}</button></li>`).join('')
    : `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__d">${lng('كل أعضاء الشركة في القناة دي', 'Everyone in the company is in this channel')}</span></span></li>`) : '';
  const people = `<section class="dp-sec" aria-labelledby="ch-h-p"><h3 class="dp-label" id="ch-h-p"><span>${lng('الأعضاء', 'Members')} <span class="muted num">${t.people.length}</span></span></h3>
    <ul class="panel-card">${pRows}
      ${mgr && !t.general ? `<li><button type="button" class="panel-row tm-add" id="ch-add-open" data-action="ch-add-open" aria-expanded="${state.chAddingPerson}">
        <span class="panel-row__icon">${icon(state.chAddingPerson ? 'x' : 'plus')}</span><span class="panel-row__text"><span class="panel-row__t">${state.chAddingPerson ? lng('خلاص', 'Done') : lng('ضيف عضو', 'Add a member')}</span></span></button></li>` : ''}
      ${pPick}
      ${t.general ? `<li class="tm-hint"><span>${icon('team')}</span><span>${lng('«عام» فيها كل أعضاء الشركة دايماً.', '“عام” always has everyone in the company.')}</span></li>` : ''}
    </ul></section>`;
  /* agents */
  const aCands = chanAgentsPool().filter((a) => !t.team.includes(a));
  const aRows = t.team.map((a) => `<li class="panel-row">${faceDot(a, 28, agentStatus(a))}
      <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(AGENTS[a].name)}</bdi></span><span class="panel-row__d">${canSee(a) ? `${bx(AGENTS[a].role || '')}${AGENTS[a].role ? ' · ' : ''}${STATUS_TXT[agentStatus(a)]}` : lng('ظاهر لك في القناة دي بس', 'Shown to you in this channel only')}</span></span>
      ${mgr ? rm(`tm-rm-${a}`, 'team-remove', `data-agent="${a}"`, AGENTS[a].name) : ''}</li>`).join('');
  const aPick = state.teamAdding && mgr ? (aCands.length ? aCands.map((a) => `<li class="panel-row tm-cand">${face(a, 28)}
      <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(AGENTS[a].name)}</bdi></span><span class="panel-row__d">${bx(AGENTS[a].role || lng('وكيل جديد', 'New agent'))}</span></span>
      <button type="button" class="btn btn--secondary btn--sm" id="tm-add-${a}" data-action="team-add" data-agent="${a}">${lng('ضيف', 'Add')}</button></li>`).join('')
    : `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__d">${lng('كل الوكلاء في القناة دي', 'Every agent is already in this channel')}</span></span></li>`) : '';
  const agents = `<section class="dp-sec" aria-labelledby="tm-h"><h3 class="dp-label" id="tm-h"><span>${lng('الوكلاء', 'Agents')} <span class="muted num">${t.team.length}</span></span></h3>
    <ul class="panel-card">${aRows || `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__d">${lng('مفيش وكلاء في القناة دي لسه.', 'No agents in this channel yet.')}</span></span></li>`}
      ${mgr ? `<li><button type="button" class="panel-row tm-add" id="tm-add-open" data-action="team-add-open" aria-expanded="${state.teamAdding}">
        <span class="panel-row__icon">${icon(state.teamAdding ? 'x' : 'plus')}</span><span class="panel-row__text"><span class="panel-row__t">${state.teamAdding ? lng('خلاص', 'Done') : lng('ضيف وكيل', 'Add an agent')}</span></span></button></li>` : ''}
      ${aPick}
      <li class="tm-hint"><span>${icon('at')}</span><span>${ROUTE_TIP()}</span></li>
      <li class="tm-hint"><span>${icon('eye')}</span><span>${lng('أي عضو في القناة يشوف وكلاءها وينادي عليهم هنا، حتى لو الوكيل مش ظاهر له برّه القناة. برّه القناة مفيش حاجة بتتغيّر.', 'Every member of the channel sees its agents and can call them here, even an agent hidden from them elsewhere. Outside the channel nothing changes.')}</span></li>
    </ul>${mgr ? '' : `<p class="set-hint ch-who">${bx(`${lng('الأعضاء والوكلاء بيضيفهم ويشيلهم', 'Members and agents are added and removed by')} ${whoManages()}.`)}</p>`}</section>`;
  const c = t.card ? cardById(t.card) : null;
  const board = c && cardVisible(c) ? `<section class="dp-sec"><h3 class="dp-label"><span>${lng('على اللوحة', 'On the board')}</span></h3>
    <div class="panel-card"><button type="button" class="panel-row" data-action="show-on-board" data-card="${c.id}">
      <span class="panel-row__text"><span class="panel-row__t">${bx(c.title)}</span><span class="panel-row__d">${bx(c.col === 'waiting' ? c.wait : c.col === 'progress' ? `${c.ticks[c.tick % c.ticks.length]} · ${c.pct}%` : (c.prog || ''))}</span></span>
      <span class="panel-row__meta${c.col === 'waiting' ? ' panel-row__meta--wait' : ''}">${c.col === 'waiting' ? '<span class="dot dot--waiting" aria-hidden="true"></span>' : ''}${esc(colName(c.col))}</span></button></div></section>` : '';
  const allH = t.msgs.filter((m) => m.role === 'handoff' && seeIn(t, m.from) && seeIn(t, m.to));
  const hs = allH.slice(-4).reverse();
  const hand = allH.length ? `<section class="dp-sec"><h3 class="dp-label"><span>${lng('التسليمات', 'Handoffs')} <span class="muted num">${allH.length}</span></span></h3>
    <ul class="panel-card">${hs.map((m) => `<li class="panel-row"><span class="handoff__faces">${face(m.from, 20)}${icon('arrow')}${face(m.to, 20)}</span>
      <span class="panel-row__text"><span class="panel-row__t">${bx(m.text)}</span><span class="panel-row__d">${bx([m.detail, m.time].filter(Boolean).join(' · '))}</span></span></li>`).join('')}</ul></section>` : '';
  d.innerHTML = `<div class="dp-top"><span class="dp-top__l">${lng('قناة', 'Channel')}</span>
      <button type="button" class="circle-btn" data-action="close-details" aria-label="${lng('اقفل التفاصيل', 'Close details')}">${icon('x')}</button></div>
    <div class="dp-scroll"><div class="dp-id"><span class="hp-hash hp-hash--xl" aria-hidden="true">${icon('hash')}</span>
      <div><div class="dp-id__name">#${bx(t.title)}</div><div class="dp-id__role">${t.people.length} ${lng('أعضاء', 'members')} · ${t.team.length} ${lng('وكلاء', 'agents')}${busy ? ` · <span class="dot dot--working" aria-hidden="true"></span>${busy} ${lng('شغال', 'working')}` : ''}</div></div></div>
      <div class="dp-sections">${people}${agents}${board}${hand}</div></div>`;
  d.dataset.viewKey = `team:${t.id}`;
  const ns = $('.dp-scroll', d); if (ns && keep) ns.scrollTop = keep;
  if (fid) { const n = document.getElementById(fid); if (n) n.focus({ preventScroll: true }); }
}
function teamThreadNow() {
  if (state.sheetCard) { const c = cardById(state.sheetCard); if (c && c.thread && threads[c.thread] && threads[c.thread].team) return threads[c.thread]; }
  const t = threads[state.chatThread]; return t && t.team ? t : null;
}
function teamAdd(a) {
  const t = teamThreadNow(); if (!t || !AGENTS[a] || t.team.includes(a) || !canManage()) return;
  t.team.push(a);
  t.msgs.push({ id: nid('n'), role: 'note', icon: 'team', text: `${me().first} ${meAct('ضاف', 'ضافت', 'added')} ${AGENTS[a].name} ${lng('للقناة', 'to the channel')}`, fresh: true });
  logAuto(ME(), `${meAct('ضاف', 'ضافت', 'added')} ${AGENTS[a].name} ${lng('لقناة', 'to the channel')}`, { chan: t.id, agent: a, obj: `#${t.title}` });
  state.teamAdding = false;
  refreshThread(t.id); scrollMounts(t.id); rerenderAll();
  const b = $('#tm-add-open'); if (b) b.focus();
  toast(`${AGENTS[a].name} ${lng('بقى في', 'is now in')} #${t.title}. ${lng('ناديه بـ', 'Call it with')} ${AGENTS[a].handle}`);
}
function teamRemove(a) {
  const t = teamThreadNow(); if (!t || !canManage()) return;
  const i = t.team.indexOf(a); if (i < 0) return;
  t.team.splice(i, 1);
  if (t.agent === a) t.agent = t.team[0] || state.main;
  t.msgs.push({ id: nid('n'), role: 'note', icon: 'team', text: `${me().first} ${meAct('شال', 'شالت', 'removed')} ${AGENTS[a].name} ${lng('من القناة', 'from the channel')}`, fresh: true });
  logAuto(ME(), `${meAct('شال', 'شالت', 'removed')} ${AGENTS[a].name} ${lng('من قناة', 'from the channel')}`, { chan: t.id, obj: `#${t.title}` });
  refreshThread(t.id); scrollMounts(t.id); rerenderAll();
  const b = $('#tm-add-open'); if (b) b.focus();
  toast(`${AGENTS[a].name} ${lng('خرج من', 'left')} #${t.title}`, 'x');
}
/* ---- the gear view: editable setup ---- */
function settingsHTML(a) {
  const A = AGENTS[a]; const D = draftOf(a);
  const eff = EFFORTS.find((e) => e.k === D.effort) || EFFORTS[1];
  const conf = state.dpConfirm && state.dpConfirm.a === a ? state.dpConfirm.kind : null;
  const job = `<section class="dp-sec" aria-labelledby="set-h-job"><h3 class="dp-label" id="set-h-job"><span>${lng('الشغلانة', 'The job')}</span><button type="button" class="link-btn" data-action="dp-settings">${lng('رجوع', 'Back')}</button></h3>
    <div class="panel-card set-card">
      <div class="set-field"><label class="set-label" for="set-name">${lng('الاسم', 'Name')}</label>
        <input class="set-input" id="set-name" type="text" dir="auto" maxlength="24" autocomplete="off" data-set="name" value="${esc(D.name)}" aria-describedby="set-name-hint set-name-err" aria-required="true">
        <span class="set-err" id="set-name-err" hidden>${lng('الوكيل محتاج اسم، ولو كلمة واحدة.', 'The agent needs a name, even one word.')}</span>
        <span class="set-hint" id="set-name-hint">${bx(`${lng('بتناديه في الرسايل بـ', 'You call it in messages with')} ${A.handle} ${lng('حتى لو غيّرت الاسم.', 'even if you change the name.')}`)}</span></div>
      <div class="set-field"><label class="set-label" for="set-role">${lng('الدور', 'Role')}</label>
        <input class="set-input" id="set-role" type="text" maxlength="32" autocomplete="off" data-set="role" value="${esc(D.role)}" placeholder="${lng('مثلاً: وكيل الإعلانات', 'e.g. Ads agent')}" aria-describedby="set-role-hint">
        <span class="set-hint" id="set-role-hint">${bx(lng('بيظهر جنب الاسم في التفاصيل والقايمة، زي «وكيل الإعلانات» أو «المحلل».', 'Shows next to the name in the details and the sidebar, like “Ads agent” or “Analyst”.'))}</span></div>
    </div></section>`;
  const about = `<section class="dp-sec" aria-labelledby="set-h-about"><h3 class="dp-label" id="set-h-about"><span>${lng('عنه', 'About')}</span></h3>
    <div class="panel-card set-card"><div class="set-field">
      <label class="sr-only" for="set-desc">${esc(A.name)} ${lng('بيعمل إيه؟', 'What does it do?')}</label>
      <textarea class="set-input set-textarea" id="set-desc" rows="3" maxlength="400" data-set="desc" placeholder="${lng('بيعمل إيه؟ مثلاً: بيخطط ويتابع حملات Meta وGoogle لكورسات الأكاديمية.', 'What does it do? e.g. Plans and monitors Meta and Google campaigns for the academy’s courses.')}" aria-describedby="set-desc-hint">${esc(D.desc)}</textarea>
      <span class="set-hint" id="set-desc-hint">${bx(lng('وصف قصير بيظهر في التفاصيل، وبيساعد باقي الوكلاء يعرفوا يسلّموه إيه.', 'A short description shown in the details. It also helps the other agents know what to hand it.'))}</span>
    </div></div></section>`;
  const how = `<section class="dp-sec" aria-labelledby="set-h-how"><h3 class="dp-label" id="set-h-how"><span>${lng('طريقة الشغل', 'How it works')}</span></h3>
    <div class="panel-card set-card"><div class="set-field">
      <label class="sr-only" for="set-instr">${lng('تعليمات ثابتة لـ', 'Standing instructions for')} ${esc(A.name)}</label>
      <textarea class="set-input set-textarea set-textarea--tall" id="set-instr" rows="6" maxlength="${INSTR_MAX}" data-set="instr" placeholder="${esc(INSTR_PH[a] || '')}" aria-describedby="set-instr-hint set-instr-count">${esc(D.instr)}</textarea>
      <div class="od-row-top set-hint-row"><span class="set-hint od-fill" id="set-instr-hint">${bx(`${lng('تعليمات ثابتة', 'Standing instructions')} ${A.name} ${lng('بيمشي عليها دايماً: اللهجة، الأولويات، والحاجات اللي يبعد عنها. وبيتعلّم كمان من المحادثات والذاكرة.', 'It always follows these: tone, priorities and things to avoid. It also learns from chats and memory.')}`)}</span>
        <span class="set-count num" id="set-instr-count">${fmt(D.instr.length)} / ${fmt(INSTR_MAX)}</span></div>
    </div></div></section>`;
  const think = `<section class="dp-sec" aria-labelledby="set-h-think"><h3 class="dp-label" id="set-h-think"><span>${lng('بيفكر بـ', 'Thinks with')}</span></h3>
    <div class="panel-card" role="radiogroup" aria-labelledby="set-h-think">${MODELS.map((m) => `
      <button type="button" class="panel-row" role="radio" aria-checked="${m.n === D.model}" data-action="set-model" data-model="${esc(m.n)}" id="set-model-${m.logo}" style="min-height:44px">
        <span class="panel-row__icon">${tile(m.logo)}</span>
        <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(m.n)}</bdi></span><span class="panel-row__d">${esc(m.d)}</span></span>
        ${m.n === D.model ? `<span class="panel-row__meta">${icon('check')}</span>` : ''}</button>`).join('')}</div>
    <div class="panel-card set-card"><div class="set-field">
      <span class="set-label" id="set-effort-l">${lng('قد إيه يفكر قبل ما يرد', 'How much it thinks before replying')}</span>
      <div class="segmented segmented--field" role="radiogroup" aria-labelledby="set-effort-l" aria-describedby="set-effort-hint">${EFFORTS.map((e) => `
        <button type="button" role="radio" id="set-effort-${e.k}" aria-checked="${e.k === D.effort}" tabindex="${e.k === D.effort ? 0 : -1}" data-action="set-effort" data-effort="${e.k}">${e.l}</button>`).join('')}</div>
      <span class="set-hint" id="set-effort-hint" aria-live="polite">${bx(eff.h)}</span>
    </div></div></section>`;
  const tools = `<section class="dp-sec" aria-labelledby="set-h-tools"><h3 class="dp-label" id="set-h-tools"><span>${lng('الأدوات', 'Tools')}</span></h3>
    ${A.conns.length ? `<ul class="panel-card">${A.conns.map((k) => {
      const s = state.conns[k];
      let end;
      if (s === 'connecting') end = lng('<span class="panel-row__meta">بيتوصل…</span>', '<span class="panel-row__meta">Connecting…</span>');
      else if (s === 'missing') end = `<button type="button" class="btn btn--primary btn--sm" data-action="connect" data-conn="${k}">${lng('وصّل', 'Connect')}</button>`;
      else end = `<button type="button" class="switch" role="switch" id="set-tool-${k}" aria-checked="${!!D.tools[k]}" aria-labelledby="set-tool-t-${k}" data-action="set-tool" data-conn="${k}"></button>`;
      const desc = s === 'missing' ? lng('مش متوصل · ', 'Not connected · ') + CONNS[k].d : D.tools[k] ? `${A.name} ${lng('يقدر يستخدمه', 'can use it')}` : `${lng('مقفول على', 'Turned off for')} ${A.name}`;
      return `<li class="panel-row">${tile(k)}<span class="panel-row__text"><span class="panel-row__t" id="set-tool-t-${k}"><bdi>${esc(CONNS[k].name)}</bdi></span><span class="panel-row__d">${bx(desc)}</span></span>${end}</li>`;
    }).join('')}</ul>` : `<div class="panel-card"><p class="panel-empty">${noToolsText(a)}</p></div>`}</section>`;
  const skills = `<section class="dp-sec" aria-labelledby="set-h-skills"><h3 class="dp-label" id="set-h-skills"><span>${lng('المهارات', 'Skills')} <span class="muted num">${D.skills.filter(Boolean).length}/${A.skills.length}</span></span></h3>
    ${A.skills.length ? '' : `<div class="panel-card"><p class="panel-empty">${bx(`${lng('لسه مفيش مهارات. اكتب لـ', 'No skills yet. Tell')} ${A.name} ${lng('في الشات بيعمل إيه، وهو هيقترح المهارات اللي محتاجها.', 'in the chat what it does, and it’ll suggest the skills it needs.')}`)}</p></div>`}
    <ul class="panel-card"${A.skills.length ? '' : ' hidden'}>${A.skills.map((sk, i) => `
      <li class="panel-row"><span class="panel-row__text"><span class="panel-row__t" id="set-skill-t-${i}">${bx(sk.t)}</span><span class="panel-row__d">${bx(sk.d)}</span>${skLearnedHTML(sk)}</span>
      <button type="button" class="switch" role="switch" id="set-skill-${i}" aria-checked="${!!D.skills[i]}" aria-labelledby="set-skill-t-${i}" data-action="set-skill" data-idx="${i}"></button></li>`).join('')}</ul></section>`;
  const pauseRow = A.paused
    ? `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${bx(`${A.name} ${lng('واقف مؤقتاً', 'is paused')}`)}</span><span class="panel-row__d">${bx(`${lng('من', 'Since')} ${A.paused}${lng('. مش بيبدأ شغل جديد ولا روتينات.', '. It won’t start new work or routines.')}`)}</span></span>
        <button type="button" class="btn btn--secondary btn--sm" data-action="resume-agent" id="danger-pause">${lng('رجّعه', 'Resume')}</button></li>`
    : `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${lng('وقّفه مؤقتاً', 'Pause')}</span><span class="panel-row__d">${bx(lng('مش هيبدأ شغل جديد ولا روتينات لحد ما ترجّعه.', 'It won’t start new work or routines until you resume it.'))}</span></span>
        <button type="button" class="btn btn--secondary btn--sm" data-action="danger" data-kind="pause" id="danger-pause" aria-expanded="${conf === 'pause'}">${lng('وقّف', 'Pause')}</button></li>`;
  const pauseConf = conf === 'pause' ? `<li class="danger-confirm" role="group" aria-label="${lng('تأكيد الإيقاف', 'Confirm pause')}">
      <p>${bx(`${A.name} ${lng('هيوقف', 'will pause')} ${A.routines.filter((r) => r.on).length} ${lng('روتين ومش هياخد كروت جديدة. الحملات اللي لايف مش هتتأثر.', 'routines and won’t take new cards. Live campaigns aren’t affected.')}`)}</p>
      <div class="panel-form__row panel-form__row--end"><button type="button" class="btn btn--secondary btn--sm" data-action="danger-cancel">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary btn--sm" data-action="danger-pause-go" id="danger-pause-go">${lng('وقّفه', 'Pause it')}</button></div></li>` : '';
  const delConf = conf === 'delete' ? `<li class="danger-confirm" role="group" aria-label="${lng('تأكيد المسح', 'Confirm delete')}">
      <p>${bx(`${lng('ده هيمسح', 'This deletes')} ${A.name} ${lng('وروتيناته وذاكرته. المحادثات والكروت هتفضل على اللوحة.', 'with its routines and memory. Chats and cards stay on the board.')}`)}</p>
      <label class="set-label" for="del-confirm">${bx(`${lng('اكتب', 'Type')} ${A.name} ${lng('عشان تأكد', 'to confirm')}`)}</label>
      <input class="set-input" id="del-confirm" type="text" dir="auto" autocomplete="off" data-del="${a}">
      <div class="panel-form__row panel-form__row--end"><button type="button" class="btn btn--secondary btn--sm" data-action="danger-cancel">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary btn--sm" data-action="danger-delete-go" id="del-go" disabled>${lng('امسح نهائياً', 'Delete for good')}</button></div></li>` : '';
  const danger = `<section class="dp-sec" aria-labelledby="set-h-danger"><h3 class="dp-label" id="set-h-danger"><span>${lng('منطقة خطر', 'Danger zone')}</span></h3>
    <ul class="panel-card">${pauseRow}${pauseConf}
      ${isMain(a) ? `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${bx(`${lng('امسح', 'Delete')} ${A.name}`)}</span><span class="panel-row__d">${bx(lng('مينفعش يتمسح وهو الرئيسي. خلّي وكيل تاني الرئيسي الأول.', 'It can’t be deleted while it’s the main agent. Make another agent main first.'))}</span></span></li>`
      : `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${bx(`${lng('امسح', 'Delete')} ${A.name}`)}</span><span class="panel-row__d">${bx(lng('مفيش رجوع بعدها. المحادثات والكروت هتفضل.', 'There’s no undo. Chats and cards stay.'))}</span></span>
        <button type="button" class="btn btn--secondary btn--sm" data-action="danger" data-kind="delete" id="danger-delete" aria-expanded="${conf === 'delete'}">${lng('امسح', 'Delete')}</button></li>${delConf}`}
    </ul></section>`;
  return `<div class="dp-sections">${job}${mainSetHTML(a)}${checkinSetHTML(a, D)}${about}${how}${think}${voiceSetHTML(a, D)}${tools}${permsHTML(a)}${skills}${danger}</div>`;
}
/* «خلّيه الرئيسي» (G23/G57): the Owner marks one existing agent as the main one; exactly one is main at a time */
function mainSetHTML(a) {
  const A = AGENTS[a]; const cur = AGENTS[state.main];
  if (!isOwner()) {
    return isMain(a) ? `<section class="dp-sec" id="set-main" aria-labelledby="set-h-main"><h3 class="dp-label" id="set-h-main"><span>${lng('الوكيل الرئيسي', 'Main agent')}</span></h3>
      <div class="panel-card"><p class="panel-empty">${bx(`${A.name} ${lng('هو الرئيسي. عمر (المالك) بس اللي يغيّره.', 'is the main agent. Only Omar (Owner) can change it.')}`)}</p></div></section>` : '';
  }
  const row = isMain(a)
    ? `<li class="panel-row"><span class="panel-row__icon">${icon('check')}</span><span class="panel-row__text"><span class="panel-row__t">${bx(`${A.name} ${lng('هو الرئيسي', 'is the main agent')}`)}</span><span class="panel-row__d">${bx(lng('أول واحد في القايمة عند كل الأعضاء ومحدش يقدر يخفيه، وبيبعت صباح الخير. عشان تغيّره افتح وكيل تاني ودوس «خلّيه الرئيسي».', 'First in the list for every member, nobody can hide it, and it sends the good-morning message. To change it, open another agent and press “Make it main”.'))}</span></span></li>`
    : `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${lng('خلّيه الرئيسي', 'Make it main')}</span><span class="panel-row__d">${bx(`${lng('هيظهر أول واحد عند كل الأعضاء ومحدش يقدر يخفيه، وهيبعت صباح الخير بدل', 'It will show first for every member, nobody can hide it, and it will send the good-morning message instead of')} ${cur.name}.`)}</span></span>
      <button type="button" class="btn btn--secondary btn--sm" id="set-make-main" data-action="make-main" data-agent="${a}">${lng('خلّيه الرئيسي', 'Make it main')}</button></li>`;
  return `<section class="dp-sec" id="set-main" aria-labelledby="set-h-main"><h3 class="dp-label" id="set-h-main"><span>${lng('الوكيل الرئيسي', 'Main agent')}</span></h3><ul class="panel-card">${row}</ul></section>`;
}
function makeMain(a) {
  if (!isOwner() || !AGENTS[a] || isMain(a)) return;
  const old = state.main; const O = AGENTS[old]; const A = AGENTS[a];
  A.checkinOn = O.checkinOn !== false; A.checkinTime = O.checkinTime || '9:00';
  if (state.drafts[a]) { state.drafts[a].checkinOn = A.checkinOn; state.drafts[a].checkinTime = A.checkinTime; }
  state.main = a;
  logAuto(ME(), meAct('غيّر الوكيل الرئيسي', 'غيّرت الوكيل الرئيسي', 'changed the main agent'), { from: O.name, to: A.name });
  const mt = threads['th-morning']; mt.agent = a; mt.msgs.forEach((m) => { if (m.role === 'agent') m.agent = a; });
  rerenderAll();
  const b = $('#set-main'); if (b) { scrollInPanel(b); const f = $('#details [data-action="dp-settings"]'); if (f) f.focus({ preventScroll: true }); }
  toast(`${A.name} ${lng('بقى الرئيسي. أول واحد في القايمة عند الكل، وهو اللي هيبعت صباح الخير', 'is now the main agent. It shows first for everyone and sends the good-morning message')}`);
}
/* the gear for anyone who isn't the Owner or a Manager: the same setup, read only, and one line on who changes it */
function settingsReadHTML(a) {
  const A = AGENTS[a];
  const eff = EFFORTS.find((e) => e.k === A.effort) || EFFORTS[1];
  const v = VOICES.find((x) => x.k === A.voice) || VOICES[0];
  const rows = (list) => `<ul class="panel-card">${list.map(([t, d]) => `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${t}</span><span class="panel-row__d ro-val">${d}</span></span></li>`).join('')}</ul>`;
  const sec = (id, title, inner) => `<section class="dp-sec" aria-labelledby="ro-h-${id}"><h3 class="dp-label" id="ro-h-${id}"><span>${title}</span>${id === 'job' ? `<button type="button" class="link-btn" data-action="dp-settings">${lng('رجوع', 'Back')}</button>` : ''}</h3>${inner}</section>`;
  const who = `<p class="ro-note">${icon('shield')}<span>${bx(`${lng('إعدادات الوكلاء بيغيّرها', 'Agent settings are changed by')} ${whoManages()} ${lng('بس.', 'only.')}`)}</span></p>`;
  const tools = A.conns.length ? `<ul class="panel-card">${A.conns.map((k) => `<li class="panel-row">${tile(k)}<span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(CONNS[k].name)}</bdi></span><span class="panel-row__d">${state.conns[k] === 'missing' ? lng('مش متوصل', 'Not connected') : A.toolsOn[k] === false ? `${lng('مقفول على', 'Turned off for')} ${bx(A.name)}` : `${bx(A.name)} ${lng('يقدر يستخدمه', 'can use it')}`}</span></span></li>`).join('')}</ul>` : `<div class="panel-card"><p class="panel-empty">${noToolsText(a)}</p></div>`;
  const skills = A.skills.length ? `<ul class="panel-card">${A.skills.map((sk) => `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${bx(sk.t)}</span><span class="panel-row__d">${bx(sk.d)}</span>${skLearnedHTML(sk)}</span><span class="panel-row__meta">${sk.on ? lng('شغالة', 'On') : lng('مقفولة', 'Off')}</span></li>`).join('')}</ul>` : `<div class="panel-card"><p class="panel-empty">${lng('لسه مفيش مهارات.', 'No skills yet.')}</p></div>`;
  return `<div class="dp-sections">${who}
    ${sec('job', lng('الشغلانة', 'The job'), rows([[lng('الاسم', 'Name'), `<bdi>${esc(A.name)}</bdi> · <bdi>${esc(A.handle)}</bdi>`], [lng('الدور', 'Role'), bx(A.role || '—')]]))}
    ${mainSetHTML(a)}
    ${isMain(a) ? sec('ck', lng('صباح الخير', 'Good morning'), rows([[lng('ملخص الصبح', 'Morning summary'), A.checkinOn ? `${lng('كل يوم', 'Every day at')} ${ckLabel(A.checkinTime)}` : lng('مقفول', 'Off')]])) : ''}
    ${sec('about', lng('عنه', 'About'), `<div class="panel-card"><p class="ro-text">${bx(A.desc || '—')}</p></div>`)}
    ${sec('how', lng('طريقة الشغل', 'How it works'), `<div class="panel-card"><p class="ro-text">${A.instr ? A.instr.split('\n').map(bx).join('<br>') : lng('مفيش تعليمات ثابتة.', 'No standing instructions.')}</p></div>`)}
    ${sec('think', lng('بيفكر بـ', 'Thinks with'), rows([[lng('الموديل', 'Model'), `<bdi>${esc(A.model)}</bdi>`], [lng('قد إيه يفكر قبل ما يرد', 'How much it thinks before replying'), eff.l]]))}
    ${sec('voice', lng('الصوت', 'Voice'), rows([[lng('لغة الكلام', 'Speaking language'), esc(langName(A.voiceLang || 'ar-EG'))], [lng('الصوت', 'Voice'), `${esc(v.n)} · <bdi dir="ltr">${esc(A.voiceSpeed || '1')}×</bdi>`]]))}
    ${sec('tools', lng('الأدوات', 'Tools'), tools)}
    ${sec('skills', `${lng('المهارات', 'Skills')} <span class="muted num">${A.skills.filter((x) => x.on).length}/${A.skills.length}</span>`, skills)}
  </div>`;
}
/* voice: speech language (Egyptian Arabic first), voice with a preview, speed */
function voiceSetHTML(a, D) {
  const v = VOICES.find((x) => x.k === D.voice) || VOICES[0];
  const playing = state.voicePlaying && state.voicePlaying.a === a;
  const sp = (s) => `<bdi dir="ltr">${s}×</bdi>`;
  const hint = playing ? `${esc(v.n)} ${lng('بيقول: «', 'says: “')}${esc(VOICE_PREVIEW[D.voiceLang] || VOICE_PREVIEW['ar-EG'])}${lng('»', '”')} · ${sp(D.voiceSpeed)}` : `${esc(v.d)}${lng('. دوس «اسمع» عشان تسمع عينة بالسرعة اللي اخترتها.', '. Press “Listen” to hear a sample at the speed you picked.')}`;
  return `<section class="dp-sec" id="set-voice" aria-labelledby="set-h-voice"><h3 class="dp-label" id="set-h-voice"><span>${lng('الصوت', 'Voice')}</span></h3>
    <div class="panel-card set-card">
      <div class="set-field"><label class="set-label" for="set-voice-lang">${lng('لغة الكلام', 'Speaking language')}</label>
        <select class="set-input vc-select" id="set-voice-lang" data-set="voiceLang" aria-describedby="set-voice-lang-hint">${VOICE_LANGS.map(([k, l]) => `<option value="${k}" ${k === D.voiceLang ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <span class="set-hint" id="set-voice-lang-hint">${bx(`${lng('بيفهمك بيها لما تملي بصوتك، وبيرد بيها لو طلبت رد مسموع.', 'It understands you in this language when you dictate, and replies in it if you ask for a spoken reply.')}${D.voiceLang === 'ar-EG' ? lng(' العامية المصرية هي الأساس.', ' Egyptian colloquial is the default.') : ''}`)}</span></div>
      <div class="set-field"><label class="set-label" for="set-voice">${lng('الصوت', 'Voice')}</label>
        <div class="vc-row"><select class="set-input vc-select" id="set-voice" data-set="voice" aria-describedby="set-voice-hint">${VOICES.map((x) => `<option value="${x.k}" ${x.k === D.voice ? 'selected' : ''}>${esc(x.n)}</option>`).join('')}</select>
          <button type="button" class="btn btn--secondary btn--sm vc-play" id="set-voice-play" data-action="voice-preview" aria-pressed="${playing}">${icon(playing ? 'stopFill' : 'play')}<span>${playing ? lng('وقّف', 'Stop') : lng('اسمع', 'Listen')}</span></button></div>
        <span class="set-hint${playing ? ' vc-quote' : ''}" id="set-voice-hint" aria-live="polite">${hint}</span></div>
      <div class="set-field"><span class="set-label" id="set-speed-l">${lng('السرعة', 'Speed')}</span>
        <div class="segmented segmented--field" role="radiogroup" aria-labelledby="set-speed-l">${SPEEDS.map((s, i) => `
          <button type="button" role="radio" id="set-speed-${i}" class="num" dir="ltr" aria-checked="${s === D.voiceSpeed}" tabindex="${s === D.voiceSpeed ? 0 : -1}" data-action="set-speed" data-speed="${s}">${s}×</button>`).join('')}</div>
        <span class="set-hint">${sp('1')} ${lng('هي السرعة العادية. الأبطأ أوضح في الأرقام والأسماء.', 'is normal speed. Slower is clearer for numbers and names.')}</span></div>
    </div></section>`;
}
function saveSettings() {
  const a = detailsAgent(); const A = AGENTS[a]; const D = draftOf(a);
  if (!D.name.trim()) {
    const inp = $('#set-name'); const err = $('#set-name-err');
    if (err) err.hidden = false;
    if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
    return;
  }
  { /* one log line per changed setting, old → new */
    const ch = []; const on = lng('مفتوح', 'On'); const off = lng('مقفول', 'Off');
    if (D.name.trim() !== A.name) ch.push([lng('الاسم', 'the name'), A.name, D.name.trim()]);
    if (D.role.trim() !== (A.role || '')) ch.push([lng('الشغلانة', 'the job'), A.role || '—', D.role.trim() || '—']);
    if (D.model !== A.model) ch.push([lng('الموديل', 'the model'), A.model, D.model]);
    if (D.effort !== A.effort) { const l = (k) => (EFFORTS.find((x) => x.k === k) || {}).l || k; ch.push([lng('مستوى التفكير', 'the thinking level'), l(A.effort), l(D.effort)]); }
    if (D.instr !== A.instr) ch.push([lng('التعليمات', 'the instructions'), null, lng('اتعدّلت', 'Edited')]);
    if (D.desc.trim() !== (A.desc || '')) ch.push([lng('الوصف', 'the description'), null, lng('اتعدّل', 'Edited')]);
    Object.keys(D.tools).forEach((k) => { const was = !(A.toolsOn && A.toolsOn[k] === false); if (!!D.tools[k] !== was) ch.push([CONNS[k] ? CONNS[k].name : k, was ? on : off, D.tools[k] ? on : off]); });
    D.skills.forEach((v, i) => { if (A.skills[i] && v !== A.skills[i].on) ch.push([A.skills[i].t, A.skills[i].on ? on : off, v ? on : off]); });
    if (D.voice !== (A.voice || 'noor') || D.voiceLang !== (A.voiceLang || 'ar-EG') || D.voiceSpeed !== (A.voiceSpeed || '1')) ch.push([lng('الصوت', 'the voice'), null, lng('اتغيّر', 'Changed')]);
    if (isMain(a) && (D.checkinOn !== A.checkinOn || D.checkinTime !== A.checkinTime)) ch.push([lng('صباح الخير', 'good morning'), A.checkinOn ? ckLabel(A.checkinTime) : off, D.checkinOn ? ckLabel(D.checkinTime) : off]);
    ch.forEach(([what, from, to]) => logAuto(ME(), `${meAct('غيّر', 'غيّرت', 'changed')} ${what} ${lng('في إعدادات', 'in the settings of')}`, { agent: a, obj: A.name, from, to }));
  }
  A.name = D.name.trim(); A.role = D.role.trim(); A.desc = D.desc.trim(); A.instr = D.instr;
  A.model = D.model; A.effort = D.effort; A.toolsOn = Object.assign({}, D.tools);
  A.voiceLang = D.voiceLang; A.voice = D.voice; A.voiceSpeed = D.voiceSpeed;
  D.skills.forEach((on, i) => { A.skills[i].on = on; });
  if (isMain(a)) { A.checkinOn = D.checkinOn; A.checkinTime = D.checkinTime; }
  delete state.drafts[a];
  rerenderAll();
  const g = $('#details [data-action="dp-settings"]'); if (g) g.focus();
  toast(`${lng('اتحفظ.', 'Saved.')} ${A.name} ${lng('هيمشي بالإعدادات الجديدة من الرسالة الجاية', 'will use the new settings from the next message')}`);
}
function discardSettings() {
  const a = detailsAgent();
  delete state.drafts[a];
  renderDetails();
  const n = $('#set-name'); if (n) n.focus();
  toast(lng('رجعنا للإعدادات المتحفظة', 'Back to your saved settings'), 'x');
}

/* a skill the agent wrote by itself: which version is in use, and a way to read before/after */
const skLearnedHTML = (sk) => (sk && sk.learned ? `<span class="sk-learned">${icon('spark')}<span>${lng('اتعلّمها لوحده · نسخة', 'Learned on its own · version')} <span class="num">${sk.ver || 1}</span></span>${sk.sid && sovHas('learning') ? `<button type="button" class="link-btn" data-action="sov-skill" data-skill="${sk.sid}">${(sk.vers || []).length > 1 ? lng('شوف قبل وبعد', 'See before and after') : lng('شوف الخطوات', 'See the steps')}</button>` : ''}</span>` : '');
/* ---- memory tab ---- */
const MEM_GROUPS = [['voice', lng('صوت البراند', 'Brand voice')], ['audience', lng('الجمهور', 'Audience')], ['banned', lng('كلام ممنوع', 'Banned phrases')], ['lessons', lng('دروس', 'Lessons')]];
const MEM_SRC = { told: lng('قلتهوله', 'You told it'), learned: lng('اتعلّمها لوحده', 'Learned on its own') };
function memNoteHTML(m) {
  if (state.memEditing === m.id) {
    return `<li class="panel-row mem-note"><div class="panel-form">
      <label class="set-label" for="mem-edit-t">${lng('عدّل الملاحظة', 'Edit note')}</label>
      <textarea class="set-input set-textarea" id="mem-edit-t" rows="3" data-mem="${m.id}" aria-describedby="mem-edit-err">${esc(m.t)}</textarea>
      <span class="panel-form__err" id="mem-edit-err" hidden>${lng('الملاحظة مينفعش تبقى فاضية. لو مش محتاجها دوس «انسى ده».', 'A note can’t be empty. If you don’t need it, press “Forget this”.')}</span>
      <div class="panel-form__row panel-form__row--end"><button type="button" class="btn btn--secondary btn--sm" data-action="mem-edit-cancel" data-mem="${m.id}">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary btn--sm" data-action="mem-edit-save" data-mem="${m.id}">${lng('احفظ', 'Save')}</button></div></div></li>`;
  }
  const short = m.t.length > 40 ? m.t.slice(0, 40) + '…' : m.t;
  /* a note a person gave it: who, by name; the rest of «from» is the date */
  const byP = m.src === 'told' && m.by && PEOPLE[m.by] && inWs(m.by) ? m.by : null;
  const src = byP ? (byP === state.as ? MEM_SRC.told : lng('اتقالّه', 'Told to it')) : MEM_SRC[m.src];
  const when = byP ? String(m.from).replace(/^[^·]*·\s*/, '') : m.from;
  return `<li class="panel-row mem-note" data-mem-row="${m.id}"><span class="mem-note__t">${bx(m.t)}</span>
    <span class="mem-note__meta"><span class="badge mem-badge">${icon(m.src === 'told' ? 'chat' : 'bulb')}${src}</span>${byP ? `<span class="mem-by">${personAv(byP, 18)}<span>${lng('من:', 'From:')} ${esc(PEOPLE[byP].first)}</span></span>` : ''}<span>${bx(when)}</span>
      <span class="mem-note__acts"${canWrite() ? '' : ' hidden'}><button type="button" class="link-btn" data-action="mem-edit" data-mem="${m.id}" aria-label="${lng('عدّل:', 'Edit:')} ${esc(short)}">${lng('عدّل', 'Edit')}</button>
      <button type="button" class="link-btn" data-action="mem-forget" data-mem="${m.id}" aria-label="${lng('انسى:', 'Forget:')} ${esc(short)}">${lng('انسى ده', 'Forget this')}</button></span></span></li>`;
}
function memListHTML(a) {
  const A = AGENTS[a];
  const q = state.memQuery.trim().toLowerCase();
  const match = (m, gl) => !q || m.t.toLowerCase().includes(q) || gl.includes(q) || MEM_SRC[m.src].includes(q) || m.from.toLowerCase().includes(q);
  let total = 0;
  const html = MEM_GROUPS.map(([g, gl]) => {
    const list = A.memory.filter((m) => m.g === g && match(m, gl));
    total += list.length;
    if (q && !list.length) return '';
    return `<section class="dp-sec" aria-labelledby="mem-h-${g}"><h3 class="dp-label" id="mem-h-${g}"><span>${gl} <span class="muted num">${list.length}</span></span></h3>
      ${list.length ? `<ul class="panel-card">${list.map(memNoteHTML).join('')}</ul>`
        : `<div class="panel-card"><p class="panel-empty">${bx(`${lng('لسه مفيش. ضيف حاجة، أو', 'Nothing yet. Add something, or')} ${A.name} ${lng('هيتعلّمها من المحادثات.', 'will learn it from chats.')}`)}</p></div>`}</section>`;
  }).join('');
  if (q && !total) {
    return `<div class="panel-card"><div class="mem-empty"><p class="panel-empty">${lng('مفيش حاجة في ذاكرة', 'Nothing in the')} <bdi>${esc(A.name)}</bdi> ${lng('فيها «', 'memory matches “')}${esc(state.memQuery.trim())}${lng('»', '”')}.</p>
      <button type="button" class="link-btn" data-action="mem-clear">${lng('امسح البحث', 'Clear search')}</button></div></div>`;
  }
  return html;
}
function memoryHTML(a) {
  const A = AGENTS[a];
  const form = state.memAdding ? `<div class="panel-card"><div class="panel-form">
      <label class="set-label" for="mem-new-g">${lng('نوعها', 'Type')}</label>
      <select class="set-input" id="mem-new-g">${MEM_GROUPS.map(([g, gl]) => `<option value="${g}">${gl}</option>`).join('')}</select>
      <label class="set-label" for="mem-new">${lng('الملاحظة', 'Note')}</label>
      <textarea class="set-input set-textarea" id="mem-new" rows="3" placeholder="مثلاً: ماتستخدمش كلمة «مجاناً» في إعلانات السعودية" aria-describedby="mem-new-err"></textarea>
      <span class="panel-form__err" id="mem-new-err" hidden>${lng('اكتب الملاحظة الأول، ولو جملة قصيرة.', 'Write the note first, even a short sentence.')}</span>
      <div class="panel-form__row panel-form__row--end"><button type="button" class="btn btn--secondary btn--sm" data-action="mem-cancel">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary btn--sm" data-action="mem-save">${lng('ضيف', 'Add')}</button></div></div></div>` : '';
  return `<section class="dp-sec" aria-labelledby="mem-h"><h3 class="dp-label" id="mem-h"><span>${lng('اللي', 'What')} <bdi>${esc(A.name)}</bdi> ${lng('فاكره', 'remembers')} <span class="muted num">${A.memory.length}</span></span>
      ${canWrite() ? `<button type="button" class="link-btn" data-action="mem-add" aria-expanded="${state.memAdding}">${lng('إضافة', 'Add')}</button>` : ''}</h3>
    <p class="mem-intro">${bx(`${lng('ملاحظات بيرجعلها في كل شغلانة: اللي الفريق قالهوله، واللي اتعلّمه لوحده من الحملات والمراجعات.', 'Notes it comes back to on every job: what the team told it, and what it learned on its own from campaigns and reviews.')} ${A.name} ${lng('واحد للشركة كلها وذاكرته واحدة، فاللي حد يعلّمهوله بيفتكره مع الكل.', 'is one agent for the whole company with one memory, so what anyone teaches it, it remembers for everyone.')}${canWrite() ? lng(' تقدر تعدّل أو تمسح أي حاجة.', ' You can edit or delete anything.') : ''}`)}</p>
    <p class="mem-know">${icon('book')}<span>${bx(`${lng('صوت البراند والجمهور والأسعار والممنوع والقرارات اللي بتخص الشركة كلها في «معرفة الشركة»، وكل الوكلاء بيقروها. هنا اللي', 'Brand voice, audience, prices, banned claims and decisions for the whole company live in “Company knowledge”, read by every agent. Here is what')} ${A.name} ${lng('فاكره لوحده.', 'remembers on its own.')}`)}</span>${sovHas('knowledge') ? `<button type="button" class="link-btn" data-action="sov-know">${lng('افتح معرفة الشركة', 'Open company knowledge')}</button>` : ''}</p>
    <div class="mem-search"><label class="sr-only" for="mem-q">${lng('دوّر في الذاكرة', 'Search memory')}</label><input type="search" id="mem-q" autocomplete="off" placeholder="${lng('دوّر في الذاكرة', 'Search memory')}" value="${esc(state.memQuery)}"></div>
    ${form}</section>
    <div class="mem-groups" id="mem-list" aria-live="polite">${memListHTML(a)}</div>`;
}
function saveMemory() {
  const a = detailsAgent(); const inp = $('#mem-new'); const err = $('#mem-new-err'); if (!inp) return;
  const v = inp.value.trim();
  if (!v) { if (err) err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
  const g = ($('#mem-new-g') || {}).value || 'voice';
  const m = mem(g, 'told', v, `${me().first} · ${lng('دلوقتي', 'just now')}`); m.by = state.as;
  AGENTS[a].memory.unshift(m);
  state.memAdding = false; state.memQuery = '';
  renderDetails();
  const b = $(`[data-action="mem-edit"][data-mem="${m.id}"]`); if (b) b.focus();
  toast(`${lng('اتضافت لذاكرة', 'Added to the memory of')} ${AGENTS[a].name}`);
}
function saveMemoryEdit(id) {
  const a = detailsAgent(); const m = AGENTS[a].memory.find((x) => x.id === id); const inp = $('#mem-edit-t'); if (!m || !inp) return;
  const v = inp.value.trim();
  if (!v) { const err = $('#mem-edit-err'); if (err) err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
  m.t = v; m.src = 'told'; m.by = state.as; m.from = `${me().first} · ${lng('عدّلها دلوقتي', 'edited just now')}`;
  state.memEditing = null; renderDetails();
  const b = $(`[data-action="mem-edit"][data-mem="${id}"]`); if (b) b.focus();
  toast(lng('الملاحظة اتعدّلت', 'Note updated'));
}
function forgetMemory(id) {
  const a = detailsAgent(); const list = AGENTS[a].memory; const i = list.findIndex((x) => x.id === id); if (i < 0) return;
  const forgets = $$('[data-action="mem-forget"]'); const pos = forgets.findIndex((b) => b.dataset.mem === id);
  const [m] = list.splice(i, 1);
  state.memUndo = { a, m, i };
  renderDetails();
  const next = $$('[data-action="mem-forget"]');
  const f = next[Math.min(pos, next.length - 1)] || $('#mem-q'); if (f) f.focus();
  toast(`${AGENTS[a].name} ${lng('نسي الملاحظة دي', 'forgot this note')}`, 'check', { action: 'mem-undo', label: lng('رجّعها', 'Undo') });
}
function undoForget() {
  const u = state.memUndo; if (!u) return;
  AGENTS[u.a].memory.splice(Math.min(u.i, AGENTS[u.a].memory.length), 0, u.m);
  state.memUndo = null;
  $('#toast-host').innerHTML = '';
  renderDetails();
  const b = $(`[data-action="mem-forget"][data-mem="${u.m.id}"]`); if (b) b.focus();
  toast(lng('الملاحظة رجعت', 'Note restored'));
}
function permsHTML(a) {
  const A = AGENTS[a];
  if (!A.perms.length) return '';
  return `<section class="dp-sec"><h3 class="dp-label"><span>${lng('صلاحيات دايمة', 'Standing permissions')}</span></h3><ul class="panel-card">${A.perms.map((p, i) => `
    <li class="panel-row"><span class="panel-row__icon">${icon('shield')}</span><span class="panel-row__text"><span class="panel-row__t">${bx(p.t)}</span><span class="panel-row__d">${bx(p.d)}</span></span>
    <button type="button" class="link-btn" data-action="revoke" data-agent="${a}" data-idx="${i}">${lng('إلغاء', 'Revoke')}</button></li>`).join('')}</ul></section>`;
}
function activityHTML(a) {
  const A = AGENTS[a];
  const ev = state.events.filter((e) => e.agent === a && (e.ws ? e.ws === state.world : state.world !== 'fresh')).slice(0, 3); // details only open for agents this person sees
  const recentSec = `<section class="dp-sec"><h3 class="dp-label"><span>${lng('آخر حاجة عملها', 'Latest activity')}</span></h3>
    ${ev.length ? `<ul class="panel-card">${ev.map((e) => `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${bx(e.t)}</span><span class="panel-row__d">${esc(e.m)}</span></span></li>`).join('')}</ul>`
      : lng('<div class="panel-card"><p class="panel-empty">لسه معملش حاجة الأسبوع ده. ابعتله رسالة وهو يبدأ.</p></div>', '<div class="panel-card"><p class="panel-empty">Nothing done this week yet. Send it a message and it’ll start.</p></div>')}</section>`;
  const tools = A.conns.length ? `<ul class="panel-card">${A.conns.map((k) => {
    const s = state.conns[k];
    let end;
    if (s === 'connecting') end = lng('<span class="panel-row__meta">بيتوصل…</span>', '<span class="panel-row__meta">Connecting…</span>');
    else if (s === 'missing') end = canManage() ? `<button type="button" class="btn btn--primary btn--sm" data-action="connect" data-conn="${k}">${lng('وصّل', 'Connect')}</button>` : lng('<span class="panel-row__meta">مش متوصل</span>', '<span class="panel-row__meta">Not connected</span>');
    else if (state.dpManageTools && canManage()) end = `<button type="button" class="link-btn" data-action="disconnect" data-conn="${k}">${lng('افصل', 'Disconnect')}</button>`;
    else if (A.toolsOn && A.toolsOn[k] === false) end = lng('<span class="panel-row__meta">مقفول عليه</span>', '<span class="panel-row__meta">Turned off for it</span>');
    else end = `<span class="panel-row__meta">${icon('check')}${lng('متوصل', 'Connected')}</span>`;
    return `<li class="panel-row">${tile(k)}<span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(CONNS[k].name)}</bdi></span>
      <span class="panel-row__d">${s === 'missing' ? lng('مش متوصل · ', 'Not connected · ') + bx(CONNS[k].d) : bx(CONNS[k].d)}</span></span>${end}</li>`;
  }).join('')}</ul>` : `<div class="panel-card"><p class="panel-empty">${noToolsText(a)}</p></div>`;
  const toolsSec = `<section class="dp-sec"><h3 class="dp-label"><span>${lng('الأدوات المتوصلة', 'Connected tools')}</span>${A.conns.length && canManage() ? `<button type="button" class="link-btn" data-action="manage-tools" aria-pressed="${state.dpManageTools}">${state.dpManageTools ? lng('خلصت', 'Done') : lng('إدارة', 'Manage')}</button>` : ''}</h3>${tools}</section>`;
  const form = state.dpAddingRoutine ? `<li class="panel-form">
      <label class="sr-only" for="rt-new">${lng('الروتين الجديد', 'New routine')}</label>
      <input id="rt-new" type="text" autocomplete="off" placeholder="مثلاً: ملخص الليدز كل يوم 8 الصبح" aria-describedby="rt-err">
      <span class="panel-form__err" id="rt-err" hidden>${lng('اكتب الروتين الأول، ولو جملة قصيرة.', 'Write the routine first, even a short sentence.')}</span>
      <div class="panel-form__row"><button type="button" class="btn btn--primary btn--sm" data-action="save-routine" data-agent="${a}">${lng('ضيف', 'Add')}</button><button type="button" class="btn btn--secondary btn--sm" data-action="cancel-routine">${lng('إلغاء', 'Cancel')}</button></div>
    </li>` : '';
  const RTS = state.world === 'fresh' && !A.worlds ? [] : A.routines; // the first run starts with nothing set up
  const rows = RTS.map((r, i) => routineRowHTML(a, r, i)).join('');
  const empty = !RTS.length ? `<div class="panel-card"><div class="rt-empty">
      <p class="panel-empty">${bx(`${lng('مفيش روتينات لسه. اكتب في الشات اللي عايزه يتكرر، و', 'No routines yet. Write what you want repeated in the chat, and')}${A.name} ${lng('يظبطه لوحده.', 'sets it up on its own.')}`)}</p>
      <button type="button" class="rt-try" data-action="routine-example"${canWrite() ? '' : ' hidden'} data-agent="${a}" data-text="${esc(routineExample(a))}"><span class="rt-try__l">${lng('جرّب تكتب', 'Try writing')}</span><span class="rt-try__t">${bx(routineExample(a))}</span></button>
    </div></div>` : '';
  const routines = `<section class="dp-sec" id="dp-routines" aria-labelledby="rt-h"><h3 class="dp-label" id="rt-h"><span>${lng('الروتينات', 'Routines')}${RTS.length ? ` <span class="muted num">${RTS.length}</span>` : ''}</span>${canWrite() ? `<button type="button" class="link-btn" data-action="add-routine" aria-expanded="${state.dpAddingRoutine}">${lng('إضافة', 'Add')}</button>` : ''}</h3>
    ${rows || form ? `<ul class="panel-card">${rows}${form}</ul>` : ''}${empty}</section>`;
  return screenSecHTML(a) + recentSec + toolsSec + routines + permsHTML(a);
}
function tasksHTML(a) {
  const mine = cards.filter((c) => c.agent === a && cardVisible(c)).sort((x, y) => COLS.findIndex((k) => k.id === x.col) - COLS.findIndex((k) => k.id === y.col));
  if (!mine.length) return lng('<section class="dp-sec"><div class="panel-card"><p class="panel-empty">مفيش كروت على اللوحة للوكيل ده لسه.</p></div></section>', '<section class="dp-sec"><div class="panel-card"><p class="panel-empty">No cards on the board for this agent yet.</p></div></section>');
  return `<section class="dp-sec"><h3 class="dp-label"><span>${lng('على اللوحة', 'On the board')}</span><button type="button" class="link-btn" data-action="nav" data-view="board">${lng('افتح اللوحة', 'Open the board')}</button></h3>
    <div class="panel-card">${mine.map((c) => `<button type="button" class="panel-row" data-action="open-card" data-card="${c.id}">
      <span class="panel-row__text"><span class="panel-row__t">${bx(c.title)}</span><span class="panel-row__d">${bx(c.col === 'waiting' ? c.wait : c.col === 'progress' ? `${c.ticks[c.tick % c.ticks.length]} · ${c.pct}%` : (c.prog || ''))}</span></span>
      <span class="panel-row__meta${c.col === 'waiting' ? ' panel-row__meta--wait' : ''}">${esc(colName(c.col))}</span></button>`).join('')}</div></section>`;
}
function filesTabHTML(a) {
  const A = AGENTS[a];
  return libraryHTML(a) + `<section class="dp-sec"><h3 class="dp-label"><span>${lng('الملفات', 'Files')} <span class="muted num">${A.files.length}</span></span>${canWrite() ? `<button type="button" class="link-btn" data-action="add-file" data-agent="${a}">${lng('إضافة', 'Add')}</button>` : ''}</h3>
    ${A.files.length ? `<ul class="panel-card">${A.files.map((f) => `
      <li class="panel-row"><span class="panel-row__icon">${icon('file')}</span><span class="panel-row__text"><span class="panel-row__t od-truncate" title="${esc(f.n)}"><bdi dir="auto">${esc(f.n)}</bdi></span><span class="panel-row__d">${bx(f.d)}</span></span></li>`).join('')}</ul>`
      : lng('<div class="panel-card"><p class="panel-empty">مفيش ملفات. ضيف ملف عشان الوكيل يشتغل منه.</p></div>', '<div class="panel-card"><p class="panel-empty">No files. Add a file for the agent to work from.</p></div>')}</section>`;
}

/* ================= board ================= */
function kcardHTML(c) {
  const a = AGENTS[c.agent];
  const crew = (c.touched || []).filter((x) => AGENTS[x] && canSee(x));
  const crewHTML = crew.length > 1 ? `<span class="kcard__crew">${faceStack(crew, 18)}<span class="kcard__crew-t">${lng('اشتغل عليها:', 'Worked on it:')} ${namesHTML(crew)}</span></span>` : '';
  let prog = '';
  if (c.col === 'progress') {
    prog = `<span class="kcard__prog"><span class="kcard__t" data-prog-t="${c.id}">${bx(c.ticks[c.tick % c.ticks.length])} · <span class="num">${c.pct}%</span></span>
      <span class="bar" role="progressbar" aria-label="${lng('التقدم', 'Progress')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.pct}" data-prog-bar="${c.id}"><span class="bar__fill" style="transform:scaleX(${c.pct / 100})"></span></span></span>`;
  } else if (c.col === 'waiting') {
    const mine = cardMine(c); const own = !mine && threads[c.thread] ? PEOPLE[threads[c.thread].owner] : null;
    prog = `${waitTagHTML(c)}<span class="badge${mine ? ' badge--wait' : ''}">${mine ? '<span class="dot dot--waiting" aria-hidden="true"></span>' : icon('clock')}${!mine ? `${lng('مستني', 'Waiting on')} ${own ? esc(own.first) : lng('الفريق', 'the team')}` : canWrite() ? lng('مستنيك', 'Waiting on you') : lng('مستني الفريق', 'Waiting on the team')}</span><span class="kcard__t">${bx(waitTxt(c))}</span>`;
  } else if (c.col === 'live') {
    prog = `<span class="badge badge--live"><span class="dot" aria-hidden="true"></span>${lng('لايف', 'Live')}</span><span class="kcard__t">${bx(c.prog)}</span>`;
  } else {
    prog = c.code ? '' : `<span class="kcard__t">${bx(c.prog || '')}</span>`;
  }
  return `<button type="button" class="kcard${c.code ? ' kcard--code' : ''}" data-action="open-card" data-card="${c.id}" aria-describedby="board-drag-hint" aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown" aria-label="${c.code ? `${lng('كود:', 'Code:')} ` : ''}${esc(c.title)} · ${esc(colName(c.col))}${c.code ? codeAria(c) : ''}${crew.length > 1 ? ` ${lng('· اشتغل عليها', '· Worked on it:')} ${esc(namesOf(crew))}` : ''}" aria-haspopup="dialog">
    ${c.code ? codeMarksHTML(c) : ''}<span class="kcard__title">${bx(c.title)}</span>
    ${prog}
    ${c.code ? codeRowsHTML(c) : ''}
    ${crewHTML}
    <span class="kcard__foot"><span class="kcard__agent">${face(c.agent, 18)}<bdi class="od-truncate">${esc(a.name)}</bdi></span><span>· ${bx(c.chan)}</span>${c.due ? `<span class="kcard__due od-nowrap">${esc(c.due)}</span>` : ''}</span>
  </button>`;
}
function renderBoard() {
  const v = $('#view-board');
  const f = state.boardFilter;
  if (!canSee('coder')) state.boardKind = 'all'; // no code cards to tell apart without Coder
  const kd = state.boardKind || 'all';
  const vis = cards.filter((c) => cardVisible(c) && (f === 'all' || c.agent === f) && (kd === 'all' || (kd === 'code') === !!c.code));
  const w = waitingCards().length;
  v.innerHTML = `<div class="board">
    <header class="page-head"><div class="od-field"><h1 class="page-title">${lng('لوحة التسويق', 'Marketing board')}</h1><p class="page-sub">${lng('كل اللي الوكلاء شغالين عليه، وإيه اللي مستني موافقتك', 'Everything the agents are working on, and what’s waiting for your OK')}</p>
      <p class="sr-only" id="board-drag-hint">${lng('اسحب الكارت بالماوس لعمود تاني، أو استخدم Shift مع الأسهم', 'Drag a card to another column, or use Shift with the arrow keys')}</p></div></header>
    <div class="board-tools">
      ${kindFilterHTML()}
      <div class="od-rail" role="group" aria-label="${lng('فلتر حسب الوكيل', 'Filter by agent')}">
        <button type="button" class="chip chip--text" data-action="filter" data-agent="all" aria-pressed="${f === 'all'}">${lng('الكل', 'All')}</button>
        ${visibleAgents().map((a) => `<button type="button" class="chip" data-action="filter" data-agent="${a}" aria-pressed="${f === a}">${face(a, 22)}<bdi>${esc(AGENTS[a].name)}</bdi></button>`).join('')}
      </div>
      <span class="board-tools__summary">${!canWrite() ? `${icon('eye')}${lng('للقراية بس: الموافقات والنقل عند باقي الفريق', 'Read only: approvals and moves are up to the rest of the team')}` : w ? `<span class="dot dot--waiting" aria-hidden="true"></span>${w} ${w > 1 ? lng('كروت مستنيين', 'cards waiting for') : lng('كارت مستني', 'card waiting for')} ${lng('موافقتك', 'your approval')}` : `${icon('check')}${lng('مفيش حاجة مستنياك', 'Nothing waiting on you')}`}</span>
      <div class="board-nav" role="group" aria-label="${lng('التنقل بين الأعمدة', 'Move between columns')}" hidden>
        <span class="board-nav__pos num" id="board-pos" aria-live="polite">${COLS.length} ${lng('أعمدة', 'columns')}</span>
        <button type="button" class="circle-btn" data-action="board-scroll" data-dir="prev" aria-label="${lng('الأعمدة اللي قبل', 'Previous columns')}" aria-controls="board-cols">${icon('chevronRight')}</button>
        <button type="button" class="circle-btn" data-action="board-scroll" data-dir="next" aria-label="${lng('الأعمدة اللي بعد', 'Next columns')}" aria-controls="board-cols">${icon('chevron')}</button>
      </div>
    </div>
    ${!cards.some(cardVisible) ? `<div class="board-bare" role="note">${face(state.main, 32)}<p>${bx(`${lng('اللوحة فاضية لسه. أول ما تطلب من', 'The board is empty for now. Once you ask')} ${AGENTS[state.main].name} ${lng('وكيل وتديله شغلانة، كروتها هتظهر هنا لوحدها.', 'for an agent and give it a job, its cards show up here on their own.')}`)}</p>
      ${canWrite() ? `<button type="button" class="btn btn--secondary btn--sm" data-action="new-agent">${icon('chat')}<span>${bx(`${lng('كلّم', 'Talk to')} ${AGENTS[state.main].name}`)}</span></button>` : ''}</div>` : ''}
    <div class="board-cols" id="board-cols">${COLS.map((col) => {
      const list = vis.filter((c) => c.col === col.id);
      const ments = col.id === 'waiting' && kd !== 'code' ? unreadMentions() : [];
      const add = col.id === 'ideas' && canWrite() ? `<button type="button" class="circle-btn add-btn" data-action="add-idea" aria-label="${lng('ضيف فكرة', 'Add an idea')}" aria-expanded="${state.addingIdea}">${icon('plus')}</button>` : '';
      const form = col.id === 'ideas' && state.addingIdea ? `<div class="add-idea" id="add-idea">
          <label for="idea-title">${lng('الفكرة', 'Idea')}</label>
          <input id="idea-title" type="text" autocomplete="off" placeholder="مثلاً: بوست LinkedIn عن الدفعة الجديدة" aria-describedby="idea-err">
          <span class="add-idea__err" id="idea-err" hidden>${lng('اكتب الفكرة الأول، ولو جملة قصيرة.', 'Write the idea first, even a short sentence.')}</span>
          <label for="idea-agent">${lng('الوكيل', 'Agent')}</label>
          <select id="idea-agent">${visibleAgents().map((a) => `<option value="${a}" ${(f === a || (f === 'all' && a === 'seo')) ? 'selected' : ''}>${esc(AGENTS[a].name)}</option>`).join('')}</select>
          <div class="add-idea__row"><button type="button" class="btn btn--primary btn--sm" data-action="save-idea">${lng('ضيف', 'Add')}</button><button type="button" class="btn btn--secondary btn--sm" data-action="cancel-idea">${lng('إلغاء', 'Cancel')}</button></div>
        </div>` : '';
      const empty = !list.length && !form && !ments.length ? `<div class="col-empty"><b>${esc(col.empty[0])}</b>${col.empty[1] ? `<span>${esc(col.empty[1])}</span>` : ''}</div>` : '';
      const colTitle = col.id === 'waiting' && !canWrite() ? lng('مستني الفريق', 'Waiting on the team') : col.name;
      return `<section class="col${col.id === 'waiting' ? ' col--waiting' : ''}" aria-labelledby="col-${col.id}">
        <div class="col__head">${col.id === 'waiting' ? '<span class="dot dot--waiting" aria-hidden="true"></span>' : ''}<h2 class="col__name" id="col-${col.id}">${esc(colTitle)}</h2><span class="col__count num">${list.length + ments.length}</span>${add}</div>
        <div class="col__body">${mentionGroupHTML(ments)}${form}${list.map(kcardHTML).join('')}${empty}</div></section>`;
    }).join('')}</div>
  </div>`;
  window.requestAnimationFrame(syncBoardNav);
}
/* which columns are in view: position text, arrows, and an edge fade where more columns wait */
function boardView() {
  const sc = $('#board-cols'); if (!sc) return null;
  const cols = $$('.col', sc); const box = sc.getBoundingClientRect();
  const full = [];
  cols.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const seen = Math.min(r.right, box.right) - Math.max(r.left, box.left);
    if (seen >= r.width - 2) full.push(i);
  });
  return { sc, cols, full };
}
function syncBoardNav() {
  const v = boardView(); const nav = $('.board-nav'); if (!v || !nav) return;
  const { sc, cols, full } = v;
  const max = sc.scrollWidth - sc.clientWidth; const pos = Math.abs(sc.scrollLeft);
  const atStart = pos <= 2; const atEnd = pos >= max - 2;
  nav.hidden = max <= 2;
  sc.classList.toggle('has-more-start', max > 2 && !atStart);
  sc.classList.toggle('has-more-end', max > 2 && !atEnd);
  if (max <= 2) return;
  const first = full.length ? full[0] + 1 : 1; const last = full.length ? full[full.length - 1] + 1 : 1;
  const posEl = $('#board-pos'); if (posEl) posEl.textContent = `${lng('الأعمدة', 'Columns')} ${first}–${last} ${lng('من', 'of')} ${cols.length}`;
  const prev = $('[data-action="board-scroll"][data-dir="prev"]'); const next = $('[data-action="board-scroll"][data-dir="next"]');
  if (prev) prev.disabled = atStart;
  if (next) next.disabled = atEnd;
}
function scrollBoard(dir) {
  const v = boardView(); if (!v || !v.full.length) return;
  const i = dir === 'next' ? v.full[v.full.length - 1] + 1 : v.full[0] - 1;
  const col = v.cols[i]; if (!col) return;
  /* RTL: «next» columns sit to the left. Bring the hidden column flush with the padded edge. */
  const box = v.sc.getBoundingClientRect(); const r = col.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(v.sc).paddingInlineStart) || 0;
  const delta = (dir === 'next') === RTL ? r.left - (box.left + pad) : r.right - (box.right - pad);
  v.sc.scrollBy({ left: delta, behavior: reduced() ? 'auto' : 'smooth' });
}

/* ================= dashboard ================= */
function deltaHTML(cur, prev, lowerIsBetter, label) {
  if (!prev) return lng('<span class="kpi__delta">مفيش فترة قبلها للمقارنة</span>', '<span class="kpi__delta">No earlier period to compare</span>');
  const pct = ((cur - prev) / prev) * 100;
  const r = Math.round(Math.abs(pct));
  if (r === 0) return `<span class="kpi__delta">${lng('زي', 'Same as')} ${label} ${lng('بالظبط', '')}</span>`;
  const up = pct > 0;
  return `<span class="kpi__delta">${icon(up ? 'up' : 'down')}<span>${up ? lng('زيادة', 'Up') : lng('أقل', 'Down')} ${r}${lng('% عن', '% vs')} ${label}</span></span>`;
}
function chartSVG(p) {
  const s = DATA[p].series; const n = s.meta.length;
  const W = 720, H = 250, L = 34, R = 6, T = 10, B = 30;
  const tot = s.meta.map((v, i) => v + s.google[i] + s.seo[i]);
  const max = Math.max.apply(null, tot);
  const top = Math.ceil(max / 10) * 10;
  const cw = (W - L - R) / n; const bw = Math.max(4, cw * (n > 10 ? 0.62 : 0.5));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = Math.round((top / 4) * k); const yy = y(v);
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end">${v}</text>`;
  }
  g += `<line class="chart__hair" x1="0" x2="0" y1="${T}" y2="${H - B}"/>`;
  let bars = '';
  for (let i = 0; i < n; i++) {
    const x = L + cw * i + (cw - bw) / 2; let base = 0;
    const back = n - 1 - i;
    const parts = [['seo', 'var(--ch-seo)'], ['google', 'var(--ch-google)'], ['meta', 'var(--ch-meta)']];
    let segs = '';
    parts.forEach(([k, col]) => {
      const v = s[k][i]; const y1 = y(base + v); const h = y(base) - y1;
      segs += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 1).toFixed(1)}" rx="2" fill="${col}"/>`;
      base += v;
    });
    bars += `<g class="bar-g" style="--i:${i}">${segs}</g>`;
    const showLbl = n <= 7 || back % 5 === 0;
    if (showLbl) bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${dayLabel(back)}</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${lng('الليدز اليومية حسب القناة لآخر', 'Daily leads by channel, last')} ${p} ${lng('يوم', 'days')}" style="direction:ltr">${g}${bars}</svg>`;
}
/* money in the interface language: «2,400 ج» / «EGP 2,400» */
const egp = (v) => (RTL ? `${v} ج` : `EGP ${v}`);
const kpiMoney = (v) => (RTL ? `${v}<span class="kpi__unit">ج</span>` : `<span class="kpi__unit kpi__unit--pre">EGP</span>${v}`);
function renderDashboard() {
  const v = $('#view-dashboard');
  const p = state.period; const label = p === '7' ? lng('الـ7 أيام اللي فاتوا', 'the previous 7 days') : lng('الـ30 يوم اللي فاتوا', 'the previous 30 days');
  const head = `<header class="page-head"><div class="od-field"><h1 class="page-title">${lng('الأرقام', 'Numbers')}</h1><p class="page-sub">${lng('بيانات تجريبية للنموذج، مش من حسابات الإعلانات الحقيقية', 'Sample data for this prototype, not from real ad accounts')}</p></div>
    <div class="segmented" role="group" aria-label="${lng('الفترة', 'Period')}">
      <button type="button" data-action="period" data-p="7" aria-pressed="${p === '7'}">${lng('آخر 7 أيام', 'Last 7 days')}</button>
      <button type="button" data-action="period" data-p="30" aria-pressed="${p === '30'}">${lng('آخر 30 يوم', 'Last 30 days')}</button>
    </div></header>`;
  if (state.dashLoading) {
    const sk = (h) => `<div class="sk" style="height:${h}px;border-radius:16px"></div>`;
    v.innerHTML = `<div class="dash">${head}<div class="dash__inner" aria-busy="true" aria-label="${lng('بيحمّل الأرقام', 'Loading the numbers')}">
      <div class="od-grid kpis">${sk(118)}${sk(118)}${sk(118)}${sk(118)}</div>
      <div class="dash-row">${sk(340)}${sk(220)}</div><div class="dash-row">${sk(280)}${sk(280)}</div></div></div>`;
    return;
  }
  const t = totals(p); const pr = DATA[p].prev; const prCpl = pr.spend / pr.leads;
  const c = DATA[p].ch;
  const chRow = (k, name, col) => {
    const r = c[k]; const rev = r.sales * PRICE;
    return `<tr><td><span class="chan"><i style="background:${col}" aria-hidden="true"></i><bdi>${name}</bdi></span></td>
      <td class="num">${r.spend ? egp(fmt(r.spend)) : lng('<span class="muted">عضوي</span>', '<span class="muted">Organic</span>')}</td><td class="num">${fmt(r.leads)}</td>
      <td class="num">${r.spend ? egp(fmt1(r.spend / r.leads)) : '<span class="muted">—</span>'}</td><td class="num">${fmt(r.sales)}</td>
      <td class="num">${egp(fmt(rev))}</td><td class="num">${r.spend ? fmt1(rev / r.spend) + '×' : '<span class="muted">—</span>'}</td></tr>`;
  };
  const wl = waitingCards();
  v.innerHTML = `<div class="dash">${head}<div class="dash__inner">
    <div class="od-grid kpis">
      <div class="kpi od-stat"><span class="kpi__label">${lng('الصرف', 'Spend')}</span><span class="kpi__val num">${kpiMoney(fmt(t.spend))}</span>${deltaHTML(t.spend, pr.spend, false, label)}</div>
      <div class="kpi od-stat"><span class="kpi__label">${lng('الليدز', 'Leads')}</span><span class="kpi__val num">${fmt(t.leads)}</span>${deltaHTML(t.leads, pr.leads, false, label)}</div>
      <div class="kpi od-stat"><span class="kpi__label">${lng('تكلفة الليد', 'Cost per lead')}</span><span class="kpi__val num">${kpiMoney(fmt1(t.cpl))}</span>${deltaHTML(t.cpl, prCpl, true, label)}</div>
      <div class="kpi od-stat"><span class="kpi__label">${lng('الإيراد', 'Revenue')}</span><span class="kpi__val num">${kpiMoney(fmt(t.revenue))}</span>${deltaHTML(t.revenue, pr.revenue, false, label)}</div>
    </div>
    <div class="dash-row">
      <section class="panel" aria-labelledby="h-chart"><div class="panel__h"><h2 id="h-chart">${lng('الليدز كل يوم', 'Leads per day')}</h2>
        <div class="legend"><span><i style="background:var(--ch-meta)"></i><bdi>Meta</bdi></span><span><i style="background:var(--ch-google)"></i><bdi>Google</bdi></span><span><i style="background:var(--ch-seo)"></i><bdi>SEO</bdi></span></div></div>
        <div class="chart-wrap" data-chart="${p}">${chartSVG(p)}<div class="chart-tip" aria-hidden="true" hidden></div></div></section>
      <section class="panel panel--wait" aria-labelledby="h-wait"><div class="panel__h"><h2 id="h-wait">${canWrite() ? lng('مستني موافقتك', 'Waiting for your approval') : lng('مستني موافقة الفريق', 'Waiting for the team’s OK')}</h2><span class="muted num">${wl.length}</span></div>
        ${wl.length ? `<div class="panel-card">${wl.map((w) => `<button type="button" class="panel-row" data-action="open-card" data-card="${w.id}" aria-haspopup="dialog">${face(w.agent, 28)}
          <span class="panel-row__text"><span class="panel-row__t">${bx(w.title)}</span><span class="panel-row__d">${bx(w.wait)}</span></span>
          <span class="panel-row__meta panel-row__meta--wait"><span class="dot dot--waiting" aria-hidden="true"></span>${canWrite() ? lng('مستنيك', 'Waiting on you') : lng('مستني', 'Waiting')}</span></button>`).join('')}</div>`
          : lng('<div class="wait-empty"><b>مفيش حاجة مستنياك</b><span>كل الوكلاء ماشيين لوحدهم. هنبلغك أول ما حد يحتاجك.</span></div>', '<div class="wait-empty"><b>Nothing waiting on you</b><span>All agents are running on their own. We’ll tell you as soon as one needs you.</span></div>')}
      </section>
    </div>
    <div class="dash-row">
      <section class="panel" aria-labelledby="h-chan"><div class="panel__h"><h2 id="h-chan">${lng('حسب القناة', 'By channel')}</h2><span class="muted">${lng('سعر الكورس', 'Course price')} ${egp(fmt(PRICE))}</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>${lng('القناة', 'Channel')}</th><th>${lng('الصرف', 'Spend')}</th><th>${lng('الليدز', 'Leads')}</th><th>${lng('تكلفة الليد', 'Cost per lead')}</th><th>${lng('المبيعات', 'Sales')}</th><th>${lng('الإيراد', 'Revenue')}</th><th>${lng('العائد', 'ROAS')}</th></tr></thead>
        <tbody>${chRow('meta', 'Meta', 'var(--ch-meta)')}${chRow('google', 'Google', 'var(--ch-google)')}${chRow('seo', 'SEO', 'var(--ch-seo)')}</tbody>
        <tfoot><tr><td>${lng('الإجمالي', 'Total')}</td><td class="num">${egp(fmt(t.spend))}</td><td class="num">${fmt(t.leads)}</td><td class="num">${egp(fmt1(t.cpl))}</td><td class="num">${fmt(t.sales)}</td><td class="num">${egp(fmt(t.revenue))}</td><td class="num">${fmt1(t.revenue / t.spend)}×</td></tr></tfoot></table></div>
        <p class="demo-note">${state.conns.ga4 === 'connected' ? lng('المبيعات من GA4 والشيت.', 'Sales from GA4 and the sheet.') : lng('المبيعات من شيت الفريق لحد ما GA4 يتوصل.', 'Sales from the team sheet until GA4 is connected.')}</p></section>
      <section class="panel" aria-labelledby="h-feed"><div class="panel__h"><h2 id="h-feed">${lng('الوكلاء عملوا إيه الأسبوع ده', 'What the agents did this week')}</h2></div>
        <ul class="feed">${state.events.filter((e) => canSee(e.agent)).slice(0, 6).map((e) => `<li>${face(e.agent, 28)}<div class="feed__body"><span class="feed__t">${RTL || !/^(Sara|Omar|Youssef|Mona)\b/.test(e.t) ? `<b><bdi>${esc(AGENTS[e.agent].name)}</bdi></b> ` : ''}${bx(RTL || /^(Sara|Omar|Youssef|Mona)\b/.test(e.t) ? e.t : e.t.charAt(0).toLowerCase() + e.t.slice(1))}</span><span class="feed__m">${esc(e.m)}</span></div></li>`).join('')}</ul></section>
    </div>
  </div></div>`;
}
function loadDashboard(ms) {
  state.dashLoading = true; renderDashboard();
  later(ms, () => {
    state.dashLoading = false; state.dashLoaded = true;
    if (state.view !== 'dashboard') return;
    const a = document.activeElement; const hadSeg = a && a.dataset && a.dataset.action === 'period';
    renderDashboard(); dashEnter(true);
    if (hadSeg) { const b = $(`[data-action="period"][data-p="${state.period}"]`); if (b) b.focus(); }
  });
}

/* ================= view switching ================= */
function syncDetailsVisibility() {
  const det = $('#details');
  det.hidden = state.view !== 'chat' || (!overlayDetails() && !state.detailsOpen);
  const pill = $('#btn-details');
  if (pill) pill.setAttribute('aria-expanded', String(overlayDetails() ? det.classList.contains('is-open') : !det.hidden));
}
function setView(v, opts = {}) {
  state.view = v;
  ['chat', 'board', 'dashboard', 'log'].forEach((k) => { $(`#view-${k}`).hidden = k !== v; });
  $('#details').classList.remove('is-open');
  const sec = $(`#view-${v}`);
  sec.classList.remove('view-enter'); void sec.offsetWidth; sec.classList.add('view-enter');
  if (v === 'chat') { renderChat(); renderDetails(); }
  if (v === 'board') { renderBoard(); boardEnter(); }
  if (v === 'log') renderLogPage();
  if (v === 'dashboard') { if (!state.dashLoaded) loadDashboard(650); else { renderDashboard(); dashEnter(false); } }
  syncDetailsVisibility();
  renderSidebar();
  closeSidebar();
  if (opts.focusComposer) { const ta = $('#ta-main'); if (ta) ta.focus(); }
}
function rerenderAll() {
  renderSidebar();
  if (state.view === 'chat' && $('#view-chat .chat')) {
    const ta = $('#ta-main'); const val = ta ? ta.value : ''; const hadFocus = document.activeElement === ta;
    const tr = $('#chat-transcript'); const keep = tr ? tr.scrollTop : 0;
    const streaming = threads[state.chatThread] && threads[state.chatThread].msgs.some((m) => m.streaming);
    if (!streaming) {
      renderChat();
      const ntr = $('#chat-transcript'); if (ntr && keep) ntr.scrollTop = Math.max(keep, ntr.scrollTop);
    }
    renderDetails(); syncDetailsVisibility();
    const nta = $('#ta-main'); if (nta && nta !== ta) { nta.value = val; syncComposer('main'); if (hadFocus) nta.focus(); }
  }
  if (state.view === 'board') renderBoard();
  if (state.view === 'dashboard' && !state.dashLoading) renderDashboard();
  if (state.view === 'log') renderLogPage();
  if (state.sheetCard) { renderSheetHead(); if (state.sheetTab === 'log') renderSheetLog(); if (state.sheetTab === 'req') renderCodePane(); }
}
function openThread(id) { state.chatThread = id; setView('chat', { focusComposer: true }); }

/* ================= sheet (board card conversation over the board) ================= */
function renderSheetHead() {
  const c = cardById(state.sheetCard); if (!c) return;
  const head = $('#sheet-head'); if (!head) return;
  const a = AGENTS[c.agent];
  const th = c.thread ? threads[c.thread] : null; const team = th && th.team;
  const tab = state.sheetTab; const nLog = cardLog(c).length;
  const reqTab = c.code ? `<button type="button" role="tab" id="sh-tab-req" aria-selected="${tab === 'req'}" aria-controls="${tab === 'req' ? 'sheet-req' : 'sheet-body'}" tabindex="${tab === 'req' ? 0 : -1}" data-action="sheet-tab" data-tab="req">${lng('الطلب', 'Request')}</button>` : '';
  head.innerHTML = `<div class="sheet__top">${th && th.channel ? `<span class="hp-hash hp-hash--lg" aria-hidden="true">${icon('hash')}</span>` : team ? faceStack(team, 24, 'var(--bg-chrome)') : face(c.agent, 28)}<h2 class="sheet__title" id="sheet-title">${bx(c.title)}</h2>
      <button type="button" class="circle-btn" data-action="close-sheet" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></div>
    <div class="sheet__meta">${c.code ? `${codeMarksHTML(c, true)}<span aria-hidden="true">·</span>` : ''}${th && th.channel ? `<span>${lng('قناة', 'Channel')} <span class="od-nowrap">#${bx(th.title)}</span></span>` : team ? `<span>${lng('فريق:', 'Team:')} ${namesHTML(team)}</span>` : `<bdi>${esc(a.name)}</bdi>`}<span aria-hidden="true">·</span>
      ${c.col === 'waiting' ? `<span class="badge badge--wait"><span class="dot dot--waiting" aria-hidden="true"></span>${canWrite() ? lng('مستنيك', 'Waiting on you') : lng('مستني الفريق', 'Waiting on the team')}</span>` : `<span class="badge">${esc(colName(c.col))}</span>`}
      ${c.thread && th && threadVisible(th) ? `<button type="button" class="link-btn" data-action="sheet-to-chat">${icon('open')}<span>${lng('افتح في المحادثات', 'Open in Chats')}</span></button>` : ''}</div>
    <div class="segmented sheet-tabs" role="tablist" aria-label="${lng('الكارت', 'The card')}">
      ${reqTab}<button type="button" role="tab" id="sh-tab-chat" aria-selected="${tab === 'chat'}" aria-controls="${tab === 'chat' ? 'sheet-transcript' : 'sheet-body'}" tabindex="${tab === 'chat' ? 0 : -1}" data-action="sheet-tab" data-tab="chat">${lng('المحادثة', 'Chat')}</button>
      <button type="button" role="tab" id="sh-tab-log" aria-selected="${tab === 'log'}" aria-controls="${tab === 'log' ? 'sheet-log' : 'sheet-body'}" tabindex="${tab === 'log' ? 0 : -1}" data-action="sheet-tab" data-tab="log">${lng('السجل', 'Log')} <span class="num sheet-tabs__n">${nLog}</span></button>
    </div>`;
}
function openSheet(cardId, tab) {
  const c = cardById(cardId); if (!c) return;
  const dlg = $('#sheet');
  window.clearTimeout(closeSheet.t); // a close still animating must not shut the sheet we are opening now
  state.sheetCard = cardId; { const th0 = c.thread && threads[c.thread]; state.sheetTab = tab === 'log' ? 'log' : tab === 'chat' ? 'chat' : c.code ? 'req' : th0 && !threadMine(th0) ? 'log' : 'chat'; }
  if (state.noteEditSurf === 'sheet') { state.noteEdit = null; state.noteEditSurf = null; state.noteDraft = null; }
  $('#sheet-inner').innerHTML = '<header class="sheet__head" id="sheet-head"></header><div class="sheet-body" id="sheet-body"></div>';
  renderSheetHead();
  dlg.classList.remove('is-closing');
  if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
  renderSheetBody(true);
  renderSidebar();
}
function closeSheet() {
  const dlg = $('#sheet'); if (!dlg.open) return;
  const finish = () => { dlg.classList.remove('is-closing'); if (dlg.open) dlg.close(); };
  if (reduced()) finish(); else { dlg.classList.add('is-closing'); closeSheet.t = window.setTimeout(finish, 190); }
}
$('#sheet').addEventListener('close', () => {
  const cid = state.sheetCard;
  state.sheetCard = null; state.sheetTab = 'chat';
  if (state.noteEditSurf === 'sheet') { state.noteEdit = null; state.noteEditSurf = null; state.noteDraft = null; }
  closePop('note');
  $('#sheet-inner').innerHTML = '';
  const target = cid && ($(`#main [data-card="${cid}"][data-action="open-card"]`) || $(`#details [data-card="${cid}"][data-action="open-card"]`));
  if (target) target.focus();
  else if (state.view === 'chat' && $('#ta-main')) $('#ta-main').focus();
  else { const nav = $(`#sb-nav [data-view="${state.view}"]`); if (nav) nav.focus(); }
});
$('#sheet').addEventListener('cancel', (e) => { e.preventDefault(); if (!closeMenus()) closeSheet(); });
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });
/* agent gallery dialog */
$('#modal').addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
$('#modal').addEventListener('close', () => {
  const m = state.modal; state.modal = null; $('#modal-inner').innerHTML = '';
  const ta = $('#ta-main');
  if (document.activeElement && document.activeElement !== document.body && !$('#modal').contains(document.activeElement)) return;
  if (m && m.opener && document.body.contains(m.opener)) m.opener.focus();
  else if (ta) ta.focus();
});

/* ================= flows ================= */
function moveCard(cardId, col, patch) {
  const c = cardById(cardId); if (!c) return;
  c.col = col; Object.assign(c, patch || {});
  if (col === 'progress' && !c.ticks) { c.ticks = [lng('بيشتغل عليه', 'Working on it'), lng('بيجهّز المسودة', 'Preparing the draft'), lng('بيراجع قبل ما يبعت', 'Reviewing before sending')]; c.tick = 0; c.pct = c.pct || 10; }
}
function bump(t) { t.day = 0; t.ts = ++tsSeq; t.time = nowTime(); }
function chooseAngle(threadId, msgId, idx, typed) {
  const t = threads[threadId]; const m = t.msgs.find((x) => x.id === msgId);
  if (!m || !m.card || m.card.status !== 'pending') return;
  const opt = m.card.options[idx];
  m.card.status = 'answered'; m.card.answer = idx; m.card.justAt = Date.now();
  logAuto(ME(), meAct('اختار زاوية الإعلان', 'اختارت زاوية الإعلان', 'picked the ad angle'), { card: m.card.card, from: lng('مستني اختيار', 'Waiting for a pick'), to: opt.t });
  if (!typed) t.msgs.push({ id: nid('u'), role: 'user', text: `نمشي بزاوية «${opt.t}»`, time: nowTime(), fresh: true });
  bump(t);
  const c = cardById(m.card.card);
  if (c) { c.wait = lng('Ads بيجهّز الخطة', 'Ads is preparing the plan'); }
  AGENTS.ads.memory.push(mem('lessons', 'learned', `${PEOPLE[state.as].first} اختار زاوية «${opt.t}» لحملة ديسمبر، يبقى نبدأ بيها في حملات المحاسب الشامل الجاية.`, lng('من المحادثة دي · النهارده', 'From this chat · Today')));
  refreshThread(threadId); rerenderAll();
  const onStop = () => { if (c && c.col === 'waiting') c.wait = lng('وقّفت Ads قبل ما يكمّل الخطة', 'You stopped Ads before it finished the plan'); };
  agentSays(threadId, 'ads', {
    text: `تمام، دي خطة الحملة بزاوية «${opt.t}». جهّزت 3 إعلانات فيديو و2 صور في Meta Ads كمسودة، ومحتاج موافقتك قبل ما أطلقها وأبدأ أصرف.`,
    activity: [lng('بيفتح حسابات Meta', 'Opening Meta accounts'), lng('بيكتب 5 نصوص بالزاوية', 'Writing 5 scripts with the angle'), lng('بيرفع الإعلانات مسودة', 'Uploading the ads as drafts'), lng('بيظبط الاستهداف والميزانية', 'Setting targeting and budget')],
    steps: [
      { tool: 'meta', label: lng('كتب 5 نصوص بالزاوية وبعتهم لـ Critic', 'Wrote 5 scripts with the angle and sent them to Critic'), state: 'done' },
      { tool: 'meta', label: lng('رفع الإعلانات كمسودة في Meta Ads', 'Uploaded the ads as drafts in Meta Ads'), state: 'done' },
      { tool: 'meta', label: lng('ظبط الاستهداف والميزانية', 'Set targeting and budget'), state: 'done' },
    ], stepsDur: lng('1 دقيقة', '1 min'),
    card: { type: 'plan', title: 'خطة الحملة', sub: 'مسودة · Meta Ads', rows: [['الهدف', 'ليدز على واتساب'], ['الجمهور', 'خريجين تجارة 22–30 · القاهرة والجيزة والإسكندرية'], ['الإعلانات', '3 فيديو + 2 صور'], ['الميزانية', '500 ج يومياً · 15,000 ج للشهر'], ['المتوقع', opt.tag.replace('متوقع ', '')]] },
  }, () => {
    logAuto(WHO.a('ads'), lng('سلّم خطة الحملة', 'delivered the campaign plan'), { card: c ? c.id : null, to: lng('مسودة · 3 فيديو + 2 صور', 'Draft · 3 videos + 2 images') });
    /* handoff: Ads sends the copy to Critic, Critic answers, then the launch approval */
    t.msgs.push({ id: nid('h'), role: 'handoff', from: 'ads', to: 'critic', text: lng('Ads بعت النصوص لـ Critic', 'Ads sent the scripts to Critic'), detail: lng('5 نصوص قبل الإطلاق', '5 scripts before launch'), time: nowTime(), fresh: true });
    addTouched(c, 'critic');
    refreshThread(threadId); scrollMounts(threadId);
    agentSays(threadId, 'critic', {
      to: 'ads', activity: [lng('بيقرا الـ5 نصوص', 'Reading the 5 scripts'), lng('بيقارن بدليل صوت الأكاديمية', 'Checking against the academy voice guide'), lng('بيكتب الملاحظات', 'Writing notes')],
      text: 'راجعت الـ5 نصوص: 4 تمام، وواحد كان فيه «شغل مضمون» فبدّلته بـ «تدريب على شغل حقيقي». مفيش أرقام من غير مصدر، فجاهزين للإطلاق لما توافق.',
    }, () => {
      logAuto(WHO.a('critic'), lng('راجع 5 نصوص', 'reviewed 5 scripts'), { card: c ? c.id : null, to: lng('4 تمام · 1 اتعدّل', '4 fine · 1 fixed') });
      t.msgs.push({ id: nid('a'), role: 'agent', agent: 'ads', time: nowTime(), fresh: true,
        card: { type: 'approval', status: 'pending', tool: 'meta', title: lng('إطلاق حملة «المحاسب الشامل · ديسمبر»', 'Launch the “المحاسب الشامل · ديسمبر” campaign'), sub: lng('Meta Ads · بيبدأ صرف فعلي', 'Meta Ads · real spend starts'), effect: 'launch-meta',
          rows: [[lng('الميزانية', 'Budget'), lng('500 ج يومياً (15,000 ج للشهر)', 'EGP 500/day (EGP 15,000/month)')], [lng('المدة', 'Duration'), lng('12 نوفمبر – 11 ديسمبر', 'Nov 12 – Dec 11')], [lng('الزاوية', 'Angle'), opt.t], [lng('الإعلانات', 'Ads'), lng('5 إعلانات راجعها Critic', '5 ads reviewed by Critic')]] } });
      if (c) c.wait = lng('مستني موافقتك على الإطلاق', 'Waiting for your OK to launch');
      refreshThread(threadId); scrollMounts(threadId); rerenderAll();
    });
  }, lng('بيجهّز الخطة', 'Preparing the plan'), onStop);
}
function decide(threadId, msgId, decision) {
  const t = threads[threadId]; const m = t.msgs.find((x) => x.id === msgId);
  if (!m || !m.card || m.card.status !== 'pending') return;
  m.card.status = decision; m.card.resolvedAt = nowTime(); m.card.justAt = Date.now();
  { const cid = m.card.effect === 'launch-meta' ? 'c-meta' : m.card.effect === 'publish-seo' ? 'c-seo' : t.card;
    logAuto(ME(), decision === 'denied' ? meAct('رفض', 'رفضت', 'refused') : meAct('وافق على', 'وافقت على', 'approved'), { card: cid && cardById(cid) ? cid : null, agent: m.agent || null, obj: m.card.title, from: lng('مستني موافقة', 'Waiting for OK'), to: OUTCOME[decision] }); }
  bump(t);
  const eff = m.card.effect; const ok = decision !== 'denied';
  if (eff === 'launch-meta') {
    if (ok) {
      sysMove('c-meta', 'live', { prog: lng('لايف من دلوقتي · لسه مفيش ليدز', 'Live now · no leads yet'), wait: '' });
      state.events.unshift({ agent: 'ads', t: lng('أطلق حملة «المحاسب الشامل · ديسمبر» بميزانية 500 ج يومياً', 'Launched the “المحاسب الشامل · ديسمبر” campaign at EGP 500/day'), m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
      if (decision === 'always') AGENTS.ads.perms.push({ t: lng('إطلاق حملات Meta', 'Launch Meta campaigns'), d: lng('لحد 15,000 ج في الشهر لكل حملة', 'Up to EGP 15,000/month per campaign') });
      toast(decision === 'always' ? lng('الحملة اتطلقت، وAds مش هيستأذن تاني في حملات زيها', 'Campaign launched. Ads won’t ask again for campaigns like this') : lng('الحملة اتطلقت', 'Campaign launched'));
    } else {
      sysMove('c-meta', 'planned', { prog: lng('مسودة · مستني تعديلاتك', 'Draft · waiting for your edits'), wait: '' });
      toast(lng('مفيش حاجة اتطلقت، الحملة فضلت مسودة', 'Nothing launched. The campaign stayed a draft'), 'x');
    }
    refreshThread(threadId); rerenderAll();
    agentSays(threadId, 'ads', ok ? {
      text: 'اتطلقت. أول تقرير أداء هيوصلك هنا بكرة 9 الصبح.\nلو تكلفة الليد عدّت 45 ج في أي إعلان هوقفه لوحدي وأقولك.',
      steps: [{ tool: 'meta', label: lng('نشر الحملة و5 إعلانات', 'Published the campaign and 5 ads'), state: 'done' }, { tool: 'meta', label: lng('فعّل روتين المتابعة اليومي', 'Turned on the daily monitoring routine'), state: 'done' }], stepsDur: lng('12 ثانية', '12 sec'),
    } : { text: 'تمام، مطلقتش حاجة ومفيش أي صرف. الحملة فضلت مسودة في Meta Ads.\nقولي تحب أغيّر إيه: الميزانية، الجمهور، ولا الزاوية؟' }, () => rerenderAll());
  } else if (eff === 'publish-seo') {
    if (ok) {
      sysMove('c-seo', 'live', { prog: lng('اتنشر · مستني Google يأرشفه', 'Published · waiting for Google to index it'), wait: '' });
      state.events.unshift({ agent: 'seo', t: lng('نشر مقال «كورس محاسبة اونلاين» على موقع الأكاديمية', 'Published the “كورس محاسبة اونلاين” article on the academy website'), m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
      if (decision === 'always') AGENTS.seo.perms.push({ t: lng('نشر المقالات', 'Publish articles'), d: lng('بعد موافقة Critic بس', 'Only after Critic approves') });
      toast(lng('المقال اتنشر', 'Article published'));
    } else {
      sysMove('c-seo', 'progress', { pct: 70, ticks: [lng('بيعدّل حسب ملاحظاتك', 'Editing based on your notes'), lng('بيبعته لـ Critic تاني', 'Sending it to Critic again')], tick: 0, wait: '' });
      toast(lng('المقال رجع للتعديل', 'Article sent back for edits'), 'x');
    }
    refreshThread(threadId); rerenderAll();
    agentSays(threadId, 'seo', ok ? {
      text: 'اتنشر على موقع الأكاديمية، وبعته لـ Search Console عشان يتأرشف أسرع. هتابع ترتيبه كل اتنين.',
      steps: [{ tool: 'wp', label: lng('نشر المقال', 'Published the article'), state: 'done' }, { tool: 'gsc', label: lng('طلب أرشفة الرابط', 'Requested indexing for the link'), state: 'done' }], stepsDur: lng('8 ثواني', '8 sec'),
    } : { text: 'تمام، مش هنشره. قولي إيه اللي مش عاجبك وأنا أعدّل وأبعته لـ Critic تاني.' }, () => rerenderAll());
  }
}
function connectTool(k) {
  if (state.conns[k] !== 'missing') return;
  state.conns[k] = 'connecting'; state.connLater[k] = false;
  refreshMounted(); renderDetails();
  later(1200, () => {
    state.conns[k] = 'connected';
    logAuto(ME(), meAct('وصّل', 'وصّلت', 'connected'), { obj: CONNS[k].name, from: lng('مش متوصل', 'Not connected'), to: lng('متوصل', 'Connected') });
    refreshMounted(); renderDetails();
    if (state.view === 'dashboard' && !state.dashLoading) renderDashboard();
    toast(`${CONNS[k].name} ${lng('اتوصل', 'connected')}`);
  });
}
/* «عملتها» on a handed-over step: the person did it, the agent picks up from there */
function handDone(threadId, msgId) {
  const t = threads[threadId]; const m = t && t.msgs.find((x) => x.id === msgId);
  if (!m || !m.card || m.card.status !== 'pending') return;
  if (m.card.screen) { screenHandDone(threadId, m); return; }
  m.card.status = 'done'; m.card.at = nowTime(); m.card.justAt = Date.now();
  logAuto(ME(), meAct('عملها', 'عملتها', 'did it'), { card: m.card.card || t.card || null, obj: m.card.title, from: lng('اتسلّمتلك', 'Handed to you'), to: lng('عملتها', 'Done it') });
  bump(t);
  if (m.card.card) sysMove(m.card.card, 'live', { prog: lng('المقال اتنشر · النصوص مسودة في Meta Ads', 'Article published · scripts are drafts in Meta Ads'), wait: '' });
  state.events.unshift({ agent: 'seo', t: `${me().first} ${lng('نشر مقال «كورس محاسب شامل اونلاين» بعد مراجعة Critic', 'published the “كورس محاسب شامل اونلاين” article after Critic’s review')}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  refreshThread(threadId); rerenderAll();
  toast(lng('تمام، اتسجّل إنك نشرته. SEO هيتابع ترتيبه', 'Got it, marked as published. SEO will track its ranking'));
  agentSays(threadId, 'seo', {
    text: 'شفته على الموقع. طلبت أرشفة الرابط من Search Console، وهتابع ترتيبه كل اتنين وأقولك لو نزل.',
    activity: [lng('بيفتح Search Console', 'Opening Search Console'), lng('بيطلب أرشفة الرابط', 'Requesting indexing for the link')],
    steps: [{ tool: 'gsc', label: lng('طلب أرشفة الرابط', 'Requested indexing for the link'), state: 'done' }], stepsDur: lng('6 ثواني', '6 sec'),
  }, () => rerenderAll());
}

/* demo replies */
function replyFor(agentId, text) {
  if (agentId === 'coder') return coderReply(text);
  const t7 = totals('7');
  if (agentId === 'ads' && /تكلفة الليد|الليد غلي|الليد زاد/.test(text)) {
    const c = DATA['7'].ch;
    return { agent: 'ads', payload: { text: `قارنت آخر 7 أيام باللي قبلها:\n• Google بقت ${fmt1(c.google.spend / c.google.leads)} ج لليد، وMeta ${fmt1(c.meta.spend / c.meta.leads)} ج\n• الزيادة في Google من كلمة «كورس محاسبة اونلاين»، المنافسة عليها زادت الأسبوع ده\n• إعادة الاستهداف في Meta لسه أرخص حاجة عندنا\n\nأقترح نوقف 3 كلمات بتصرف من غير ليدز، وننقل جزء من ميزانية Google لإعادة الاستهداف. مش هغيّر أي ميزانية قبل موافقتك.`,
      steps: [{ tool: 'gads', label: lng('قرا تقرير كلمات البحث', 'Read the search terms report'), state: 'done' }, { tool: 'meta', label: lng('قرا أرقام Meta', 'Read Meta numbers'), state: 'done' }], stepsDur: lng('16 ثانية', '16 sec') } };
  }
  if (isMain(agentId)) {
    if (/مستني|واقف|مين/.test(text)) {
      const wl = waitingCards();
      return { agent: agentId, payload: { text: wl.length ? `ده اللي واقف دلوقتي:\n${wl.map((c) => `• ${c.title}: ${c.wait}`).join('\n')}\n\nلو عايز تكمّل في واحدة، افتحها من «مستنيك» أو قولي هنا.` : 'مفيش حاجة واقفة عندك دلوقتي. كل الوكلاء ماشيين لوحدهم، وهقولك أول ما حد يحتاجك.' } };
    }
    return { agent: agentId, payload: { text: 'تمام، ده عندي. هتابعه وأقولك هنا أول ما يخلص، ولو احتاج وكيل تاني هسلّمهوله في نفس المحادثة.' } };
  }
  if (/^\/agent|وكيل جديد/.test(text)) {
    return { agent: agentId, payload: { text: 'تمام. هكتب وصف الوكيل الجديد: شغلته، الأدوات اللي محتاجها، وإمتى يستأذنك. هبعتهولك هنا تراجعه قبل ما يبدأ يشتغل.' } };
  }
  if (AGENTS[agentId] && AGENTS[agentId].custom) {
    const A = AGENTS[agentId];
    return { agent: agentId, payload: { text: A.reply || 'تمام، فهمت. هبدأ وأسألك عن أي حاجة ناقصة، ولو فيه نشر أو صرف أو رسالة لعميل هجهّزها وأسلّمهالك انت.',
      steps: A.conns.length ? A.conns.slice(0, 2).map((k) => ({ tool: k, label: `${lng('بص على', 'Checked')} ${CONNS[k].name}`, state: state.conns[k] === 'connected' ? 'done' : 'skipped' })) : undefined, stepsDur: A.conns.length ? lng('14 ثانية', '14 sec') : undefined } };
  }
  if ((/\/report|تقرير|ملخص/.test(text) && canSee('analyst')) || agentId === 'analyst') {
    return { agent: 'analyst', payload: {
      text: `ملخص آخر 7 أيام (5 – 11 نوفمبر):\n• الصرف ${fmt(t7.spend)} ج، والليدز ${fmt(t7.leads)} بتكلفة ${fmt1(t7.cpl)} ج لليد\n• Meta جابت ${DATA['7'].ch.meta.leads} ليد بـ ${fmt1(DATA['7'].ch.meta.spend / DATA['7'].ch.meta.leads)} ج، Google جابت ${DATA['7'].ch.google.leads} بـ ${fmt1(DATA['7'].ch.google.spend / DATA['7'].ch.google.leads)} ج\n• SEO جاب ${DATA['7'].ch.seo.leads} ليد من غير صرف\n• الإيراد ${fmt(t7.revenue)} ج من ${t7.sales} مبيعات\n\nأرخص قناة مدفوعة دلوقتي Meta. التفاصيل كاملة في صفحة الأرقام.`,
      steps: [{ tool: 'meta', label: lng('قرا أرقام Meta', 'Read Meta numbers'), state: 'done' }, { tool: 'gads', label: lng('قرا أرقام Google Ads', 'Read Google Ads numbers'), state: 'done' }, { tool: 'sheets', label: lng('قرا المبيعات من الشيت', 'Read sales from the sheet'), state: 'done' }], stepsDur: lng('18 ثانية', '18 sec') } };
  }
  if (agentId === 'critic') {
    return { agent: 'critic', payload: { text: 'استلمت. هراجع الوعود والأرقام واللهجة وأرجعلك بملاحظات محددة على كل سطر، مش رأي عام.\nلو فيه رقم في النص ابعتلي مصدره عشان أتأكد منه.' } };
  }
  if (agentId === 'seo') {
    return { agent: 'seo', payload: { text: 'تمام. هبدأ ببحث الكلمات وأرجعلك بعنوانين وهيكل المقال قبل ما أكتب، عشان نتفق على الاتجاه الأول.',
      steps: [{ tool: 'gsc', label: lng('بحث الكلمات القريبة', 'Researched related keywords'), state: 'done' }], stepsDur: lng('9 ثواني', '9 sec') } };
  }
  if (/\/campaign|حملة/.test(text) && canSee('ads')) {
    return { agent: 'ads', payload: { text: 'تمام، هبدأ بمسودة حملة. هقرا نتايج الحملات اللي شبهها الأول، وهرجعلك بخطة وميزانية مقترحة. مش هصرف أي حاجة قبل موافقتك.',
      steps: [{ tool: 'meta', label: lng('قرا الحملات المشابهة', 'Read similar campaigns'), state: 'done' }, { tool: 'gads', label: lng('شاف حجم البحث في Google', 'Checked search volume on Google'), state: 'done' }], stepsDur: lng('22 ثانية', '22 sec') } };
  }
  if (!text) return { agent: agentId, payload: { text: 'وصلني الملف. هقراه وأقولك لو فيه حاجة محتاجة قرار منك.' } };
  return { agent: agentId, payload: { text: 'تمام، فهمت. هشتغل على ده وأحدّثك هنا أول بأول، ولو احتجت موافقة على صرف أو نشر هسألك الأول.' } };
}
function mentionedAgent(text) {
  const hs = text.match(/@[^\s@،,.:؟?!]+/g);
  if (!hs) return null;
  for (let i = 0; i < hs.length; i++) {
    const a = visibleAgents().find((k) => AGENTS[k].handle.toLowerCase() === hs[i].toLowerCase());
    if (a) return a;
  }
  return null;
}
function mentionedAgents(text) {
  const out = [];
  (text.match(/@[^\s@،,.:؟?!]+/g) || []).forEach((h) => {
    const a = visibleAgents().find((k) => AGENTS[k].handle.toLowerCase() === h.toLowerCase());
    if (a && !out.includes(a)) out.push(a);
  });
  return out;
}

/* ---- team threads: @ calls one agent, no @ = the whole team (max 3 reply), Critic reviews last ---- */
const HANDOFF_TXT = { ads: [lng('Ads بعت النصين لـ Critic', 'Ads sent the 2 scripts to Critic'), lng('نصين', '2 scripts')], seo: [lng('SEO بعت القسم الجديد لـ Critic', 'SEO sent the new section to Critic'), lng('فقرة في المقال', 'A paragraph in the article')], analyst: [lng('Analyst بعت الأرقام لـ Critic', 'Analyst sent the numbers to Critic'), lng('آخر 7 أيام', 'Last 7 days')] };
function teamReply(a, text, ctx) {
  const sa = /الرياض|السعودية|جدة|الخليج|سعودي/.test(text);
  const toCritic = ctx.withCritic;
  if (a === 'ads') {
    return {
      text: (sa ? 'كتبت نصين للرياض وجدة بلهجة سعودية خفيفة:\n• «تبغى تشتغل محاسب؟ ابدأ بشهادة معتمدة»\n• «الدفعة الجديدة تبدأ 1 ديسمبر، والمقاعد 40 بس»'
        : 'كتبت نصين جداد للحملة:\n• «اتعلّم المحاسبة اللي الشركات بتطلبها، من Excel لحد الضرايب»\n• «الدفعة الجديدة بتبدأ 1 ديسمبر، والأماكن 40 بس»')
        + (toCritic ? '\nهبعتهم لـ Critic قبل ما أرفعهم مسودة.' : '\nمش هرفع ولا هصرف حاجة قبل موافقتك.'),
      steps: [{ tool: 'meta', label: lng('قرا أداء النصوص الحالية', 'Read current script performance'), state: 'done' }, { tool: 'meta', label: lng('كتب نصين جداد', 'Wrote 2 new scripts'), state: 'done' }], stepsDur: lng('34 ثانية', '34 sec'),
      activity: [lng('بيفتح حسابات Meta', 'Opening Meta accounts'), sa ? lng('بيكتب نصين للرياض وجدة', 'Writing 2 scripts for Riyadh and Jeddah') : lng('بيكتب نصين جداد', 'Writing 2 new scripts')].concat(toCritic ? [lng('بيجهّزهم لـ Critic', 'Preparing them for Critic')] : []),
    };
  }
  if (a === 'seo') {
    return {
      text: 'هضيف قسم «الدفعة الجديدة» في مقال كورس المحاسبة: الميعاد 1 ديسمبر، والسعر 2,400 ج، ورابط التسجيل.' + (toCritic ? '\nهبعته لـ Critic يراجع الأرقام قبل ما يتنشر.' : '\nهسيبه مسودة على WordPress، وانت اللي تنشره.'),
      steps: [{ tool: 'wp', label: lng('فتح المقال على WordPress', 'Opened the article in WordPress'), state: 'done' }, { tool: 'wp', label: lng('كتب قسم الدفعة الجديدة', 'Wrote the new-cohort section'), state: 'done' }], stepsDur: lng('15 ثانية', '15 sec'),
      activity: [lng('بيفتح المقال على WordPress', 'Opening the article in WordPress'), lng('بيكتب قسم الدفعة الجديدة', 'Writing the new-cohort section')],
    };
  }
  if (a === 'analyst') {
    const c = DATA['7'].ch;
    return {
      text: `قبل ما تكتبوا، دي أرقام آخر 7 أيام:\n• Meta جابت ${c.meta.leads} ليد بـ ${fmt1(c.meta.spend / c.meta.leads)} ج لليد\n• Google جابت ${c.google.leads} ليد بـ ${fmt1(c.google.spend / c.google.leads)} ج لليد\nأقترح الجزء الأكبر من ميزانية ديسمبر يروح لـ Meta.`,
      steps: [{ tool: 'meta', label: lng('قرا أرقام Meta', 'Read Meta numbers'), state: 'done' }, { tool: 'gads', label: lng('قرا أرقام Google Ads', 'Read Google Ads numbers'), state: 'done' }], stepsDur: lng('12 ثانية', '12 sec'),
      activity: [lng('بيقرا أرقام آخر 7 أيام', 'Reading the last 7 days'), lng('بيحسب تكلفة الليد', 'Calculating cost per lead')],
    };
  }
  if (a === 'critic') {
    if (!ctx.producers.length) return Object.assign({ activity: ACT.critic }, replyFor('critic', text).payload);
    const items = [];
    ctx.producers.forEach((p) => {
      if (p === 'ads') {
        items.push({ q: sa ? 'تبغى تشتغل محاسب؟ ابدأ بشهادة معتمدة' : 'اتعلّم المحاسبة اللي الشركات بتطلبها، من Excel لحد الضرايب', ok: true, note: 'واضح ومن غير وعود مبالغ فيها.' });
        items.push({ q: sa ? 'الدفعة الجديدة تبدأ 1 ديسمبر، والمقاعد 40 بس' : 'الدفعة الجديدة بتبدأ 1 ديسمبر، والأماكن 40 بس', ok: false, note: 'رقم «40» محتاج تأكيد من الأكاديمية. لحد ما يتأكد: «الأماكن محدودة».' });
      } else if (p === 'seo') items.push({ q: 'قسم «الدفعة الجديدة» في مقال كورس المحاسبة', ok: true, note: 'الميعاد والسعر 2,400 ج مطابقين لصفحة الكورس.' });
      else if (p === 'analyst') items.push({ q: 'أرقام Analyst عن Meta وGoogle', ok: true, note: 'من حسابات الإعلانات مباشرة، ومكتوب إنها آخر 7 أيام.' });
      else if (AGENTS[p]) items.push({ q: `شغل ${AGENTS[p].name}`, ok: true, note: 'مفيش وعود ولا أرقام من غير مصدر.' });
    });
    const fixes = items.filter((i) => !i.ok).length; const ok = items.length - fixes;
    const okTxt = `${ok} ${ok === 1 ? 'جاهز' : 'جاهزين'}`;
    return {
      to: ctx.producers[0], text: 'راجعت اللي اتكتب سطر سطر:', activity: [lng('بيقرا اللي اتكتب', 'Reading what was written'), lng('بيقارن بدليل صوت الأكاديمية', 'Checking against the academy voice guide'), lng('بيكتب الملاحظات', 'Writing notes')],
      card: { type: 'review', title: 'مراجعة شغل الفريق', sub: `${items.length} حاجات · قبل ما تطلع`, items, decision: fixes ? `${okTxt}، و${fixes} رجع لـ Ads بالبديل` : 'كله جاهز، مفيش تعديلات' },
    };
  }
  return Object.assign({ activity: ACT.other }, replyFor(a, text).payload);
}
function teamTurn(threadId, text) {
  const t = threads[threadId];
  const named = agentsNamed(text, AGENT_ORDER);
  const inCh = named.filter((a) => t.team.includes(a));
  const out = named.filter((a) => !t.team.includes(a) && (canSee(a) || canManage()));
  if (out.length) {
    const x = out[0];
    t.msgs.push({ id: nid('n'), role: 'note', icon: 'team', fresh: true,
      text: canManage() ? `${AGENTS[x].name} ${lng('مش في القناة دي، فمحدش قرا رسالتك غير الأعضاء.', 'isn’t in this channel, so only the members read your message.')}` : `${AGENTS[x].name} ${lng('مش في القناة دي. اطلب من', 'isn’t in this channel. Ask')} ${whoManages()} ${lng('يضيفوه.', 'to add it.')}`,
      link: canManage() ? { action: 'team-add', agent: x, label: lng('ضيفه', 'Add it') } : null });
    refreshThread(threadId); scrollMounts(threadId);
  }
  /* ordinary talk between members goes to no agent: only an agent called by name reads and answers */
  if (!inCh.length) return;
  const responders = inCh.slice(0, 3);
  const order = responders.filter((a) => a !== 'critic').concat(responders.includes('critic') ? ['critic'] : []);
  const producers = order.filter((a) => a !== 'critic');
  const withCritic = order.includes('critic') && producers.length > 0;
  let card = t.card ? cardById(t.card) : null; let isNewCard = false;
  if (!card && !t.general) {
    const cid = nid('c');
    cards.push({ id: cid, col: 'progress', title: t.title, agent: order[0], chan: lng('قناة', 'Channel'), due: '', thread: threadId, pct: 6, touched: [],
      ticks: [lng('الوكلاء بدأوا يشتغلوا', 'The agents started working'), lng('Critic بيراجع', 'Critic is reviewing'), lng('بيجهّزوا المسودة', 'Preparing the draft')], tick: 0 });
    t.card = cid; card = cardById(cid); isNewCard = true;
    logAuto(WHO.sys(), lng('ضاف كارت من القناة', 'added a card from the channel'), { card: cid, chan: threadId, to: colName('progress') });
  }
  const steps = []; let hops = 0;
  order.forEach((a) => {
    steps.push({ kind: 'reply', a, payload: teamReply(a, text, { withCritic, producers }) });
    if (withCritic && a !== 'critic' && hops < 3) {
      const h = HANDOFF_TXT[a] || [`${AGENTS[a].name} ${lng('بعت شغله لـ Critic', 'sent its work to Critic')}`, ''];
      steps.push({ kind: 'handoff', from: a, to: 'critic', text: h[0], detail: h[1] }); hops += 1;
    }
  });
  if (withCritic && producers.includes('ads') && hops < 3) steps.push({ kind: 'handoff', from: 'critic', to: 'ads', text: lng('Critic رجّع نص 2 لـ Ads بالبديل', 'Critic sent script 2 back to Ads with an alternative'), detail: '«الأماكن محدودة»' });
  if (isNewCard) steps.push({ kind: 'note', text: lng('الكارت ده اتضاف للوحة في «شغالين عليه»', 'This card was added to the board under “In progress”') });
  runSteps(threadId, steps, (a) => addTouched(card, a), () => rerenderAll());
}
function send(key) {
  const ta = $(`#ta-${key}`); if (!ta) return;
  const text = ta.value.trim(); const files = state.attach[key].slice();
  if (!text && !files.length) return;
  flySend(key);
  /* steer: the agent is mid-step, so the message waits and is read when the step ends */
  const curId = threadOfKey(key); const cur = curId ? threads[curId] : null;
  if (cur && cur.run) {
    const um = { id: nid('u'), role: 'user', by: state.as, text, files, time: nowTime(), fresh: true, queued: true };
    cur.msgs.push(um); cur.run.queue.push(um.id); bump(cur);
    if (recs[key]) { window.clearInterval(recs[key].timer); window.clearInterval(recs[key].wave); delete recs[key]; syncMic(key); }
    ta.value = ''; state.attach[key] = []; syncFiles(key); syncComposer(key); closePop(key); closePlus(key);
    refreshThread(curId); scrollMounts(curId); renderThreadList();
    return;
  }
  let threadId; let isNew = false;
  const rt = /^\//.test(text) ? null : parseRoutine(text);
  if (key === 'sheet') {
    const c = cardById(state.sheetCard); if (!c) return;
    if (!c.thread) {
      threadId = nid('th');
      threads[threadId] = { id: threadId, agent: c.agent, title: c.title, time: nowTime(), day: 0, ts: ++tsSeq, card: c.id, msgs: [], ws: state.world === 'fresh' ? 'fresh' : undefined };
      c.thread = threadId; isNew = true;
      if (c.col === 'ideas' || c.col === 'planned') moveCard(c.id, 'progress', { pct: 8 });
      $('#sheet-transcript').dataset.threadMount = threadId;
    } else threadId = c.thread;
  } else if (!threads[state.chatThread]) {
    const ag = mentionedAgent(text) || state.newChatAgent;
    threadId = nid('th');
    const title = text.replace(/@\w+\s*/g, '').replace(/^\/\w+\s*/, '').slice(0, 44) || (files[0] || lng('محادثة جديدة', 'New chat'));
    /* a routine sentence is not a task: no board card for it */
    const cid = rt ? null : nid('c');
    if (cid) cards.push({ id: cid, col: 'progress', title, agent: ag, chan: AGENTS[ag].role, due: '', thread: threadId, pct: 6, ticks: [lng('بدأ يشتغل', 'Started working'), lng('بيجمع البيانات', 'Collecting data'), lng('بيجهّز المسودة', 'Preparing the draft')], tick: 0 });
    /* a written request to Coder is a code card on the same board */
    if (cid && ag === 'coder') codeFromChat(cardById(cid), text);
    threads[threadId] = { id: threadId, agent: ag, title: rt ? `روتين: ${rt.title}` : (cid && ag === 'coder' ? cardById(cid).title : title), time: nowTime(), day: 0, ts: ++tsSeq, card: cid, msgs: [], owner: state.as, ws: state.world === 'fresh' ? 'fresh' : undefined };
    state.chatThread = threadId; isNew = true;
  } else threadId = state.chatThread;
  state.newHint = false;
  const t = threads[threadId];
  t.msgs.push({ id: nid('u'), role: 'user', by: state.as, text, files, time: nowTime(), fresh: true, ord: ++logOrd });
  bump(t);
  if (t.channel) noteUnread(threadId, state.as);
  if (recs[key]) { window.clearInterval(recs[key].timer); window.clearInterval(recs[key].wave); delete recs[key]; syncMic(key); }
  ta.value = ''; state.attach[key] = []; syncFiles(key); syncComposer(key); closePop(key); closePlus(key);
  const target = mentionedAgent(text) || t.agent;
  if (isNew && key === 'main') { rerenderAll(); }
  else { refreshThread(threadId); scrollMounts(threadId); rerenderAll(); }
  if (t.team) { firstTaskSeen(mentionedAgent(text)); teamTurn(threadId, text); return; }
  const pendingChoice = t.msgs.find((m) => m.card && m.card.type === 'choice' && m.card.status === 'pending');
  if (pendingChoice && target === 'ads') {
    const KEYS = ['خريج', 'Excel', 'شهادة'];
    const i = KEYS.findIndex((k) => text.includes(k));
    if (i >= 0) { chooseAngle(threadId, pendingChoice.id, i, true); return; }
  }
  if (rt) { firstTaskSeen(target); routineFromChat(threadId, target, rt); return; }
  /* Lead asked one question before making an agent: this message is the answer */
  if (key === 'main' && answerAskTyped(threadId, text)) { dropNewCard(t, isNew); return; }
  /* a new agent comes from asking Lead in plain words: the Owner gets it at once, anyone else sends the Owner a request */
  if (wantsNewAgent(text)) { const so = state.soloTpl; state.soloTpl = null; dropNewCard(t, isNew); agentTalk(threadId, text, so ? { tpl: so } : null); return; }
  /* «من دلوقتي…»: a lasting rule, said to the agent itself. Saved at once (or suggested, for a member in a team) */
  if (ruleTurn(threadId, target, text)) { dropNewCard(t, isNew); rerenderAll(); return; }
  /* «افتكر إن…»: the agent saves a note under this person's name and writes it in the log */
  if (learnTurn(threadId, target, text)) { dropNewCard(t, isNew); rerenderAll(); return; }
  /* the main agent is the front door: work that belongs to another agent is handed over in this same chat */
  if (isMain(target) && mainTurn(threadId, text, isNew)) return;
  firstTaskSeen(target);
  const r = replyFor(target, text);
  agentSays(threadId, r.agent, r.payload, () => {
    if (isNew) { t.msgs.push({ id: nid('n'), role: 'note', text: lng('الكارت ده اتضاف للوحة في «شغالين عليه»', 'This card was added to the board under “In progress”') }); refreshThread(threadId); scrollMounts(threadId); }
    rerenderAll();
    const cc = t.card && cardById(t.card);
    if (isNew && cc && cc.code && cc.code.fresh) codeRunNew(cc.id, threadId);
  });
}

/* the «جديد» mark lasts until the Owner hands the agent its first job (a task or a routine; a lasting rule or a note is not a job) */
function firstTaskSeen(ag) {
  if (!ag || !AGENTS[ag] || !AGENTS[ag].isNew || !isOwner()) return;
  AGENTS[ag].isNew = false;
  rerenderAll();
}

/* ================= composer: autosize, + menu, @ and / autocomplete, files ================= */
const CMDS = [
  { c: '/campaign', d: lng('حملة جديدة مع Ads', 'New campaign with Ads') },
  { c: '/report', d: lng('ملخص الأرقام من Analyst', 'Numbers summary from Analyst') },
  { c: '/review', d: lng('ابعت نص لـ Critic يراجعه', 'Send a script to Critic for review') },
  { c: '/article', d: lng('مقال SEO جديد', 'New SEO article') },
  { c: '/agent', d: lng('اطلب وكيل جديد', 'Ask for a new agent') },
];
const popState = {};
function syncComposer(key) {
  const ta = $(`#ta-${key}`); if (!ta) return;
  if (key === 'note') { syncNoteComposer(); return; }
  ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
  const btn = $(`.composer__send[data-key="${key}"]`);
  const run = runOf(threadOfKey(key));
  const has = !!ta.value.trim() || state.attach[key].length > 0;
  if (btn) {
    /* while an agent works: empty field = stop square; typed text = send (it waits for the step to end) */
    const stop = !!run && !has;
    const who = run && run.agent && AGENTS[run.agent] ? AGENTS[run.agent].name : lng('الوكيل', 'The agent');
    btn.classList.toggle('is-stop', stop);
    btn.dataset.action = stop ? 'stop' : 'send';
    btn.disabled = stop ? false : !has;
    btn.setAttribute('aria-label', stop ? `${lng('وقّف', 'Stop')} ${who}` : run ? lng('ابعت · هيقراها بعد الخطوة دي', 'Send · it’ll read this after this step') : lng('ابعت', 'Send'));
    if (stop) btn.title = `${lng('وقّف', 'Stop')} ${who}`; else btn.removeAttribute('title');
    const want = stop ? 'stop' : 'send';
    if (btn.dataset.icon !== want) { btn.innerHTML = icon(stop ? 'stopFill' : 'send', 'is-morph'); btn.dataset.icon = want; }
  }
  syncActivityKey(key);
}
function syncFiles(key) {
  const host = $(`[data-files="${key}"]`); if (!host) return;
  const list = state.attach[key];
  host.hidden = !list.length;
  host.innerHTML = list.map((f, i) => `<span class="file-chip">${icon('clip')}<bdi dir="auto">${esc(f)}</bdi><button type="button" data-action="unattach" data-key="${key}" data-idx="${i}" aria-label="${lng('شيل', 'Remove')} ${esc(f)}">${icon('x')}</button></span>`).join('');
  syncComposer(key);
}
function tokenAtCaret(ta) {
  const pos = ta.selectionStart; const before = ta.value.slice(0, pos);
  const m = before.match(/(^|\s)([@/])([^\s@/]*)$/);
  return m ? { type: m[2], q: m[3].toLowerCase(), start: pos - m[3].length - 1, end: pos } : null;
}
function updatePop(key) {
  const ta = $(`#ta-${key}`); const pop = $(`[data-pop="${key}"]`); if (!ta || !pop) return;
  const tok = tokenAtCaret(ta);
  if (!tok || (tok.type === '/' && key === 'note')) { closePop(key); return; }
  const items = tok.type === '@' ? mentionMenu(key, tok.q)
    : CMDS.filter((c) => c.c.slice(1).startsWith(tok.q)).map((c) => ({ sec: lng('الأوامر', 'Commands'), ins: c.c + ' ', html: `<span class="menu__t">${bx(c.d)}</span><span class="menu__hint menu__code">${esc(c.c)}</span>` }));
  if (!items.length) { closePop(key); return; }
  closePlus(key);
  popState[key] = { tok, items, idx: 0 };
  let last = null;
  pop.innerHTML = items.map((it, i) => { const lab = it.sec !== last ? `<div class="menu__label">${it.sec}</div>` : ''; last = it.sec;
    return `${lab}<button type="button" class="menu__item" role="option" id="opt-${key}-${i}" aria-selected="${i === 0}" data-action="pop-pick" data-key="${key}" data-idx="${i}" tabindex="-1">${it.html}</button>`; }).join('');
  pop.hidden = false;
  ta.setAttribute('aria-expanded', 'true'); ta.setAttribute('aria-activedescendant', `opt-${key}-0`);
}
function closePop(key) {
  const pop = $(`[data-pop="${key}"]`); if (pop) pop.hidden = true;
  delete popState[key];
  const ta = $(`#ta-${key}`); if (ta) { ta.setAttribute('aria-expanded', 'false'); ta.removeAttribute('aria-activedescendant'); }
}
function pickPop(key, idx) {
  const s = popState[key]; const ta = $(`#ta-${key}`); if (!s || !ta) return;
  const it = s.items[idx]; const v = ta.value;
  ta.value = v.slice(0, s.tok.start) + it.ins + v.slice(s.tok.end);
  const p = s.tok.start + it.ins.length; ta.focus(); ta.setSelectionRange(p, p);
  closePop(key); syncComposer(key);
}
function movePop(key, dir) {
  const s = popState[key]; if (!s) return;
  s.idx = (s.idx + dir + s.items.length) % s.items.length;
  $$(`[data-pop="${key}"] .menu__item`).forEach((b, i) => b.setAttribute('aria-selected', String(i === s.idx)));
  const ta = $(`#ta-${key}`); if (ta) ta.setAttribute('aria-activedescendant', `opt-${key}-${s.idx}`);
}
function plusMenuHTML(key) {
  const ch = chanOf(key); const callA = ch ? ch.team : visibleAgents();
  const ppl = ch ? ch.people.filter((p) => p !== state.as) : [];
  return `${ppl.length ? `<div class="menu__label">${lng('نادي حد من القناة', 'Call someone in the channel')}</div>
    ${ppl.map((p) => `<button type="button" class="menu__item" role="menuitem" data-action="plus-insert" data-key="${key}" data-ins="${PH[p]} ">${personAv(p, 20)}<span class="menu__t">${esc(PEOPLE[p].name)}</span><bdi class="menu__hint" dir="rtl">${PH[p]}</bdi></button>`).join('')}` : ''}
    ${callA.length ? `<div class="menu__label">${lng('نادي وكيل', 'Call an agent')}</div>` : ''}
    ${callA.map((a) => `<button type="button" class="menu__item" role="menuitem" data-action="plus-insert" data-key="${key}" data-ins="${esc(AGENTS[a].handle)} ">${face(a, 20)}<bdi class="menu__t">${esc(AGENTS[a].name)}</bdi><bdi class="menu__hint">${esc(AGENTS[a].handle)}</bdi></button>`).join('')}
    ${canManage() && !isSolo() ? `<button type="button" class="menu__item" role="menuitem" data-action="plus-team" data-key="${key}">${icon('hash')}<span class="menu__t">${lng('قناة جديدة', 'New channel')}<span class="menu__d">${lng('للفريق والوكلاء في محادثة واحدة', 'For the team and agents in one conversation')}</span></span></button>` : ''}
    <div class="menu__sep" role="separator"></div>
    <div class="menu__label">${lng('الأوامر', 'Commands')}</div>
    ${CMDS.map((c) => `<button type="button" class="menu__item" role="menuitem" data-action="plus-insert" data-key="${key}" data-ins="${esc(c.c)} ">${icon('slash')}<span class="menu__t">${bx(c.d)}</span><span class="menu__hint menu__code">${esc(c.c)}</span></button>`).join('')}
    <div class="menu__sep" role="separator"></div>
    <button type="button" class="menu__item" role="menuitem" data-action="attach" data-key="${key}">${icon('clip')}<span class="menu__t">${lng('إرفاق ملف', 'Attach a file')}</span></button>
    <button type="button" class="menu__item" role="menuitem" data-action="open-apps" data-key="${key}">${icon('plug')}<span class="menu__t">${lng('ربط التطبيقات', 'Connect apps')}<span class="menu__d">${bx(`${canManage() ? lng('وصّل أداة جديدة لوكيل ·', 'Connect a new tool to an agent ·') : ''} ${connectedCount()} ${lng('متوصل', 'connected')}`)}</span></span></button>
    ${canManage() ? `<div class="menu__sep" role="separator"></div>
    <div class="menu__label">${lng('الموديل', 'Model')}</div>` : ''}
    ${!canManage() ? '' : MODELS.map((m) => { const cur = AGENTS[composerAgent(key)].model; return `<button type="button" class="menu__item" role="menuitemradio" aria-checked="${m.n === cur}" data-action="pick-model" data-model="${esc(m.n)}" data-key="${key}">${tile(m.logo)}<span class="menu__t"><bdi>${esc(m.n)}</bdi><span class="menu__d">${esc(m.d)}</span></span>${m.n === cur ? icon('check', 'menu__check') : ''}</button>`; }).join('')}`;
}
function togglePlus(key) {
  const menu = $(`[data-plus-menu="${key}"]`); const btn = $(`[data-action="plus-menu"][data-key="${key}"]`); if (!menu || !btn) return;
  if (!menu.hidden) { closePlus(key); btn.focus(); return; }
  closePop(key);
  menu.innerHTML = plusMenuHTML(key);
  menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('.menu__item'); if (first) first.focus();
}
function closePlus(key) {
  const menu = $(`[data-plus-menu="${key}"]`); if (menu) menu.hidden = true;
  const btn = $(`[data-action="plus-menu"][data-key="${key}"]`); if (btn) btn.setAttribute('aria-expanded', 'false');
}
/* ================= workspace settings menu (under Sara's name) ================= */
const LANGS = [
  { k: 'en', name: 'English', d: () => lng('من الشمال لليمين · الأساسي', 'Left to right · Default') },
  { k: 'ar', name: 'العربية', d: () => lng('من اليمين للشمال · عامية مصرية', 'Right to left · Egyptian Arabic') },
];
function meMenuHTML() {
  const P0 = me();
  return `<div class="me-menu__head">
      <span class="me__av" aria-hidden="true">${P0.av}</span>
      <span class="me__text"><span class="me__name od-truncate">${P0.name}</span><span class="me__role od-truncate">${P0.title} · <bdi>${esc(state.companyName)}</bdi></span></span>
    </div>
    <div class="menu__sep" role="separator"></div>
    <button type="button" class="menu__item" role="menuitem" data-action="sov-open" data-sec="" tabindex="-1">${icon('gear')}<span class="menu__t">${lng('الإعدادات', 'Settings')}<span class="menu__d">${me().role === 'viewer' ? lng('حسابك والوكلاء اللي بتشتغل معاهم', 'Your account and the agents you work with') : lng('الشركة والوكلاء والمعرفة والتطبيقات', 'Company, agents, knowledge and apps')}</span></span></button>
    <div class="menu__sep" role="separator"></div>
    <div class="menu__label" id="me-as-lbl">${lng('شايف كـ', 'Viewing as')}</div>
    <div role="group" aria-labelledby="me-as-lbl" aria-describedby="me-as-hint">
      ${VIEWS.map((v) => { const Q = PEOPLE[v.p]; const on = v.p === state.as && v.w === state.world; return `<button type="button" class="menu__item me-as" role="menuitemradio" aria-checked="${on}" data-action="set-as" data-person="${v.p}" data-world="${v.w}" tabindex="-1">
        <span class="me__av me-as__av" aria-hidden="true">${Q.av}</span><span class="menu__t">${v.t()}<span class="menu__d">${v.d()}</span></span>${on ? icon('check', 'menu__check') : ''}</button>`; }).join('')}
    </div>
    <button type="button" class="menu__item" role="menuitem" data-action="first-run" tabindex="-1">${icon('repeat')}<span class="menu__t">${lng('أول تشغيل', 'First run')}<span class="menu__d">${lng('لوحدك ولا مع تيم؟ من أول خطوة', 'Alone or with a team? From step one')}</span></span></button>
    <p class="me-menu__hint me-as__hint" id="me-as-hint">${lng('للنموذج بس: الأربع شاشات وأول تشغيل عشان تجرّب، ومش جزء من المنتج.', 'Prototype aid only: the four views and the first run are for trying things out, not part of the product.')}</p>
    ${canManage() ? `<div class="menu__sep" role="separator"></div>
    <button type="button" class="menu__item" role="menuitem" data-action="open-team" tabindex="-1">${icon('team')}<span class="menu__t">${lng('الفريق', 'Team')}<span class="menu__d">${isSolo() ? lng('انت لوحدك دلوقتي · اعزم عضو', 'Just you for now · invite a member') : lng('مين بيشتغل مع أنهي وكلاء', 'Who works with which agents')}</span></span></button>` : ''}
    <div class="menu__sep" role="separator"></div>
    <div class="menu__label" id="me-lang-lbl">${lng('لغة الواجهة', 'Interface language')}</div>
    <div role="group" aria-labelledby="me-lang-lbl">
      ${LANGS.map((l) => `<button type="button" class="menu__item" role="menuitemradio" aria-checked="${l.k === LANG}" data-action="set-lang" data-lang="${l.k}" tabindex="-1">
        <span class="menu__t"><span class="lang-native" lang="${l.k}" dir="${l.k === 'ar' ? 'rtl' : 'ltr'}">${l.name}</span><span class="menu__d">${l.d()}</span></span>${l.k === LANG ? icon('check', 'menu__check') : ''}</button>`).join('')}
    </div>
    <p class="me-menu__hint">${lng('المحادثات مع الوكلاء بتفضل بالعربي في اللغتين.', 'Chats with your agents stay in Arabic in both.')}</p>
    <div class="menu__sep" role="separator"></div>
    <button type="button" class="menu__item" role="menuitem" data-action="open-apps" data-me="1" tabindex="-1">${icon('plug')}<span class="menu__t">${lng('ربط التطبيقات', 'Connect apps')}<span class="menu__d">${bx(`${connectedCount()} ${lng('متوصل', 'connected')}`)}</span></span></button>`;
}
function openMeMenu() {
  const menu = $('#me-menu'); const btn = $('#btn-me'); if (!menu || !btn) return;
  $$('[data-plus-menu]').forEach((m) => { if (!m.hidden) closePlus(m.dataset.plusMenu); });
  menu.innerHTML = meMenuHTML();
  menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
  const cur = menu.querySelector('[aria-checked="true"]') || menu.querySelector('.menu__item'); if (cur) cur.focus();
}
function closeMeMenu(focusBtn) {
  const menu = $('#me-menu'); const btn = $('#btn-me');
  if (!menu || menu.hidden) return false;
  menu.hidden = true; if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); }
  return true;
}
/* English ⇄ Arabic interface. Chats stay Arabic; the prototype reloads in the chosen language. */
function applyLang(next) {
  if (next === LANG) return;
  let saved = false;
  try { localStorage.setItem('gtm-lang', next); saved = localStorage.getItem('gtm-lang') === next; } catch (err) { saved = false; }
  try {
    const u = new URL(window.location.href);
    if (!saved || u.searchParams.has('lang')) { u.searchParams.set('lang', next); window.location.replace(u.toString()); } else window.location.reload();
  } catch (err) { window.location.reload(); }
}
function closeMenus() {
  if (closeMeMenu(true)) return true;
  const open = $$('[data-plus-menu]').find((m) => !m.hidden);
  if (open) { const key = open.dataset.plusMenu; closePlus(key); const b = $(`[data-action="plus-menu"][data-key="${key}"]`); if (b) b.focus(); return true; }
  const pop = $$('[data-pop]').find((m) => !m.hidden);
  if (pop) { closePop(pop.dataset.pop); return true; }
  return false;
}
function insertAtCaret(key, ins) {
  const ta = $(`#ta-${key}`); if (!ta) return;
  const pos = ta.selectionStart != null ? ta.selectionStart : ta.value.length; const pre = ta.value.slice(0, pos);
  const add = (pre && !/\s$/.test(pre) ? ' ' : '') + ins;
  ta.value = pre + add + ta.value.slice(pos); ta.focus(); ta.setSelectionRange(pos + add.length, pos + add.length);
  syncComposer(key);
}

/* ================= sidebar (mobile) & details overlay ================= */
function closeSidebar() { $('#sidebar').classList.remove('is-open'); $('#mobile-menu').setAttribute('aria-expanded', 'false'); syncScrim(); }
function syncScrim() { $('#scrim').hidden = !($('#sidebar').classList.contains('is-open') || $('#details').classList.contains('is-open')); }
function closeDetails() {
  const det = $('#details');
  if (overlayDetails()) det.classList.remove('is-open');
  else { state.detailsOpen = false; }
  syncDetailsVisibility(); syncScrim();
  const b = $('#btn-details'); if (b) b.focus();
}
function saveRoutine(a) {
  const inp = $('#rt-new'); const err = $('#rt-err'); if (!inp) return;
  const v = inp.value.trim();
  if (!v) { if (err) err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
  const p = parseRoutine(v, true);
  AGENTS[a].routines.push(p ? { t: p.title, d: p.label, on: true, sched: p.sched, flash: true } : { t: v, d: 'كل يوم 9:00 الصبح', on: true, sched: { kind: 'daily', h: 9, m: 0 }, flash: true });
  state.dpAddingRoutine = false; renderDetails();
  const b = $('[data-action="add-routine"]'); if (b) b.focus();
  toast(`${lng('«', '“')}${v}${lng('» اشتغل', '” is on')}`);
}

/* ================= routines: schedule, next run, run now, made by a sentence ================= */
const DAYN = ['الحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const DAY_EVERY = ['حد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];
const DOW = { سبت: 6, حد: 0, أحد: 0, احد: 0, اتنين: 1, إتنين: 1, اثنين: 1, تلات: 2, ثلاثاء: 2, أربع: 3, اربع: 3, أربعاء: 3, اربعاء: 3, خميس: 4, جمعة: 5, جمعه: 5 };
const periodWord = (h) => (h < 5 ? 'بالليل' : h < 12 ? 'الصبح' : h < 15 ? 'الضهر' : h < 18 ? 'العصر' : 'بالليل');
const clockLabel = (h, m) => `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${periodWord(h)}`;
/* interface-language versions (agents still say the Arabic ones in chat) */
const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clockUI = (h, m) => (RTL ? clockLabel(h, m) : `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`);
function schedUI(sched, ar) {
  if (RTL || !sched) return ar;
  const at = (x) => clockUI(x.h, x.m);
  if (sched.kind === 'daily') return `Every day · ${at(sched)}`;
  if (sched.kind === 'hourly') return 'Every hour';
  if (sched.kind === 'weekly') return `Every ${DAY_EN[sched.dow]} · ${at(sched)}`;
  if (sched.kind === 'biweekly') return 'Every two weeks';
  if (sched.kind === 'monthly') return `1st of every month · ${at(sched)}`;
  if (sched.kind === 'trigger') return 'As soon as it happens';
  if (sched.kind === 'auto') return 'Automatic';
  return ar;
}
const rtWhen = (r) => schedUI(r.sched, r.d);
const nowAt = () => { const r = new Date(); const d = new Date(TODAY); d.setHours(r.getHours(), r.getMinutes(), 0, 0); return d; };
function whenLabel(d, ui) {
  const a = nowAt(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b - a) / 864e5);
  if (ui && !RTL) {
    const dayEn = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff < 7 ? DAY_EN[d.getDay()] : `${DAY_EN[d.getDay()].slice(0, 3)}, ${MONTH_EN[d.getMonth()]} ${d.getDate()}`;
    return `${dayEn} ${clockUI(d.getHours(), d.getMinutes())}`;
  }
  const day = diff === 0 ? 'النهارده' : diff === 1 ? 'بكرة' : diff < 7 ? DAYN[d.getDay()] : `${DAYN[d.getDay()]} ${d.getDate()} ${MONTHS_AR[d.getMonth()]}`;
  return `${day} ${clockLabel(d.getHours(), d.getMinutes())}`;
}
function nextRun(r, ui) {
  const s = r.sched || { kind: 'daily', h: 9, m: 0 };
  if (s.kind === 'trigger' || s.kind === 'auto') return null;
  const n = nowAt(); const d = new Date(n);
  if (s.kind === 'hourly') { d.setHours(n.getHours() + 1, 0, 0, 0); return whenLabel(d, ui); }
  d.setHours(s.h, s.m || 0, 0, 0);
  if (s.kind === 'daily') { if (d <= n) d.setDate(d.getDate() + 1); }
  else if (s.kind === 'weekly') { d.setDate(d.getDate() + ((s.dow - n.getDay() + 7) % 7)); if (d <= n) d.setDate(d.getDate() + 7); }
  else if (s.kind === 'biweekly') { d.setDate(d.getDate() + (((s.dow - n.getDay() + 7) % 7) || 14)); }
  else if (s.kind === 'monthly') { d.setDate(1); d.setMonth(d.getMonth() + 1); }
  return whenLabel(d, ui);
}
/* «ابعتلي ملخص الإعلانات كل يوم 9 الصبح» → { title: 'ملخص الإعلانات', label: 'كل يوم 9:00 الصبح', sched } */
const RT_VERB = /^(?:ابعتلي|ابعتلنا|ابعت لي|ابعت|اعملّي|اعملي|اعمل لي|اعمل|جهّزلي|جهزلي|جهّز|جهز|حضّرلي|حضرلي|طلّعلي|طلعلي|شغّل|شغل|راجعلي|راجع|تابعلي|تابع|فكّرني|فكرني|ذكّرني|ذكرني|بلّغني|بلغني|قولي|اكتبلي|اكتب)\s+/;
function parseRoutine(raw, loose) {
  const text = String(raw || '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).trim();
  const fm = text.match(/كل\s+(?:يوم\s+)?(يوم|ساعة|ساعه|أسبوع|اسبوع|شهر|سبت|حد|أحد|احد|اتنين|إتنين|اثنين|تلات|ثلاثاء|أربعاء|اربعاء|أربع|اربع|خميس|جمعة|جمعه)(?=\s|$|[.،,؟?])|(يومياً|يوميا|أسبوعياً|اسبوعيا)/);
  if (!fm) return null;
  const clean = text.replace(/@[^\s]+\s*/g, '');
  const startsVerb = RT_VERB.test(clean);
  const rest = text.slice(fm.index + fm[0].length);
  const tm = rest.match(/(?:الساعة\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(الصبح|صباحاً|صباحا|ص|الضهر|الظهر|العصر|المغرب|المسا|مساءً|مساء|بالليل|الليل|م)?(?=\s|$|[.،,؟?])/);
  if (!loose && !startsVerb && !tm) return null;
  const word = fm[1] || fm[2];
  let sched;
  if (/^(يوم|يومياً|يوميا)$/.test(word)) sched = { kind: 'daily' };
  else if (/^ساع/.test(word)) sched = { kind: 'hourly' };
  else if (/^(أسبوع|اسبوع|أسبوعياً|اسبوعيا)$/.test(word)) sched = { kind: 'weekly', dow: 4 };
  else if (word === 'شهر') sched = { kind: 'monthly' };
  else sched = { kind: 'weekly', dow: DOW[word] };
  if (sched.kind !== 'hourly') {
    let h = 9; let m = 0;
    if (tm) {
      h = Math.min(23, parseInt(tm[1], 10)); m = tm[2] ? Math.min(59, parseInt(tm[2], 10)) : 0;
      const p = tm[3] || '';
      if (/الصبح|صباح|^ص$/.test(p)) { if (h === 12) h = 0; }
      else if (/الضهر|الظهر/.test(p)) { if (h < 6) h += 12; }
      else if (p) { if (h < 12) h += 12; }
      else if (h >= 1 && h <= 6) h += 12;
    } else if (sched.kind === 'weekly' && /^(أسبوع|اسبوع|أسبوعياً|اسبوعيا)$/.test(word)) { h = 16; }
    sched.h = h; sched.m = m;
  }
  let title = clean.slice(0, Math.max(0, clean.indexOf(fm[0]))).trim();
  if (!clean.includes(fm[0])) title = clean;
  title = title.replace(/^(?:من فضلك|لو سمحت)\s+/, '').replace(RT_VERB, '').replace(/^(?:لي|ب)\s+/, '').replace(/[\s،,.:]+$/, '');
  if (!title) {
    title = rest.replace(tm ? tm[0] : '', '').replace(RT_VERB, '').replace(/^[\s،,.:]+|[\s،,.:؟?]+$/g, '');
  }
  if (!title) title = 'روتين جديد';
  if (title.length > 48) title = title.slice(0, 47) + '…';
  let label;
  if (sched.kind === 'daily') label = `كل يوم ${clockLabel(sched.h, sched.m)}`;
  else if (sched.kind === 'hourly') label = 'كل ساعة';
  else if (sched.kind === 'monthly') label = `أول كل شهر ${clockLabel(sched.h, sched.m)}`;
  else label = `كل ${DAY_EVERY[sched.dow]} ${clockLabel(sched.h, sched.m)}`;
  return { title, label, sched };
}
const RT_EXAMPLES = {
  ads: 'ابعتلي ملخص الإعلانات كل يوم 9 الصبح',
  seo: 'ابعتلي ترتيب المقالات كل اتنين 11 الصبح',
  analyst: 'ابعتلي مقارنة Meta وGoogle كل خميس 4 العصر',
  critic: 'ابعتلي الإعلانات اللي محتاجة مراجعة كل يوم 2 الضهر',
};
const routineExample = (a) => (AGENTS[a] && AGENTS[a].routineEx) || RT_EXAMPLES[a] || 'ابعتلي ملخص اللي عملته كل خميس 4 العصر';
function routineRowHTML(a, r, i) {
  const A = AGENTS[a];
  const running = !!state.rtRunning[`${a}:${i}`];
  const nx = nextRun(r, true);
  let next;
  if (!r.on) next = lng('واقف · مش هيشتغل لحد ما ترجّعه', 'Paused · won’t run until you turn it back on');
  else if (A.paused) next = `${lng('واقف مع', 'Paused with')} ${A.name} ${lng('لحد ما ترجّعه', 'until you resume it')}`;
  else if (r.sched && r.sched.kind === 'trigger') next = lng('مستني الشرط يحصل', 'Waiting for the condition');
  else if (r.sched && r.sched.kind === 'auto') next = lng('مع كل نص جديد يوصله', 'With every new script it receives');
  else next = `${lng('المرة الجاية:', 'Next run:')} ${nx}`;
  const run = running ? lng('<span class="rt-running shimmer" role="status">بيشتغل…</span>', '<span class="rt-running shimmer" role="status">Running…</span>')
    : A.paused || !canWrite() ? '' : `<button type="button" class="link-btn rt-run" data-action="run-routine" data-agent="${a}" data-idx="${i}" aria-label="${lng('شغّل «', 'Run “')}${esc(r.t)}${lng('» دلوقتي', '” now')}">${lng('شغّله دلوقتي', 'Run now')}</button>`;
  return `<li class="panel-row rt-row${r.flash ? ' is-flash' : ''}" data-rt="${a}-${i}"><span class="panel-row__icon">${icon('repeat')}</span>
    <span class="panel-row__text"><span class="panel-row__t" id="rt-${a}-${i}">${bx(r.t)}</span><span class="panel-row__d">${bx(rtWhen(r))}${r.last ? ` ${lng('· آخر مرة', '· Last run')} ${esc(r.last)}` : ''}</span>
      <span class="rt-meta"><span class="rt-next${r.on && !A.paused ? '' : ' is-off'}">${bx(next)}</span>${run}</span></span>
    ${canWrite() ? `<button type="button" class="switch" role="switch" aria-checked="${r.on}" aria-labelledby="rt-${a}-${i}" data-action="toggle-routine" data-agent="${a}" data-idx="${i}"></button>` : `<span class="panel-row__meta">${r.on ? lng('شغال', 'On') : lng('واقف', 'Off')}</span>`}</li>`;
}
function routineResult(a, r) {
  const t7 = totals('7'); const c = DATA['7'].ch; const k = r.t;
  const head = `روتين «${r.t}» · اشتغل دلوقتي بطلب منك\n`;
  if (/وقف|45/.test(k)) return { text: `${head}فحصت كل الإعلانات اللي شغالة دلوقتي:\n• أغلى إعلان «فيديو 3 · القاهرة» عند 41 ج لليد، تحت الحد\n• مفيش إعلان عدّى 45 ج، فموقفتش حاجة\n• الإعلان اللي وقّفته بالليل «فيديو 2 · الرياض» لسه واقف`, steps: [{ tool: 'meta', label: lng('فحص 9 إعلانات', 'Checked 9 ads'), state: 'done' }, { tool: 'gads', label: lng('فحص 4 إعلانات بحث', 'Checked 4 search ads'), state: 'done' }], stepsDur: lng('11 ثانية', '11 sec') };
  if (/الصرف/.test(k)) return { text: `${head}الصرف آخر 7 أيام ${fmt(t7.spend)} ج من 15,000 ج ميزانية الشهر:\n• Meta ${fmt(c.meta.spend)} ج · ${c.meta.leads} ليد\n• Google ${fmt(c.google.spend)} ج · ${c.google.leads} ليد\n• ماشيين أقل من الخطة بـ 6%، فمفيش داعي نغيّر حاجة دلوقتي`, steps: [{ tool: 'meta', label: lng('قرا صرف Meta', 'Read Meta spend'), state: 'done' }, { tool: 'gads', label: lng('قرا صرف Google Ads', 'Read Google Ads spend'), state: 'done' }], stepsDur: lng('9 ثواني', '9 sec') };
  if (/التقرير/.test(k)) return { text: `${head}ملخص الأسبوع لحد دلوقتي (5 – 11 نوفمبر):\n• الصرف ${fmt(t7.spend)} ج، والليدز ${fmt(t7.leads)} بتكلفة ${fmt1(t7.cpl)} ج لليد\n• الإيراد ${fmt(t7.revenue)} ج من ${t7.sales} مبيعات\n• التقرير الكامل هيطلع الخميس 4 العصر زي ميعاده`, steps: [{ tool: 'meta', label: lng('قرا أرقام Meta', 'Read Meta numbers'), state: 'done' }, { tool: 'gads', label: lng('قرا أرقام Google Ads', 'Read Google Ads numbers'), state: 'done' }, { tool: 'sheets', label: lng('قرا المبيعات من الشيت', 'Read sales from the sheet'), state: 'done' }], stepsDur: lng('18 ثانية', '18 sec') };
  if (/تنبيه|قلّت/.test(k)) return { text: `${head}الليدز آخر ساعة 3، والمتوسط في الساعة دي من 2 لـ 4. مفيش نزول، فمفيش تنبيه.`, steps: [{ tool: 'sheets', label: lng('قرا شيت الليدز', 'Read the leads sheet'), state: 'done' }], stepsDur: lng('4 ثواني', '4 sec') };
  if (/كلمات/.test(k)) return { text: `${head}لقيت 6 كلمات جديدة ليها بحث:\n• «كورس ضرائب اونلاين» 880 بحث في الشهر\n• «شهادة محاسبة معتمدة» 590 بحث\n• «كورس اودو محاسبة» 320 بحث\nأقترح نبدأ بالأولى، المنافسة عليها خفيفة.`, steps: [{ tool: 'gsc', label: lng('بحث 40 كلمة قريبة', 'Researched 40 related keywords'), state: 'done' }], stepsDur: lng('21 ثانية', '21 sec') };
  if (/المقالات|ترتيب/.test(k)) return { text: `${head}راجعت ترتيب 14 مقال:\n• «كورس محاسبة اونلاين» نزل من 4 لـ 8\n• «إزاي تبقى محاسب من البيت» طلع للسادس\nهحدّث الأول وأبعته لـ Critic قبل ما يتنشر.`, steps: [{ tool: 'gsc', label: lng('قرا ترتيب 14 مقال', 'Read rankings for 14 articles'), state: 'done' }], stepsDur: lng('16 ثانية', '16 sec') };
  if (/مراجعة|نص/.test(k) && a === 'critic') return { text: `${head}مفيش نصوص جديدة مستنية مراجعة دلوقتي. آخر مراجعة كانت امبارح 6:15 م على 8 نصوص.` };
  if (/ليد|ليدز/.test(k)) return { text: `${head}الليدز من امبارح 9 الصبح: 27 ليد (Meta 18 · Google 9).\n• 6 سألوا عن التقسيط\n• 4 من الرياض وجدة\n• 11 لسه محدش رد عليهم`, steps: [{ tool: 'sheets', label: lng('قرا شيت الليدز', 'Read the leads sheet'), state: 'done' }], stepsDur: lng('6 ثواني', '6 sec') };
  if (/منافس/.test(k)) return { text: `${head}أكاديميتين منافسين نزّلوا إعلانات جديدة الأسبوع ده:\n• واحدة بتعرض خصم 20% لحد آخر نوفمبر\n• التانية بتركّز على «شهادة دولية» في الرياض\nمفيش حد غيّر سعر الكورس الأساسي.` };
  if (a === 'ads' || /الإعلانات|الحملات|أداء/.test(k)) return { text: `${head}أداء امبارح على كل الحملات:\n• الصرف 806 ج (Meta 497 ج · Google 309 ج)\n• 22 ليد مدفوعة بمتوسط 36.6 ج لليد، و5 ليد من SEO\n• إعادة الاستهداف أرخص حملة: 24 ج لليد\n• مفيش إعلان عدّى 45 ج، فموقفتش حاجة`, steps: [{ tool: 'meta', label: lng('قرا أرقام Meta', 'Read Meta numbers'), state: 'done' }, { tool: 'gads', label: lng('قرا أرقام Google Ads', 'Read Google Ads numbers'), state: 'done' }], stepsDur: lng('12 ثانية', '12 sec') };
  return { text: `${head}خلصت. كل حاجة ماشية، ومفيش حاجة محتاجة قرار منك دلوقتي.` };
}
function routineFromChat(threadId, agent, rt) {
  const t = threads[threadId]; const A = AGENTS[agent];
  const r = { t: rt.title, d: rt.label, on: true, sched: rt.sched, flash: true };
  A.routines.push(r);
  const first = nextRun(r);
  agentSays(threadId, agent, {
    text: `تمام. هبعتلك ${rt.title} ${rt.label}${first ? `، وأول مرة ${first}` : ''}.\nلو عايز تغيّر الميعاد أو توقفه، قولي هنا أو من الروتينات في التفاصيل.`,
    steps: [{ tool: 'sheets', label: lng('عمل روتين جديد', 'Created a new routine'), state: 'done' }], stepsDur: lng('2 ثانية', '2 sec'),
  }, () => {
    t.msgs.push({ id: nid('n'), role: 'note', icon: 'repeat', text: `${lng('اتعمل روتين:', 'Routine created:')} ${rt.title} · ${schedUI(rt.sched, rt.label)}`, link: { action: 'show-routines', agent, label: lng('شوفه في التفاصيل', 'See it in details') }, fresh: true });
    refreshThread(threadId); scrollMounts(threadId); rerenderAll();
  }, lng('بيظبط الروتين', 'Setting up the routine'));
}
function showRoutines(a) {
  const cur = threads[state.chatThread];
  if (a && (currentThreadAgent() !== a || (cur && cur.team))) {
    const th = sortedThreads().find((x) => x.agent === a && !x.team && threadVisible(x));
    if (th) state.chatThread = th.id; else { state.chatThread = null; state.newChatAgent = a; }
    setView('chat');
  }
  state.dpSettings = false; state.dpTab = 'activity'; state.dpConfirm = null;
  if (overlayDetails()) { const det = $('#details'); det.hidden = false; det.classList.add('is-open'); syncScrim(); }
  else state.detailsOpen = true;
  renderDetails(); syncDetailsVisibility();
  const sec = $('#dp-routines');
  if (sec) {
    scrollInPanel(sec);
    const rows = $$('.rt-row', sec); const last = rows[rows.length - 1];
    const sw = last && $('.switch', last); if (sw) sw.focus({ preventScroll: true });
  }
  window.setTimeout(() => { Object.keys(AGENTS).forEach((k) => AGENTS[k].routines.forEach((r) => { r.flash = false; })); }, 1500);
}
function runRoutine(a, i) {
  const A = AGENTS[a]; const r = A.routines[i]; const key = `${a}:${i}`;
  if (!r || state.rtRunning[key]) return;
  state.rtRunning[key] = true; renderDetails();
  later(1600, () => {
    delete state.rtRunning[key];
    let th = sortedThreads().find((x) => x.agent === a && !x.checkin && !x.team && threadVisible(x));
    if (!th) {
      const id = nid('th');
      threads[id] = { id, agent: a, title: `روتين: ${r.t}`, time: nowTime(), day: 0, ts: ++tsSeq, card: null, msgs: [] };
      th = threads[id];
    }
    const res = routineResult(a, r);
    const msg = Object.assign({ id: nid('a'), role: 'agent', agent: a, time: nowTime(), fresh: true }, res);
    th.msgs.push(msg); bump(th);
    r.last = nowTime();
    state.events.unshift({ agent: a, t: `${lng('شغّل روتين «', 'Ran the “')}${r.t}${lng('» بطلب منك', '” routine at your request')}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
    const mounted = $$(`[data-thread-mount="${th.id}"]`).length > 0;
    if (mounted) stream(th.id, msg, () => rerenderAll());
    rerenderAll();
    const sw = $(`#details [data-action="toggle-routine"][data-agent="${a}"][data-idx="${i}"]`); if (sw) sw.focus({ preventScroll: true });
    toast(`${lng('«', '“')}${r.t}${lng('» خلص', '” finished')}${mounted ? lng('، والنتيجة تحت', ', result below') : lng(' · النتيجة في المحادثة', ' · result is in the chat')}`, 'check', mounted ? null : { action: 'open-thread', label: lng('افتحها', 'Open it'), thread: th.id });
  });
}
/* scroll only the details panel (scrollIntoView would also nudge the locked page) */
function scrollInPanel(el) {
  const sc = el.closest('.dp-scroll, .sov-main'); if (!sc) return;
  const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 8;
  sc.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
}
const noToolsText = (a) => (a === 'critic' ? lng('المراجع بيشتغل على النصوص اللي بتوصله بس، مش محتاج أدوات خارجية.', 'The reviewer only works on the scripts sent to it and doesn’t need outside tools.') : bx(`${AGENTS[a].name} ${lng('بيشتغل على اللي بتبعتهوله بس، مش محتاج أدوات خارجية.', 'only works on what you send it and doesn’t need outside tools.')}`));

/* ================= morning check-in (primary agent) ================= */
const CK_TIMES = ['7:00', '7:30', '8:00', '8:30', '9:00', '9:30', '10:00', '10:30', '11:00'];
const ckLabel = (v) => { const [h, m] = v.split(':').map(Number); return clockUI(h, m); };
function checkinHTML() {
  const A = AGENTS[state.main];
  const wl = waitingCards();
  const ments = unreadMentions(); const nw = wl.length + ments.length;
  const done = state.handoff.done;
  const night = OVERNIGHT.filter((o) => canSee(o.agent));
  const showHand = canSee('ads'); // Ads prepared the WhatsApp step: only people who work with Ads see it
  const nWait = wl.length === 1 ? lng('حاجة واحدة مستنياك', 'One thing waiting on you') : wl.length === 2 ? lng('حاجتين مستنيينك', 'Two things waiting on you') : `${wl.length} ${lng('حاجات مستنياك', 'things waiting on you')}`;
  const nTeam = `${wl.length} ${lng('مستني موافقة الفريق', 'waiting for the team’s OK')}`;
  const sub = [wl.length ? (canWrite() ? nWait : nTeam) : lng('مفيش حاجة مستنياك', 'Nothing waiting on you'), `${night.length} ${lng('حاجات اشتغلت بالليل', 'things ran overnight')}`].concat(ments.length ? [`${lng('اتذكرت في', 'Mentioned in')} ${ments.length}`] : [])
    .concat(showHand ? [done ? lng('اللي اتسلّمتلك خلص', 'Your handed-over task is done') : canWrite() ? lng('حاجة اتسلّمتلك', 'One thing handed to you') : lng('حاجة اتسلّمت للفريق', 'One thing handed to the team')] : []).join(' · ');
  const waitRows = nw ? `<div class="ck-list">${ments.map(mentionRowHTML).join('')}${wl.map((c) => `<button type="button" class="panel-row${c.request ? ' ck-req' : ''}" data-action="${c.thread ? 'open-thread' : 'open-card'}" data-thread="${c.thread || ''}" data-card="${c.id}">${c.request && MADE[c.request] ? personAv(MADE[c.request].by, 24) : face(c.agent, 24)}
      <span class="panel-row__text"><span class="panel-row__t">${bx(c.title)}</span><span class="panel-row__d">${waitTagHTML(c, true)}${bx(waitTxt(c))}</span></span>
      <span class="panel-row__meta">${icon('chevron')}</span></button>`).join('')}</div>`
    : `<p class="ck-empty">${icon('check')}<span>${lng('مفيش حاجة مستنياك دلوقتي. كل الوكلاء ماشيين لوحدهم.', 'Nothing waiting on you right now. All agents are running on their own.')}</span></p>`;
  const nightRows = `<div class="ck-list">${night.map((o) => `<button type="button" class="panel-row" data-action="open-agent" data-agent="${o.agent}">${face(o.agent, 24)}
      <span class="panel-row__text"><span class="panel-row__t">${bx(o.t)}</span><span class="panel-row__d"><bdi>${esc(AGENTS[o.agent].name)}</bdi> · ${bx(o.m)}</span></span>
      <span class="panel-row__meta">${icon('chevron')}</span></button>`).join('')}</div>`;
  const hand = `<div class="ck-hand">
      <div class="ck-hand__head">${tile('wa', true)}<div class="card__titles"><span class="card__title">${bx(HANDOFF.title)}</span><span class="card__sub">${bx(HANDOFF.sub)}</span></div></div>
      <p class="ck-quote" dir="auto">${bx(HANDOFF.msg)}</p>
      <dl class="kv ck-kv">${HANDOFF.rows.map((r) => `<div class="kv__row"><dt>${bx(r[0])}</dt><dd>${r[1].endsWith('.csv') ? `<bdi dir="auto">${esc(r[1])}</bdi>` : bx(r[1])}</dd></div>`).join('')}</dl>
      ${done ? `<div class="card__outcome ck-outcome">${icon('check')}<span>${bx(`${state.handoff.by ? `${state.handoff.by} ${lng('عملتها ·', 'did it ·')}` : lng('عملتها ·', 'Done it ·')} ${state.handoff.at}${lng('. Ads هيتابع الردود ويقولك مين سجّل.', '. Ads will follow the replies and tell you who signed up.')}`)}</span></div>`
        : !canWrite() ? waitLineHTML(lng('مستني حد من الفريق يبعتها', 'Waiting for someone on the team to send it'))
        : `<div class="ck-actions"><button type="button" class="btn btn--secondary" data-action="copy-handoff">${icon('copy')}<span>${lng('انسخ الرسالة', 'Copy the message')}</span></button>
          <button type="button" class="btn btn--primary" data-action="handoff-done">${lng('عملتها', 'Done it')}</button></div>`}
    </div>`;
  const foot = A.checkinOn ? `${lng('بيوصلك كل يوم', 'Arrives every day at')} ${ckLabel(A.checkinTime)}${lng('. لو مفيش جديد مش هيبعت حاجة.', '. If there’s nothing new, it won’t send anything.')}` : lng('صباح الخير مقفول دلوقتي، مش هيوصلك بكرة.', 'Good morning is off, so it won’t arrive tomorrow.');
  const waitLabel = canWrite() ? lng('مستنيك', 'Waiting on you') : lng('مستني الفريق', 'Waiting on the team');
  return `<div class="card ckcard" role="group" aria-label="${lng('صباح الخير: ملخص اليوم', 'Good morning: today’s summary')}">
    <div class="card__head"><span class="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true">${icon('sun')}</span>
      <div class="card__titles"><span class="card__title">${lng('صباح الخير · الأربع 11 نوفمبر', 'Good morning · Wed, Nov 11')}</span><span class="card__sub">${bx(sub)}</span></div></div>
    <section class="ck-sec" aria-labelledby="ck-h-wait"><h3 class="ck-label" id="ck-h-wait">${nw ? '<span class="dot dot--waiting" aria-hidden="true"></span>' : ''}<span class="${nw ? 'ck-label--wait' : ''}">${waitLabel}</span>${nw ? ` <span class="num ck-label--wait">${nw}</span>` : ''}</h3>${waitRows}</section>
    ${night.length ? `<section class="ck-sec" aria-labelledby="ck-h-night"><h3 class="ck-label" id="ck-h-night">${lng('اشتغل بالليل', 'Ran overnight')} <span class="num">${night.length}</span></h3>${nightRows}</section>` : ''}
    ${showHand ? `<section class="ck-sec" aria-labelledby="ck-h-hand"><h3 class="ck-label" id="ck-h-hand"><span class="badge ck-badge">${icon('hand')}${lng('اتسلّمتلك', 'Handed to you')}</span></h3>${hand}</section>` : ''}
    <div class="ck-foot"><span>${bx(foot)}</span>${canManage() ? `<button type="button" class="link-btn" data-action="checkin-settings">${lng('غيّر الميعاد', 'Change the time')}</button>` : ''}</div>
  </div>`;
}
/* the morning message greets whoever the prototype is shown as */
function syncMorning() {
  const m = threads['th-morning'].msgs[0]; const P0 = me();
  m.agent = state.main;
  m.text = canWrite() ? `صباح الخير يا ${PEOPLE[state.as].first}. ده اللي مستنيك النهارده، واللي اشتغل بالليل.` : `صباح الخير يا ${PEOPLE[state.as].first}. ده اللي مستني الفريق النهارده، واللي اشتغل بالليل.`;
  return P0;
}
function checkinSetHTML(a, D) {
  if (!isMain(a)) return '';
  return `<section class="dp-sec" id="set-checkin" aria-labelledby="set-h-ck"><h3 class="dp-label" id="set-h-ck"><span>${lng('صباح الخير', 'Good morning')}</span></h3>
    <ul class="panel-card">
      <li class="panel-row"><span class="panel-row__text"><span class="panel-row__t" id="set-ck-t">${lng('ابعتلي ملخص الصبح كل يوم', 'Send me a morning summary every day')}</span><span class="panel-row__d">${lng('اللي مستنيك واللي اشتغل بالليل، في أول محادثة في اليوم', 'What’s waiting on you and what ran overnight, in the first chat of the day')}</span></span>
        <button type="button" class="switch" role="switch" id="set-ck-on" aria-checked="${!!D.checkinOn}" aria-labelledby="set-ck-t" data-action="set-checkin"></button></li>
      <li class="panel-row"><span class="panel-row__text"><label class="panel-row__t" for="set-ck-time">${lng('الميعاد', 'Time')}</label><span class="panel-row__d">${lng('بتوقيت القاهرة', 'Cairo time')}</span></span>
        <select class="set-input ck-time num" id="set-ck-time" data-set="checkinTime" ${D.checkinOn ? '' : 'disabled'}>${CK_TIMES.map((v) => `<option value="${v}" ${v === D.checkinTime ? 'selected' : ''}>${ckLabel(v)}</option>`).join('')}</select></li>
    </ul>
    <p class="set-hint ck-hint">${bx(lng('لو مفيش جديد، مش هيبعت حاجة. عشان كده امبارح مفيش رسالة صباح الخير.', 'If there’s nothing new, it won’t send anything. That’s why there was no good-morning message yesterday.'))}</p></section>`;
}

/* ================= agent templates: a private gallery for this workspace ================= */
const TPL_CATS = [['all', lng('الكل', 'All')], ['ads', lng('إعلانات', 'Ads')], ['content', lng('محتوى', 'Content')], ['numbers', lng('أرقام', 'Numbers')], ['social', lng('سوشيال', 'Social')], ['follow', lng('متابعة', 'Monitoring')], ['code', lng('كود', 'Code')]];
const TEMPLATES = [
  { id: 'meta', cat: 'ads', role: lng('مدير إعلانات Meta', 'Meta ads manager'), name: 'Reach', look: { shape: 'spark', color: 'sky' }, kind: 'team', conns: ['meta', 'ga4'],
    line: lng('بيبني حملات فيسبوك وانستجرام، ويتابع تكلفة الليد كل يوم، ويوقف الإعلان اللي بيصرف على الفاضي.', 'Builds Facebook and Instagram campaigns, watches cost per lead every day, and pauses ads that waste spend.'),
    example: 'اعمل حملة Meta لدبلومة الضرائب بميزانية 6,000 ج للشهر', routineEx: 'ابعتلي تكلفة الليد في Meta كل يوم 9 الصبح',
    skills: [[lng('حملات ليدز على واتساب', 'WhatsApp lead campaigns'), lng('فورم أو رسالة مباشرة حسب الجمهور', 'Lead form or direct message depending on the audience')], [lng('متابعة تكلفة الليد', 'Cost-per-lead monitoring'), lng('بيوقف أي إعلان يعدّي الحد اللي تحدده', 'Pauses any ad that passes the limit you set')]],
    reply: 'تمام. هقرا نتايج حملات المحاسب الشامل الأول عشان أبني عليها، وهرجعلك بخطة وميزانية. مش هطلق ولا هصرف أي حاجة قبل موافقتك.' },
  { id: 'gads', cat: 'ads', role: lng('مدير Google Ads', 'Google Ads manager'), name: 'Search', look: { shape: 'specs', color: 'mint' }, kind: 'team', conns: ['gads', 'ga4'],
    line: lng('بيختار كلمات البحث، يكتب إعلانات Google، ويوقف الكلمات اللي بتصرف من غير ليدز.', 'Picks search keywords, writes Google ads, and pauses keywords that spend without leads.'),
    example: 'شوف الكلمات اللي صرفت أكتر من 300 ج الأسبوع ده من غير ولا ليد', routineEx: 'ابعتلي الكلمات اللي بتصرف من غير ليدز كل اتنين 10 الصبح',
    skills: [[lng('كلمات سلبية', 'Negative keywords'), lng('بيشيل الكلمات اللي بتجيب زيارات مش مهتمة', 'Removes keywords that bring uninterested visits')], [lng('إعلانات بحث بالعامية', 'Search ads in colloquial Arabic'), lng('عناوين وأوصاف لكل مجموعة إعلانية', 'Headlines and descriptions for every ad group')]],
    reply: 'تمام. هقرا تقرير كلمات البحث آخر 7 أيام وأطلّعلك الكلمات اللي صرفت من غير ليدز. أي تغيير في الميزانية أو وقف كلمات هستأذنك فيه الأول.' },
  { id: 'hook', cat: 'ads', role: lng('ناقد إعلانات', 'Ad critic'), name: 'Hook', look: { shape: 'brow', color: 'stone' }, kind: 'team', conns: [],
    line: lng('بيقرا الإعلان بعين العميل: الفكرة واضحة في أول 3 ثواني؟ الوعد مقبول؟ وبيرتّب البدايل من الأقوى للأضعف.', 'Reads each ad like a customer: is the idea clear in the first 3 seconds? Is the promise fair? Then ranks the alternatives from strongest to weakest.'),
    example: 'قيّم الإعلانات الـ5 اللي شغالة على Meta ورتّبهم من الأقوى للأضعف', routineEx: 'ابعتلي أضعف إعلان شغال كل حد 11 الصبح',
    skills: [[lng('تقييم أول 3 ثواني', 'First-3-seconds check'), lng('للفيديو والريلز', 'For videos and reels')], [lng('بدايل للعناوين', 'Headline alternatives'), lng('3 بدايل لكل عنوان ضعيف', '3 alternatives for every weak headline')]],
    reply: 'تمام. ابعتلي النصوص أو قولي أي حملة، وهقيّم كل إعلان لوحده: الفكرة، الوعد، وأول 3 ثواني، وهقترح بديل لكل نقطة ضعيفة.' },
  { id: 'writer', cat: 'content', role: lng('كاتب محتوى SEO', 'SEO content writer'), name: 'Writer', look: { shape: 'specs', color: 'slate' }, kind: 'team', conns: ['gsc', 'wp'],
    line: lng('بيكتب مقالات طويلة على كلمات ليها بحث، ويسيبها مسودة على WordPress.', 'Writes long-form articles on keywords with search volume and leaves them as drafts in WordPress.'),
    handoff: lng('مش بينشر لوحده. بيسيب المقال مسودة، وانت اللي تنشره.', 'Never publishes on its own. It leaves the article as a draft, and you publish it.'),
    example: 'اكتب مقال عن الفرق بين المحاسب والمراجع في 1,500 كلمة', routineEx: 'ابعتلي 3 أفكار مقالات جديدة كل اتنين 11 الصبح',
    skills: [[lng('مقالات 1,500+ كلمة', '1,500+ word articles'), lng('عناوين فرعية وأسئلة شائعة', 'Subheadings and FAQs')], [lng('روابط داخلية', 'Internal links'), lng('لصفحات الكورسات', 'To course pages')]],
    reply: 'تمام. هبحث الكلمة الأول وأرجعلك بعنوانين وهيكل المقال. بعد ما أكتبه هسيبه مسودة على WordPress، وانت اللي تنشره.' },
  { id: 'news', cat: 'content', role: lng('كاتب نيوزلتر', 'Newsletter writer'), name: 'Letters', look: { shape: 'calm', color: 'lilac' }, kind: 'personal', conns: ['mail', 'sheets'],
    line: lng('بيكتب النشرة الأسبوعية للمشتركين من أخبار الكورسات ومقالات الأسبوع.', 'Writes the weekly subscriber newsletter from course news and the week’s articles.'),
    handoff: lng('مش بيبعت لحد. بيجهّز الإيميل في Mailchimp، وانت اللي تدوس إرسال.', 'Never sends to anyone. It prepares the email in Mailchimp, and you press Send.'),
    example: 'جهّز نيوزلتر الأسبوع ده عن خصم الدفعة الجديدة', routineEx: 'جهّزلي النيوزلتر كل أربع 2 الضهر',
    skills: [[lng('نشرة أسبوعية', 'Weekly newsletter'), lng('عنوان + 3 أخبار + دعوة للتسجيل', 'Headline + 3 news items + a call to sign up')], [lng('عناوين إيميل', 'Email subject lines'), lng('3 عناوين تختار منهم', '3 subject lines to pick from')]],
    reply: 'تمام. هجمع أخبار الأسبوع والخصم وأكتب النشرة بـ 3 عناوين تختار منهم. هسيبها مسودة في Mailchimp، ومش هتتبعت غير لما انت تدوس إرسال.' },
  { id: 'cal', cat: 'content', role: lng('مدير تقويم المحتوى', 'Content calendar manager'), name: 'Calendar', look: { shape: 'round', color: 'sage' }, kind: 'team', conns: ['sheets'],
    line: lng('بيرتّب البوستات والمقالات والإيميلات على الشهر، وبيفكّر الفريق قبل كل ميعاد بيومين.', 'Lays out posts, articles and emails across the month, and reminds the team two days before each date.'),
    example: 'حط خطة محتوى ديسمبر: 3 بوستات في الأسبوع ومقالين', routineEx: 'ابعتلي مواعيد المحتوى بتاعة الأسبوع كل حد 9 الصبح',
    skills: [[lng('خطة شهرية', 'Monthly plan'), lng('في شيت الفريق', 'In the team sheet')], [lng('تذكير قبل الميعاد', 'Reminder before each date'), lng('بيومين لكل حاجة', 'Two days ahead of everything')]],
    reply: 'تمام. هحط الخطة في شيت الفريق: البوستات والمقالات والإيميلات على أيام ديسمبر، وهوريهالك هنا قبل ما أشاركها مع الفريق.' },
  { id: 'landing', cat: 'content', role: lng('مراجع صفحات الهبوط', 'Landing page reviewer'), name: 'Landing', look: { shape: 'bars', color: 'sky' }, kind: 'personal', conns: ['ga4'],
    line: lng('بيقارن صفحة الكورس بالإعلان اللي ودّى عليها، ويقترح تعديلات ترفع التسجيل.', 'Compares the course page with the ad that sent people there, and suggests edits that lift sign-ups.'),
    example: 'راجع صفحة المحاسب الشامل وقولي ليه الناس بتخرج منها', routineEx: 'ابعتلي نسبة التسجيل في صفحة الكورس كل خميس 4 العصر',
    skills: [[lng('مقارنة الإعلان بالصفحة', 'Ad-to-page match'), lng('نفس الوعد ونفس السعر', 'Same promise, same price')], [lng('اقتراحات تعديل', 'Suggested edits'), lng('مرتّبة حسب الأثر المتوقع', 'Ranked by expected impact')]],
    reply: 'تمام. هقارن الصفحة بالإعلانات اللي بتودّي عليها وأرجعلك بقايمة تعديلات مرتّبة. محتاج GA4 عشان أشوف الناس بتخرج منين بالظبط.' },
  { id: 'numbers', cat: 'numbers', role: lng('محلل أرقام', 'Numbers analyst'), name: 'Numbers', look: { shape: 'bars', color: 'mint' }, kind: 'team', conns: ['meta', 'gads', 'sheets'],
    line: lng('بيقرا Meta وGoogle وشيت المبيعات، ويقولك الفلوس راحت فين ورجّعت إيه.', 'Reads Meta, Google and the sales sheet, and tells you where the money went and what it brought back.'),
    example: 'قارن تكلفة الليد بين القاهرة والرياض آخر 30 يوم', routineEx: 'ابعتلي العائد لكل قناة كل خميس 4 العصر',
    skills: [[lng('مقارنة المدن', 'City comparison'), lng('مصر والسعودية', 'Egypt and Saudi Arabia')], [lng('العائد لكل قناة', 'Return per channel'), lng('من شيت المبيعات', 'From the sales sheet')]],
    reply: 'تمام. هقرا Meta وGoogle والشيت وأرجعلك بالخلاصة في 3 نقط وبعدها الجدول. قراية بس، مش هغيّر أي حاجة في الحسابات.' },
  { id: 'budget', cat: 'numbers', role: lng('مخطط الميزانية', 'Budget planner'), name: 'Budget', look: { shape: 'round', color: 'stone' }, kind: 'personal', conns: ['meta', 'gads', 'sheets'],
    line: lng('بيقسّم ميزانية الشهر على القنوات والأيام حسب اللي جاب ليدز أرخص.', 'Splits the monthly budget across channels and days based on what brought the cheapest leads.'),
    example: 'وزّع 40,000 ج ميزانية ديسمبر على Meta وGoogle', routineEx: 'ابعتلي الصرف مقابل الخطة كل سبت 10 الصبح',
    skills: [[lng('توزيع على القنوات', 'Split by channel'), lng('حسب تكلفة الليد آخر 30 يوم', 'Based on cost per lead over the last 30 days')], [lng('توزيع على الأيام', 'Split by day'), lng('أكتر في أيام الذروة', 'More on peak days')]],
    reply: 'تمام. هقترح توزيع على القنوات والأيام حسب آخر 30 يوم، وهبعتهولك هنا. مش هغيّر ميزانية أي حملة، ده دور Ads بعد موافقتك.' },
  { id: 'social', cat: 'social', role: lng('مدير سوشيال', 'Social media manager'), name: 'Social', look: { shape: 'calm', color: 'mint' }, kind: 'team', conns: ['meta'],
    line: lng('بيكتب بوستات وريلز لصفحة الأكاديمية، ويجهّز ردود على التعليقات اللي بتتكرر.', 'Writes posts and reels for the academy page, and prepares replies to recurring comments.'),
    handoff: lng('مش بينشر ولا بيرد لوحده. بيجهّز البوست والرد، وانت اللي تنشر.', 'Never posts or replies on its own. It prepares the post and the reply, and you publish.'),
    example: 'اكتب 3 بوستات للدفعة الجديدة بلهجة مصرية', routineEx: 'ابعتلي التعليقات اللي محتاجة رد كل يوم 6 بالليل',
    skills: [[lng('بوستات وريلز', 'Posts and reels'), lng('نص + فكرة الصورة أو الفيديو', 'Copy + the image or video idea')], [lng('ردود جاهزة', 'Ready replies'), lng('للأسئلة اللي بتتكرر في التعليقات', 'For questions that keep coming up in comments')]],
    reply: 'تمام. هكتب 3 بوستات بزاوية مختلفة لكل واحد، وأحطهم هنا تختار. مش هنشر حاجة، انت اللي تنشر من الصفحة.' },
  { id: 'radar', cat: 'follow', role: lng('متابع منافسين', 'Competitor watcher'), name: 'Radar', look: { shape: 'spark', color: 'lilac' }, kind: 'personal', conns: [],
    line: lng('بيتابع إعلانات وأسعار الأكاديميات المنافسة في مصر والسعودية، ويبعتلك اللي اتغير بس.', 'Tracks ads and prices from competing academies in Egypt and Saudi Arabia, and only tells you what changed.'),
    example: 'شوف إعلانات المنافسين على Meta الأسبوع ده وقولي إيه الجديد', routineEx: 'ابعتلي أي عرض جديد من المنافسين كل اتنين 10 الصبح',
    skills: [[lng('مكتبة إعلانات Meta', 'Meta Ad Library'), lng('إعلانات المنافسين الشغالة', 'Competitors’ active ads')], [lng('تغيير الأسعار', 'Price changes'), lng('من صفحات الكورسات', 'From course pages')]],
    reply: 'تمام. هبص على مكتبة إعلانات Meta وصفحات المنافسين، وأبعتلك اللي اتغير بس: عروض جديدة، أسعار، أو زاوية جديدة.' },
  { id: 'wa', cat: 'follow', role: lng('متابع ليدز واتساب', 'WhatsApp lead follow-up'), name: 'FollowUp', look: { shape: 'brow', color: 'sage' }, kind: 'team', conns: ['wa', 'sheets'],
    line: lng('بيفرز الليدز الجديدة، ويكتب رسالة متابعة لكل واحد حسب سؤاله.', 'Sorts new leads and writes a follow-up message for each one based on their question.'),
    handoff: lng('مش بيبعت لعميل لوحده. بيجهّز الرسايل والقايمة، وانت اللي تبعت من رقم الأكاديمية.', 'Never messages a customer on its own. It prepares the messages and the list, and you send them from the academy number.'),
    example: 'جهّز رسايل متابعة لليدز اللي مردوش من يومين', routineEx: 'ابعتلي الليدز اللي محدش رد عليهم كل يوم 12 الضهر',
    skills: [[lng('فرز الليدز', 'Lead sorting'), lng('حسب السؤال والمدينة', 'By question and city')], [lng('رسايل متابعة', 'Follow-up messages'), lng('رسالة لكل ليد، بالعامية', 'One message per lead, in colloquial Arabic')]],
    reply: 'تمام. هفرز الليدز اللي مردوش وأكتب رسالة لكل واحد حسب سؤاله. مش هبعت لحد، هسلّمك القايمة والرسايل جاهزة تبعتها انت.' },
];
const CAT_NAME = Object.fromEntries(TPL_CATS);
const KIND_TXT = { personal: lng('شغال معاك انت', 'Works with you'), team: lng('شغال مع الفريق كله', 'Works with the whole team') };
function tplMatches(tp, m) {
  if (m.cat !== 'all' && tp.cat !== m.cat) return false;
  const q = m.q.trim().toLowerCase(); if (!q) return true;
  return [tp.role, tp.name, tp.line, CAT_NAME[tp.cat], tp.handoff || '', tp.conns.map((k) => CONNS[k].name).join(' ')].join(' ').toLowerCase().includes(q);
}
function tplCardHTML(tp) {
  /* a template that is already one of this workspace's agents (Coder): marked, and it opens instead of adding again */
  const added = !!(tp.agent && AGENTS[tp.agent] && AGENT_ORDER.includes(tp.agent));
  const addedFoot = added ? (canSee(tp.agent) ? `<span class="tpl__added">${icon('check')}${lng('متضاف', 'Added')}</span><button type="button" class="btn btn--secondary btn--sm" data-action="tpl-open" data-agent="${tp.agent}" aria-label="${lng('افتح', 'Open')} ${esc(AGENTS[tp.agent].name)}">${lng('افتحه', 'Open it')}</button>`
    : `<span class="tpl__added">${icon('check')}${lng('متضاف للفريق · مش ظاهر ليك', 'In the team · not shown to you')}</span>`) : '';
  return `<article class="tpl${added ? ' tpl--added' : ''}" aria-labelledby="tpl-t-${tp.id}">
    <div class="tpl__top">${tp.agent ? face(tp.agent, 44) : lookFace(tp.look, 44)}<div class="tpl__titles"><h3 class="tpl__role" id="tpl-t-${tp.id}">${bx(tp.role)}</h3><span class="tpl__cat">${CAT_NAME[tp.cat]}${isSolo() ? '' : ` · ${KIND_TXT[tp.kind]}`}</span></div></div>
    <p class="tpl__line">${bx(tp.line)}</p>
    ${tp.handoff ? `<p class="tpl__hand">${icon('hand')}<span>${bx(tp.handoff.split('. ')[1] || tp.handoff)}</span></p>` : ''}
    <div class="tpl__foot"><span class="tpl__tools">${tp.conns.map((k) => tile(k)).join('')}${tp.conns.length ? '' : lng('<span class="tpl__none">من غير أدوات</span>', '<span class="tpl__none">No tools</span>')}</span>
      ${added ? addedFoot : isOwner() ? `<button type="button" class="btn btn--secondary btn--sm" data-action="tpl-add" data-tpl="${tp.id}" aria-label="${lng('ضيف', 'Add')} ${esc(tp.role)}">${lng('ضيفه', 'Add it')}</button>`
        : `<button type="button" class="btn btn--secondary btn--sm" data-action="tpl-ask" data-tpl="${tp.id}" aria-label="${lng('اطلب', 'Ask for')} ${esc(tp.role)}">${lng('اطلبه', 'Ask for it')}</button>`}</div>
  </article>`;
}
function tplGridHTML() {
  const m = state.modal;
  const list = TEMPLATES.filter((tp) => tplMatches(tp, m));
  if (!list.length) {
    const q = m.q.trim();
    return `<div class="tpl-empty"><b>${q ? `${lng('مفيش وكيل جاهز فيه «', 'No ready-made agent matches “')}${esc(q)}${lng('»', '”')}` : lng('مفيش وكلاء في القسم ده', 'No agents in this category')}</b>
      <span>${bx(lng('جرّب كلمة تانية، أو ابدأ وكيل من الصفر واكتبله شغلته بنفسك.', 'Try another word, or start an agent from scratch and describe its job yourself.'))}</span>
      <div class="tpl-empty__acts">${q ? lng('<button type="button" class="btn btn--secondary btn--sm" data-action="tpl-clear">امسح البحث</button>', '<button type="button" class="btn btn--secondary btn--sm" data-action="tpl-clear">Clear search</button>') : ''}${isOwner() ? `<button type="button" class="btn btn--secondary btn--sm" data-action="tpl-scratch" data-name="${esc(q)}">${lng('ابدأ من الصفر', 'Start from scratch')}</button>` : `<button type="button" class="btn btn--secondary btn--sm" data-action="tpl-ask">${bx(`${lng('اطلبه من', 'Ask')} ${AGENTS[state.main].name}`)}</button>`}</div></div>`;
  }
  return list.map(tplCardHTML).join('');
}
function galleryHTML() {
  const m = state.modal;
  return `<header class="modal__head"><div class="modal__titles"><h2 class="modal__title" id="modal-title">${lng('وكلاء جاهزين لـ', 'Ready-made agents for')} <bdi>RS Learning</bdi></h2>
      <p class="modal__sub">${bx(isSolo() ? `${lng('اختار دور، و', 'Pick a role and ')}${AGENTS[state.main].name}${lng(' هيجهّزلك اقتراح في المحادثة. الوكيل بيتعمل بس لما توافق. القايمة دي خاصة بمساحتك، ومحدش برّاها يشوفها.', ' prepares a proposal in the chat. The agent is created only when you approve. This list is private to your workspace.')}` : isOwner() ? lng('اختار دور وضيفه للفريق في دقيقة. القايمة دي خاصة بمساحة RS Learning، ومحدش برّه الفريق يشوفها.', 'Pick a role and add it to the team in a minute. This list is private to the RS Learning workspace. Nobody outside the team can see it.')
        : `${lng('اختار دور واطلبه من', 'Pick a role and ask')} ${AGENTS[state.main].name}${lng('. هيجهّز اقتراح، والوكيل بيتعمل بس لما عمر يوافق. القايمة دي خاصة بمساحة RS Learning.', '. It prepares a proposal, and the agent is only created when Omar approves. This list is private to the RS Learning workspace.')}`)}</p></div>
      <button type="button" class="circle-btn" data-action="close-modal" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></header>
    <div class="modal__tools">
      <div class="tpl-search">${icon('search')}<label class="sr-only" for="tpl-q">${lng('دوّر في الوكلاء الجاهزين', 'Search ready-made agents')}</label><input type="search" id="tpl-q" autocomplete="off" placeholder="${lng('دوّر بالدور أو الأداة، مثلاً: واتساب', 'Search by role or tool, e.g. WhatsApp')}" value="${esc(m.q)}"></div>
      <div class="od-rail tpl-cats" role="group" aria-label="${lng('الأقسام', 'Categories')}">${TPL_CATS.map(([k, l]) => {
        const n = k === 'all' ? TEMPLATES.length : TEMPLATES.filter((tp) => tp.cat === k).length;
        return `<button type="button" class="chip chip--text" data-action="tpl-cat" data-cat="${k}" aria-pressed="${m.cat === k}">${l}<span class="chip__n num">${n}</span></button>`;
      }).join('')}</div>
    </div>
    <div class="tpl-grid" id="tpl-grid" aria-live="polite">${tplGridHTML()}</div>
    <footer class="modal__foot"><span class="modal__foot-t">${lng('مش لاقي الدور اللي محتاجه؟', 'Can’t find the role you need?')}</span>
      ${isOwner() ? `<button type="button" class="btn btn--secondary" data-action="tpl-scratch">${lng('ابدأ من الصفر', 'Start from scratch')}</button>` : `<button type="button" class="btn btn--secondary" data-action="tpl-ask">${bx(`${lng('اطلبه من', 'Ask')} ${AGENTS[state.main].name}`)}</button>`}</footer>`;
}
const handleFor = (name) => '@' + name.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, '');
function createHTML() {
  const m = state.modal; const D = m.draft; const tp = m.tpl ? TEMPLATES.find((x) => x.id === m.tpl) : null;
  const nm = D.name.trim();
  const summary = tp ? `<ul class="panel-card cr-sum">
      <li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${bx(tp.role)}</span><span class="panel-row__d">${bx(tp.line)}</span></span></li>
      ${tp.conns.length ? `<li class="panel-row"><span class="panel-row__text"><span class="panel-row__t">${lng('هيستخدم', 'Will use')}</span><span class="panel-row__d">${bx(tp.conns.map((k) => CONNS[k].name + (state.conns[k] === 'connected' ? '' : lng(' (محتاج توصيل)', ' (needs connecting)'))).join(lng('، ', ', ')))}</span></span><span class="tpl__tools">${tp.conns.map((k) => tile(k)).join('')}</span></li>` : ''}
      ${tp.handoff ? `<li class="panel-row"><span class="panel-row__icon">${icon('hand')}</span><span class="panel-row__text"><span class="panel-row__t">${lng('اتسلّمتلك', 'Handed to you')}</span><span class="panel-row__d">${bx(tp.handoff)}</span></span></li>` : ''}
    </ul>` : `<p class="set-hint cr-hint">${bx(lng('بعد ما تضيفه، اكتبله شغلته في أول رسالة، أو من الإعدادات. ومهما كانت شغلته، أي نشر أو صرف أو رسالة لعميل بيتسلّملك انت.', 'After you add it, tell it its job in the first message or in settings. Whatever its job, anything that publishes, spends or messages a customer is handed to you.'))}</p>`;
  return `<header class="modal__head">${m.from === 'gallery' ? `<button type="button" class="circle-btn" data-action="tpl-back" aria-label="${lng('رجوع للوكلاء الجاهزين', 'Back to ready-made agents')}">${icon('chevronRight')}</button>` : ''}
      <div class="modal__titles"><h2 class="modal__title" id="modal-title">${tp ? `${lng('ضيف', 'Add')} ${bx(tp.role)}` : lng('وكيل جديد من الصفر', 'New agent from scratch')}</h2></div>
      <button type="button" class="circle-btn" data-action="close-modal" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></header>
    <div class="modal__body cr">
      <div class="cr-preview" id="cr-preview">${lookFace(D.look, 72, nm || lng('الوكيل الجديد', 'New agent'))}<bdi class="cr-handle" id="cr-handle">${nm ? esc(handleFor(nm)) : '@…'}</bdi></div>
      <div class="set-field"><label class="set-label" for="cr-name">${lng('الاسم', 'Name')}</label>
        <input class="set-input" id="cr-name" type="text" dir="auto" maxlength="20" autocomplete="off" value="${esc(D.name)}" placeholder="${lng('مثلاً: Pulse', 'e.g. Pulse')}" aria-describedby="cr-name-hint cr-name-err" aria-required="true">
        <span class="set-err" id="cr-name-err" hidden></span>
        <span class="set-hint" id="cr-name-hint">${bx(lng('اسم قصير بتناديه بيه في الرسايل، والأحسن بالإنجليزي زي باقي الوكلاء.', 'A short name you call it by in messages. English works best, like the other agents.'))}</span></div>
      <div class="set-field"><span class="set-label" id="cr-shape-l">${lng('الشكل', 'Look')}</span>
        <div class="cr-shapes" role="radiogroup" aria-labelledby="cr-shape-l">${LOOK_SHAPES.map(([k]) => `<button type="button" class="cr-shape" role="radio" id="cr-shape-${k}" aria-checked="${D.look.shape === k}" tabindex="${D.look.shape === k ? 0 : -1}" data-action="cr-shape" data-shape="${k}" aria-label="${SHAPE_NAMES[k]}">${lookFace({ shape: k, color: D.look.color }, 40)}</button>`).join('')}</div>
        <span class="set-label" id="cr-color-l">${lng('اللون', 'Colour')}</span>
        <div class="cr-colors" role="radiogroup" aria-labelledby="cr-color-l">${LOOK_COLORS.map(([k, bg, , l]) => `<button type="button" class="cr-color" role="radio" id="cr-color-${k}" aria-checked="${D.look.color === k}" tabindex="${D.look.color === k ? 0 : -1}" data-action="cr-color" data-color="${k}" aria-label="${l}" style="background:${bg}"></button>`).join('')}</div></div>
      <div class="set-field"><span class="set-label" id="cr-kind-l">${lng('بيشتغل مع مين', 'Who it works with')}</span>
        <div class="cr-kinds" role="radiogroup" aria-labelledby="cr-kind-l">
          ${[['personal', lng('شغال معاك انت', 'Works with you'), lng('بيساعدك انت بس، بحساباتك وملفاتك.', 'Helps only you, with your accounts and files.')], ['team', lng('شغال مع الفريق كله', 'Works with the whole team'), lng('أي حد في الفريق يقدر يكلّمه ويسلّمه شغل.', 'Anyone on the team can talk to it and hand it work.')]].map(([k, t, d]) => `
          <button type="button" class="cr-kind" role="radio" id="cr-kind-${k}" aria-checked="${D.kind === k}" tabindex="${D.kind === k ? 0 : -1}" data-action="cr-kind" data-kind="${k}">
            <span class="cr-kind__t">${t}</span><span class="cr-kind__d">${d}</span>${D.kind === k ? icon('check', 'cr-kind__check') : ''}</button>`).join('')}
        </div></div>
      ${summary}
    </div>
    <footer class="modal__foot modal__foot--end"><button type="button" class="btn btn--secondary" data-action="close-modal">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary" data-action="cr-create">${lng('ضيف', 'Add')}</button></footer>`;
}
function renderModal() {
  const dlg = $('#modal'); const m = state.modal; if (!m) return;
  dlg.classList.toggle('modal--sm', m.step === 'create' || m.step === 'team');
  dlg.classList.toggle('modal--fit', false); // «قناة جديدة» is taller than the screen: fixed height, the body scrolls, the buttons stay
  $('#modal-inner').innerHTML = m.step === 'create' ? createHTML() : m.step === 'team' ? teamCreateHTML() : galleryHTML();
}
/* «قناة جديدة» (Owner or Manager): name it, choose which members and which agents are in it */
const chNameHint = (v) => bx(`${lng('هتظهر في القنوات كده:', 'Shows under channels as:')} #${String(v || '').trim().replace(/^#+/, '') || lng('اسم-القناة', 'channel-name')}`);
function teamCreateHTML() {
  const D = state.modal.draft;
  const ags = chanAgentsPool();
  const err = D.nameErr === 'dup' ? lng('فيه قناة بالاسم ده. اختار اسم تاني.', 'There’s already a channel with this name. Pick another one.') : lng('القناة محتاجة اسم، ولو كلمة واحدة.', 'The channel needs a name, even one word.');
  return `<header class="modal__head"><div class="modal__titles"><h2 class="modal__title" id="modal-title">${lng('قناة جديدة', 'New channel')}</h2>
      <p class="modal__sub">${bx(lng('محادثة للفريق، لحملة أو لقسم: الأعضاء والوكلاء بيكتبوا في نفس المكان. الوكيل بيقرا ويرد بس لما حد يناديه باسمه.', 'A team conversation for a campaign or a department: members and agents write in the same place. An agent reads and replies only when someone calls it by name.'))}</p></div>
      <button type="button" class="circle-btn" data-action="close-modal" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></header>
    <div class="modal__body cr">
      <div class="set-field"><label class="set-label" for="tm-name">${lng('اسم القناة', 'Channel name')} <span aria-hidden="true">*</span></label>
        <input class="set-input" id="tm-name" type="text" maxlength="32" autocomplete="off" value="${esc(D.name)}" placeholder="${lng('مثلاً: إطلاق الدفعة الجديدة', 'e.g. New cohort launch')}" aria-required="true" aria-describedby="tm-name-err tm-name-hint"${D.nameErr ? ' aria-invalid="true"' : ''}>
        <span class="set-err" id="tm-name-err" ${D.nameErr ? '' : 'hidden'}>${err}</span>
        <span class="set-hint" id="tm-name-hint">${chNameHint(D.name)}</span></div>
      <div class="set-field"><span class="set-label" id="ch-pick-l">${lng('الأعضاء', 'Members')} <span class="num">${D.people.length}</span></span>
        <div class="panel-card" role="group" aria-labelledby="ch-pick-l">${roster().map((p) => { const on = D.people.includes(p); const self = p === state.as; const Q = PEOPLE[p];
          return `<button type="button" class="panel-row tm-pick" role="checkbox" id="ch-pick-${p}" aria-checked="${on}"${self ? ' aria-disabled="true"' : ''} data-action="ch-person" data-person="${p}">${personAv(p, 28)}
            <span class="panel-row__text"><span class="panel-row__t">${esc(Q.name)}${self ? ` <span class="ch-you">${lng('(انت)', '(you)')}</span>` : ''}</span><span class="panel-row__d">${self ? lng('اللي بيعمل القناة بيبقى فيها', 'Whoever creates the channel is in it') : `${esc(Q.title)}${Q.job ? ` · ${esc(Q.job)}` : ''}${Q.role === 'viewer' ? ` · ${lng('هتقرا بس', 'will only read')}` : ''}`}</span></span>
            <span class="tm-check" aria-hidden="true">${on ? icon('check') : ''}</span></button>`; }).join('')}</div></div>
      <div class="set-field"><span class="set-label" id="tm-pick-l">${lng('الوكلاء في القناة', 'Agents in the channel')} <span class="num">${D.members.length}</span></span>
        <div class="panel-card" role="group" aria-labelledby="tm-pick-l">${ags.map((a) => {
          const on = D.members.includes(a);
          return `<button type="button" class="panel-row tm-pick" role="checkbox" id="tm-pick-${a}" aria-checked="${on}" data-action="tm-toggle" data-agent="${a}">${face(a, 28)}
            <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(AGENTS[a].name)}</bdi></span><span class="panel-row__d">${bx(AGENTS[a].role || lng('وكيل جديد', 'New agent'))}</span></span>
            <span class="tm-check" aria-hidden="true">${on ? icon('check') : ''}</span></button>`;
        }).join('')}</div></div>
      <p class="set-hint cr-hint">${icon('at')} ${bx(lng('الوكلاء مش بيقروا ولا بيردّوا غير لما حد يناديهم باسمهم، زي @Critic. أي عضو في القناة يقدر ينادي وكلاءها هنا، حتى لو الوكيل مش ظاهر له برّه القناة. وأي نشر أو صرف أو رسالة لعميل بيتسلّم لحد من الفريق.', 'Agents read and reply only when someone calls them by name, like @Critic. Any member of the channel can call its agents here, even an agent hidden from them elsewhere. Anything that publishes, spends or messages a customer is handed to someone on the team.'))}</p>
    </div>
    <footer class="modal__foot modal__foot--end"><button type="button" class="btn btn--secondary" data-action="close-modal">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary" data-action="tm-create">${lng('اعمل القناة', 'Create the channel')}</button></footer>`;
}
function openTeamCreate(opener) {
  if (!canManage() || isSolo()) return;
  state.modal = { step: 'team', q: '', cat: 'all', opener: opener || null,
    draft: { name: 'إطلاق الدفعة الجديدة', people: [state.as].concat(['sara', 'youssef'].filter((p) => p !== state.as && inWs(p))), members: ['ads', 'critic'].filter((a) => chanAgentsPool().includes(a)), nameErr: false } };
  renderModal();
  const dlg = $('#modal'); dlg.classList.remove('is-closing');
  if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
  window.requestAnimationFrame(() => { const n = $('#tm-name'); if (n) { n.focus(); n.select(); } });
}
function createTeam() {
  const m = state.modal; if (!m || m.step !== 'team' || !canManage()) return;
  const D = m.draft; const nm = D.name.trim().replace(/^#+/, '').trim();
  if (!nm || Object.values(threads).some((x) => x.channel && x.title === nm)) { D.nameErr = nm ? 'dup' : true; renderModal(); const f = $('#tm-name'); if (f) f.focus(); return; }
  const people = roster().filter((p) => D.people.includes(p) || p === state.as);
  const ags = AGENT_ORDER.filter((a) => D.members.includes(a));
  const id = nid('ch');
  threads[id] = { id, channel: true, ws: state.world, agent: ags[0] || state.main, team: ags, people, title: nm, time: nowTime(), day: 0, ts: ++tsSeq, card: null, unread: {}, msgs: [] };
  logAuto(ME(), meAct('عمل قناة', 'عملت قناة', 'created the channel'), { chan: id, obj: `#${nm}`, to: `${memberNames(people)}${ags.length ? ` · ${namesOf(ags)}` : ''}` });
  closeModal();
  if ($('#sheet').open) closeSheet();
  state.chatThread = id; state.teamAdding = false; state.chAddingPerson = false;
  setView('chat', { focusComposer: true });
  toast(`${lng('القناة اتعملت ·', 'Channel created ·')} ${people.length} ${lng('أعضاء و', 'members and')} ${ags.length} ${lng('وكلاء', 'agents')}`, 'hash');
}
function openGallery(opener) {
  state.modal = { step: 'gallery', q: '', cat: 'all', tpl: null, from: 'gallery', draft: null, opener: opener || null };
  renderModal();
  const dlg = $('#modal'); dlg.classList.remove('is-closing');
  if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }
  window.requestAnimationFrame(() => { const q = $('#tpl-q'); if (q) q.focus(); });
}
function openCreate(tplId, from, name) {
  const tp = tplId ? TEMPLATES.find((x) => x.id === tplId) : null;
  const m = state.modal || { q: '', cat: 'all' };
  state.modal = Object.assign(m, { step: 'create', tpl: tp ? tp.id : null, from,
    draft: { name: tp ? tp.name : (name || ''), look: tp ? Object.assign({}, tp.look) : { shape: 'calm', color: 'stone' }, kind: tp ? tp.kind : 'personal' } });
  renderModal();
  window.requestAnimationFrame(() => { const n = $('#cr-name'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
}
function closeModal() {
  const dlg = $('#modal'); if (!dlg.open) return;
  const finish = () => { dlg.classList.remove('is-closing'); if (dlg.open) dlg.close(); };
  if (reduced()) finish(); else { dlg.classList.add('is-closing'); window.setTimeout(finish, 190); }
}
function syncCreatePreview() {
  const m = state.modal; if (!m || m.step !== 'create') return;
  const nm = m.draft.name.trim();
  const pv = $('#cr-preview'); if (pv) pv.innerHTML = `${lookFace(m.draft.look, 72, nm || lng('الوكيل الجديد', 'New agent'))}<bdi class="cr-handle" id="cr-handle">${nm ? esc(handleFor(nm)) : '@…'}</bdi>`;
}
function createAgent() {
  const m = state.modal; if (!m || m.step !== 'create') return;
  const D = m.draft; const nm = D.name.trim(); const inp = $('#cr-name'); const err = $('#cr-name-err');
  const fail = (msg) => { if (err) { err.textContent = msg; err.hidden = false; } if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); } };
  if (!nm) { fail(lng('الوكيل محتاج اسم، ولو كلمة واحدة.', 'The agent needs a name, even one word.')); return; }
  if (!isOwner()) return;
  if (AGENT_ORDER.some((k) => AGENTS[k].name.toLowerCase() === nm.toLowerCase() || AGENTS[k].handle.toLowerCase() === handleFor(nm).toLowerCase())) { fail(lng('فيه وكيل بالاسم ده. اختار اسم تاني.', 'There’s already an agent with this name. Pick another one.')); return; }
  const tp = m.tpl ? TEMPLATES.find((x) => x.id === m.tpl) : null;
  const id = nid('ag');
  const conns = tp ? tp.conns.slice() : [];
  AGENTS[id] = {
    name: nm, handle: handleFor(nm), role: tp ? tp.role : '', custom: true, kind: D.kind, tpl: tp ? tp.id : null,
    desc: tp ? `${tp.line}${tp.handoff ? ' ' + tp.handoff : ''}` : '',
    line: tp ? tp.line : '', handoff: tp ? tp.handoff || '' : '', reply: tp ? tp.reply : '', routineEx: tp ? tp.routineEx : '',
    example: tp ? tp.example : 'قولي هتساعدني في إيه، وإيه الأدوات اللي محتاجها',
    conns, routines: [], files: [], perms: [], memory: [],
    model: state.defModel || 'Opus 5.5', effort: state.defEffort || 'medium', instr: '', paused: false,
    voiceLang: 'ar-EG', voice: 'noor', voiceSpeed: '1',
    skills: tp ? tp.skills.map(([t, d]) => ({ t, d, on: true })) : [],
    toolsOn: Object.fromEntries(conns.map((k) => [k, true])),
  };
  FACES[id] = lookFill(D.look);
  AGENT_ORDER.push(id);
  VOICE_SAMPLE[id] = AGENTS[id].example;
  closeModal();
  state.chatThread = null; state.newChatAgent = id; state.dpSettings = false; state.dpTab = 'activity';
  setView('chat', { focusComposer: true });
  const tileEl = $(`[data-action="open-agent"][data-agent="${id}"]`);
  if (tileEl) { tileEl.classList.add('is-flash'); window.setTimeout(() => tileEl.classList.remove('is-flash'), 1500); }
  toast(`${nm} ${lng('اتضاف للفريق ·', 'joined the team ·')} ${KIND_TXT[D.kind]}`);
}

/* ================= events ================= */
/* mic: press and hold = dictate until release; a quick click = start, click again to finish */
let micPress = null; let micSkipClick = false;
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('[data-action="mic"]');
  if (!b || e.button > 0) return;
  const key = b.dataset.key;
  if (recs[key]) { micPress = null; micSkipClick = false; return; } // recording: the click finishes it
  micPress = { key, t: Date.now() }; micSkipClick = true;
  startMic(key, 'press');
  window.setTimeout(() => { if (micPress && micPress.key === key && recs[key]) { recs[key].mode = 'hold'; syncMic(key); } }, 400);
});
document.addEventListener('pointerup', () => {
  if (!micPress) return;
  const { key, t } = micPress; micPress = null;
  const r = recs[key];
  if (r) { if (Date.now() - t > 400) stopMic(key, true); else { r.mode = 'click'; syncMic(key); } }
  window.setTimeout(() => { micSkipClick = false; }, 0);
});
document.addEventListener('pointercancel', () => {
  if (!micPress) return;
  const { key } = micPress; micPress = null; micSkipClick = false;
  stopMic(key, false);
});
document.addEventListener('change', (e) => {
  /* the voice picker: a new voice resets the preview */
  if (e.target.id === 'set-voice' || e.target.id === 'set-voice-lang') {
    if (state.voicePlaying) { window.clearTimeout(state.voicePlaying.timer); state.voicePlaying = null; }
    renderDetails();
  }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!e.target.closest('[data-plus-menu]') && !e.target.closest('[data-action="plus-menu"]')) {
    $$('[data-plus-menu]').forEach((m) => { if (!m.hidden) closePlus(m.dataset.plusMenu); });
  }
  /* the settings menu closes on any click outside it, and after any of its own actions */
  if (!e.target.closest('#btn-me') && (!e.target.closest('#me-menu') || (el && el.closest('#me-menu') && el.dataset.action !== 'set-lang'))) closeMeMenu(false);
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'me-menu': if (!closeMeMenu(true)) openMeMenu(); break;
    case 'set-lang': if (d.lang === LANG) closeMeMenu(true); else applyLang(d.lang); break;
    case 'nav': if ($('#sheet').open) closeSheet(); setView(d.view); break;
    case 'new-chat': state.chatThread = null; setView('chat', { focusComposer: true }); break;
    case 'new-agent': openLeadForAgent(); break;
    case 'open-gallery-alt': openGallery($('[data-action="new-agent"]') || el); break;
    case 'close-modal': closeModal(); break;
    case 'tpl-cat': {
      state.modal.cat = d.cat; renderModal();
      const b = $(`[data-action="tpl-cat"][data-cat="${d.cat}"]`); if (b) b.focus(); break;
    }
    case 'tpl-clear': { state.modal.q = ''; const q = $('#tpl-q'); if (q) { q.value = ''; q.focus(); } $('#tpl-grid').innerHTML = tplGridHTML(); break; }
    case 'tpl-add': askLeadTpl(d.tpl); break;
    case 'tpl-scratch': askLeadTpl(null); break;
    case 'tpl-back': {
      const back = state.modal.tpl; state.modal.step = 'gallery'; renderModal();
      const b = back ? $(`[data-action="tpl-add"][data-tpl="${back}"]`) : $('[data-action="tpl-scratch"]'); if (b) b.focus(); break;
    }
    case 'cr-shape': state.modal.draft.look.shape = d.shape; renderModal(); { const b = $(`#cr-shape-${d.shape}`); if (b) b.focus(); } break;
    case 'cr-color': state.modal.draft.look.color = d.color; renderModal(); { const b = $(`#cr-color-${d.color}`); if (b) b.focus(); } break;
    case 'cr-kind': state.modal.draft.kind = d.kind; renderModal(); { const b = $(`#cr-kind-${d.kind}`); if (b) b.focus(); } break;
    case 'cr-create': createAgent(); break;
    case 'run-routine': runRoutine(d.agent, Number(d.idx)); break;
    case 'show-routines': showRoutines(d.agent); break;
    case 'routine-example': {
      if (state.view !== 'chat') setView('chat');
      if (overlayDetails()) { $('#details').classList.remove('is-open'); syncDetailsVisibility(); syncScrim(); }
      const ta = $('#ta-main'); if (ta) { ta.value = d.text; syncComposer('main'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      break;
    }
    case 'set-checkin': {
      const D = draftOf(detailsAgent()); D.checkinOn = !D.checkinOn; renderDetails(); { const b = $('#set-ck-on'); if (b) b.focus(); } break;
    }
    case 'checkin-settings': {
      state.dpSettings = true; state.dpConfirm = null;
      if (overlayDetails()) { const det = $('#details'); det.hidden = false; det.classList.add('is-open'); syncScrim(); }
      else state.detailsOpen = true;
      renderDetails(); syncDetailsVisibility();
      const sec = $('#set-checkin'); if (sec) scrollInPanel(sec);
      const t = $('#set-ck-time'); const sw = $('#set-ck-on'); if (t && !t.disabled) t.focus({ preventScroll: true }); else if (sw) sw.focus({ preventScroll: true });
      break;
    }
    case 'copy-handoff': {
      const txt = HANDOFF.msg;
      try { if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {}); } catch (err) { /* clipboard blocked in the preview */ }
      toast(lng('الرسالة اتنسخت. ابعتها من رقم الأكاديمية على واتساب', 'Message copied. Send it from the academy number on WhatsApp'), 'copy'); break;
    }
    case 'handoff-done': {
      state.handoff = { done: true, at: nowTime(), by: me().first };
      logAuto(ME(), meAct('عملها', 'عملتها', 'did it'), { agent: 'ads', obj: HANDOFF.title, from: lng('اتسلّمتلك', 'Handed to you'), to: lng('اتبعتت لـ 38 ليد', 'Sent to 38 leads') });
      state.events.unshift({ agent: 'ads', t: `${me().first} ${lng('بعت عرض الدفعة الجديدة لـ 38 ليد على واتساب، وAds بيتابع الردود', 'sent the new-cohort offer to 38 leads on WhatsApp, and Ads is following the replies')}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
      refreshMounted(); rerenderAll();
      { const b = $('[data-action="checkin-settings"]'); if (b) b.focus({ preventScroll: true }); }
      toast(lng('تمام، اتسجّلت إنك بعتها. Ads هيتابع الردود', 'Got it, marked as sent. Ads will follow the replies')); break;
    }
    case 'open-thread': openThread(d.thread); break;
    case 'open-agent': {
      const th = sortedThreads().find((t) => t.agent === d.agent && !t.checkin && !t.team && threadVisible(t));
      if (th) openThread(th.id); else { state.chatThread = null; state.newChatAgent = d.agent; setView('chat', { focusComposer: true }); }
      break;
    }
    case 'toggle-search': {
      const box = $('#sb-search'); const open = box.hidden;
      box.hidden = !open; el.setAttribute('aria-expanded', String(open));
      if (open) $('#sb-q').focus(); else { state.sbQuery = ''; $('#sb-q').value = ''; renderThreadList(); }
      break;
    }
    case 'pick-new-agent': state.newChatAgent = d.agent; renderChat(); renderDetails(); renderSidebar(); { const b = $(`[data-action="pick-new-agent"][data-agent="${d.agent}"]`); if (b) b.focus(); } break;
    case 'suggest': { const ta = $('#ta-main'); if (ta) { ta.value = d.text; syncComposer('main'); ta.focus(); } break; }
    case 'toggle-steps': {
      const t = threads[d.thread]; const m = t && t.msgs.find((x) => x.id === d.msg);
      const host = el.closest('.transcript');
      if (m) { m.stepsOpen = !m.stepsOpen; m.stepsJust = m.stepsOpen ? Date.now() : 0; refreshThread(d.thread); const b = $(`[data-action="toggle-steps"][data-msg="${d.msg}"]`, host || document); if (b) b.focus(); }
      break;
    }
    case 'choose': chooseAngle(d.thread, d.msg, Number(d.idx)); break;
    case 'approve': decide(d.thread, d.msg, d.decision); break;
    case 'connect': connectTool(d.conn); break;
    case 'connect-later': {
      state.connLater[d.conn] = true; refreshMounted();
      const ta = $('#ta-main') || $('#ta-sheet'); if (ta) ta.focus();
      break;
    }
    case 'disconnect': {
      state.conns[d.conn] = 'missing'; state.connLater[d.conn] = false; renderDetails(); refreshMounted();
      toast(`${CONNS[d.conn].name} ${lng('اتفصل', 'disconnected')}`, 'x');
      const b = $('[data-action="manage-tools"]'); if (b) b.focus();
      break;
    }
    case 'send': send(d.key); break;
    case 'stop': {
      const tid = threadOfKey(d.key); stopRun(tid);
      const ta = $(`#ta-${d.key}`); if (ta) ta.focus();
      break;
    }
    case 'plus-team': closePlus(d.key); openTeamCreate($(`[data-action="plus-menu"][data-key="${d.key}"]`)); break;
    case 'tm-toggle': {
      const D = state.modal.draft; const i = D.members.indexOf(d.agent);
      if (i >= 0) D.members.splice(i, 1); else D.members.push(d.agent);
      if (D.members.length >= 2) D.err = false;
      renderModal(); { const b = $(`#tm-pick-${d.agent}`); if (b) b.focus(); } break;
    }
    case 'tm-create': createTeam(); break;
    case 'team-add-open': state.teamAdding = !state.teamAdding; renderDetails(); { const b = $('#tm-add-open'); if (b) b.focus(); } break;
    case 'team-add': teamAdd(d.agent); break;
    case 'team-remove': teamRemove(d.agent); break;
    case 'hand-done': handDone(d.thread, d.msg); break;
    case 'hand-open': toast(lng('في النسخة الحقيقية دي بتفتح المسودة على WordPress. انت اللي تدوس نشر', 'In the real product this opens the draft in WordPress. You press Publish'), 'open'); break;
    case 'mic-cancel': stopMic(d.key, false); break;
    case 'voice-preview': {
      const a = detailsAgent(); const D = draftOf(a);
      if (state.voicePlaying) { window.clearTimeout(state.voicePlaying.timer); state.voicePlaying = null; renderDetails(); break; }
      const ms = Math.round(3200 / Number(D.voiceSpeed || 1));
      state.voicePlaying = { a, timer: later(ms, () => { state.voicePlaying = null; if (state.dpSettings) renderDetails(); }) };
      renderDetails(); { const b = $('#set-voice-play'); if (b) b.focus(); } break;
    }
    case 'set-speed': {
      const D = draftOf(detailsAgent()); D.voiceSpeed = d.speed; renderDetails();
      { const b = $(`#set-speed-${SPEEDS.indexOf(d.speed)}`); if (b) b.focus(); } break;
    }
    case 'plus-menu': togglePlus(d.key); break;
    case 'plus-insert': closePlus(d.key); insertAtCaret(d.key, d.ins); break;
    case 'pop-pick': pickPop(d.key, Number(d.idx)); break;
    case 'attach': closePlus(d.key); state.fileTarget = { type: 'composer', key: d.key }; $('#file-input').click(); break;
    case 'unattach': {
      state.attach[d.key].splice(Number(d.idx), 1); syncFiles(d.key);
      const ta = $(`#ta-${d.key}`); if (ta) ta.focus();
      break;
    }
    case 'add-file': state.fileTarget = { type: 'agent', agent: d.agent }; $('#file-input').click(); break;
    case 'pick-model': {
      const ag = composerAgent(d.key);
      AGENTS[ag].model = d.model;
      if (state.drafts[ag]) state.drafts[ag].model = d.model;
      closePlus(d.key); { const ta = $(`#ta-${d.key}`); if (ta) ta.focus(); }
      renderDetails();
      toast(`${AGENTS[ag].name} ${lng('هيفكر بـ', 'will think with')} ${d.model}`); break;
    }
    case 'mic':
      if (micSkipClick) { micSkipClick = false; break; }
      if (recs[d.key]) stopMic(d.key, true); else startMic(d.key, 'click');
      break;
    case 'set-model': {
      draftOf(detailsAgent()).model = d.model; renderDetails();
      { const b = $(`#details [data-action="set-model"][data-model="${CSS.escape(d.model)}"]`); if (b) b.focus(); }
      break;
    }
    case 'set-effort': draftOf(detailsAgent()).effort = d.effort; renderDetails(); { const b = $(`#set-effort-${d.effort}`); if (b) b.focus(); } break;
    case 'set-tool': { const D = draftOf(detailsAgent()); D.tools[d.conn] = !D.tools[d.conn]; renderDetails(); { const b = $(`#set-tool-${d.conn}`); if (b) b.focus(); } break; }
    case 'set-skill': { const D = draftOf(detailsAgent()); const i = Number(d.idx); D.skills[i] = !D.skills[i]; renderDetails(); { const b = $(`#set-skill-${i}`); if (b) b.focus(); } break; }
    case 'save-settings': saveSettings(); break;
    case 'discard-settings': discardSettings(); break;
    case 'danger': {
      const a = detailsAgent(); const open = state.dpConfirm && state.dpConfirm.a === a && state.dpConfirm.kind === d.kind;
      state.dpConfirm = open ? null : { a, kind: d.kind }; renderDetails();
      const f = !open && d.kind === 'delete' ? $('#del-confirm') : !open ? $('#danger-pause-go') : $(`#danger-${d.kind}`); if (f) f.focus();
      break;
    }
    case 'danger-cancel': { const k = state.dpConfirm ? state.dpConfirm.kind : 'pause'; state.dpConfirm = null; renderDetails(); const b = $(`#danger-${k}`); if (b) b.focus(); break; }
    case 'danger-pause-go': {
      const a = detailsAgent(); AGENTS[a].paused = nowTime(); state.dpConfirm = null;
      logAuto(ME(), meAct('وقّف مؤقتاً', 'وقّفت مؤقتاً', 'paused'), { agent: a, obj: AGENTS[a].name, from: lng('شغال', 'Working'), to: lng('واقف مؤقتاً', 'Paused') });
      rerenderAll(); { const b = $('#danger-pause'); if (b) b.focus(); }
      toast(`${AGENTS[a].name} ${lng('وقف مؤقتاً، مش هيبدأ شغل جديد', 'is paused and won’t start new work')}`, 'x'); break;
    }
    case 'resume-agent': {
      const a = detailsAgent(); AGENTS[a].paused = false;
      logAuto(ME(), meAct('رجّع', 'رجّعت', 'resumed'), { agent: a, obj: AGENTS[a].name, from: lng('واقف مؤقتاً', 'Paused'), to: lng('شغال', 'Working') });
      rerenderAll(); { const b = $('#danger-pause'); if (b) b.focus(); }
      toast(`${AGENTS[a].name} ${lng('رجع يشتغل', 'is back to work')}`); break;
    }
    case 'danger-delete-go': {
      const a = detailsAgent(); state.dpConfirm = null; renderDetails();
      { const b = $('#danger-delete'); if (b) b.focus(); }
      toast(`${lng('ده نموذج، المسح مش شغال فيه.', 'This is a prototype, so deleting doesn’t work here.')} ${AGENTS[a].name} ${lng('لسه موجود', 'is still here')}`, 'x'); break;
    }
    case 'mem-add': state.memAdding = !state.memAdding; renderDetails(); { const i = $('#mem-new'); if (i) i.focus(); else { const b = $('[data-action="mem-add"]'); if (b) b.focus(); } } break;
    case 'mem-cancel': state.memAdding = false; renderDetails(); { const b = $('[data-action="mem-add"]'); if (b) b.focus(); } break;
    case 'mem-save': saveMemory(); break;
    case 'mem-edit': state.memEditing = d.mem; renderDetails(); { const t = $('#mem-edit-t'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } } break;
    case 'mem-edit-cancel': state.memEditing = null; renderDetails(); { const b = $(`[data-action="mem-edit"][data-mem="${d.mem}"]`); if (b) b.focus(); } break;
    case 'mem-edit-save': saveMemoryEdit(d.mem); break;
    case 'mem-forget': forgetMemory(d.mem); break;
    case 'mem-undo': undoForget(); break;
    case 'mem-clear': { state.memQuery = ''; const q = $('#mem-q'); if (q) { q.value = ''; q.focus(); } const l = $('#mem-list'); if (l) l.innerHTML = memListHTML(detailsAgent()); break; }
    case 'board-scroll': scrollBoard(d.dir); break;
    case 'toggle-details': {
      const det = $('#details');
      if (overlayDetails()) {
        det.hidden = false; det.classList.toggle('is-open'); syncScrim();
        if (det.classList.contains('is-open')) { const x = det.querySelector('[data-action="close-details"]'); if (x) x.focus(); }
      } else {
        state.detailsOpen = !state.detailsOpen;
      }
      syncDetailsVisibility();
      break;
    }
    case 'close-details': closeDetails(); break;
    case 'dp-settings': {
      if (state.dpSettings && isDirty(detailsAgent())) { nudgeSaveBar(); break; }
      state.dpSettings = !state.dpSettings; state.dpConfirm = null; renderDetails();
      const b = $('#details [data-action="dp-settings"]'); if (b) b.focus();
      break;
    }
    case 'dp-tab': state.dpTab = d.tab; state.memEditing = null; state.memAdding = false; renderDetails(); { const b = $(`#dp-tab-${d.tab}`); if (b) b.focus(); } break;
    case 'manage-tools': state.dpManageTools = !state.dpManageTools; renderDetails(); { const b = $('[data-action="manage-tools"]'); if (b) b.focus(); } break;
    case 'add-routine': state.dpAddingRoutine = !state.dpAddingRoutine; renderDetails(); { const i = $('#rt-new'); if (i) i.focus(); else { const b = $('[data-action="add-routine"]'); if (b) b.focus(); } } break;
    case 'cancel-routine': state.dpAddingRoutine = false; renderDetails(); { const b = $('[data-action="add-routine"]'); if (b) b.focus(); } break;
    case 'save-routine': saveRoutine(d.agent); break;
    case 'toggle-routine': {
      const r = AGENTS[d.agent].routines[Number(d.idx)]; r.on = !r.on;
      renderDetails(); { const b = $(`#details [data-action="toggle-routine"][data-agent="${d.agent}"][data-idx="${d.idx}"]`); if (b) b.focus(); }
      const nx = nextRun(r, true);
      toast(r.on ? `${lng('«', '“')}${r.t}${lng('» رجع يشتغل', '” is back on')}${nx ? ` ${lng('· المرة الجاية', '· next run')} ${nx}` : ''}` : `${lng('«', '“')}${r.t}${lng('» وقف لحد ما ترجّعه', '” is paused until you resume it')}`, r.on ? 'check' : 'x'); break;
    }
    case 'revoke': { const pr = AGENTS[d.agent].perms[Number(d.idx)]; AGENTS[d.agent].perms.splice(Number(d.idx), 1); if (pr) logAuto(ME(), meAct('لغى صلاحية', 'لغت صلاحية', 'revoked a permission'), { agent: d.agent, obj: pr.t, from: lng('دايمة', 'Standing'), to: lng('هيستأذن تاني', 'Will ask again') }); renderDetails(); toast(lng('الصلاحية اتلغت، الوكيل هيستأذنك تاني', 'Permission revoked. The agent will ask you again')); { const b = $('#details [data-action="dp-settings"]'); if (b) b.focus(); } break; }
    case 'show-on-board': {
      const cid = d.card; const c = cardById(cid);
      if (c && state.boardFilter !== 'all' && state.boardFilter !== c.agent) state.boardFilter = 'all';
      setView('board');
      const k = $(`[data-action="open-card"][data-card="${cid}"]`);
      if (k) { k.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); k.classList.add('is-flash'); k.focus({ preventScroll: true }); }
      break;
    }
    case 'filter': state.boardFilter = d.agent; renderBoard(); { const b = $(`[data-action="filter"][data-agent="${d.agent}"]`); if (b) b.focus(); } break;
    case 'add-idea': state.addingIdea = !state.addingIdea; renderBoard(); { const i = $('#idea-title'); if (i) i.focus(); else { const b = $('[data-action="add-idea"]'); if (b) b.focus(); } } break;
    case 'cancel-idea': state.addingIdea = false; renderBoard(); { const b = $('[data-action="add-idea"]'); if (b) b.focus(); } break;
    case 'save-idea': saveIdea(); break;
    case 'open-card': openSheet(d.card); break;
    case 'close-sheet': closeSheet(); break;
    case 'sheet-to-chat': { const c = cardById(state.sheetCard); if (c && c.thread) { const th = c.thread; state.sheetCard = null; const dlg = $('#sheet'); if (dlg.open) dlg.close(); openThread(th); } break; }
    case 'toggle-theme': {
      const dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      try { localStorage.setItem('gtm-theme-v2', dark ? 'dark' : 'light'); } catch (err) { /* storage blocked: keep in memory */ }
      renderSidebar(); $('#btn-theme').focus(); break;
    }
    case 'toggle-lang': applyLang(RTL ? 'en' : 'ar'); break;
    case 'open-sidebar': { const sb = $('#sidebar'); sb.classList.add('is-open'); el.setAttribute('aria-expanded', 'true'); syncScrim(); const f = $('#btn-search'); if (f) f.focus(); break; }
    case 'close-overlays': closeSidebar(); $('#details').classList.remove('is-open'); syncDetailsVisibility(); syncScrim(); break;
    default: break;
  }
});
$('#file-input').addEventListener('change', (e) => {
  const names = Array.from(e.target.files || []).map((f) => f.name);
  const tgt = state.fileTarget; e.target.value = ''; state.fileTarget = null;
  if (!names.length || !tgt) return;
  if (tgt.type === 'composer') {
    state.attach[tgt.key].push(...names); syncFiles(tgt.key);
    const ta = $(`#ta-${tgt.key}`); if (ta) ta.focus();
  } else {
    names.forEach((n) => AGENTS[tgt.agent].files.unshift({ n, d: `${lng('اتضاف دلوقتي · من', 'Added just now · from')} ${me().first}` }));
    renderDetails(); toast(names.length > 1 ? `${names.length} ${lng('ملفات اتضافوا', 'files added')}` : lng('الملف اتضاف', 'File added'));
    const b = $('[data-action="add-file"]'); if (b) b.focus();
  }
});
function saveIdea() {
  const inp = $('#idea-title'); const err = $('#idea-err'); if (!inp) return;
  const v = inp.value.trim();
  if (!v) { if (err) err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
  const ag = ($('#idea-agent') || {}).value || 'seo';
  const id = nid('c');
  cards.unshift({ id, col: 'ideas', title: v, agent: ag, chan: AGENTS[ag].role, due: '', thread: null, prog: `${lng('فكرة جديدة من', 'New idea from')} ${me().first}` });
  logAuto(ME(), meAct('ضاف فكرة', 'ضافت فكرة', 'added an idea'), { card: id, to: colName('ideas') });
  state.addingIdea = false; renderBoard(); renderSidebar();
  const k = $(`[data-action="open-card"][data-card="${id}"]`); if (k) { k.classList.add('is-flash'); k.focus(); }
  toast(lng('الفكرة اتضافت', 'Idea added'));
}
document.addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.ta;
  if (key) { syncComposer(key); updatePop(key); }
  if (e.target.id === 'sb-q') { state.sbQuery = e.target.value; renderThreadList(); }
  if (e.target.id === 'tpl-q' && state.modal) { state.modal.q = e.target.value; const g = $('#tpl-grid'); if (g) g.innerHTML = tplGridHTML(); }
  if (e.target.id === 'tm-name' && state.modal && state.modal.draft) {
    state.modal.draft.name = e.target.value;
    const h = $('#tm-name-hint'); if (h) h.innerHTML = chNameHint(e.target.value);
    if (e.target.value.trim()) { state.modal.draft.nameErr = false; const er = $('#tm-name-err'); if (er) er.hidden = true; e.target.removeAttribute('aria-invalid'); }
  }
  if (e.target.id === 'cr-name' && state.modal && state.modal.draft) {
    state.modal.draft.name = e.target.value; syncCreatePreview();
    if (e.target.value.trim()) { const err = $('#cr-name-err'); if (err) err.hidden = true; e.target.removeAttribute('aria-invalid'); }
  }
  if (e.target.id === 'idea-title' && e.target.value.trim()) { const err = $('#idea-err'); if (err) err.hidden = true; e.target.removeAttribute('aria-invalid'); }
  if (e.target.id === 'rt-new' && e.target.value.trim()) { const err = $('#rt-err'); if (err) err.hidden = true; e.target.removeAttribute('aria-invalid'); }
  const field = e.target.dataset && e.target.dataset.set;
  if (field) {
    const D = draftOf(detailsAgent()); D[field] = e.target.value;
    if (field === 'name') {
      const n = $('#dp-id-name'); if (n) n.textContent = e.target.value.trim() || AGENTS[detailsAgent()].name;
      if (e.target.value.trim()) { const err = $('#set-name-err'); if (err) err.hidden = true; e.target.removeAttribute('aria-invalid'); }
    }
    if (field === 'role') { const r = $('#dp-id-role'); if (r) r.textContent = e.target.value.trim() ? `${e.target.value.trim()} · ` : ''; }
    if (field === 'instr') { const c = $('#set-instr-count'); if (c) c.textContent = `${fmt(e.target.value.length)} / ${fmt(INSTR_MAX)}`; }
    syncSaveBar();
  }
  if (e.target.id === 'mem-q') { state.memQuery = e.target.value; const l = $('#mem-list'); if (l) l.innerHTML = memListHTML(detailsAgent()); }
  if ((e.target.id === 'mem-new' || e.target.id === 'mem-edit-t') && e.target.value.trim()) {
    const err = $(e.target.id === 'mem-new' ? '#mem-new-err' : '#mem-edit-err'); if (err) err.hidden = true; e.target.removeAttribute('aria-invalid');
  }
  if (e.target.id === 'del-confirm') { const go = $('#del-go'); if (go) go.disabled = e.target.value.trim() !== AGENTS[e.target.dataset.del].name; }
});
/* validate the name when the person leaves the field, not on every key */
document.addEventListener('focusout', (e) => {
  if (e.target.id !== 'set-name' || e.target.value.trim()) return;
  const err = $('#set-name-err'); if (err) err.hidden = false; e.target.setAttribute('aria-invalid', 'true');
});
document.addEventListener('keydown', (e) => {
  /* arrow keys inside the + menu */
  const menu = e.target.closest && e.target.closest('[data-plus-menu]');
  if (menu) {
    const items = $$('.menu__item', menu); const i = items.indexOf(e.target);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); return; }
    if (e.key === 'Home') { e.preventDefault(); items[0].focus(); return; }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenus(); return; }
    if (e.key === 'Tab') { closePlus(menu.dataset.plusMenu); return; }
  }
  /* arrow keys inside the workspace settings menu */
  const meMenu = e.target.closest && e.target.closest('#me-menu');
  if (meMenu) {
    const items = $$('.menu__item', meMenu); const i = items.indexOf(e.target);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); return; }
    if (e.key === 'Home') { e.preventDefault(); items[0].focus(); return; }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMeMenu(true); return; }
    if (e.key === 'Tab') { closeMeMenu(false); return; }
  }
  /* arrow keys across the details tabs */
  if (e.target.getAttribute && e.target.getAttribute('role') === 'tab' && e.target.closest('#details') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const order = ['activity', 'tasks', 'files', 'memory', 'log']; const i = order.indexOf(state.dpTab);
    const dir = (e.key === 'ArrowLeft') === RTL ? 1 : -1; // forward = left in Arabic, right in English
    state.dpTab = order[(i + dir + order.length) % order.length]; renderDetails();
    const b = $(`#dp-tab-${state.dpTab}`); if (b) b.focus(); e.preventDefault(); return;
  }
  /* effort: arrow keys move the choice (RTL: left = next level) */
  if (e.target.dataset && e.target.dataset.action === 'set-effort' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const ks = EFFORTS.map((x) => x.k); const D = draftOf(detailsAgent());
    const i = ks.indexOf(D.effort); const dir = (e.key === 'ArrowLeft') === RTL ? 1 : -1;
    D.effort = ks[Math.max(0, Math.min(ks.length - 1, i + dir))]; renderDetails();
    const b = $(`#set-effort-${D.effort}`); if (b) b.focus(); e.preventDefault(); return;
  }
  if (e.target.id === 'mem-new') {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveMemory(); }
    if (e.key === 'Escape') { e.preventDefault(); state.memAdding = false; renderDetails(); const b = $('[data-action="mem-add"]'); if (b) b.focus(); }
    return;
  }
  if (e.target.id === 'mem-edit-t') {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveMemoryEdit(e.target.dataset.mem); }
    if (e.key === 'Escape') { e.preventDefault(); const id = e.target.dataset.mem; state.memEditing = null; renderDetails(); const b = $(`[data-action="mem-edit"][data-mem="${id}"]`); if (b) b.focus(); }
    return;
  }
  if (e.target.id === 'mem-q' && e.key === 'Escape' && e.target.value) {
    e.preventDefault(); state.memQuery = ''; e.target.value = ''; const l = $('#mem-list'); if (l) l.innerHTML = memListHTML(detailsAgent()); return;
  }
  if (e.target.id === 'cr-name' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); createAgent(); return; }
  if (e.target.id === 'tm-name' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); createTeam(); return; }
  /* voice speed: arrow keys move the choice (RTL: left = faster) */
  if (e.target.dataset && e.target.dataset.action === 'set-speed' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const D = draftOf(detailsAgent()); const i = SPEEDS.indexOf(D.voiceSpeed); const dir = (e.key === 'ArrowLeft') === RTL ? 1 : -1;
    const ni = Math.max(0, Math.min(SPEEDS.length - 1, i + dir)); D.voiceSpeed = SPEEDS[ni]; renderDetails();
    const b = $(`#set-speed-${ni}`); if (b) b.focus(); e.preventDefault(); return;
  }
  if (e.target.dataset && /^cr-(shape|color|kind)$/.test(e.target.dataset.action || '') && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
    const grp = e.target.parentElement; const items = $$('[role="radio"]', grp); const i = items.indexOf(e.target);
    const dir = ((e.key === 'ArrowLeft') === RTL && e.key !== 'ArrowUp') || e.key === 'ArrowDown' ? 1 : -1; // forward = left in Arabic, right in English
    const nx = items[(i + dir + items.length) % items.length]; e.preventDefault(); nx.click(); return;
  }
  if (e.target.id === 'set-name' && e.key === 'Enter') { e.preventDefault(); if (isDirty(detailsAgent())) saveSettings(); return; }
  if (e.key === 'Escape') { const rk = Object.keys(recs)[0]; if (rk) { e.preventDefault(); stopMic(rk, false); return; } }
  const key = e.target.dataset && e.target.dataset.ta;
  if (key) {
    if (popState[key]) {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePop(key, 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); movePop(key, -1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickPop(key, popState[key].idx); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(key); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(key); }
    return;
  }
  if (e.target.id === 'idea-title') {
    if (e.key === 'Enter') { e.preventDefault(); saveIdea(); }
    if (e.key === 'Escape') { e.preventDefault(); state.addingIdea = false; renderBoard(); const b = $('[data-action="add-idea"]'); if (b) b.focus(); }
    return;
  }
  if (e.target.id === 'rt-new') {
    if (e.key === 'Enter') { e.preventDefault(); const s = $('[data-action="save-routine"]'); if (s) saveRoutine(s.dataset.agent); }
    if (e.key === 'Escape') { e.preventDefault(); state.dpAddingRoutine = false; renderDetails(); const b = $('[data-action="add-routine"]'); if (b) b.focus(); }
    return;
  }
  if (e.target.id === 'sb-q' && e.key === 'Escape') {
    e.preventDefault(); state.sbQuery = ''; e.target.value = ''; $('#sb-search').hidden = true; $('#btn-search').setAttribute('aria-expanded', 'false'); renderThreadList(); $('#btn-search').focus(); return;
  }
  if (e.key === 'Escape') {
    if (closeMenus()) return;
    if ($('#sidebar').classList.contains('is-open') || $('#details').classList.contains('is-open')) { closeSidebar(); $('#details').classList.remove('is-open'); syncDetailsVisibility(); syncScrim(); }
    return;
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if (!typing && canWrite() && !$('#sheet').open && !$('#modal').open && !$('#apps').open && !$('#viewer').open && !$('#preview').open && !$('#team').open && !$('#sov').open && (e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault(); state.chatThread = null; setView('chat', { focusComposer: true });
  }
});
document.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-action="period"]'); if (!opt) return;
  if (state.period === opt.dataset.p) return;
  state.period = opt.dataset.p; loadDashboard(380);
  window.requestAnimationFrame(() => { const b = $(`[data-action="period"][data-p="${state.period}"]`); if (b) b.focus(); });
});
window.addEventListener('resize', () => { if (state.view === 'chat') syncDetailsVisibility(); if (state.view === 'board') syncBoardNav(); });
document.addEventListener('scroll', (e) => { if (e.target && e.target.id === 'board-cols') syncBoardNav(); }, true);

/* live progress on cards being worked on */
window.setInterval(() => {
  cards.filter((c) => c.col === 'progress' && !c.screen && !(c.code && (c.code.tests.st === 'failed' || c.code.review.st === 'waiting'))).forEach((c) => { // screen cards move with the agent's screen; a code card stuck on a failed test or a review doesn't creep
    if (c.pct >= 96) return;
    c.pct = Math.min(96, c.pct + 2 + Math.floor(Math.random() * 4));
    if (Math.random() < 0.4) c.tick += 1;
    $$(`[data-prog-t="${c.id}"]`).forEach((n) => { n.innerHTML = `${bx(c.ticks[c.tick % c.ticks.length])} · <span class="num">${c.pct}%</span>`; });
    $$(`[data-prog-bar="${c.id}"]`).forEach((n) => { n.setAttribute('aria-valuenow', String(c.pct)); const f = n.firstElementChild; if (f) f.style.transform = `scaleX(${c.pct / 100})`; });
  });
}, 4000);

/* ================= agent screen: watch an agent work where there is no API (G43–G47, J06) =================
   The agent drives a browser on its own cloud screen (Meta Business Suite, TikTok Ads, Canva). The person can watch a
   thumbnail that refreshes every 4 s, open a large read-only live view, and take the wheel only after a per-session OK.
   A publish or pay step on screen stops right there and becomes «اتسلّمتلك». The screen itself is drawn in code. */
const SCR_TICK = 4000;
const SCR_STEP_EVERY = 2; // the agent moves one step every 2 refreshes
const SCR_TASKS = {
  retarget: {
    agent: 'ads', tool: 'meta', app: 'Meta Business Suite', url: 'business.facebook.com/latest/ads_manager', title: lng('تجديد إعادة الاستهداف لديسمبر', 'Renew retargeting for December'),
    thread: 'th-retarget', card: 'c-retarget',
    home: [lng('الإعلانات', 'Ads'), lng('18 ليد امبارح', '18 leads yesterday'), lng('27 ج لليد', 'EGP 27/lead'), lng('250 ج في اليوم', 'EGP 250/day')],
    list: [lng('الحملات', 'Campaigns'), lng('إعادة استهداف · نوفمبر', 'Retargeting · November')],
    aud: [lng('زوار صفحة المحاسب الشامل', 'المحاسب الشامل page visitors'), lng('آخر 30 يوم', 'Last 30 days'), lng('مصر', 'Egypt')],
    media: { ratio: '1', cap: 'من خريج تجارة لمحاسب شغال في 3 شهور' },
    budget: [[lng('في اليوم', 'Per day'), lng('250 ج', 'EGP 250')], [lng('المدة', 'Duration'), lng('6 أيام', '6 days')], [lng('الإجمالي', 'Total'), lng('1,500 ج', 'EGP 1,500')]],
    steps: [
      { t: lng('فتح Meta Business Suite على حساب RS Learning', 'Opened Meta Business Suite on the RS Learning account'), v: 'home' },
      { t: lng('نسخ حملة إعادة الاستهداف بتاعة نوفمبر', 'Copied November’s retargeting campaign'), v: 'list' },
      { t: lng('اختار جمهور زوار صفحة المحاسب الشامل آخر 30 يوم', 'Picked the audience of المحاسب الشامل page visitors, last 30 days'), v: 'audience' },
      { t: lng('رفع فيديو «من خريج لمحاسب شغال» بالنص اللي Critic وافق عليه', 'Uploaded the “من خريج لمحاسب شغال” video with the script Critic approved'), v: 'creative' },
      { t: lng('حط الميزانية 250 ج في اليوم لمدة 6 أيام', 'Set the budget to EGP 250/day for 6 days'), v: 'budget' },
      { t: lng('راجع شكل الإعلان على الموبايل', 'Checked the ad preview on mobile'), v: 'preview' },
      { t: lng('وصل لزرار «انشر» ووقف', 'Reached the “Publish” button and stopped'), v: 'publish', stop: true },
    ],
    hand: {
      say: 'وصلت لزرار «انشر» في Meta Business Suite ووقفت. النشر بيبدأ صرف فعلي، فالخطوة دي عليك:',
      title: lng('انشر حملة إعادة استهداف ديسمبر على Meta', 'Publish the December retargeting campaign on Meta'),
      sub: lng('Ads جهّزها على Meta Business Suite ووقف عند «انشر». الصرف بيبدأ لما انت تدوس.', 'Ads set it up in Meta Business Suite and stopped at “Publish”. Spend starts when you press it.'),
      rows: [[lng('الميزانية', 'Budget'), lng('1,500 ج · 250 ج في اليوم لمدة 6 أيام', 'EGP 1,500 · EGP 250/day for 6 days')], [lng('الجمهور', 'Audience'), lng('زوار صفحة المحاسب الشامل آخر 30 يوم', 'المحاسب الشامل page visitors, last 30 days')], [lng('الإعلان', 'Ad'), lng('فيديو «من خريج لمحاسب شغال» · 15 ثانية', '“من خريج لمحاسب شغال” video · 15 sec')]],
      wait: lng('اتسلّمتلك: انشر الحملة على Meta', 'Handed to you: publish the campaign on Meta'),
      event: lng('جهّز إعادة استهداف ديسمبر على Meta Business Suite ووقف عند «انشر»', 'Set up December retargeting in Meta Business Suite and stopped at “Publish”'),
      doneNote: lng('Ads هيتابع تكلفة الليد كل ساعة.', 'Ads will check cost per lead every hour.'),
      doneEvent: lng('سارة نشرت إعادة استهداف ديسمبر على Meta، وAds بيتابع تكلفة الليد', 'Sara published December retargeting on Meta, and Ads is tracking cost per lead'),
      live: lng('اتنشرت النهارده · 250 ج في اليوم', 'Published today · EGP 250/day'),
      after: 'شفتها لايف على Meta. هتابع تكلفة الليد كل ساعة، ولو عدّت 45 ج هوقف الإعلان وأقولك. وهبدأ دلوقتي نسخة TikTok من نفس الفيديو.',
      afterSteps: [{ tool: 'meta', label: lng('اتأكد إن الحملة لايف', 'Confirmed the campaign is live'), state: 'done' }],
    },
  },
  tiktok: {
    agent: 'ads', tool: 'tiktok', app: 'TikTok Ads', url: 'ads.tiktok.com/i18n/creation', title: lng('إعلان TikTok للمحاسب الشامل', 'TikTok ad for المحاسب الشامل'),
    thread: 'th-tiktok', card: 'c-tiktok', threadTitle: 'إعلان TikTok: المحاسب الشامل', cardTitle: 'إعلان TikTok: المحاسب الشامل', chan: 'TikTok',
    intro: 'هعمل نسخة TikTok من فيديو «من خريج لمحاسب شغال». إنشاء الإعلانات على TikTok Ads بشتغل عليه من شاشتي، وهقف قبل «انشر».',
    home: ['TikTok Ads Manager', lng('حساب RS Learning', 'RS Learning account'), lng('مصر', 'Egypt'), lng('ليدز', 'Leads')],
    list: [lng('الحملات', 'Campaigns'), 'المحاسب الشامل · ديسمبر'],
    aud: [lng('21–30 سنة', 'Age 21–30'), lng('مصر', 'Egypt'), lng('محاسبة وبيزنس', 'Accounting & business')],
    media: { ratio: '9 / 16', cap: 'اتخرجت تجارة ومش لاقي شغل؟ المحاسب الشامل بيبدأ 1 ديسمبر' },
    budget: [[lng('في اليوم', 'Per day'), lng('200 ج', 'EGP 200')], [lng('المدة', 'Duration'), lng('5 أيام', '5 days')], [lng('الإجمالي', 'Total'), lng('1,000 ج', 'EGP 1,000')]],
    steps: [
      { t: lng('فتح TikTok Ads Manager على حساب RS Learning', 'Opened TikTok Ads Manager on the RS Learning account'), v: 'home' },
      { t: lng('عمل حملة ليدز اسمها «المحاسب الشامل · ديسمبر»', 'Created a leads campaign called “المحاسب الشامل · ديسمبر”'), v: 'list' },
      { t: lng('اختار الجمهور: 21–30 سنة في مصر، مهتمين بالمحاسبة والبيزنس', 'Picked the audience: age 21–30 in Egypt, interested in accounting and business'), v: 'audience' },
      { t: lng('رفع الفيديو بمقاس 9:16 وكتب الكابشن بالعامية', 'Uploaded the 9:16 video and wrote a colloquial caption'), v: 'creative' },
      { t: lng('حط الميزانية 200 ج في اليوم لمدة 5 أيام', 'Set the budget to EGP 200/day for 5 days'), v: 'budget' },
      { t: lng('وصل لزرار «انشر» ووقف', 'Reached the “Publish” button and stopped'), v: 'publish', stop: true },
    ],
    hand: {
      say: 'الإعلان جاهز على TikTok Ads ووقفت عند «انشر». ده بيبدأ صرف، فالقرار عليك:',
      title: lng('انشر إعلان TikTok للمحاسب الشامل', 'Publish the TikTok ad for المحاسب الشامل'),
      sub: lng('Ads جهّزه على TikTok Ads ووقف عند «انشر». الصرف بيبدأ لما انت تدوس.', 'Ads set it up in TikTok Ads and stopped at “Publish”. Spend starts when you press it.'),
      rows: [[lng('الميزانية', 'Budget'), lng('1,000 ج · 200 ج في اليوم لمدة 5 أيام', 'EGP 1,000 · EGP 200/day for 5 days')], [lng('الجمهور', 'Audience'), lng('21–30 سنة في مصر · محاسبة وبيزنس', 'Age 21–30 in Egypt · accounting & business')], [lng('الإعلان', 'Ad'), lng('نفس الفيديو بمقاس 9:16 · 15 ثانية', 'Same video at 9:16 · 15 sec')]],
      wait: lng('اتسلّمتلك: انشر الإعلان على TikTok', 'Handed to you: publish the ad on TikTok'),
      event: lng('جهّز إعلان TikTok للمحاسب الشامل ووقف عند «انشر»', 'Set up the TikTok ad for المحاسب الشامل and stopped at “Publish”'),
      doneNote: lng('Ads هيقارن تكلفة الليد بـ Meta بعد يومين.', 'Ads will compare cost per lead with Meta in two days.'),
      doneEvent: lng('سارة نشرت إعلان TikTok للمحاسب الشامل', 'Sara published the TikTok ad for المحاسب الشامل'),
      live: lng('اتنشر النهارده · 200 ج في اليوم', 'Published today · EGP 200/day'),
      after: 'تمام، الإعلان لايف على TikTok. بعد يومين هقارن تكلفة الليد بـ Meta وأقولك نكمّل فين.',
      afterSteps: [{ tool: 'tiktok', label: lng('اتأكد إن الإعلان لايف', 'Confirmed the ad is live'), state: 'done' }],
    },
  },
  canva: {
    agent: 'seo', tool: 'canva', app: 'Canva', url: 'canva.com/design/blog-header', title: lng('صور مقال «كورس محاسب شامل اونلاين»', 'Images for the “كورس محاسب شامل اونلاين” article'),
    thread: 'th-canva', card: 'c-canva', threadTitle: 'صور المقال في Canva', cardTitle: 'صور مقال: كورس محاسب شامل اونلاين', chan: 'SEO',
    intro: 'هعمل 3 صور لمقال «كورس محاسب شامل اونلاين» على Canva. التصميم ده مفيهوش API، فبشتغل عليه من شاشتي، والصور هتتحفظ في ملفاتي.',
    home: [lng('التصميمات', 'Designs'), lng('قوالب المدونة', 'Blog templates'), '1200×630', 'RS Learning'],
    list: [lng('القوالب', 'Templates'), lng('صورة مدونة · 1200×630', 'Blog image · 1200×630')],
    canvas: ['كورس محاسب شامل أونلاين', 'المهارات التي تطلبها الشركات', 'أسئلة شائعة قبل التسجيل'],
    steps: [
      { t: lng('فتح Canva على حساب RS Learning', 'Opened Canva on the RS Learning account'), v: 'home' },
      { t: lng('اختار قالب صور المدونة بمقاس 1200×630', 'Picked the 1200×630 blog image template'), v: 'list' },
      { t: lng('كتب عنوان المقال وحط لوجو الأكاديمية', 'Wrote the article title and added the academy logo'), v: 'canvas' },
      { t: lng('عمل صورتين للعناوين الفرعية', 'Made 2 images for the subheadings'), v: 'canvas2' },
      { t: lng('نزّل 3 صور وحفظهم في ملفاته', 'Downloaded 3 images and saved them to its files'), v: 'save', end: true },
    ],
    end: {
      say: 'خلصت 3 صور للمقال وحفظتهم في ملفاتي في فولدر «صور». مفيش حاجة اتنشرت، وهحطهم في مسودة WordPress لما تنشر المقال.',
      event: lng('عمل 3 صور لمقال «كورس محاسب شامل اونلاين» على Canva وحفظهم في ملفاته', 'Made 3 images for the “كورس محاسب شامل اونلاين” article in Canva and saved them to its files'),
      prog: lng('3 صور في ملفات SEO', '3 images in SEO’s files'),
      toast: lng('SEO حفظ 3 صور في ملفاته', 'SEO saved 3 images to its files'),
      files: [
        { n: 'صورة-مقال-محاسب-شامل-1.svg', lines: ['كورس محاسب شامل أونلاين:', 'ماذا ستتعلم وأين ستعمل؟'] },
        { n: 'صورة-مقال-محاسب-شامل-2.svg', lines: ['المهارات التي', 'تطلبها الشركات'] },
        { n: 'صورة-مقال-محاسب-شامل-3.svg', lines: ['أسئلة شائعة', 'قبل التسجيل'] },
      ],
    },
  },
};
const SCREENS = {
  ads: { apps: ['Meta Business Suite', 'TikTok Ads'], state: 'awake', task: 'retarget', step: 2, n: 0, queue: ['tiktok'], mode: 'watch', hand: null, done: [], last: '' },
  seo: { apps: ['Canva'], state: 'asleep', task: null, step: 0, n: 0, queue: ['canva'], mode: 'watch', hand: null, done: [], last: lng('آخر شغل: صورة مقال «إزاي تبقى محاسب من البيت» · امبارح', 'Last job: article image “إزاي تبقى محاسب من البيت” · Yesterday') },
};
const scrPct = (T, step) => Math.round(8 + (step / (T.steps.length - 1)) * 84);
/* the thread and board card for the task already on Ads's screen when the page opens */
threads['th-retarget'] = {
  id: 'th-retarget', agent: 'ads', title: 'إعادة استهداف ديسمبر · Meta', time: lng('10:45 ص', '10:45 AM'), day: 0, ts: 700, card: 'c-retarget',
  msgs: [
    { id: 'rt1', role: 'user', time: lng('10:44 ص', '10:44 AM'), text: '@Ads جدّد إعادة الاستهداف لشهر ديسمبر بنفس الـ 250 ج في اليوم، وحط فيديو «من خريج لمحاسب شغال».' },
    { id: 'rt2', role: 'agent', agent: 'ads', time: lng('10:45 ص', '10:45 AM'), text: 'تمام. إنشاء الحملة في Meta Business Suite مفيهوش API للجزء ده، فهشتغل عليه من شاشتي. تقدر تتفرج من «شاشة الوكيل» في التفاصيل، وهقف قبل «انشر» وأسلّمهولك.',
      steps: [{ tool: 'meta', label: lng('قرا نتايج إعادة الاستهداف في نوفمبر', 'Read November retargeting results'), state: 'done' }], stepsDur: lng('12 ثانية', '12 sec') },
  ],
};
cards.push({ id: 'c-retarget', col: 'progress', title: 'إعادة استهداف ديسمبر · Meta', agent: 'ads', chan: 'Meta', due: lng('12 نوفمبر', 'Nov 12'), thread: 'th-retarget',
  pct: scrPct(SCR_TASKS.retarget, 2), ticks: [SCR_TASKS.retarget.steps[2].t], tick: 0, screen: true, touched: ['ads', 'critic'] });

const handCardOf = (s) => (s.hand && threads[s.hand.thread] ? (threads[s.hand.thread].msgs.find((x) => x.id === s.hand.msg) || {}).card : null);
function scrLine(a) {
  const s = SCREENS[a]; const T = s.task ? SCR_TASKS[s.task] : null;
  if (s.state === 'asleep') return s.last || lng('نايم · بيصحى لوحده لما يبقى عنده شغل', 'Asleep · wakes up on its own when it has work');
  if (s.state === 'waking') return lng('بيصحى وبيفتح المتصفح…', 'Waking up and opening the browser…');
  if (!T) return lng('خلص شغله · هينام لو محدش بيتفرج', 'Finished its work · will sleep if nobody is watching');
  if (s.mode === 'control') return `${lng('الدفة معاك ·', 'You have control ·')} ${AGENTS[a].name} ${lng('واقف مكانه', 'is holding still')}`;
  if (s.hand) return `${lng('وقف عند «انشر» في', 'Stopped at “Publish” in')} ${T.app} ${lng('· اتسلّمتلك', '· handed to you')}`;
  return T.steps[s.step].t;
}
function scrStatusHTML(a) {
  const s = SCREENS[a];
  if (s.state === 'asleep') return lng('<span class="scr-st"><span class="dot dot--idle" aria-hidden="true"></span>نايم</span>', '<span class="scr-st"><span class="dot dot--idle" aria-hidden="true"></span>Asleep</span>');
  if (s.state === 'waking') return lng('<span class="scr-st"><span class="dot dot--waking" aria-hidden="true"></span>بيصحى</span>', '<span class="scr-st"><span class="dot dot--waking" aria-hidden="true"></span>Waking up</span>');
  if (s.hand) return lng('<span class="scr-st scr-st--wait"><span class="dot dot--waiting" aria-hidden="true"></span>صاحي · مستنيك</span>', '<span class="scr-st scr-st--wait"><span class="dot dot--waiting" aria-hidden="true"></span>Awake · waiting on you</span>');
  return `<span class="scr-st"><span class="dot ${s.task ? 'dot--working' : 'dot--idle'}" aria-hidden="true"></span>${lng('صاحي', 'Awake')}</span>`;
}
/* cursor targets per screen view, in % of the screen (x from the left, y from the top) */
const SCR_CUR = { home: [46, 44], list: [36, 41], audience: [44, 46], creative: [30, 58], budget: [50, 52], preview: [44, 60], publish: [9, 89], canvas: [40, 48], canvas2: [22, 50], save: [52, 62] };
const SCR_JIT = [[0, 0], [3, -2], [-2, 3], [2, 2]];
function scrView(a) { const s = SCREENS[a]; const T = s.task ? SCR_TASKS[s.task] : null; return T ? T.steps[s.step].v : null; }
function scrCursor(a) {
  const s = SCREENS[a]; const v = scrView(a); if (!v || s.state !== 'awake' || s.mode === 'control') return null; // the person holds the mouse: no agent cursor
  const base = SCR_CUR[v] || [50, 50]; const j = s.hand || s.mode === 'control' ? [0, 0] : SCR_JIT[s.n % SCR_JIT.length];
  return [base[0] + j[0], base[1] + j[1]];
}
function scrKey(a) {
  const s = SCREENS[a];
  if (s.state !== 'awake') return s.state;
  if (!s.task) return 'idle';
  return `${s.task}:${s.step}:${s.mode === 'control' ? 'c' : 'w'}:${s.hand ? 'h' : ''}`;
}
const sl = (w) => `<i class="scr__ln" style="--w:${w}%"></i>`;
const stx = (t, c) => `<span class="scr__tx${c ? ' ' + c : ''}">${bx(t)}</span>`;
const SCR_PLAY = '<svg class="scr__play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
function scrViewHTML(a, T, v, live) {
  const s = SCREENS[a];
  switch (v) {
    case 'home':
      return `${stx(T.home[0], 'scr__tx--h')}<div class="scr__kpis">${T.home.slice(1).map((k) => `<span class="scr__kpi">${stx(k)}${sl(55)}</span>`).join('')}</div>${sl(92)}${sl(78)}${sl(86)}${sl(62)}`;
    case 'list':
      return `${stx(T.list[0], 'scr__tx--h')}<div class="scr__rows">${[0, 1, 2, 3].map((i) => `<span class="scr__row${i === 1 ? ' is-on' : ''}"><i class="scr__box"></i>${i === 1 ? stx(T.list[1]) : sl(38 + ((i * 17) % 30))}${i === 1 ? lng('<span class="scr__btn">نسخ</span>', '<span class="scr__btn">Duplicate</span>') : ''}</span>`).join('')}</div>`;
    case 'audience':
      return `${stx(lng('الجمهور', 'Audience'), 'scr__tx--h')}<div class="scr__pills">${T.aud.map((p) => `<span class="scr__pill">${bx(p)}</span>`).join('')}</div>${stx(lng('حجم الجمهور التقريبي', 'Estimated audience size'), 'scr__tx--l')}<i class="scr__meter"><i></i></i>${sl(72)}${sl(54)}`;
    case 'creative':
      return `${stx(lng('الإعلان', 'Ad'), 'scr__tx--h')}<div class="scr__split"><span class="scr__media" style="--ratio:${T.media.ratio}">${SCR_PLAY}</span>
        <span class="scr__fields"><span class="scr__field">${stx(lng('النص الأساسي', 'Primary text'), 'scr__tx--l')}<span class="scr__input scr__input--multi">${bx(T.media.cap)}</span></span>
        <span class="scr__field">${stx(lng('الزرار', 'Button'), 'scr__tx--l')}<span class="scr__input">${lng('ابعت رسالة', 'Send message')}</span></span></span></div>`;
    case 'budget':
      return `${stx(lng('الميزانية والمدة', 'Budget & schedule'), 'scr__tx--h')}<span class="scr__fields">${T.budget.map(([l, val]) => `<span class="scr__field">${stx(l, 'scr__tx--l')}<span class="scr__input">${bx(val)}</span></span>`).join('')}</span>${sl(46)}`;
    case 'preview':
      return `${stx(lng('المعاينة على الموبايل', 'Mobile preview'), 'scr__tx--h')}<span class="scr__phone"><span class="scr__media" style="--ratio:1">${SCR_PLAY}</span>${sl(90)}${sl(66)}<span class="scr__btn">${lng('ابعت رسالة', 'Send message')}</span></span>`;
    case 'publish': {
      const pub = live
        ? `<button type="button" class="scr__btn scr__btn--ink is-held" data-action="scr-publish" data-agent="${a}">${lng('انشر', 'Publish')}</button>`
        : `<span class="scr__btn scr__btn--ink${s.hand ? ' is-held' : ''}">${lng('انشر', 'Publish')}</span>`;
      return `${stx(lng('مراجعة قبل النشر', 'Review before publishing'), 'scr__tx--h')}<span class="scr__fields">${T.hand.rows.map(([l, val]) => `<span class="scr__field scr__field--row">${stx(l, 'scr__tx--l')}${stx(val)}</span>`).join('')}</span>
        <span class="scr__acts"><span class="scr__btn">${lng('رجوع', 'Back')}</span>${pub}</span>`;
    }
    case 'canvas':
      return `<span class="scr__canvas">${stx(T.canvas[0], 'scr__tx--c')}<span class="scr__mark"><bdi>RS Learning</bdi></span></span>${sl(42)}`;
    case 'canvas2':
      return `${stx(lng('صفحات التصميم', 'Design pages'), 'scr__tx--h')}<span class="scr__trio">${T.canvas.map((c, i) => `<span class="scr__canvas scr__canvas--sm${i === 2 ? ' is-on' : ''}">${stx(c, 'scr__tx--c')}</span>`).join('')}</span>${sl(56)}`;
    case 'save':
      return `${stx(lng('اتنزّلوا', 'Downloaded'), 'scr__tx--h')}<span class="scr__trio">${T.canvas.map((c) => `<span class="scr__canvas scr__canvas--sm">${stx(c, 'scr__tx--c')}<i class="scr__ok">${icon('check')}</i></span>`).join('')}</span>${sl(56)}`;
    default: return '';
  }
}
function scrScreenHTML(a, lg) {
  const s = SCREENS[a]; const T = s.task ? SCR_TASKS[s.task] : null;
  const live = !!(lg && s.mode === 'control' && s.hand);
  let body; let url = '';
  if (s.state === 'asleep') body = `<span class="scr__off">${icon('moon')}<span>${lng('الشاشة نايمة', 'Screen is asleep')}</span></span>`;
  else if (s.state === 'waking') body = `<span class="scr__off scr__off--waking"><span class="scr__wake">${sl(70)}${sl(48)}${sl(60)}</span><span>${lng('بيصحى…', 'Waking up…')}</span></span>`;
  else if (!T) { url = 'about:blank'; body = `<span class="scr__off">${icon('check')}<span>${lng('مفيش شغل مفتوح', 'No open work')}</span></span>`; }
  else {
    url = T.url;
    body = `<span class="scr__side"><i class="scr__logo"></i>${sl(80)}${sl(62)}${sl(72)}${sl(54)}</span><span class="scr__main">${scrViewHTML(a, T, T.steps[s.step].v, live)}</span>`;
  }
  const c = scrCursor(a);
  return `<div class="scr${lg ? ' scr--lg' : ''}${s.state !== 'awake' ? ' is-off' : ''}${s.mode === 'control' ? ' is-control' : ''}" data-scr="${a}" data-scr-key="${scrKey(a)}"${live ? '' : ' aria-hidden="true"'}>
    <span class="scr__bar"><span class="scr__dots"><i></i><i></i><i></i></span><span class="scr__url" dir="ltr">${esc(url)}</span></span>
    <span class="scr__body">${body}</span>
    ${c ? `<span class="scr__layer" dir="ltr"><svg class="scr__cursor" style="--x:${c[0]};--y:${c[1]}" viewBox="0 0 16 22" aria-hidden="true"><path d="M2 2v15.5l4.3-3.9 2.8 6.4 2.7-1.2-2.8-6.3H15z" fill="var(--text-1)" stroke="var(--bg-pane)" stroke-width="1.4" stroke-linejoin="round"/></svg></span>` : ''}
  </div>`;
}
/* the card at the top of the details «نشاط» tab (only for agents that work on a screen):
   just the screen. Hover or keyboard focus reveals the one action (اتفرج / صحّيه) and the current step. */
function screenSecHTML(a) {
  const s = SCREENS[a]; if (!s) return '';
  const asleep = s.state === 'asleep'; const waking = s.state === 'waking';
  const can = !(asleep && !canWrite());
  const act = asleep ? 'scr-wake' : waking ? 'scr-wake' : 'scr-watch';
  const pill = asleep ? `${icon('sun')}<span>${lng('صحّيه', 'Wake it')}</span>`
    : waking ? `<span>${lng('بيصحى…', 'Waking up…')}</span>`
    : `${icon('eye')}<span>${lng('اتفرج', 'Watch')}</span>`;
  const ov = `<span class="scr-ov" aria-hidden="${can ? 'false' : 'true'}">
        ${can ? `<span class="scr-ov__pill">${pill}</span>` : ''}
        <span class="scr-ov__line" data-scr-line="${a}">${bx(scrLine(a))}</span></span>`;
  const shot = can
    ? `<button type="button" class="scr-thumb" id="scr-act-${a}" data-action="${act}" data-agent="${a}"${waking ? ' aria-disabled="true"' : ''}${act === 'scr-watch' ? ' aria-haspopup="dialog"' : ''}>${scrScreenHTML(a, false)}${ov}</button>`
    : `<div class="scr-thumb is-static">${scrScreenHTML(a, false)}${ov}</div>`;
  return `<section class="dp-sec" aria-labelledby="scr-h-${a}"><h3 class="dp-label"><span id="scr-h-${a}">${lng('شاشة الوكيل', 'Agent’s screen')}</span>${scrStatusHTML(a)}</h3>
    <div class="scr-card" data-agent="${a}">${shot}</div></section>`;
}
function scrLogHTML(a) {
  const s = SCREENS[a]; const T = s.task ? SCR_TASKS[s.task] : null;
  if (!T) {
    return s.done.length ? s.done.map((x) => `<li class="vw-step is-done"><span class="vw-step__m" aria-hidden="true">${icon('check')}</span><span>${bx(x.t)} · <span class="num">${esc(x.at)}</span></span></li>`).join('')
      : lng('<li class="vw-step"><span class="vw-step__m" aria-hidden="true"><span class="vw-step__ring"></span></span><span>مفيش شغل خلص على الشاشة النهارده</span></li>', '<li class="vw-step"><span class="vw-step__m" aria-hidden="true"><span class="vw-step__ring"></span></span><span>No work finished on the screen today</span></li>');
  }
  return T.steps.map((st, i) => {
    const cls = i < s.step ? ' is-done' : i === s.step ? ' is-now' : '';
    const mark = i < s.step ? icon('check') : i === s.step ? (s.hand || s.mode === 'control' ? icon('hand') : '<span class="dot dot--working"></span>') : '<span class="vw-step__ring"></span>';
    return `<li class="vw-step${cls}"${i === s.step ? ' aria-current="step"' : ''}><span class="vw-step__m" aria-hidden="true">${mark}</span><span>${bx(st.t)}${i === s.step && s.hand ? lng(' <span class="vw-step__wait">مستنيك</span>', ' <span class="vw-step__wait">Waiting on you</span>') : ''}</span></li>`;
  }).join('');
}
/* refresh: patch the thumbnails in place (the cursor glides), or re-render the card and viewer on a state change */
function scrPatch(a) {
  $$(`[data-scr="${a}"]`).forEach((el) => {
    if (el.dataset.scrKey !== scrKey(a)) { el.outerHTML = scrScreenHTML(a, el.classList.contains('scr--lg')); return; }
    const cur = $('.scr__cursor', el); const c = scrCursor(a);
    if (cur && c) { cur.style.setProperty('--x', c[0]); cur.style.setProperty('--y', c[1]); }
  });
  $$(`[data-scr-line="${a}"]`).forEach((n) => { n.innerHTML = bx(scrLine(a)); });
  const log = $(`#vw-log[data-agent="${a}"]`); if (log) log.innerHTML = scrLogHTML(a);
}
function scrRefresh(a, full) {
  if (full) {
    if ($(`#details .scr-card[data-agent="${a}"]`)) renderDetails();
    if (state.viewer && state.viewer.a === a) renderViewer();
  }
  scrPatch(a);
}
function scrSyncCard(a) {
  const s = SCREENS[a]; const T = SCR_TASKS[s.task]; const c = cardById(T.card); if (!c || c.col !== 'progress') return;
  c.ticks = [T.steps[s.step].t]; c.tick = 0; c.pct = scrPct(T, s.step);
  $$(`[data-prog-t="${c.id}"]`).forEach((n) => { n.innerHTML = `${bx(c.ticks[0])} · <span class="num">${c.pct}%</span>`; });
  $$(`[data-prog-bar="${c.id}"]`).forEach((n) => { n.setAttribute('aria-valuenow', String(c.pct)); const f = n.firstElementChild; if (f) f.style.transform = `scaleX(${c.pct / 100})`; });
}
function scrStart(a) {
  const s = SCREENS[a];
  s.task = s.queue.shift() || null; s.step = 0; s.n = 0; s.hand = null;
  if (!s.task) return;
  const T = SCR_TASKS[s.task];
  if (!threads[T.thread]) {
    threads[T.thread] = { id: T.thread, agent: a, title: T.threadTitle, time: nowTime(), day: 0, ts: ++tsSeq, card: T.card,
      msgs: [{ id: nid('m'), role: 'agent', agent: a, time: nowTime(), text: T.intro }] };
  } else bump(threads[T.thread]);
  if (!cardById(T.card)) cards.push({ id: T.card, col: 'progress', title: T.cardTitle, agent: a, chan: T.chan, due: '', thread: T.thread, pct: scrPct(T, 0), ticks: [T.steps[0].t], tick: 0, screen: true });
  state.events.unshift({ agent: a, t: `${lng('بدأ يشتغل من شاشته على', 'Started working from its screen in')} ${T.app}: ${T.title}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  renderSidebar(); if (state.view === 'board') renderBoard();
}
function scrWake(a) {
  const s = SCREENS[a]; if (!s || s.state !== 'asleep') return;
  s.state = 'waking'; s.n = 0; scrRefresh(a, true);
  later(2400, () => {
    s.state = 'awake'; s.n = 0;
    if (!s.task) scrStart(a);
    scrRefresh(a, true);
    toast(lng(`شاشة ${AGENTS[a].name} صحيت`, `${AGENTS[a].name}’s screen is awake`), 'monitor');
  });
}
/* the agent reached «انشر» / «ادفع»: it stops and hands the step to the person (same «اتسلّمتلك» card as the chat) */
function scrHandOver(a) {
  const s = SCREENS[a]; const T = SCR_TASKS[s.task]; const H = T.hand; const t = threads[T.thread];
  const id = nid('h');
  t.msgs.push({ id, role: 'agent', agent: a, time: nowTime(), fresh: true, text: H.say,
    card: { type: 'hand', status: 'pending', tool: T.tool, screen: a, task: s.task, card: T.card, title: H.title, sub: H.sub, rows: H.rows, doneNote: H.doneNote } });
  bump(t);
  s.hand = { thread: T.thread, msg: id };
  moveCard(T.card, 'waiting', { wait: H.wait });
  state.events.unshift({ agent: a, t: H.event, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  refreshThread(T.thread); rerenderAll();
  if (state.viewer && state.viewer.a === a) renderViewer();
  scrPatch(a);
  toast(`${AGENTS[a].name} ${lng('وقف عند «انشر» وسلّمهولك', 'stopped at “Publish” and handed it to you')}`, 'hand', { action: 'open-thread', thread: T.thread, label: lng('افتح', 'Open') });
}
/* «عملتها» on a screen step (from the chat card, the board sheet or the viewer banner) */
function screenHandDone(threadId, m) {
  const t = threads[threadId]; const c = m.card; const a = c.screen; const s = SCREENS[a]; const T = SCR_TASKS[c.task]; const H = T.hand;
  c.status = 'done'; c.at = nowTime(); bump(t);
  if (s.hand && s.hand.msg === m.id) { s.hand = null; s.done.unshift({ t: T.title, at: c.at }); s.task = null; s.step = 0; s.n = 0; s.mode = 'watch'; }
  moveCard(T.card, 'live', { prog: H.live, wait: '' });
  state.events.unshift({ agent: a, t: H.doneEvent, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  refreshThread(threadId); rerenderAll();
  if (state.viewer && state.viewer.a === a) { renderViewer(); const f = $('#vw-close'); if (f && !$('#viewer').contains(document.activeElement)) f.focus(); }
  scrPatch(a);
  toast(`${lng('تمام، اتسجّل إنك نشرتها.', 'Got it, marked as published.')} ${AGENTS[a].name} ${lng('هيتابع', 'will follow up')}`);
  agentSays(threadId, a, { text: H.after, activity: [`${lng('بيفتح', 'Opening')} ${T.app}`, lng('بيتأكد إنها لايف', 'Checking it’s live')], steps: H.afterSteps, stepsDur: lng('8 ثواني', '8 sec') }, () => rerenderAll());
  /* after a beat the agent picks up the next task in its queue */
  later(SCR_TICK, () => { if (s.state === 'awake' && !s.task && s.queue.length) { scrStart(a); scrRefresh(a, true); } });
}
/* a task with no publish step (Canva images): it ends by saving files to the agent's library */
function scrFinish(a) {
  const s = SCREENS[a]; const T = SCR_TASKS[s.task]; const E = T.end;
  const L = libOf(a);
  E.files.forEach((f, i) => { L.images.unshift({ id: nid('f'), n: f.n, kind: 'image', w: 1200, h: 630, size: `${21 + i} KB`, at: `${lng('النهارده ·', 'Today ·')} ${nowTime()}`, d: lng('1200×630 · من Canva', '1200×630 · from Canva'), data: { tpl: 'blog', lines: f.lines }, alt: `${lng('صورة مقال:', 'Article image:')} ${f.lines.join(' ')}` }); });
  s.done.unshift({ t: T.title, at: nowTime() }); s.task = null; s.step = 0; s.n = 0;
  moveCard(T.card, 'done', { prog: E.prog });
  state.events.unshift({ agent: a, t: E.event, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  rerenderAll(); scrRefresh(a, true);
  toast(E.toast, 'image', { action: 'lib-show', thread: T.thread, label: lng('افتح الفولدر', 'Open the folder') });
  agentSays(T.thread, a, { text: E.say, activity: [lng('بينزّل الصور من Canva', 'Downloading the images from Canva'), lng('بيحفظهم في ملفاته', 'Saving them to its files')], steps: [{ tool: 'canva', label: lng('نزّل 3 صور بمقاس 1200×630', 'Downloaded 3 images at 1200×630'), state: 'done' }], stepsDur: lng('9 ثواني', '9 sec') }, () => rerenderAll());
}
window.setInterval(() => {
  Object.keys(SCREENS).forEach((a) => {
    const s = SCREENS[a];
    if (s.state !== 'awake') return;
    s.n += 1;
    if (!s.task) { // nothing to do: it sleeps after a while, unless someone is watching
      const watching = state.viewer && state.viewer.a === a;
      if (s.n >= 3 && !watching) { s.state = 'asleep'; s.mode = 'watch'; if (s.done.length) s.last = `${lng('آخر شغل:', 'Last job:')} ${s.done[0].t} · ${s.done[0].at}`; scrRefresh(a, true); }
      return;
    }
    if (s.mode === 'control' || s.hand || s.n % SCR_STEP_EVERY !== 0) { scrPatch(a); return; }
    const T = SCR_TASKS[s.task];
    if (T.steps[s.step].end) { scrFinish(a); return; }
    s.step += 1; scrSyncCard(a);
    if (T.steps[s.step].stop) { scrHandOver(a); return; }
    scrPatch(a);
  });
}, SCR_TICK);

/* ---- the large read-only live view ---- */
state.viewer = null;
function renderViewer() {
  const v = state.viewer; if (!v) return;
  const a = v.a; const s = SCREENS[a]; const A = AGENTS[a]; const T = s.task ? SCR_TASKS[s.task] : null;
  const dlg = $('#viewer'); const ae = document.activeElement; const fid = ae && ae.id && dlg.contains(ae) ? ae.id : null;
  const ctrl = s.mode === 'control';
  const running = s.state === 'awake' && !!T;
  const chip = ctrl ? `<span class="badge vw-chip vw-chip--ctrl">${icon('hand')}${lng('الدفة معاك', 'You have control')}</span>` : `<span class="badge vw-chip">${icon('eye')}${lng('بتتفرج', 'Watching')}</span>`;
  const sub = running ? `${T.app} · ${T.title}` : `${lng('بيشتغل من شاشته على', 'Works from its screen in')} ${s.apps.join(lng(' و', ' and '))}`;
  const hc = handCardOf(s);
  const banner = hc ? `<div class="vw-hand" role="group" aria-labelledby="vw-hand-t">
      <span class="badge ck-badge">${icon('hand')}${lng('اتسلّمتلك', 'Handed to you')}</span>
      <span class="vw-hand__t"><b id="vw-hand-t">${bx(hc.title)}</b><span>${bx(ctrl ? lng('الدفة معاك: دوس «انشر» على الشاشة بنفسك، وبعدها «عملتها».', 'You have control: press “Publish” on the screen yourself, then “Done it”.') : `${A.name} ${lng('وقف عند «انشر» ومداسش عليه. دوسها بنفسك من', 'stopped at “Publish” and didn’t press it. Press it yourself in')} ${T.app} ${lng('أو خد الدفة، وبعدها «عملتها».', 'or take control, then “Done it”.')}`)}</span></span>
      ${canWrite() ? `<button type="button" class="btn btn--primary" id="vw-done" data-action="hand-done" data-thread="${s.hand.thread}" data-msg="${s.hand.msg}">${lng('عملتها', 'Done it')}</button>` : ''}</div>` : '';
  const off = s.state === 'asleep' ? `<div class="vw-off"><p>${bx(`${lng('الشاشة بتنام بعد 20 دقيقة من غير شغل لو محدش بيتفرج، وبتصحى لوحدها لما يبقى عند', 'The screen goes to sleep after 20 idle minutes if nobody is watching, and wakes up on its own when')} ${A.name} ${lng('شغل.', 'has work.')}`)}</p>
      ${canWrite() ? `<button type="button" class="btn btn--primary" id="vw-wake" data-action="scr-wake" data-agent="${a}">${icon('sun')}<span>${lng('صحّيه', 'Wake it')}</span></button>` : ''}</div>` : '';
  let foot;
  if (!running) {
    foot = `<div class="vw-mode"><b>${lng('بتتفرج بس', 'Watching only')}</b><span>${s.state === 'waking' ? lng('الشاشة بتصحى وبتفتح المتصفح.', 'The screen is waking up and opening the browser.') : s.state === 'asleep' ? lng('مفيش حاجة شغالة على الشاشة دلوقتي.', 'Nothing is running on the screen right now.') : lng('مفيش شغل مفتوح على الشاشة دلوقتي.', 'No work is open on the screen right now.')}</span></div>`;
  } else if (!canWrite()) {
    foot = `<div class="vw-mode"><b>${lng('بتتفرج بس', 'Watching only')}</b><span>${bx(`${A.name} ${lng('شغال لوحده، وحسابك للمشاهدة بس.', 'is working on its own, and your account is view-only.')}`)}</span></div>`;
  } else if (s.mode === 'confirm') {
    foot = `<div class="vw-mode" id="vw-confirm-t"><b>${bx(`${lng('تاخد الدفة من', 'Take control from')} ${A.name}${lng('؟', '?')}`)}</b><span>${lng('هيوقف مكانه وانت تحرّك الماوس والكيبورد. الإذن ده للجلسة دي بس: لما تقفل الشاشة الدفة بترجعله، والمرة الجاية هيستأذنك تاني.', 'It holds still while you use the mouse and keyboard. This permission is for this session only: when you close the screen, control goes back to it, and next time it’ll ask you again.')}</span></div>
      <span class="vw-foot__acts"><button type="button" class="btn btn--secondary" id="vw-take-cancel" data-action="scr-take-cancel" data-agent="${a}">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary" id="vw-take-go" data-action="scr-take-go" data-agent="${a}" aria-describedby="vw-confirm-t">${lng('اسمح للجلسة دي', 'Allow for this session')}</button></span>`;
  } else if (ctrl) {
    foot = `<div class="vw-mode"><b>${lng('الدفة معاك', 'You have control')}</b><span>${bx(`${A.name} ${lng('واقف مكانه لحد ما تخلّص. اللي بتعمله على الشاشة باسمك انت.', 'is holding still until you’re done. What you do on the screen is done in your name.')}`)}</span></div>
      <span class="vw-foot__acts"><button type="button" class="btn btn--primary" id="vw-giveback" data-action="scr-giveback" data-agent="${a}">${lng('خلصت', 'Done')}</button></span>`;
  } else {
    foot = `<div class="vw-mode"><b>${lng('بتتفرج بس', 'Watching only')}</b><span>${bx(`${lng('الماوس والكيبورد مقفولين عليك، و', 'Your mouse and keyboard are locked, and')}${A.name} ${lng('شغال لوحده.', 'is working on its own.')}`)}</span></div>
      <span class="vw-foot__acts"><span class="vw-take__d" id="vw-take-d">${icon('shield')}${lng('محتاج إذنك · للجلسة دي بس', 'Needs your permission · this session only')}</span>
      <button type="button" class="btn btn--secondary" id="vw-take" data-action="scr-take" data-agent="${a}" aria-describedby="vw-take-d">${icon('hand')}<span>${lng('خد الدفة', 'Take control')}</span></button></span>`;
  }
  $('#viewer-inner').innerHTML = `<header class="vw__head">${face(a, 32)}<div class="vw__titles"><h2 class="vw__title" id="viewer-title">${RTL ? `شاشة <bdi>${esc(A.name)}</bdi>` : `<bdi>${esc(A.name)}</bdi>’s screen`}</h2><span class="vw__sub">${bx(sub)}</span></div>
      ${chip}<button type="button" class="circle-btn" id="vw-close" data-action="vw-close" aria-label="${lng('اقفل الشاشة', 'Close the screen')}">${icon('x')}</button></header>
    <div class="vw__body">
      <div class="vw__stage"><div class="vw__screen">${scrScreenHTML(a, true)}</div>${banner}${off}</div>
      <aside class="vw__log" aria-labelledby="vw-log-h"><h3 class="vw__log-h" id="vw-log-h">${T ? lng('الخطوات', 'Steps') : lng('خلص النهارده', 'Done today')}</h3>
        <ol class="vw-steps" id="vw-log" data-agent="${a}">${scrLogHTML(a)}</ol>
        <p class="vw-note">${icon('shield')}<span>${bx(`${lng('أي «انشر» أو دفع على الشاشة بيقف ويتسلّملك.', 'Any “Publish” or payment on the screen stops and is handed to you.')} ${A.name} ${lng('مبيدوسش عليه لوحده.', 'never presses it on its own.')}`)}</span></p></aside>
    </div>
    <footer class="vw__foot">${foot}</footer>`;
  if (fid) { const n = document.getElementById(fid); if (n) n.focus({ preventScroll: true }); }
}
function openViewer(a, opener) {
  if (!SCREENS[a]) return;
  state.viewer = { a, opener: opener || null };
  SCREENS[a].mode = 'watch';
  renderViewer();
  showDlg($('#viewer'));
  const first = () => $('#vw-done') || $('#vw-take') || $('#vw-wake') || $('#vw-close');
  { const f = first(); if (f) f.focus(); }
  window.requestAnimationFrame(() => { const f = first(); if (f && !f.contains(document.activeElement)) f.focus(); });
}

/* ---- shared dialog open/close (same motion as the agent gallery) ---- */
function showDlg(dlg) { dlg.classList.remove('is-closing'); if (!dlg.open) { try { dlg.showModal(); } catch (err) { dlg.setAttribute('open', ''); } } }
function closeDlg(dlg) {
  if (!dlg || !dlg.open) return;
  const finish = () => { dlg.classList.remove('is-closing'); if (dlg.open) dlg.close(); };
  if (reduced()) finish(); else { dlg.classList.add('is-closing'); window.setTimeout(finish, 190); }
}
['viewer', 'apps', 'preview'].forEach((id) => {
  const dlg = $(`#${id}`);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDlg(dlg); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(dlg); });
});
$('#viewer').addEventListener('close', () => {
  const v = state.viewer; state.viewer = null; $('#viewer-inner').innerHTML = '';
  if (!v) return;
  const s = SCREENS[v.a];
  if (s.mode === 'control') toast(`${lng('الدفة رجعت لـ', 'Control went back to')} ${AGENTS[v.a].name} ${lng('لما قفلت الشاشة', 'when you closed the screen')}`, 'hand');
  s.mode = 'watch';
  scrRefresh(v.a, true);
  const target = v.opener && document.body.contains(v.opener) ? v.opener : $(`#scr-act-${v.a}`);
  if (target) target.focus();
});

/* ================= apps catalogue «ربط التطبيقات» (G48/G49) ================= */
const APP_CATS = [['all', lng('الكل', 'All')], ['ads', lng('إعلانات', 'Ads')], ['content', lng('محتوى', 'Content')], ['comm', lng('تواصل', 'Communication')], ['analytics', lng('تحليلات', 'Analytics')], ['sales', lng('مبيعات', 'Sales')]];
const CAT_AR = Object.fromEntries(APP_CATS);
const APPS = [
  { k: 'meta', cat: 'ads', def: ['ads', 'analyst'], al: 'ميتا فيسبوك فيس بوك اعلانات', use: lng('Ads بيقرا نتايج الحملات ويجهّز الإعلانات كمسودة. أي إطلاق أو صرف بيتسلّملك.', 'Ads reads campaign results and prepares ads as drafts. Any launch or spend is handed to you.'), eff: lng('قراءة ومسودات · الصرف عليك', 'Read and drafts · spend is yours'), can: lng('يقرا النتايج والجماهير، ويجهّز حملات كمسودة', 'Reads results and audiences, and prepares campaigns as drafts'), cant: lng('يطلق حملة أو يصرف جنيه من غير ما انت تدوس', 'Launch a campaign or spend a pound without you pressing') },
  { k: 'gads', cat: 'ads', def: ['ads', 'analyst'], al: 'جوجل اعلانات سيرش', use: lng('Ads بيتابع حملات Search ويقترح كلمات وميزانيات، ومبيغيّرش ميزانية من غير إذنك.', 'Ads monitors Search campaigns and suggests keywords and budgets. It never changes a budget without your OK.'), eff: lng('قراءة واقتراحات · الصرف عليك', 'Read and suggest · spend is yours'), can: lng('يقرا الكلمات والتكلفة ويقترح تعديلات', 'Reads keywords and costs and suggests edits'), cant: lng('يغيّر ميزانية أو يشغّل حملة لوحده', 'Change a budget or start a campaign on its own') },
  { k: 'tiktok', cat: 'ads', screen: true, def: ['ads'], al: 'تيك توك تيكتوك', use: lng('Ads بيجهّز إعلانات TikTok من شاشته لأن الجزء ده مفيهوش API، وبيقف قبل «انشر».', 'Ads prepares TikTok ads from its own screen because this part has no API, and stops before “Publish”.'), eff: lng('من شاشة الوكيل · النشر عليك', 'Via the agent’s screen · publishing is yours'), can: lng('يعمل الحملة والإعلان ويقف عند «انشر»', 'Builds the campaign and the ad, then stops at “Publish”'), cant: lng('يدوس «انشر» أو يدفع', 'Press “Publish” or pay') },
  { k: 'li', cat: 'ads', def: ['ads'], al: 'لينكدان لينكد ان', use: lng('Ads هيجهّز بوستات وإعلانات LinkedIn للشركات كمسودة، والنشر عليك.', 'Ads will prepare LinkedIn company posts and ads as drafts. Publishing is yours.'), eff: lng('مسودات بس · النشر عليك', 'Drafts only · publishing is yours'), can: lng('يكتب بوستات وإعلانات ويقرا نتايجها', 'Writes posts and ads and reads their results'), cant: lng('ينشر بوست أو يطلق إعلان', 'Publish a post or launch an ad') },
  { k: 'wp', cat: 'content', def: ['seo'], al: 'ووردبريس وورد بريس موقع مدونة', use: lng('SEO بيكتب المقالات كمسودة على موقع الأكاديمية، والنشر عليك.', 'SEO writes articles as drafts on the academy website. Publishing is yours.'), eff: lng('مسودات بس · النشر عليك', 'Drafts only · publishing is yours'), can: lng('يكتب ويعدّل مسودات المقالات', 'Writes and edits article drafts'), cant: lng('ينشر مقال للعامة', 'Publish an article to the public') },
  { k: 'canva', cat: 'content', screen: true, def: ['seo'], al: 'كانفا تصميم صور', use: lng('SEO & Content بيعمل صور المقالات والإعلانات من شاشته، وبيحفظها في ملفاته.', 'SEO & Content makes article and ad images from its own screen and saves them to its files.'), eff: lng('من شاشة الوكيل · مفيش نشر', 'Via the agent’s screen · no publishing'), can: lng('يعمل تصميمات من قوالب الأكاديمية وينزّلها', 'Makes designs from the academy’s templates and downloads them'), cant: lng('يشارك تصميم برّه الفريق أو يشتري عناصر مدفوعة', 'Share a design outside the team or buy paid elements') },
  { k: 'ig', cat: 'content', def: ['seo'], al: 'انستجرام انستا ريلز', use: lng('SEO & Content هيجهّز الريلز والبوستات كمسودة، والنشر عليك.', 'SEO & Content will prepare reels and posts as drafts. Publishing is yours.'), eff: lng('مسودات بس · النشر عليك', 'Drafts only · publishing is yours'), can: lng('يجهّز البوست والكابشن ويقرا التفاعل', 'Prepares the post and caption and reads engagement'), cant: lng('ينشر أو يرد على تعليقات العملاء', 'Publish or reply to customer comments') },
  { k: 'wa', cat: 'comm', def: ['ads'], al: 'واتساب واتس اب', use: lng('Ads بيقرا رسايل الليدز عشان يعرف مين سأل عن الكورس، ومبيبعتش لعميل من نفسه.', 'Ads reads lead messages to know who asked about the course. It never messages a customer on its own.'), eff: lng('قراءة بس · الإرسال عليك', 'Read only · sending is yours'), can: lng('يقرا الرسايل ويجهّز ردود وقوايم متابعة', 'Reads messages and prepares replies and follow-up lists'), cant: lng('يبعت رسالة لعميل', 'Message a customer') },
  { k: 'slack', cat: 'comm', def: ['ads', 'seo', 'analyst', 'critic'], al: 'سلاك', use: lng('الوكلاء هيبعتوا ملخص الصبح والتنبيهات لقناة التسويق على Slack.', 'The agents will send the morning summary and alerts to the marketing channel on Slack.'), eff: lng('رسايل للفريق بس', 'Team messages only'), can: lng('يبعت ملخصات وتنبيهات في قناة التسويق', 'Sends summaries and alerts to the marketing channel'), cant: lng('يكلّم حد برّه الفريق', 'Talk to anyone outside the team') },
  { k: 'gmail', cat: 'comm', def: ['ads'], al: 'جيميل ايميل بريد', use: lng('Ads هيكتب ردود الليدز كمسودات في Gmail، وانت اللي تبعت.', 'Ads will write replies to leads as drafts in Gmail, and you send them.'), eff: lng('مسودات بس · الإرسال عليك', 'Drafts only · sending is yours'), can: lng('يقرا إيميلات الليدز ويكتب مسودات', 'Reads lead emails and writes drafts'), cant: lng('يبعت إيميل لعميل', 'Email a customer') },
  { k: 'mail', cat: 'comm', def: ['seo'], al: 'ميلشيمب ميل تشيمب نشره ايميلات', use: lng('SEO & Content هيكتب الإيميلات لقايمة المشتركين كمسودة، والإرسال عليك.', 'SEO & Content will write subscriber emails as drafts. Sending is yours.'), eff: lng('مسودات بس · الإرسال عليك', 'Drafts only · sending is yours'), can: lng('يكتب النشرة ويقرا نسبة الفتح', 'Writes the newsletter and reads open rates'), cant: lng('يبعت لقايمة الـ 4,180 مشترك', 'Send to the list of 4,180 subscribers') },
  { k: 'ga4', cat: 'analytics', def: ['ads', 'seo', 'analyst'], al: 'جوجل اناليتكس تحليلات مبيعات', use: lng('Analyst هيقرا المبيعات والتحويلات بس، مش هيغيّر حاجة.', 'Analyst will only read sales and conversions. It won’t change anything.'), eff: lng('قراءة بس · مفيش صرف', 'Read only · no spend'), can: lng('يقرا المبيعات والتحويلات من كل قناة', 'Reads sales and conversions from every channel'), cant: lng('يغيّر أي إعداد في الحساب', 'Change any account setting') },
  { k: 'gsc', cat: 'analytics', def: ['seo'], al: 'سيرش كونسول جوجل ترتيب', use: lng('SEO بيشوف الكلمات والترتيب، وبيطلب أرشفة المقالات الجديدة.', 'SEO sees keywords and rankings, and requests indexing for new articles.'), eff: lng('قراءة وطلب أرشفة', 'Read and request indexing'), can: lng('يقرا الكلمات والترتيب ويطلب أرشفة', 'Reads keywords and rankings and requests indexing'), cant: lng('يغيّر إعدادات الموقع', 'Change website settings') },
  { k: 'sheets', cat: 'analytics', def: ['analyst'], al: 'شيت شيتس جوجل جدول', use: lng('Analyst بيقرا شيت الليدز والمبيعات، وبيكتب فيه التقرير الأسبوعي.', 'Analyst reads the leads and sales sheet and writes the weekly report into it.'), eff: lng('قراءة وكتابة في شيت واحد', 'Read and write in one sheet'), can: lng('يقرا الشيت ويضيف صفحة التقرير', 'Reads the sheet and adds the report tab'), cant: lng('يمسح بيانات أو يشارك الشيت', 'Delete data or share the sheet') },
  { k: 'hubspot', cat: 'sales', def: ['analyst'], al: 'هب سبوت هبسبوت صفقات', use: lng('Analyst هيقرا الصفقات ومراحلها عشان يربط الليدز بالمبيعات.', 'Analyst will read deals and their stages to tie leads to sales.'), eff: lng('قراءة بس', 'Read only'), can: lng('يقرا الصفقات ومراحل البيع', 'Reads deals and sales stages'), cant: lng('يغيّر صفقة أو يكلّم عميل', 'Change a deal or contact a customer') },
  { k: 'odoo', cat: 'sales', def: ['analyst'], al: 'اودو فواتير حسابات', use: lng('Analyst هيقرا الفواتير والتحصيل بس، عشان يحسب العائد الحقيقي لكل قناة.', 'Analyst will only read invoices and collections, to work out the real return per channel.'), eff: lng('قراءة بس · مفيش صرف', 'Read only · no spend'), can: lng('يقرا الفواتير والتحصيل', 'Reads invoices and collections'), cant: lng('يعمل فاتورة أو يسجّل دفع', 'Create an invoice or record a payment') },
];
const connectedCount = () => APPS.filter((x) => state.conns[x.k] === 'connected').length;
const appAgents = (k) => AGENT_ORDER.filter((a) => AGENTS[a].conns.includes(k));
const appByK = (k) => APPS.find((x) => x.k === k);
const arNorm = (s) => String(s).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u0652]/g, '');
function appMatches(x, q, cat) {
  if (cat !== 'all' && x.cat !== cat) return false;
  if (!q) return true;
  return arNorm([CONNS[x.k].name, x.al, x.use, CAT_AR[x.cat]].join(' ')).includes(arNorm(q));
}
function renderAppsBtn() {
  const b = $('#btn-apps'); if (!b) return;
  b.innerHTML = `${icon('plug')}<span class="od-fill">${lng('ربط التطبيقات', 'Connect apps')}</span><span class="sb-apps__n num">${connectedCount()} ${lng('متوصل', 'connected')}</span>`;
}
function appCardHTML(x) {
  const C = CONNS[x.k]; const s = state.conns[x.k]; const ags = appAgents(x.k).filter(canSee);
  let foot;
  if (!canManage()) {
    foot = s === 'connected' ? `<span class="app__state">${icon('check')}<span>${lng('متوصل', 'Connected')}</span>${ags.length ? faceStack(ags, 18) : ''}</span>` : `<span class="app__state app__state--off">${lng('مش متوصل', 'Not connected')}</span>`;
  } else if (s === 'connected') {
    foot = `<span class="app__state">${icon('check')}<span>${lng('متوصل', 'Connected')}</span>${ags.length ? faceStack(ags, 18) : lng('<span class="app__none">مفيش وكيل</span>', '<span class="app__none">No agent</span>')}</span>
      <button type="button" class="btn btn--secondary btn--sm" id="app-btn-${x.k}" data-action="app-open" data-app="${x.k}" aria-label="${lng('إدارة', 'Manage')} ${esc(C.name)}">${lng('إدارة', 'Manage')}</button>`;
  } else if (s === 'connecting') {
    foot = lng('<span class="app__state">بيتوصل…</span>', '<span class="app__state">Connecting…</span>');
  } else {
    foot = `<span class="app__state app__state--off">${lng('مش متوصل', 'Not connected')}</span>
      <button type="button" class="btn btn--secondary btn--sm" id="app-btn-${x.k}" data-action="app-open" data-app="${x.k}" aria-label="${lng('وصّل', 'Connect')} ${esc(C.name)}">${lng('وصّل', 'Connect')}</button>`;
  }
  return `<article class="app-card" aria-labelledby="app-t-${x.k}">
    <div class="app__top">${tile(x.k, true)}<div class="app__titles"><h4 class="app__name" id="app-t-${x.k}"><bdi>${esc(C.name)}</bdi></h4><span class="app__cat">${CAT_AR[x.cat]}${x.screen ? lng(' · من شاشة الوكيل', ' · via the agent’s screen') : ''}</span></div></div>
    <p class="app__use od-clamp-2">${bx(x.use)}</p>
    <div class="app__foot">${foot}</div></article>`;
}
function appsListHTML() {
  const m = state.apps; const q = m.q.trim();
  const list = APPS.filter((x) => appMatches(x, q, m.cat));
  if (!list.length) {
    return `<div class="tpl-empty"><b>${q ? `${lng('مفيش تطبيق فيه «', 'No app matches “')}${esc(q)}${lng('»', '”')}` : lng('مفيش تطبيقات في القسم ده', 'No apps in this category')}</b>
      <span>${bx(lng('جرّب اسم تاني بالعربي أو بالإنجليزي، زي «واتساب» أو HubSpot.', 'Try another name in Arabic or English, like “واتساب” or HubSpot.'))}</span>
      ${q ? lng('<div class="tpl-empty__acts"><button type="button" class="btn btn--secondary btn--sm" data-action="apps-clear">امسح البحث</button></div>', '<div class="tpl-empty__acts"><button type="button" class="btn btn--secondary btn--sm" data-action="apps-clear">Clear search</button></div>') : ''}</div>`;
  }
  const on = list.filter((x) => state.conns[x.k] !== 'missing'); const off = list.filter((x) => state.conns[x.k] === 'missing');
  const sec = (title, arr, id) => (arr.length ? `<section class="apps-sec" aria-labelledby="${id}"><h3 class="apps-sec__h" id="${id}">${title} <span class="num muted">${arr.length}</span></h3><div class="apps-grid">${arr.map(appCardHTML).join('')}</div></section>` : '');
  return sec(lng('متوصل', 'Connected'), on, 'apps-h-on') + sec(lng('تقدر توصّلها', 'Available to connect'), off, 'apps-h-off');
}
function appsHeadHTML() {
  const m = state.apps;
  return `<header class="apps-head"><div class="sheet__top"><h2 class="sheet__title" id="apps-title">${lng('ربط التطبيقات', 'Connect apps')}</h2><span class="badge apps-count">${icon('check')}<span class="num">${connectedCount()}</span> ${lng('متوصل', 'connected')}</span>
      <button type="button" class="circle-btn" id="apps-close" data-action="apps-close" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></div>
    <p class="apps-sub">${bx(canManage() ? lng('كل تطبيق بتختار مين من الوكلاء يستخدمه. وأي نشر أو صرف أو رسالة لعميل بيتسلّملك انت، مهما كان التطبيق.', 'For each app, you choose which agents use it. Anything that publishes, spends or messages a customer is handed to you, whatever the app.')
      : `${lng('ربط التطبيقات واختيار الوكلاء اللي يستخدموها بيعمله', 'Connecting apps and choosing which agents use them is done by')} ${whoManages()} ${lng('بس.', 'only.')}`)}</p>
    <div class="tpl-search">${icon('search')}<label class="sr-only" for="apps-q">${lng('دوّر على تطبيق', 'Search apps')}</label><input type="search" id="apps-q" autocomplete="off" placeholder="${lng('دوّر على تطبيق، مثلاً: واتساب', 'Search apps, e.g. WhatsApp')}" value="${esc(m.q)}"></div>
    <div class="od-rail tpl-cats" role="group" aria-label="${lng('الأقسام', 'Categories')}">${APP_CATS.map(([k, l]) => {
      const n = k === 'all' ? APPS.length : APPS.filter((x) => x.cat === k).length;
      return `<button type="button" class="chip chip--text" id="apps-cat-${k}" data-action="apps-cat" data-cat="${k}" aria-pressed="${m.cat === k}">${l}<span class="chip__n num">${n}</span></button>`;
    }).join('')}</div></header>`;
}
function appDetailHTML(k) {
  const m = state.apps; const x = appByK(k); const C = CONNS[k]; const s = state.conns[k]; const ags = appAgents(k);
  const conn = s === 'connected'; const busy = s === 'connecting';
  const head = `<header class="apps-head"><div class="sheet__top"><button type="button" class="circle-btn" id="apps-back" data-action="apps-back" aria-label="${lng('رجوع لكل التطبيقات', 'Back to all apps')}">${icon('chevronRight')}</button>
      <h2 class="sheet__title" id="apps-title">${conn ? `<bdi>${esc(C.name)}</bdi>` : `${lng('وصّل', 'Connect')} <bdi>${esc(C.name)}</bdi>`}</h2>
      <button type="button" class="circle-btn" id="apps-close" data-action="apps-close" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></div>
    <div class="sheet__meta"><span>${CAT_AR[x.cat]}</span><span aria-hidden="true">·</span><span>${bx(x.eff)}</span>${conn ? `<span class="badge">${icon('check')}${lng('متوصل', 'Connected')}</span>` : ''}</div></header>`;
  const hero = `<div class="app-hero">${tile(k, true)}<p>${bx(x.use)}</p></div>`;
  const kv = `<dl class="kv app-kv"><div class="kv__row"><dt>${lng('هيقدر', 'Can')}</dt><dd>${bx(x.can)}</dd></div><div class="kv__row"><dt>${lng('مش هيقدر', 'Can’t')}</dt><dd>${bx(x.cant)}</dd></div>
    <div class="kv__row"><dt>${lng('الدخول', 'Sign-in')}</dt><dd>${bx(x.screen ? lng('بتسجّل دخول مرة واحدة على شاشة الوكيل وانت بتتفرج، والباسورد مبيتحفظش عندنا.', 'You sign in once on the agent’s screen while you watch. We never store the password.') : `${lng('بتسجّل دخول من نافذة', 'You sign in through')} ${C.name} ${lng('نفسها، والباسورد مبيعدّيش علينا.', '’s own window. The password never passes through us.')}`)}</dd></div></dl>`;
  let who; let foot;
  if (conn) {
    who = `<section class="apps-sec" aria-labelledby="app-who-h"><h3 class="apps-sec__h" id="app-who-h">${lng('مين يستخدمه', 'Who uses it')}</h3>
      <ul class="panel-card">${visibleAgents().map((a) => {
        const on = AGENTS[a].conns.includes(k);
        return `<li class="panel-row">${face(a, 28)}<span class="panel-row__text"><span class="panel-row__t" id="app-ag-t-${a}"><bdi>${esc(AGENTS[a].name)}</bdi></span><span class="panel-row__d">${on ? lng('يقدر يستخدمه', 'Can use it') : lng('مقفول عليه', 'Turned off for it')}</span></span>
          <button type="button" class="switch" role="switch" id="app-ag-${a}" aria-checked="${on}" aria-labelledby="app-ag-t-${a}" data-action="app-agent" data-app="${k}" data-agent="${a}"></button></li>`;
      }).join('')}</ul>
      ${ags.length ? '' : `<p class="set-hint">${bx(lng('متوصل بس محدش من الوكلاء بيستخدمه. شغّل وكيل واحد على الأقل عشان يبان في أدواته.', 'Connected, but no agent uses it. Turn on at least one agent so it shows up in its tools.'))}</p>`}</section>`;
    const verb = ags.length > 1 ? lng('مش هيقدروا يوصلوله', 'won’t be able to reach it') : lng('مش هيقدر يوصله', 'won’t be able to reach it');
    who += m.off ? `<div class="app-off" role="group" aria-labelledby="app-off-t"><p id="app-off-t">${bx(`${lng('تفصل', 'Disconnect')} ${C.name}${lng('؟', '?')} ${ags.length ? `${namesOf(ags)} ${verb}` : lng('محدش من الوكلاء بيستخدمه دلوقتي', 'No agent uses it right now')} ${lng('لحد ما توصّله تاني.', 'until you connect it again.')}`)}</p>
        <div class="panel-form__row panel-form__row--end"><button type="button" class="btn btn--secondary btn--sm" id="app-off-cancel" data-action="app-off-cancel">${lng('إلغاء', 'Cancel')}</button>
        <button type="button" class="btn btn--primary btn--sm" id="app-off-go" data-action="app-off-go" data-app="${k}">${lng('افصل', 'Disconnect')}</button></div></div>`
      : `<div><button type="button" class="link-btn" id="app-off" data-action="app-off">${lng('افصل', 'Disconnect')} <bdi>${esc(C.name)}</bdi></button></div>`;
    foot = lng('<footer class="modal__foot modal__foot--end"><button type="button" class="btn btn--primary" id="apps-done" data-action="apps-back">خلصت</button></footer>', '<footer class="modal__foot modal__foot--end"><button type="button" class="btn btn--primary" id="apps-done" data-action="apps-back">Done</button></footer>');
  } else {
    who = `<section class="apps-sec" aria-labelledby="app-pick-h"><h3 class="apps-sec__h" id="app-pick-h">${lng('مين ياخد صلاحية', 'Who gets access')} <span class="num muted">${m.pick.length}</span></h3>
      <div class="panel-card" role="group" aria-labelledby="app-pick-h" aria-describedby="app-pick-err">${visibleAgents().map((a) => {
        const on = m.pick.includes(a);
        return `<button type="button" class="panel-row tm-pick" role="checkbox" id="app-pick-${a}" aria-checked="${on}" data-action="app-pick" data-agent="${a}"${busy ? ' aria-disabled="true"' : ''}>${face(a, 28)}
          <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(AGENTS[a].name)}</bdi></span><span class="panel-row__d">${bx(AGENTS[a].role || lng('وكيل جديد', 'New agent'))}</span></span>
          <span class="tm-check" aria-hidden="true">${on ? icon('check') : ''}</span></button>`;
      }).join('')}</div>
      <span class="set-err" id="app-pick-err" ${m.err ? '' : 'hidden'}>${lng('اختار وكيل واحد على الأقل.', 'Pick at least one agent.')}</span></section>`;
    foot = `<footer class="modal__foot modal__foot--end"><button type="button" class="btn btn--secondary" id="app-cancel" data-action="apps-back">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary" id="app-connect" data-action="app-connect" data-app="${k}"${busy ? ' aria-disabled="true"' : ''}>${busy ? lng('بيتوصل…', 'Connecting…') : lng('وصّل', 'Connect')}</button></footer>`;
  }
  return head + `<div class="apps-body apps-detail">${hero}${kv}${who}</div>` + foot;
}
state.apps = null;
function renderApps() {
  const m = state.apps; if (!m) return;
  /* the same catalogue renders inside the settings overlay when «التطبيقات» is open there */
  const host = state.sov && state.sov.sec === 'apps' ? $('#sov-apps') : $('#apps-inner'); if (!host) return;
  host.innerHTML = m.view ? appDetailHTML(m.view)
    : appsHeadHTML() + `<div class="apps-body" id="apps-body" aria-live="polite">${appsListHTML()}</div>`;
}
function appPrep(k) {
  const m = state.apps; m.view = k; m.off = false; m.err = false;
  const cur = appAgents(k);
  m.pick = cur.length ? cur.slice() : appByK(k).def.filter((a) => AGENTS[a]);
}
function openApps(opener) {
  state.apps = { q: '', cat: 'all', view: null, pick: [], off: false, err: false, opener: opener || null };
  renderApps();
  showDlg($('#apps'));
  { const q = $('#apps-q'); if (q) q.focus(); }
  window.requestAnimationFrame(() => { const q = $('#apps-q'); if (q && document.activeElement !== q && $('#apps').contains(document.activeElement) && document.activeElement.id === 'apps-close') q.focus(); });
}
function appGrant(a, k, on) {
  const A = AGENTS[a]; if (!A) return;
  if (on) { if (!A.conns.includes(k)) A.conns.push(k); A.toolsOn[k] = true; if (state.drafts[a]) state.drafts[a].tools[k] = true; }
  else { A.conns = A.conns.filter((x) => x !== k); delete A.toolsOn[k]; if (state.drafts[a]) delete state.drafts[a].tools[k]; }
}
function appConnect(k) {
  const m = state.apps; if (!m || state.conns[k] !== 'missing') return;
  if (!m.pick.length) { m.err = true; renderApps(); const f = $(`#app-pick-${AGENT_ORDER[0]}`); if (f) f.focus(); return; }
  const picks = AGENT_ORDER.filter((a) => m.pick.includes(a));
  state.conns[k] = 'connecting'; state.connLater[k] = false;
  renderApps(); { const b = $('#app-connect'); if (b) b.focus(); }
  refreshMounted(); renderDetails();
  later(1200, () => {
    state.conns[k] = 'connected';
    logAuto(ME(), meAct('وصّل', 'وصّلت', 'connected'), { obj: CONNS[k].name, from: lng('مش متوصل', 'Not connected'), to: lng('متوصل', 'Connected') });
    picks.forEach((a) => appGrant(a, k, true));
    refreshMounted(); rerenderAll();
    if (state.apps && state.apps.view === k) { renderApps(); const f = $('#apps-done'); if (f) f.focus(); }
    toast(`${CONNS[k].name} ${lng('اتوصل ·', 'connected ·')} ${namesOf(picks)}`);
  });
}

/* ================= files library in the details «ملفات» tab (G47) ================= */
const LIB_FOLDERS = [['copy', lng('نصوص إعلانات', 'Ad scripts')], ['images', lng('صور', 'Images')], ['reports', lng('تقارير', 'Reports')], ['articles', lng('مقالات', 'Articles')]];
const LIB_EMPTY = {
  copy: (n) => `${lng('نصوص الإعلانات اللي', 'Ad scripts that')} ${n} ${lng('بيكتبها بتتحفظ هنا بعد مراجعة Critic.', 'writes are saved here after Critic reviews them.')}`,
  images: (n) => `${lng('الصور والكريتيف اللي', 'Images and creatives that')} ${n} ${lng('بيعمله بتتحفظ هنا، زي صور Canva.', 'makes are saved here, like Canva images.')}`,
  reports: (n) => `${lng('التقارير والجداول اللي', 'Reports and sheets that')} ${n} ${lng('بيطلّعها بتتحفظ هنا.', 'produces are saved here.')}`,
  articles: () => lng('مسودات المقالات بتتحفظ هنا لحد ما تتنشر.', 'Article drafts are saved here until they’re published.'),
};
const LIB = {
  ads: {
    copy: [
      { id: 'f-ads-c1', n: 'نصوص-ميتا-ديسمبر.txt', kind: 'copy', size: '2 KB', at: lng('النهارده · 10:37 ص', 'Today · 10:37 AM'), d: lng('3 نصوص · Meta · بعد مراجعة Critic', '3 scripts · Meta · after Critic’s review'),
        data: { title: 'نصوص إعلانات ديسمبر · Meta', items: [
          { l: 'النص 1 · فيديو', t: 'من خريج تجارة لمحاسب شغال في 3 شهور.\nفي «المحاسب الشامل» هتتعلم Excel وOdoo والضرايب على شغل حقيقي، والدفعة الجديدة بتبدأ 1 ديسمبر.', kv: [['العنوان', 'من خريج لمحاسب شغال'], ['الزرار', 'ابعت رسالة']], note: 'Critic: تمام · معانا قصص طلبة تثبت الوعد' },
          { l: 'النص 2 · صورة', t: 'أقصر طريق لأول شغلانة محاسبة.\n12 أسبوع تدريب عملي على حالات من شركات حقيقية، وشهادة معتمدة في الآخر.', kv: [['العنوان', 'أقصر طريق لأول شغلانة'], ['الزرار', 'ابعت رسالة']], note: 'Critic: اتعدّل من «أضمن طريق» لـ «أقصر طريق»' },
          { l: 'النص 3 · كاروسيل', t: 'Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج.\nلو سجّلت قبل 20 نوفمبر هتدفع 2,040 ج بس.', kv: [['العنوان', 'خصم 15% لحد 20 نوفمبر'], ['الزرار', 'اعرف أكتر']], note: 'Critic: السعر مطابق لصفحة الكورس' },
        ] } },
      { id: 'f-ads-c2', n: 'google-search-محاسبة.txt', kind: 'copy', size: '1 KB', at: lng('امبارح · 3:20 م', 'Yesterday · 3:20 PM'), d: lng('Google Search · 5 عناوين ووصفين', 'Google Search · 5 headlines and 2 descriptions'),
        data: { title: 'إعلان Google Search · كورس محاسبة', items: [
          { l: 'العناوين · لحد 30 حرف', t: 'كورس محاسبة اونلاين 2026\nمن خريج لمحاسب شغال\nExcel وOdoo والضرايب\nشهادة معتمدة وتدريب عملي\nالدفعة الجديدة 1 ديسمبر' },
          { l: 'الأوصاف · لحد 90 حرف', t: 'اتعلم المحاسبة من الصفر على شغل حقيقي: Excel وOdoo والضرايب في 3 شهور.\nسجّل قبل 20 نوفمبر وادفع 2,040 ج بدل 2,400 ج. اسأل على واتساب.', note: 'Critic: لسه مراجعهاش' },
        ] } },
      { id: 'f-ads-c3', n: 'نص-فيديو-تيك-توك-15ث.txt', kind: 'copy', size: '1 KB', at: lng('امبارح · 5:05 م', 'Yesterday · 5:05 PM'), d: lng('سكريبت 15 ثانية · TikTok', '15-sec script · TikTok'),
        data: { title: 'سكريبت فيديو TikTok · 15 ثانية', items: [
          { l: 'أول 3 ثواني', t: '«اتخرجت تجارة ومش لاقي شغل؟»' },
          { l: 'من 3 لـ 10 ثواني', t: 'لقطات من التدريب: شيت Excel، شاشة Odoo، وإقرار ضريبي حقيقي.' },
          { l: 'آخر 5 ثواني', t: '«المحاسب الشامل · الدفعة الجديدة 1 ديسمبر. ابعتلنا على واتساب»', note: 'Critic: الفكرة بتبان في أول 3 ثواني' },
        ] } },
    ],
    images: [
      { id: 'f-ads-i1', n: 'كريتيف-من-خريج-لمحاسب.svg', kind: 'image', w: 1080, h: 1080, size: '14 KB', at: lng('النهارده · 10:33 ص', 'Today · 10:33 AM'), d: lng('1080×1080 · لإعلان Meta', '1080×1080 · for a Meta ad'),
        data: { tpl: 'sq', lines: ['من خريج تجارة', 'لمحاسب شغال', 'في 3 شهور'], sub: 'Excel وOdoo والضرايب على شغل حقيقي' }, alt: lng('كريتيف إعلان: من خريج تجارة لمحاسب شغال في 3 شهور، المحاسب الشامل بـ 2,400 ج', 'Ad creative: “من خريج تجارة لمحاسب شغال في 3 شهور”, المحاسب الشامل for EGP 2,400') },
      { id: 'f-ads-i2', n: 'ستوري-الدفعة-الجديدة.svg', kind: 'image', w: 1080, h: 1920, size: '16 KB', at: lng('امبارح · 4:10 م', 'Yesterday · 4:10 PM'), d: lng('1080×1920 · ستوري Instagram وTikTok', '1080×1920 · Instagram and TikTok story'),
        data: { tpl: 'story', lines: ['الدفعة الجديدة', 'من المحاسب الشامل', 'بتبدأ 1 ديسمبر'], sub: 'سجّل قبل 20 نوفمبر وادفع 2,040 ج' }, alt: lng('ستوري: الدفعة الجديدة من المحاسب الشامل بتبدأ 1 ديسمبر', 'Story: the new المحاسب الشامل cohort starts Dec 1') },
    ],
    reports: [
      { id: 'f-ads-r1', n: 'صرف-وليدز-ميتا-5-11-نوفمبر.csv', kind: 'report', size: '3 KB', at: lng('النهارده · 9:00 ص', 'Today · 9:00 AM'), d: lng('آخر 7 أيام · حملتين على Meta', 'Last 7 days · 2 Meta campaigns'), data: { type: 'campaigns' } },
    ],
  },
  seo: {
    copy: [],
    images: [
      { id: 'f-seo-i1', n: 'صورة-مقال-محاسب-من-البيت.svg', kind: 'image', w: 1200, h: 630, size: '19 KB', at: lng('امبارح · 12:40 م', 'Yesterday · 12:40 PM'), d: lng('1200×630 · من Canva', '1200×630 · from Canva'),
        data: { tpl: 'blog', lines: ['كيف تصبح محاسباً', 'من البيت؟'] }, alt: lng('صورة مقال: كيف تصبح محاسباً من البيت؟', 'Article image: كيف تصبح محاسباً من البيت؟') },
    ],
    reports: [
      { id: 'f-seo-r1', n: 'كلمات-محاسبة-نوفمبر.csv', kind: 'report', size: '4 KB', at: lng('الاتنين · 11:05 ص', 'Monday · 11:05 AM'), d: lng('40 كلمة · من Search Console', '40 keywords · from Search Console'), data: { type: 'kw' } },
    ],
    articles: [
      { id: 'f-seo-a1', n: 'مقال-كورس-محاسب-شامل-اونلاين.md', kind: 'article', size: '11 KB', at: lng('النهارده · 10:38 ص', 'Today · 10:38 AM'), d: lng('1,600 كلمة · مسودة على WordPress', '1,600 words · draft in WordPress'),
        data: { title: 'كورس محاسب شامل أونلاين: ماذا ستتعلم وأين ستعمل؟', meta: 'الكلمة: كورس محاسب شامل اونلاين · 1,300 بحث في الشهر · Critic: مقبول بعد تعديل واحد', words: '1,600',
          sections: [
            { h: '', p: 'إذا كنت خريج تجارة وتبحث عن أقصر طريق لأول وظيفة محاسبة، فكورس المحاسب الشامل أونلاين يعلّمك في 12 أسبوعاً ما تطلبه الشركات فعلاً: Excel وOdoo والضرائب، على حالات عملية من شركات حقيقية.' },
            { h: 'ماذا ستتعلم في الكورس؟', p: 'تبدأ بأساسيات القيد المزدوج والقوائم المالية، ثم تنتقل إلى Excel للمحاسبين وOdoo لإدارة الحسابات، وتنتهي بإعداد إقرار ضريبي كامل.' },
            { h: 'أين يعمل خريجو الكورس؟', p: 'في أقسام الحسابات بالشركات الصغيرة والمتوسطة، ومكاتب المراجعة، والعمل الحر لمتابعة حسابات المحلات والعيادات.' },
            { h: 'كم سعر الكورس؟', p: 'سعر الكورس 2,400 جنيه، ومن يسجّل قبل 20 نوفمبر يدفع 2,040 جنيهاً.' },
          ] } },
      { id: 'f-seo-a2', n: 'مقال-كورس-محاسبة-اونلاين.md', kind: 'article', size: '13 KB', at: lng('امبارح · 1:30 م', 'Yesterday · 1:30 PM'), d: lng('1,850 كلمة · مستني موافقتك على النشر', '1,850 words · waiting for your OK to publish'),
        data: { title: 'كورس محاسبة أونلاين: دليلك الكامل 2026', meta: 'الكلمة: كورس محاسبة اونلاين · 2,900 بحث في الشهر · Critic: مقبول بعد تعديلين', words: '1,850',
          sections: [
            { h: '', p: 'الكورس الأونلاين المناسب هو الذي يعلّمك المحاسبة على برامج تستخدمها الشركات اليوم، ويعطيك تدريباً عملياً وشهادة معتمدة، بسعر واضح من البداية.' },
            { h: 'كيف تختار كورس محاسبة أونلاين؟', p: 'قارن بين المحتوى العملي، وعدد ساعات التدريب، والبرامج التي ستتعلمها، وطريقة المتابعة بعد انتهاء الكورس.' },
            { h: 'أسئلة شائعة', p: 'هل أحتاج خبرة سابقة؟ لا، الكورس يبدأ من الصفر. هل الشهادة معتمدة؟ نعم، وتحصل عليها بعد اجتياز المشروع النهائي.' },
          ] } },
    ],
  },
  analyst: {
    copy: [], images: [],
    reports: [
      { id: 'f-an-r1', n: 'مسودة-التقرير-الأسبوعي-5-11-نوفمبر.csv', kind: 'report', size: '5 KB', at: lng('النهارده · 9:30 ص', 'Today · 9:30 AM'), d: lng('مسودة · من غير مبيعات GA4', 'Draft · without GA4 sales'), data: { type: 'channels' } },
    ],
  },
  critic: {
    copy: [], images: [],
    reports: [
      { id: 'f-cr-r1', n: 'مراجعة-نصوص-ديسمبر.txt', kind: 'copy', size: '2 KB', at: lng('النهارده · 10:36 ص', 'Today · 10:36 AM'), d: lng('3 نصوص · 2 تمام و1 اتعدّل', '3 scripts · 2 OK, 1 edited'),
        data: { title: 'مراجعة نصوص إعلانات ديسمبر', items: [
          { l: 'نص 1 · تمام', t: 'من خريج تجارة لمحاسب شغال في 3 شهور', note: 'الوعد واضح، ومعانا قصص طلبة تثبته.' },
          { l: 'نص 2 · يتعدّل', t: 'أضمن طريق لأول وظيفة محاسبة', note: '«أضمن» وعد مقدرش نثبته. البديل: «أقصر طريق لأول شغلانة محاسبة».' },
          { l: 'نص 3 · تمام', t: 'Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج', note: 'السعر مطابق لصفحة الكورس.' },
        ] } },
    ],
  },
};
state.libPath = {};
state.preview = null;
const libOf = (a) => LIB[a] || (LIB[a] = { copy: [], images: [], reports: [] });
const libFolders = (a) => LIB_FOLDERS.filter(([k]) => k !== 'articles' || libOf(a).articles);
const libFind = (a, id) => libFolders(a).reduce((f, [k]) => f || (libOf(a)[k] || []).find((x) => x.id === id), null);
const filesWord = (n) => (n === 1 ? lng('ملف واحد', 'One file') : n === 2 ? lng('ملفين', '2 files') : n <= 10 ? `${n} ${lng('ملفات', 'files')}` : `${n} ${lng('ملف', 'files')}`);
const KIND_ICON = { copy: 'file', article: 'file', report: 'table', image: 'image' };
/* a file name: an Arabic name keeps its extension at the end (left), a Latin one runs left to right as a whole */
function fname(n) {
  const i = n.lastIndexOf('.'); const base = i > 0 ? n.slice(0, i) : n; const ext = i > 0 ? n.slice(i) : '';
  if (/^[A-Za-z0-9]/.test(base)) return `<bdi dir="ltr">${esc(n)}</bdi>`;
  return `<bdi dir="rtl">${esc(base)}</bdi>${ext ? `<bdi dir="ltr">${esc(ext)}</bdi>` : ''}`;
}
/* the creatives are files, not UI: fixed colours from the agents' face palette, same in both themes */
function imageSVG(f) {
  const d = f.data; const W = f.w; const H = f.h;
  const font = 'IBM Plex Sans Arabic, Noto Sans Arabic, Tahoma, sans-serif';
  const tx = (x, y, size, txt, fill, o = {}) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${o.w || 400}" fill="${fill}"${o.op ? ` fill-opacity="${o.op}"` : ''} text-anchor="${o.anchor || 'start'}" direction="rtl">${esc(txt)}</text>`;
  let g = '';
  if (d.tpl === 'sq') {
    g = `<rect width="${W}" height="${H}" fill="#1C1C1C"/>${tx(984, 156, 34, 'RS Learning · المحاسب الشامل', '#D7E9E6')}
      ${d.lines.map((l, i) => tx(984, 380 + i * 128, 100, l, i === d.lines.length - 1 ? '#D7E9E6' : '#FFFFFF', { w: 600 })).join('')}
      ${tx(984, 756, 40, d.sub, '#FFFFFF', { op: 0.78 })}<rect x="96" y="840" width="888" height="2" fill="#FFFFFF" fill-opacity="0.18"/>
      ${tx(984, 958, 40, 'الدفعة الجديدة 1 ديسمبر', '#FFFFFF')}<rect x="96" y="900" width="270" height="84" rx="42" fill="#D7E9E6"/>${tx(231, 956, 40, '2,400 ج', '#0B3D39', { w: 600, anchor: 'middle' })}`;
  } else if (d.tpl === 'story') {
    g = `<rect width="${W}" height="${H}" fill="#1C1C1C"/>${tx(980, 220, 40, 'RS Learning', '#D7E9E6')}
      ${d.lines.map((l, i) => tx(980, 760 + i * 124, 92, l, i === d.lines.length - 1 ? '#D7E9E6' : '#FFFFFF', { w: 600 })).join('')}
      ${tx(980, 1200, 44, d.sub, '#FFFFFF', { op: 0.78 })}
      <rect x="140" y="1600" width="800" height="124" rx="62" fill="#D7E9E6"/>${tx(540, 1680, 50, 'ابعتلنا على واتساب', '#0B3D39', { w: 600, anchor: 'middle' })}`;
  } else {
    g = `<rect width="${W}" height="${H}" fill="#E1E5EB"/>${tx(1120, 110, 30, 'RS Learning · المدونة', '#1E293B', { op: 0.72 })}
      ${d.lines.map((l, i) => tx(1120, 290 + i * 92, 64, l, '#1E293B', { w: 600 })).join('')}
      <rect x="80" y="470" width="1040" height="2" fill="#1E293B" fill-opacity="0.16"/>${tx(1120, 540, 28, 'المحاسب الشامل · الدفعة الجديدة 1 ديسمبر', '#1E293B', { op: 0.72 })}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${font}">${g}</svg>`;
}
const svgURI = (f) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(imageSVG(f))}`;
function libThumb(f, lg) {
  if (f.kind === 'image') return `<span class="lib-thumb${lg ? ' lib-thumb--lg' : ''}"><img src="${svgURI(f)}" width="${f.w}" height="${f.h}" alt=""></span>`;
  return `<span class="lib-thumb${lg ? ' lib-thumb--lg' : ''}">${icon(KIND_ICON[f.kind] || 'file')}</span>`;
}
/* report numbers come from the same demo data as the dashboard (5–11 نوفمبر) */
const ADS_CAMPAIGNS = [['إعادة استهداف زوار الصفحة', 1700, 63], ['المحاسب الشامل · فيديو', 1780, 41]];
const KW_ROWS = [['كورس محاسبة اونلاين', 2900, '9'], ['تعلم المحاسبة من الصفر', 2400, '14'], ['كورس اكسل للمحاسبين', 1600, '11'], ['كورس محاسب شامل اونلاين', 1300, 'جديدة'], ['ازاي تبقى محاسب من البيت', 880, '6'], ['دبلومة ضرايب اونلاين', 720, '22']];
function seriesSVG(vals, aria) {
  const n = vals.length; const W = 600, H = 210, L = 30, R = 6, T = 10, B = 28;
  const top = Math.ceil(Math.max.apply(null, vals) / 5) * 5;
  const cw = (W - L - R) / n; const bw = cw * 0.5;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = Math.round((top / 4) * k); const yy = y(v); g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end">${v}</text>`; }
  vals.forEach((v, i) => {
    const x = L + cw * i + (cw - bw) / 2; const back = n - 1 - i;
    g += `<g><title>${dayLabel(back)}: ${v} ليد</title><rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" fill="var(--ch-meta)"/></g><text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${dayLabel(back)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}" style="direction:ltr">${g}</svg>`;
}
function reportRows(f) {
  if (f.data.type === 'campaigns') return ADS_CAMPAIGNS.map(([n, sp, ld]) => ({ n, sp, ld }));
  const c = DATA['7'].ch;
  return [['Meta', c.meta, 'var(--ch-meta)'], ['Google', c.google, 'var(--ch-google)'], ['SEO', c.seo, 'var(--ch-seo)']].map(([n, x, sw]) => ({ n, sp: x.spend, ld: x.leads, sw }));
}
function reportHTML(f) {
  if (f.data.type === 'kw') {
    return `<div class="table-wrap"><table class="table"><thead><tr><th>${lng('الكلمة', 'Keyword')}</th><th>${lng('بحث في الشهر', 'Monthly searches')}</th><th>${lng('الترتيب', 'Rank')}</th></tr></thead>
      <tbody>${KW_ROWS.map(([k, v, p]) => `<tr><td>${bx(k)}</td><td class="num">${fmt(v)}</td><td class="num">${esc(p)}</td></tr>`).join('')}</tbody></table></div>
      <p class="demo-note">${lng('أول 6 كلمات من 40 · بيانات تجريبية للنموذج، مش من Search Console الحقيقي.', 'First 6 of 40 keywords · sample data for this prototype, not from the real Search Console.')}</p>`;
  }
  const rows = reportRows(f);
  const sp = rows.reduce((s, r) => s + r.sp, 0); const ld = rows.reduce((s, r) => s + r.ld, 0);
  const stat = (l, v, u) => `<div class="od-stat pv-stat"><span class="pv-stat__l">${l}</span><span class="pv-stat__v num">${u ? kpiMoney(v) : v}</span></div>`;
  const cpl = (s, l) => (s ? fmt1(s / l) : '0');
  const isCh = f.data.type === 'channels';
  const chart = isCh ? `${chartSVG('7')}<div class="legend pv-legend"><span><i style="background:var(--ch-meta)"></i><bdi>Meta</bdi></span><span><i style="background:var(--ch-google)"></i><bdi>Google</bdi></span><span><i style="background:var(--ch-seo)"></i><bdi>SEO</bdi></span></div>`
    : seriesSVG(DATA['7'].series.meta, lng('ليدز Meta اليومية لآخر 7 أيام', 'Daily Meta leads, last 7 days'));
  return `<div class="od-grid pv-stats">${stat(lng('الصرف', 'Spend'), fmt(sp), 'ج')}${stat(lng('الليدز', 'Leads'), fmt(ld))}${stat(lng('تكلفة الليد', 'Cost per lead'), cpl(sp, ld), 'ج')}</div>
    <div class="table-wrap"><table class="table"><thead><tr><th>${isCh ? lng('القناة', 'Channel') : lng('الحملة', 'Campaign')}</th><th>${lng('الصرف', 'Spend')}</th><th>${lng('الليدز', 'Leads')}</th><th>${lng('تكلفة الليد', 'Cost per lead')}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.sw ? `<span class="chan"><i style="background:${r.sw}"></i><bdi>${esc(r.n)}</bdi></span>` : bx(r.n)}</td><td class="num">${bx(egp(fmt(r.sp)))}</td><td class="num">${fmt(r.ld)}</td><td class="num">${r.sp ? bx(egp(cpl(r.sp, r.ld))) : lng('من غير صرف', 'No spend')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>${lng('الإجمالي', 'Total')}</td><td class="num">${bx(egp(fmt(sp)))}</td><td class="num">${fmt(ld)}</td><td class="num">${bx(egp(cpl(sp, ld)))}</td></tr></tfoot></table></div>
    <div class="pv-chart"><h3 class="pv-h">${lng('الليدز اليومية', 'Daily leads')} · ${dayLabel(6)} – ${dayLabel(0)}</h3>${chart}</div>
    <p class="demo-note">${lng('بيانات تجريبية للنموذج، مش من حسابات الإعلانات الحقيقية.', 'Sample data for this prototype, not from real ad accounts.')}${isCh ? lng(' المبيعات مش متحسبة لحد ما GA4 يتوصل.', ' Sales aren’t counted until GA4 is connected.') : ''}</p>`;
}
function reportCSV(f) {
  if (f.data.type === 'kw') return ['الكلمة,بحث في الشهر,الترتيب'].concat(KW_ROWS.map((r) => r.join(','))).join('\n');
  const rows = reportRows(f); const isCh = f.data.type === 'channels';
  const head = `${isCh ? 'القناة' : 'الحملة'},الصرف (ج),الليدز,تكلفة الليد (ج)`;
  const body = rows.map((r) => `${r.n},${r.sp},${r.ld},${r.sp ? (r.sp / r.ld).toFixed(1) : 0}`);
  const s = DATA['7'].series;
  const days = isCh ? ['', 'اليوم,Meta,Google,SEO'].concat(s.meta.map((v, i) => `${dayLabel(6 - i)},${v},${s.google[i]},${s.seo[i]}`))
    : ['', 'اليوم,ليدز Meta'].concat(s.meta.map((v, i) => `${dayLabel(6 - i)},${v}`));
  return [head].concat(body, days).join('\n');
}
function fileBody(f) {
  if (f.kind === 'image') return { mime: 'image/svg+xml', body: imageSVG(f) };
  if (f.kind === 'report') return { mime: 'text/csv;charset=utf-8', body: `\uFEFF${reportCSV(f)}\n` };
  const D = f.data;
  if (f.kind === 'article') return { mime: 'text/markdown;charset=utf-8', body: `# ${D.title}\n\n> ${D.meta}\n\n${D.sections.map((s) => (s.h ? `## ${s.h}\n\n` : '') + s.p).join('\n\n')}\n` };
  return { mime: 'text/plain;charset=utf-8', body: `${D.title}\n\n${D.items.map((it) => `${it.l}\n${it.t}${it.kv ? `\n${it.kv.map((r) => `${r[0]}: ${r[1]}`).join('\n')}` : ''}${it.note ? `\nملاحظة: ${it.note}` : ''}`).join('\n\n')}\n` };
}
function libDownload(f) {
  if (!f) return;
  try {
    const b = fileBody(f);
    const url = URL.createObjectURL(new Blob([b.body], { type: b.mime }));
    const link = document.createElement('a'); link.href = url; link.download = f.n; link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`${lng('بينزّل «', 'Downloading “')}${f.n}${lng('»', '”')}`, 'download');
  } catch (err) { toast(lng('التنزيل مقفول في المعاينة دي. افتح النموذج في المتصفح ونزّله من هناك', 'Download is blocked in this preview. Open the prototype in a browser and download it there'), 'x'); }
}
function libraryHTML(a) {
  const A = AGENTS[a]; const L = libOf(a); const path = state.libPath[a];
  if (!path) {
    const total = libFolders(a).reduce((n, [k]) => n + (L[k] || []).length, 0);
    return `<section class="dp-sec" aria-labelledby="lib-h"><h3 class="dp-label" id="lib-h"><span>${lng('مكتبة', 'Library of')} <bdi>${esc(A.name)}</bdi> <span class="muted num">${total}</span></span></h3>
      <div class="panel-card">${libFolders(a).map(([k, l]) => {
        const fs = L[k] || [];
        return `<button type="button" class="panel-row lib-folder" id="lib-f-${k}" data-action="lib-open" data-agent="${a}" data-folder="${k}">
          <span class="panel-row__icon">${icon('folder')}</span><span class="panel-row__text"><span class="panel-row__t">${l}</span><span class="panel-row__d">${fs.length ? `${filesWord(fs.length)} ${lng('· آخر واحد', '· latest')} ${esc(fs[0].at)}` : lng('فاضي', 'Empty')}</span></span>${icon('chevron', 'lib-chev')}</button>`;
      }).join('')}</div>
      <p class="lib-hint">${bx(`${lng('اللي', 'What')} ${A.name} ${lng('بيعمله بيتحفظ هنا لوحده. تقدر تشوفه وتنزّله، والتعديل اطلبه منه في الشات.', 'makes is saved here automatically. You can view and download it, and ask for edits in the chat.')}`)}</p></section>`;
  }
  const name = (LIB_FOLDERS.find(([k]) => k === path) || [])[1] || '';
  const fs = L[path] || [];
  return `<section class="dp-sec" aria-labelledby="lib-h"><nav class="lib-crumbs" aria-label="${lng('مكان الملفات', 'File location')}">
      <button type="button" class="link-btn" id="lib-root" data-action="lib-root" data-agent="${a}">${lng('مكتبة', 'Library of')} <bdi>${esc(A.name)}</bdi></button>${icon('chevron')}
      <h3 class="lib-crumbs__cur" id="lib-h" aria-current="location">${name} <span class="muted num">${fs.length}</span></h3></nav>
    ${fs.length ? `<ul class="panel-card">${fs.map((f) => `<li class="panel-row lib-file">
        <button type="button" class="lib-file__main" id="lib-p-${f.id}" data-action="lib-preview" data-agent="${a}" data-file="${f.id}" aria-haspopup="dialog">${libThumb(f)}
          <span class="panel-row__text"><span class="panel-row__t lib-1l" title="${esc(f.n)}">${fname(f.n)}</span><span class="panel-row__d lib-1l">${bx(f.d)}</span></span></button>
        <button type="button" class="circle-btn lib-dl" data-action="lib-download" data-agent="${a}" data-file="${f.id}" aria-label="${lng('نزّل', 'Download')} ${esc(f.n)}" title="${lng('نزّل', 'Download')}">${icon('download')}</button></li>`).join('')}</ul>`
      : `<div class="panel-card"><div class="lib-empty">${icon(path === 'images' ? 'image' : 'folder')}<p>${bx(LIB_EMPTY[path](A.name))}</p></div></div>`}
  </section>`;
}
function previewBodyHTML(f) {
  const D = f.data;
  if (f.kind === 'image') return `<figure class="pv-fig"><img class="pv-img" src="${svgURI(f)}" width="${f.w}" height="${f.h}" alt="${esc(f.alt || f.n)}"><figcaption>${bx(f.d)}</figcaption></figure>`;
  if (f.kind === 'report') return reportHTML(f);
  if (f.kind === 'article') {
    return `<article class="pv-article"><h3 class="pv-article__h">${bx(D.title)}</h3><p class="pv-article__meta">${bx(D.meta)}</p>
      ${D.sections.map((s) => `${s.h ? `<h4>${bx(s.h)}</h4>` : ''}<p>${bx(s.p)}</p>`).join('')}
      <p class="pv-article__more">${bx(`${lng('ده أول جزء بس. المقال كامل', 'This is just the first part. The full article is')} ${D.words} ${lng('كلمة في الملف.', 'words in the file.')}`)}</p></article>`;
  }
  return `<h3 class="pv-h">${bx(D.title)}</h3><ol class="pv-copy">${D.items.map((it) => `<li><span class="pv-copy__l">${bx(it.l)}</span><p class="pv-copy__t">${bx(it.t)}</p>
    ${it.kv ? kvHTML(it.kv) : ''}${it.note ? `<span class="pv-copy__n">${icon('review')}<span>${bx(it.note)}</span></span>` : ''}</li>`).join('')}</ol>`;
}
function openPreview(a, id) {
  const f = libFind(a, id); if (!f) return;
  const A = AGENTS[a];
  state.preview = { a, id };
  $('#preview-inner').innerHTML = `<header class="modal__head">${libThumb(f, true)}<div class="modal__titles"><h2 class="modal__title pv-title" id="preview-title">${fname(f.n)}</h2>
      <p class="modal__sub">${bx(`${A.name} · ${f.at} · ${f.size}`)}</p></div>
      <button type="button" class="circle-btn" id="pv-close" data-action="pv-close" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></header>
    <div class="pv__body"${f.kind === 'article' || f.kind === 'copy' ? ' dir="rtl"' : ''}>${previewBodyHTML(f)}</div>
    <footer class="modal__foot"><span class="modal__foot-t">${bx(`${lng('للقراية بس. لو عايز تعديل، اطلبه من', 'Read only. For edits, ask')} ${A.name} ${lng('في الشات.', 'in the chat.')}`)}</span>
      <button type="button" class="btn btn--primary" id="pv-dl" data-action="lib-download" data-agent="${a}" data-file="${f.id}">${icon('download')}<span>${lng('نزّل', 'Download')}</span></button></footer>`;
  showDlg($('#preview'));
  { const b = $('#pv-dl'); if (b) b.focus(); }
}
$('#preview').addEventListener('close', () => {
  const p = state.preview; state.preview = null; $('#preview-inner').innerHTML = '';
  const t = p && document.getElementById(`lib-p-${p.id}`);
  if (t) t.focus();
});
$('#apps').addEventListener('close', () => {
  const m = state.apps; state.apps = null; $('#apps-inner').innerHTML = '';
  const t = m && m.opener && document.body.contains(m.opener) && m.opener.offsetParent ? m.opener : $('#btn-apps');
  if (t) t.focus();
});

/* ---- events for this round (delegated from the document, so re-rendered controls keep working) ---- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset;
  const s = d.agent ? SCREENS[d.agent] : null;
  /* a toast action clicked inside an open dialog leads somewhere behind it: close the dialog first */
  if (el.classList.contains('toast__act')) { const dlg = el.closest('dialog'); if (dlg) closeDlg(dlg); }
  switch (d.action) {
    case 'scr-wake': if (el.getAttribute('aria-disabled') !== 'true') scrWake(d.agent); break;
    case 'scr-watch': openViewer(d.agent, el.classList.contains('scr-thumb') ? $(`#scr-act-${d.agent}`) : el); break;
    case 'scr-take': if (s) { s.mode = 'confirm'; renderViewer(); const b = $('#vw-take-go'); if (b) b.focus(); } break;
    case 'scr-take-cancel': if (s) { s.mode = 'watch'; renderViewer(); const b = $('#vw-take'); if (b) b.focus(); } break;
    case 'scr-take-go': if (s) { s.mode = 'control'; renderViewer(); scrRefresh(d.agent, true); const b = $('#vw-giveback'); if (b) b.focus(); toast(lng('الدفة معاك للجلسة دي بس', 'You have control for this session only'), 'hand'); } break;
    case 'scr-giveback': if (s) { s.mode = 'watch'; renderViewer(); scrRefresh(d.agent, true); const b = $('#vw-take') || $('#vw-close'); if (b) b.focus(); toast(`${lng('رجّعت الدفة لـ', 'Gave control back to')} ${AGENTS[d.agent].name}${lng('، وكمّل من مكانه', ', and it carried on from where it was')}`, 'hand'); } break;
    case 'scr-publish': if (s && s.hand) handDone(s.hand.thread, s.hand.msg); break;
    case 'vw-close': closeDlg($('#viewer')); break;
    case 'open-apps': {
      const opener = d.key ? $(`[data-action="plus-menu"][data-key="${d.key}"]`) : d.me ? $('#btn-me') : el;
      if (d.key) closePlus(d.key);
      openApps(opener); break;
    }
    case 'apps-close': closeDlg($('#apps')); break;
    case 'apps-cat': state.apps.cat = d.cat; renderApps(); { const b = $(`#apps-cat-${d.cat}`); if (b) b.focus(); } break;
    case 'apps-clear': { state.apps.q = ''; const q = $('#apps-q'); if (q) { q.value = ''; q.focus(); } $('#apps-body').innerHTML = appsListHTML(); break; }
    case 'app-open': appPrep(d.app); renderApps(); { const b = $('#apps-back'); if (b) b.focus(); } break;
    case 'apps-back': {
      const m = state.apps; if (!m) break; const k = m.view; if (k && state.conns[k] === 'connecting') break;
      m.view = null; m.off = false; renderApps();
      const b = (k && $(`#app-btn-${k}`)) || $('#apps-q'); if (b) b.focus(); break;
    }
    case 'app-pick': {
      const m = state.apps; if (!m || el.getAttribute('aria-disabled') === 'true') break;
      const i = m.pick.indexOf(d.agent); if (i >= 0) m.pick.splice(i, 1); else m.pick.push(d.agent);
      if (m.pick.length) m.err = false;
      renderApps(); { const b = $(`#app-pick-${d.agent}`); if (b) b.focus(); } break;
    }
    case 'app-connect': if (el.getAttribute('aria-disabled') !== 'true') appConnect(d.app); break;
    case 'app-agent': {
      const k = d.app; const on = AGENTS[d.agent].conns.includes(k);
      appGrant(d.agent, k, !on); renderApps(); rerenderAll();
      { const b = $(`#app-ag-${d.agent}`); if (b) b.focus(); }
      toast(on ? `${AGENTS[d.agent].name} ${lng('مبقاش يقدر يستخدم', 'can no longer use')} ${CONNS[k].name}` : `${AGENTS[d.agent].name} ${lng('يقدر يستخدم', 'can use')} ${CONNS[k].name}`, on ? 'x' : 'check'); break;
    }
    case 'app-off': state.apps.off = true; renderApps(); { const b = $('#app-off-cancel'); if (b) b.focus(); } break;
    case 'app-off-cancel': state.apps.off = false; renderApps(); { const b = $('#app-off'); if (b) b.focus(); } break;
    case 'app-off-go': {
      const k = d.app; state.conns[k] = 'missing'; state.connLater[k] = false;
      state.apps.off = false; state.apps.view = null; renderApps(); refreshMounted(); rerenderAll();
      { const b = $(`#app-btn-${k}`); if (b) b.focus(); }
      toast(`${CONNS[k].name} ${lng('اتفصل', 'disconnected')}`, 'x'); break;
    }
    case 'lib-open': state.libPath[d.agent] = d.folder; renderDetails(); { const b = $('#lib-root'); if (b) b.focus(); } break;
    case 'lib-root': { const prev = state.libPath[d.agent]; state.libPath[d.agent] = null; renderDetails(); const b = $(`#lib-f-${prev}`); if (b) b.focus(); break; }
    case 'lib-preview': openPreview(d.agent, d.file); break;
    case 'lib-download': libDownload(libFind(d.agent, d.file)); break;
    case 'pv-close': closeDlg($('#preview')); break;
    case 'lib-show': { // from the toast after Canva: open SEO's «صور» folder
      const t = threads[d.thread]; if (!t) break;
      state.dpSettings = false; state.dpTab = 'files'; state.libPath[t.agent] = 'images'; state.detailsOpen = true;
      if ($('#sheet').open) closeSheet();
      openThread(d.thread);
      if (overlayDetails()) { const det = $('#details'); det.hidden = false; det.classList.add('is-open'); syncScrim(); }
      { const b = $('#lib-root'); if (b) b.focus({ preventScroll: true }); }
      break;
    }
    default: break;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'apps-q' && state.apps) { state.apps.q = e.target.value; const b = $('#apps-body'); if (b) b.innerHTML = appsListHTML(); }
});

/* ================= motion: friendly, state-driven (faces, press, drag, counters) =================
   Every movement answers something: the pointer, a click, an agent working or finishing, a card moving, a number
   arriving. Transform and opacity only; with reduced motion the faces stay still and the state changes alone. */
const MOT = { mx: null, my: null, raf: 0, running: new Set(), done: {}, hop: null, seenWait: null, newWait: {}, sbCount: null, drag: null, swallow: false, kpi: [], lastMove: null };
let liveQueued = false;
function scheduleLive() {
  if (liveQueued) return;
  liveQueued = true;
  window.requestAnimationFrame(() => { liveQueued = false; syncLive(); });
}
function runningAgents() {
  const s = new Set();
  Object.keys(threads).forEach((id) => { const r = threads[id].run; if (r && r.agent && AGENTS[r.agent] && !r.stopped) s.add(r.agent); });
  return s;
}
function applyLive(wrap, a, run, now) {
  if (!wrap || !a) return;
  const thinking = run.has(a);
  wrap.classList.toggle('is-thinking', thinking);
  const f = $('.face', wrap); if (f) f.classList.toggle('is-thinking', thinking);
  const dots = $('.think', wrap);
  if (thinking && !dots) wrap.insertAdjacentHTML('beforeend', '<span class="think" aria-hidden="true"><i></i><i></i><i></i></span>');
  if (!thinking && dots) dots.remove();
  const done = !thinking && MOT.done[a] > now;
  const ck = $('.done-ck', wrap);
  if (done && !ck) wrap.insertAdjacentHTML('beforeend', `<span class="done-ck" aria-hidden="true">${icon('check')}</span>`);
  if (!done && ck) ck.remove();
}
function syncLive() {
  const now = Date.now();
  const run = runningAgents();
  /* an agent that just stopped working gets a small check on its dot for a moment */
  MOT.running.forEach((a) => { if (!run.has(a)) { MOT.done[a] = now + 1600; window.setTimeout(scheduleLive, 1650); } });
  run.forEach((a) => { delete MOT.done[a]; });
  MOT.running = run;
  $$('.agent-tile[data-agent]').forEach((t) => applyLive($('.face-wrap', t), t.dataset.agent, run, now));
  $$('#details .face-wrap--lg').forEach((w) => { const f = $('.face', w); applyLive(w, f && f.dataset.face, run, now); });
  const pf = $('#btn-details > .face'); if (pf) pf.classList.toggle('is-thinking', run.has(pf.dataset.face));
  /* the face you just clicked hops — also its fresh copies after the click re-rendered the view */
  if (MOT.hop && MOT.hop.until > now) {
    $$(`.face--look[data-face="${MOT.hop.agent}"]`).forEach((f) => {
      if (f.dataset.hopped || !f.getBoundingClientRect().width) return;
      hopFace(f);
    });
  }
  syncWaitMarks();
}
function hopFace(f) {
  if (reduced()) return;
  f.dataset.hopped = '1';
  f.classList.remove('is-happy'); void f.getBoundingClientRect(); f.classList.add('is-happy');
  window.setTimeout(() => { f.classList.remove('is-happy'); }, 520);
}
/* «مستنيك» shakes once when a card newly lands in it; the sidebar count pops when it grows */
function syncWaitMarks() {
  const ids = new Set(waitingCards().map((c) => c.id));
  const now = Date.now();
  if (MOT.seenWait) ids.forEach((id) => { if (!MOT.seenWait.has(id)) MOT.newWait[id] = now + 1200; });
  MOT.seenWait = ids;
  Object.keys(MOT.newWait).forEach((id) => {
    if (MOT.newWait[id] < now) { delete MOT.newWait[id]; return; }
    $$(`.kcard[data-card="${id}"] .badge--wait, .corner-pill.is-waiting[data-card="${id}"]`).forEach((b) => {
      if (b.dataset.shook) return; b.dataset.shook = '1'; b.classList.add('is-new');
    });
  });
  const n = ids.size; const sc = $('#sb-nav .sb-count');
  if (sc && MOT.sbCount != null && n > MOT.sbCount && !sc.dataset.popped) { sc.dataset.popped = '1'; sc.classList.add('is-pop'); }
  MOT.sbCount = n;
}
new MutationObserver(scheduleLive).observe(document.body, { childList: true, subtree: true });

/* faces look toward the pointer (a small shift of the features, never the whole face) */
function lookFrame() {
  MOT.raf = 0;
  const vh = window.innerHeight;
  $$('.face--look').forEach((f) => {
    if (MOT.mx == null) { f.style.removeProperty('--fx'); f.style.removeProperty('--fy'); return; }
    const r = f.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > vh) return;
    const dx = MOT.mx - (r.left + r.width / 2); const dy = MOT.my - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1; const k = Math.min(1, d / 220);
    f.style.setProperty('--fx', `${((dx / d) * 1.6 * k).toFixed(2)}px`);
    f.style.setProperty('--fy', `${((dy / d) * 1.3 * k).toFixed(2)}px`);
  });
}
function lookReset() { MOT.mx = null; if (!MOT.raf) MOT.raf = window.requestAnimationFrame(lookFrame); }
document.documentElement.addEventListener('pointerleave', lookReset);
window.addEventListener('blur', lookReset);
/* a blink now and then, one face at a time */
window.setInterval(() => {
  if (reduced() || document.hidden) return;
  const list = $$('.face--look').filter((f) => !f.classList.contains('is-thinking') && $('.face__eye', f) && f.getBoundingClientRect().width);
  if (!list.length) return;
  const f = list[Math.floor(Math.random() * list.length)];
  f.classList.add('is-blink'); window.setTimeout(() => f.classList.remove('is-blink'), 140);
}, 1300);

/* the send arrow flies off; the button underneath turns into stop or rests */
function flySend(key) {
  if (reduced()) return;
  const b = $(`.composer__send[data-key="${key}"]`); if (!b) return;
  const r = b.getBoundingClientRect(); if (!r.width) return;
  const host = $$('dialog[open]').pop() || document.body;
  const fly = document.createElement('span');
  fly.className = 'send-fly'; fly.setAttribute('aria-hidden', 'true'); fly.innerHTML = icon('send');
  fly.style.left = `${r.left}px`; fly.style.top = `${r.top}px`; fly.style.width = `${r.width}px`; fly.style.height = `${r.height}px`;
  host.appendChild(fly);
  window.setTimeout(() => fly.remove(), 420);
}

/* ---- board: drag cards between columns (mouse), Shift + arrows (keyboard) ---- */
const BOARD_ORDER = COLS.map((c) => c.id);
function needsDecision(c) {
  if (c.col === 'waiting') return true;
  const t = c.thread && threads[c.thread];
  return !!(t && t.msgs.some((m) => m.card && m.card.status === 'pending' && /^(approval|hand|choice)$/.test(m.card.type)));
}
function blockReason(c, to) {
  if (!c || !to || to === c.col) return '';
  if (c.code) return 'code'; // a code card moves with Coder's work: building, merge request, merged
  if (c.screen && c.col === 'progress') return 'screen';
  if (needsDecision(c)) return 'decide';
  if (to === 'waiting') return 'waiting';
  return '';
}
function boardMove(id, to, beforeId) {
  const c = cardById(id); if (!c || !to) return false;
  const from = c.col;
  const why = blockReason(c, to);
  if (why === 'code') { toast(lng('كارت الكود بيتنقل لوحده مع شغل Coder: بيبني، بيفتح طلب الدمج، والدمج عليكم', 'A code card moves on its own with Coder’s work: building, the merge request, then your merge'), 'code'); later(260, () => openSheet(c.id)); return false; }
  if (why === 'screen') { toast(`${lng('الكارت ده ماشي مع شاشة', 'This card follows')} ${AGENTS[c.agent].name}${lng('، وهيتنقل لوحده', '’s screen and moves on its own')}`, 'monitor'); return false; }
  if (why === 'decide') {
    /* nothing goes live (or anywhere) past a pending decision: open it instead */
    toast(to === 'live' || to === 'done' ? lng('محتاج موافقتك الأول. قرّر هنا والكارت هيتنقل لوحده', 'It needs your OK first. Decide here and the card moves on its own') : lng('الكارت ده مستني قرارك. قرّر من المحادثة الأول', 'This card is waiting for your decision. Decide in the chat first'), 'hand');
    later(260, () => openSheet(c.id));
    return false;
  }
  if (why === 'waiting') { toast(lng('«مستنيك» بيتملا لوحده لما وكيل يحتاج موافقتك', '“Waiting on you” fills up on its own when an agent needs your OK'), 'clock'); return false; }
  const snap = { id, data: Object.assign({}, c), idx: cards.indexOf(c), note: null };
  if (to !== from) {
    let patch = {};
    if (to === 'live') patch = { prog: lng('لايف · لسه مفيش أرقام', 'Live · no numbers yet') };
    else if (to === 'done') patch = { prog: `${lng('خلصت ·', 'Done ·')} ${nowTime()}` };
    else if (to !== 'progress' && !(/^(ideas|planned)$/.test(from) && c.prog)) patch = { prog: `${lng('رجعت من «', 'Back from “')}${colName(from)}${lng('»', '”')}` };
    moveCard(id, to, patch);
    logAuto(ME(), meAct('نقل الكارت', 'نقلت الكارت', 'moved the card'), { card: id, from: colName(from), to: colName(to) });
    if (to === 'progress' && c.pct >= 96) c.pct = 10;
    const t = c.thread && threads[c.thread];
    if (t) {
      const note = { id: nid('n'), role: 'note', icon: 'board', text: `${lng('نقلتها على اللوحة لـ «', 'Moved on the board to “')}${colName(to)}${lng('»', '”')}`, fresh: true };
      t.msgs.push(note); snap.note = note.id;
    }
  }
  cards.splice(cards.indexOf(c), 1);
  let at = beforeId ? cards.findIndex((x) => x.id === beforeId) : -1;
  if (at < 0) { let last = -1; cards.forEach((x, i) => { if (x.col === to) last = i; }); at = last < 0 ? cards.length : last + 1; }
  cards.splice(at, 0, c);
  MOT.lastMove = snap;
  if (c.thread) refreshThread(c.thread);
  rerenderAll();
  if (to !== from) toast(`${lng('اتنقلت لـ «', 'Moved to “')}${colName(to)}${lng('»', '”')}`, 'check', { action: 'undo-move', label: lng('رجّعها', 'Undo') });
  return true;
}
function undoMove() {
  const s = MOT.lastMove; MOT.lastMove = null; if (!s) return;
  const c = cardById(s.id); if (!c) return;
  const was = c.col;
  Object.keys(c).forEach((k) => { delete c[k]; });
  Object.assign(c, s.data);
  if (was !== c.col) logAuto(ME(), meAct('رجّع الكارت', 'رجّعت الكارت', 'moved the card back'), { card: c.id, from: colName(was), to: colName(c.col) });
  cards.splice(cards.indexOf(c), 1); cards.splice(Math.min(s.idx, cards.length), 0, c);
  if (s.note && c.thread && threads[c.thread]) { const t = threads[c.thread]; const i = t.msgs.findIndex((m) => m.id === s.note); if (i >= 0) t.msgs.splice(i, 1); refreshThread(c.thread); }
  rerenderAll();
  const el = $(`#view-board .kcard[data-card="${s.id}"]`);
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); land(el); }
  toast(`${lng('رجعت لـ «', 'Back in “')}${colName(c.col)}${lng('»', '”')}`, 'check');
}
function land(el, from) {
  if (!el || reduced()) return;
  const nr = el.getBoundingClientRect();
  const dx = from ? from.left - nr.left : 0; const dy = from ? from.top - nr.top : -6;
  el.style.transition = 'none';
  el.style.transform = `translate(${dx}px, ${dy}px)${from ? ' rotate(2deg) scale(1.03)' : ''}`;
  void el.offsetWidth;
  el.style.transition = 'transform 320ms var(--ease-spring)';
  el.style.transform = '';
  el.classList.add('is-landing');
  window.setTimeout(() => { el.style.transition = ''; el.classList.remove('is-landing'); }, 380);
}
function colAt(x, y) {
  const n = document.elementFromPoint(x, y);
  const col = n && n.closest && n.closest('#board-cols .col');
  return col ? col.getAttribute('aria-labelledby').replace('col-', '') : null;
}
function clearDropMarks() {
  $$('#board-cols .is-over, #board-cols .is-blocked').forEach((n) => n.classList.remove('is-over', 'is-blocked'));
  $$('#board-cols .is-drop-before').forEach((n) => n.classList.remove('is-drop-before'));
  $$('#board-cols .is-drop-end').forEach((n) => n.classList.remove('is-drop-end'));
}
function dragStart(d) {
  const r = d.el.getBoundingClientRect();
  d.on = true; d.lastX = d.x0; d.tilt = 0; d.over = null; d.before = null;
  const g = d.el.cloneNode(true);
  ['data-action', 'data-card', 'aria-haspopup', 'aria-describedby', 'aria-keyshortcuts', 'aria-label'].forEach((a) => g.removeAttribute(a));
  $$('[id], [data-prog-t], [data-prog-bar]', g).forEach((n) => { n.removeAttribute('id'); n.removeAttribute('data-prog-t'); n.removeAttribute('data-prog-bar'); });
  g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1;
  g.classList.add('kcard--ghost');
  g.style.width = `${r.width}px`; g.style.left = `${r.left}px`; g.style.top = `${r.top}px`;
  document.body.appendChild(g);
  d.ghost = g;
  d.el.classList.add('is-drag-src');
  document.body.classList.add('is-dragging');
}
function dragMove(d, e) {
  const x = e.clientX; const y = e.clientY;
  d.tilt = reduced() ? 0 : Math.max(-6, Math.min(6, d.tilt * 0.6 + (x - d.lastX) * 0.45)); d.lastX = x;
  d.ghost.style.transform = `translate(${x - d.x0}px, ${y - d.y0}px) rotate(${(reduced() ? 0 : 2 + d.tilt).toFixed(2)}deg) scale(${reduced() ? 1 : 1.03})`;
  const c = cardById(d.id); const to = colAt(x, y);
  clearDropMarks(); d.over = to; d.before = null;
  if (to) {
    const colEl = $(`#board-cols .col[aria-labelledby="col-${to}"]`);
    if (blockReason(c, to)) colEl.classList.add('is-blocked');
    else {
      colEl.classList.add('is-over');
      const list = $$('.kcard', colEl).filter((k) => k.dataset.card !== d.id);
      const nx = list.find((k) => { const r = k.getBoundingClientRect(); return r.top + r.height / 2 > y; });
      if (nx) { d.before = nx.dataset.card; nx.classList.add('is-drop-before'); } else { const body = $('.col__body', colEl); if (body) body.classList.add('is-drop-end'); }
    }
  }
  /* near an edge of the board the columns scroll by themselves */
  const sc = $('#board-cols'); if (!sc) return;
  const b = sc.getBoundingClientRect();
  d.vx = x < b.left + 72 ? -12 : x > b.right - 72 ? 12 : 0;
  if (d.vx && !d.sraf) d.sraf = window.requestAnimationFrame(dragScroll);
}
function dragScroll() {
  const d = MOT.drag;
  if (!d || !d.on || !d.vx) { if (d) d.sraf = 0; return; }
  const sc = $('#board-cols'); if (sc) sc.scrollLeft += d.vx;
  d.sraf = window.requestAnimationFrame(dragScroll);
}
function dragEnd(d, cancel) {
  MOT.drag = null;
  clearDropMarks(); document.body.classList.remove('is-dragging');
  if (d.sraf) window.cancelAnimationFrame(d.sraf);
  MOT.swallow = true; window.setTimeout(() => { MOT.swallow = false; }, 60);
  const c = cardById(d.id);
  const gr = d.ghost.getBoundingClientRect();
  const sameSpot = c && d.over === c.col && (() => {
    const list = cards.filter((x) => x.col === c.col); const i = list.indexOf(c);
    return d.before ? (list[i + 1] && list[i + 1].id === d.before) : i === list.length - 1;
  })();
  const moved = !cancel && c && d.over && !sameSpot && boardMove(d.id, d.over, d.before);
  if (moved) {
    d.ghost.remove();
    const el = $(`#view-board .kcard[data-card="${d.id}"]`);
    if (el) { land(el, gr); el.focus({ preventScroll: true }); }
    return;
  }
  const src = document.body.contains(d.el) ? d.el : $(`#view-board .kcard[data-card="${d.id}"]`);
  const finish = () => { d.ghost.remove(); if (src) src.classList.remove('is-drag-src'); };
  if (!src || reduced()) { finish(); return; }
  const sr = src.getBoundingClientRect();
  d.ghost.style.transition = 'transform 220ms var(--ease-out)';
  d.ghost.style.transform = `translate(${sr.left - parseFloat(d.ghost.style.left)}px, ${sr.top - parseFloat(d.ghost.style.top)}px)`;
  window.setTimeout(finish, 230);
}
document.addEventListener('pointerdown', (e) => {
  const k = e.target.closest && e.target.closest('#view-board .kcard');
  if (!k || e.button !== 0 || e.pointerType === 'touch' || !canWrite()) return;
  MOT.drag = { el: k, id: k.dataset.card, x0: e.clientX, y0: e.clientY, on: false };
});
document.addEventListener('pointermove', (e) => {
  const d = MOT.drag;
  if (d) {
    if (!d.on && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    if (!d.on) dragStart(d);
    e.preventDefault(); dragMove(d, e);
    return;
  }
  if (e.pointerType === 'touch') return;
  if (!reduced()) { MOT.mx = e.clientX; MOT.my = e.clientY; if (!MOT.raf) MOT.raf = window.requestAnimationFrame(lookFrame); }
  chartHover(e);
}, { passive: false });
document.addEventListener('pointerup', () => { const d = MOT.drag; if (!d) return; if (d.on) dragEnd(d, false); else MOT.drag = null; });
document.addEventListener('pointercancel', () => { const d = MOT.drag; if (!d) return; if (d.on) dragEnd(d, true); else MOT.drag = null; });
document.addEventListener('keydown', (e) => {
  if (MOT.drag && MOT.drag.on && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dragEnd(MOT.drag, true); return; }
  const k = e.target.closest && e.target.closest('#view-board .kcard');
  if (!k || !e.shiftKey || !/^Arrow(Left|Right|Up|Down)$/.test(e.key) || !canWrite()) return;
  e.preventDefault();
  const id = k.dataset.card; const c = cardById(id); if (!c) return;
  let ok = false;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const to = BOARD_ORDER[BOARD_ORDER.indexOf(c.col) + ((e.key === 'ArrowLeft') === RTL ? 1 : -1)]; // next column: left in Arabic, right in English
    if (!to) return;
    ok = boardMove(id, to, null);
  } else {
    const list = $$('.kcard', k.closest('.col')).map((n) => n.dataset.card); const i = list.indexOf(id);
    if (e.key === 'ArrowUp' && i > 0) ok = boardMove(id, c.col, list[i - 1]);
    if (e.key === 'ArrowDown' && i < list.length - 1) ok = boardMove(id, c.col, list[i + 2] || null);
  }
  if (!ok) return;
  const el = $(`#view-board .kcard[data-card="${id}"]`);
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); land(el); }
}, true);
/* after a drag, the release must not open the card; a click on a face makes it hop */
window.addEventListener('click', (e) => {
  if (MOT.swallow && e.target.closest && e.target.closest('.kcard')) { e.stopPropagation(); e.preventDefault(); MOT.swallow = false; return; }
  const host = e.target.closest && e.target.closest('button, [data-action]');
  const f = (e.target.closest && e.target.closest('.face--look[data-face]')) || (host && $('.face--look[data-face]', host));
  if (f) { MOT.hop = { agent: f.dataset.face, until: Date.now() + 450 }; hopFace(f); }
  if (host && host.dataset.action === 'undo-move') undoMove();
}, true);

/* board: progress bars fill in when the board opens */
function boardEnter() {
  if (reduced()) return;
  const b = $('#view-board .board'); if (!b) return;
  b.classList.add('board--enter');
  window.setTimeout(() => { const n = $('#view-board .board'); if (n) n.classList.remove('board--enter'); }, 900);
}

/* ---- dashboard: numbers count to their value, bars rise, a crosshair reads any day ---- */
function countUp(node, from, to, dec) {
  const t0 = performance.now(); const dur = 650;
  const show = (v) => (dec ? fmt1(v) : fmt(Math.round(v)));
  const step = (t) => {
    if (!node.isConnected) return;
    const p = Math.min(1, (t - t0) / dur); const k = 1 - Math.pow(1 - p, 3);
    node.nodeValue = show(from + (to - from) * k);
    if (p < 1) window.requestAnimationFrame(step); else node.nodeValue = show(to);
  };
  node.nodeValue = show(from);
  window.requestAnimationFrame(step);
}
function dashEnter(fromPrev) {
  $$('#view-dashboard .kpi__val').forEach((el, i) => {
    const node = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.nodeValue.trim()); if (!node) return;
    const txt = node.nodeValue.trim(); const to = Number(txt.replace(/,/g, ''));
    if (!isFinite(to)) return;
    const from = fromPrev && MOT.kpi[i] != null ? MOT.kpi[i] : 0;
    MOT.kpi[i] = to;
    if (reduced() || from === to) return;
    countUp(node, from, to, txt.indexOf('.') >= 0);
  });
  const ch = $('#view-dashboard .chart');
  if (ch && !reduced()) { ch.classList.add('is-enter'); window.setTimeout(() => ch.classList.remove('is-enter'), 1300); }
}
function chartOff(wrap) {
  if (!wrap || !wrap.dataset.on) return;
  delete wrap.dataset.on;
  const svg = $('svg.chart', wrap); if (svg) { svg.classList.remove('is-hover'); $$('.bar-g.is-on', svg).forEach((g) => g.classList.remove('is-on')); }
  const tip = $('.chart-tip', wrap); if (tip) tip.hidden = true;
}
function chartHover(e) {
  const wrap = e.target.closest && e.target.closest('.chart-wrap');
  if (!wrap) { $$('.chart-wrap[data-on]').forEach(chartOff); return; }
  const svg = $('svg.chart', wrap); const tip = $('.chart-tip', wrap); if (!svg || !tip) return;
  const p = wrap.dataset.chart; const s = DATA[p] && DATA[p].series; if (!s) return;
  const n = s.meta.length; const W = 720; const L = 34; const R = 6; const cw = (W - L - R) / n;
  const r = svg.getBoundingClientRect(); const sx = ((e.clientX - r.left) * W) / r.width;
  const i = Math.floor((sx - L) / cw);
  if (i < 0 || i >= n) { chartOff(wrap); return; }
  if (wrap.dataset.on === String(i)) return;
  wrap.dataset.on = String(i);
  svg.classList.add('is-hover');
  $$('.bar-g', svg).forEach((g, k) => g.classList.toggle('is-on', k === i));
  const cx = L + cw * i + cw / 2;
  const hair = $('.chart__hair', svg); if (hair) { hair.setAttribute('x1', cx.toFixed(1)); hair.setAttribute('x2', cx.toFixed(1)); }
  const back = n - 1 - i; const tot = s.meta[i] + s.google[i] + s.seo[i];
  const row = (col, name, v) => `<span class="chart-tip__row"><i style="background:${col}"></i><bdi>${name}</bdi><span class="num">${v}</span></span>`;
  tip.innerHTML = `<span class="chart-tip__d">${esc(dayLabel(back))}</span><span class="chart-tip__tot"><span class="num">${tot}</span> ${lng('ليد', 'leads')}</span>
    ${row('var(--ch-meta)', 'Meta', s.meta[i])}${row('var(--ch-google)', 'Google', s.google[i])}${row('var(--ch-seo)', 'SEO', s.seo[i])}`;
  tip.hidden = false;
  const wr = wrap.getBoundingClientRect();
  const px = (cx / W) * r.width + (r.left - wr.left);
  const tw = tip.offsetWidth;
  let left = px + 14; if (left + tw > wr.width) left = px - 14 - tw;
  tip.style.transform = `translate(${Math.max(0, left).toFixed(0)}px, 6px)`;
}

/* ================= the main agent: handoffs in the same chat, new-agent proposals, team access =================
   G11 / «Make primary» in the Grok Bot reference: one agent is the front door. It hands work to the agent that owns it
   in the same conversation (only to agents this member is allowed), and a new agent is only ever a proposal until the
   Owner says yes. */
const JOB_OF = {
  ads: lng('الحملات والإعلانات عند وكيل الإعلانات', 'Campaigns and ads belong to the ads agent'),
  seo: lng('كتابة المقالات والمحتوى عند وكيل المحتوى', 'Articles and content belong to the content agent'),
  analyst: lng('التقارير والأرقام عند المحلل', 'Reports and numbers belong to the analyst'),
  critic: lng('المراجعة قبل النشر عند وكيل المراجعة', 'Pre-publish reviews belong to the review agent'),
};
function classifyWork(text) {
  if (/\/article|مقال|مقالة|\bSEO\b|سيو|كلمات مفتاحية|محتوى|بلوج/i.test(text)) return 'seo';
  if (/\/review|راجع|مراجعة/.test(text)) return 'critic';
  if (/\/report|تقرير|ملخص|أرقام|العائد|أنهي قناة/.test(text)) return 'analyst';
  if (/\/campaign|حملة|إعلان|اعلان|تكلفة الليد|ميزانية|\bMeta\b|\bGoogle\b|ميتا|جوجل/i.test(text)) return 'ads';
  return null;
}
const wantsNewAgent = (text) => /^\/agent\b|وكيل جديد|وكيل تاني|عايز وكيل|عاوز وكيل|محتاج وكيل|ضيف وكيل|اعمل وكيل|اعملي وكيل|اعملّي وكيل|اعملي حد|(?:عايز|عاوز|محتاج|محتاجين|عايزين)\s+حد\s+(?:يمسك|يتابع|يكتب|يعمل|يراجع|يرد|يراقب|يجهّز|يجهز|يدير)/.test(text);
/* a first message to the main agent doesn't open a board card by itself: the agent it hands to owns the card */
function dropNewCard(t, isNew) {
  if (!isNew || !t.card) return;
  const i = cards.findIndex((c) => c.id === t.card); if (i >= 0) cards.splice(i, 1);
  t.card = null;
}
function mainTurn(threadId, text, isNew) {
  const t = threads[threadId]; const main = state.main; const M = AGENTS[main];
  const job = classifyWork(text);
  /* the agent that does this job here: the seeded one, or one Lead made in this workspace for the same job */
  const want = job ? (canSee(job) ? job : visibleAgents().find((a) => !isMain(a) && AGENTS[a].job === job) || (AGENTS[job] && inWorld(job) ? job : null)) : null;
  /* nobody here does this job yet: Lead offers to make the agent, in one line */
  if (job && !want && canWrite()) { dropNewCard(t, isNew); offerAgent(threadId, job, text); return true; }
  if (!want || !AGENTS[want] || isMain(want)) { dropNewCard(t, isNew); return false; }
  const short = text.replace(/^\/\w+\s*/, '').trim();
  const quote = short.length > 34 ? `${short.slice(0, 32)}…` : short;
  if (canSee(want)) {
    const W = AGENTS[want];
    firstTaskSeen(want);
    const c = t.card ? cardById(t.card) : null;
    if (c) { c.agent = want; c.chan = W.role; addTouched(c, main); addTouched(c, want); }
    const steps = [
      { kind: 'reply', a: main, payload: { text: `ده شغل ${W.name}. هسلّمهوله هنا، وهيكمّل معاك في نفس المحادثة.`, activity: ACT.lead } },
      { kind: 'handoff', from: main, to: want, text: `${lng('اتسلّم لـ', 'Handed to')} ${W.name}`, detail: `«${quote}»` },
      { kind: 'reply', a: want, payload: replyFor(want, text).payload },
    ];
    if (isNew && c) steps.push({ kind: 'note', text: lng('الكارت ده اتضاف للوحة في «شغالين عليه»', 'This card was added to the board under “In progress”') });
    runSteps(threadId, steps, null, () => rerenderAll());
    return true;
  }
  /* the agent exists but this member isn't allowed it: say so (without showing it) and offer to ask the manager */
  dropNewCard(t, isNew);
  agentSays(threadId, main, {
    text: `${JOB_OF[want] || lng('الشغلانة دي عند وكيل تاني في الشركة', 'This job belongs to another agent in the company')}، ${lng('والوكيل ده مش متاح ليك. تحب أطلب من سارة (المديرة) تفتحهولك؟', 'and that agent isn’t available to you. Should I ask Sara (Manager) to open it for you?')}`,
    activity: ACT.lead,
    card: { type: 'askmgr', status: 'pending', want, by: state.as },
  }, () => rerenderAll());
  return true;
}
function askMgrHTML(t, m) {
  const c = m.card; const fresh = m.fresh ? ' card-in' : '';
  const head = `<div class="card__head"><span class="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true">${icon('team')}</span>
    <div class="card__titles"><span class="card__title">${lng('أطلبه من سارة؟', 'Ask Sara for it?')}</span><span class="card__sub">${bx(lng('سارة (المديرة) هي اللي بتختار كل واحد بيشتغل مع أنهي وكلاء.', 'Sara (Manager) chooses which agents each person works with.'))}</span></div></div>`;
  let out;
  if (c.status === 'asked') out = `<div class="card__outcome">${icon('check')}<span>${bx(`${lng('اتبعت لسارة ·', 'Sent to Sara ·')} ${c.at}${lng('. هيوصلك رد هنا لما توافق.', '. You’ll get an answer here when she approves.')}`)}</span></div>`;
  else if (c.status === 'no') out = `<div class="card__outcome">${icon('x')}<span>${lng('تمام، مفيش طلب اتبعت.', 'OK, no request was sent.')}</span></div>`;
  else if (!canWrite() || c.by !== state.as) out = waitLineHTML(`${lng('مستني رد', 'Waiting for')} ${PEOPLE[c.by].first}`);
  else out = `<div class="card__actions">
      <button type="button" class="btn btn--secondary" data-action="ask-mgr" data-answer="no" data-thread="${t.id}" data-msg="${m.id}">${lng('لا خلاص', 'No, never mind')}</button>
      <button type="button" class="btn btn--primary" data-action="ask-mgr" data-answer="yes" data-thread="${t.id}" data-msg="${m.id}">${lng('اطلب من سارة', 'Ask Sara')}</button></div>`;
  return `<div class="card${c.status === 'pending' ? '' : ' is-resolved'}${fresh}${justCls(c)}" role="group" aria-label="${lng('اطلبه من سارة', 'Ask Sara for it')}">${head}${out}</div>`;
}
function answerAskMgr(threadId, msgId, yes) {
  const t = threads[threadId]; const m = t && t.msgs.find((x) => x.id === msgId);
  if (!m || !m.card || m.card.status !== 'pending' || !canWrite()) return;
  m.card.status = yes ? 'asked' : 'no'; m.card.at = nowTime(); m.card.justAt = Date.now();
  bump(t);
  if (yes) state.events.unshift({ agent: state.main, t: `${lng('طلب من سارة تفتح وكيل لـ', 'Asked Sara to open an agent for')} ${me().first}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  refreshThread(threadId); rerenderAll();
  const ta = $('#ta-main') || $('#ta-sheet'); if (ta) ta.focus();
  toast(yes ? lng('الطلب اتبعت لسارة', 'Request sent to Sara') : lng('مفيش طلب اتبعت', 'No request sent'), yes ? 'check' : 'x');
}

/* ---- new-agent proposals: prepared by the main agent, created only when the Owner approves ---- */
const PROPS = {};
const PROP_INSTR = {
  wa: 'رد على أي ليد جديد في نفس اليوم برسالة بالعامية حسب سؤاله.\nماتبعتش لأي عميل بنفسك: جهّز الرسايل والقايمة وسلّمها للي طلب.\nأي سعر أو خصم في الرسالة لازم يطابق صفحة الكورس.',
  radar: 'ابعت اللي اتغيّر بس، مش كل الإعلانات.\nأي رقم عن منافس لازم يبقى معاه رابط المصدر.',
  news: 'النشرة كل أربع: عنوان، 3 أخبار، ودعوة للتسجيل.\nماتبعتش النشرة بنفسك: سيبها مسودة في Mailchimp.',
  social: 'بوستات بالعامية المصرية، ومن غير وعود «شغل مضمون».\nماتنشرش ولا ترد على تعليق بنفسك: جهّز وسلّم.',
};
const PP_TOOLS = ['wa', 'sheets', 'meta', 'gads', 'ga4', 'mail'];
function pickTemplate(text) {
  const byRole = TEMPLATES.find((tp) => text.includes(tp.role)); if (byRole) return byRole;
  const key = /واتساب|ليدز|متابعة/.test(text) ? 'wa' : /منافس/.test(text) ? 'radar' : /نيوزلتر|نشرة|إيميل|ايميل/.test(text) ? 'news'
    : /سوشيال|بوست|انستجرام|ريلز/.test(text) ? 'social' : /كلمات البحث|Google Ads|جوجل/.test(text) ? 'gads' : 'wa';
  return TEMPLATES.find((tp) => tp.id === key);
}
function uniqueName(n) {
  let nm = n; let k = 2;
  while (AGENT_ORDER.some((a) => AGENTS[a].name.toLowerCase() === nm.toLowerCase()) || Object.values(PROPS).some((p) => p.status === 'pending' && p.name === nm && (!threads[p.thread] || threadVisible(threads[p.thread])))) nm = `${n}${k++}`;
  return nm;
}
const memberNames = (list) => list.map((p) => PEOPLE[p].first).join(lng(' و', ' and '));
function askNewAgent(threadId, text, opts) {
  const t = threads[threadId]; const main = state.main; const M = AGENTS[main];
  const tp = (opts && opts.tpl && TEMPLATES.find((x) => x.id === opts.tpl)) || pickTemplate(text);
  const solo = isSolo();
  const m0 = text.match(/(?:عشان|علشان|لأن|لان)\s+(.+)$/);
  const why = (opts && opts.why) || (m0 ? m0[1] : text.replace(/^\/agent\s*/, '').replace(/[،,]?\s*(عشان|علشان)\s*$/, '')).trim() || lng('من غير سبب مكتوب', 'No reason written');
  const id = nid('pp');
  /* alone there is nobody to show it to: no «مين يشوفه» at all */
  const members = solo ? [] : [state.as, 'sara'].filter((p, i, arr) => p !== 'omar' && arr.indexOf(p) === i && inWs(p));
  const P0 = { id, tpl: tp.id, name: uniqueName(tp.name), role: tp.role, line: tp.line, instr: PROP_INSTR[tp.id] || `${tp.line}\n${tp.handoff || 'أي نشر أو صرف أو رسالة لعميل بيتسلّم للشخص.'}`,
    tools: tp.conns.slice(), model: state.defModel || 'Opus 5.5', members, by: state.as, why, look: Object.assign({}, tp.look), status: 'pending', thread: threadId, card: null, mode: null, draft: null };
  PROPS[id] = P0;
  const steps = [];
  if (!isMain(t.agent)) steps.push({ kind: 'handoff', from: t.agent, to: main, text: `${lng('اتسلّم لـ', 'Handed to')} ${M.name}`, detail: lng('طلب وكيل جديد', 'New-agent request') });
  steps.push({ kind: 'reply', a: main, payload: {
    text: solo ? 'تمام. جهّزتلك اقتراح وكيل جديد بالتفاصيل دي. راجعه ووافق عليه هنا، أو عدّله الأول. الوكيل مش هيتعمل غير لما تدوس «وافق».'
      : isOwner() ? 'تمام. جهّزت اقتراح وكيل جديد بالتفاصيل دي. راجعه، ولو تمام وافق عليه هنا، وهو مش هيتعمل غير بموافقتك.'
      : `تمام يا ${me().first}. جهّزت اقتراح وكيل جديد بالتفاصيل دي وبعته لعمر. الوكيل مش هيتعمل غير لما يوافق، وهقولك هنا أول ما يرد.`,
    activity: [lng('بيقرا طلبك', 'Reading your request'), lng('بيختار الأدوات والموديل', 'Choosing tools and model'), lng('بيكتب الاقتراح', 'Writing the proposal')],
    card: { type: 'proposal', pid: id } } });
  runSteps(threadId, steps, null, () => {
    const cid = nid('c');
    cards.unshift({ id: cid, col: 'waiting', title: `${lng('وكيل جديد:', 'New agent:')} ${P0.name}`, agent: main, chan: lng('اقتراح', 'Proposal'), due: '', thread: threadId, proposal: id,
      wait: solo ? lng('مستني موافقتك عشان يتعمل', 'Waiting for your OK to be created') : `${lng('طلبه', 'Asked for by')} ${PEOPLE[P0.by].first} · ${lng('مستني موافقتك', 'waiting for your OK')}` });
    P0.card = cid;
    logAuto(WHO.a(main), lng(`جهّز اقتراح وكيل جديد بطلب من ${AR_FIRST[P0.by]}`, `prepared a new-agent proposal for ${PEOPLE[P0.by].first}`), { obj: P0.name, only: [P0.by] });
    state.events.unshift({ agent: main, t: `${lng('جهّز اقتراح وكيل جديد', 'Prepared a new-agent proposal')} «${P0.name}» ${lng('بطلب من', 'at the request of')} ${PEOPLE[P0.by].first}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
    rerenderAll();
    if (!isOwner()) toast(lng('الاقتراح اتبعت لعمر. مفيش وكيل لحد ما يوافق', 'The proposal went to Omar. No agent until he approves'), 'clock');
  });
}
function proposalHTML(t, m) {
  const P0 = PROPS[m.card.pid]; if (!P0) return '';
  const fresh = m.fresh ? ' card-in' : ''; const pid = P0.id;
  const pending = P0.status === 'pending'; const owner = isOwner(); const solo = isSolo();
  const by = PEOPLE[P0.by];
  const toolsTxt = (list) => (list.length ? list.map((k) => `<bdi>${esc(CONNS[k].name)}</bdi>${state.conns[k] === 'connected' ? '' : lng(' (محتاج توصيل)', ' (needs connecting)')}`).join(lng('، ', ', ')) : lng('من غير أدوات', 'No tools'));
  const whoTxt = `${P0.members.length ? memberNames(P0.members) : lng('محدش غير المالك', 'Nobody but the Owner')}${lng(' · والمالك بيشوف كل الوكلاء', ' · and the Owner sees every agent')}`;
  const kv = (rows) => `<dl class="kv pp-kv">${rows.map(([k, v]) => `<div class="kv__row"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const top = pending
    ? (owner ? `<span class="badge badge--wait"><span class="dot dot--waiting" aria-hidden="true"></span>${lng('مستنيك', 'Waiting on you')}</span>` : `<span class="badge">${icon('clock')}${lng('مستني موافقة المالك', 'Waiting for the Owner’s OK')}</span>`)
    : `<span class="badge">${icon(P0.status === 'approved' ? 'check' : 'x')}${P0.status === 'approved' ? lng('اتوافق عليه', 'Approved') : lng('اترفض', 'Declined')}</span>`;
  const head = `<div class="hcard__top">${top}</div><div class="card__head">${lookFace(P0.look, 44)}
    <div class="card__titles"><span class="card__title">${lng('اقتراح وكيل جديد:', 'New agent proposal:')} <bdi>${esc(P0.name)}</bdi></span><span class="card__sub">${bx(`${lng('جهّزه', 'Prepared by')} ${AGENTS[state.main].name} ${solo ? lng('· بيتعمل بس لما توافق', '· created only when you approve') : lng('· بيتعمل بس لما عمر يوافق', '· created only when Omar approves')}`)}</span></div></div>`;
  /* the Owner edits the same fields, then approves */
  if (pending && owner && P0.mode === 'edit') {
    const D = P0.draft;
    const cands = PP_TOOLS.concat(D.tools.filter((k) => !PP_TOOLS.includes(k)));
    return `<div class="card pp-card${fresh}" role="group" aria-label="${lng('عدّل الاقتراح:', 'Edit the proposal:')} ${esc(P0.name)}">${head}
      <div class="pp-form">
        <div class="set-field"><label class="set-label" for="pp-name-${pid}">${lng('الاسم', 'Name')}</label>
          <input class="set-input" id="pp-name-${pid}" type="text" dir="auto" maxlength="20" autocomplete="off" data-pp="name" data-pid="${pid}" value="${esc(D.name)}" aria-describedby="pp-name-err-${pid}" aria-required="true">
          <span class="set-err" id="pp-name-err-${pid}" ${D.err ? '' : 'hidden'}>${esc(D.err || '')}</span></div>
        <div class="set-field"><label class="set-label" for="pp-role-${pid}">${lng('الشغلانة', 'Job')}</label>
          <input class="set-input" id="pp-role-${pid}" type="text" maxlength="40" autocomplete="off" data-pp="role" data-pid="${pid}" value="${esc(D.role)}"></div>
        <div class="set-field"><label class="set-label" for="pp-instr-${pid}">${lng('التعليمات', 'Instructions')}</label>
          <textarea class="set-input set-textarea" id="pp-instr-${pid}" rows="4" data-pp="instr" data-pid="${pid}">${esc(D.instr)}</textarea></div>
        <div class="set-field"><span class="set-label" id="pp-tools-l-${pid}">${lng('الأدوات والتطبيقات', 'Tools and apps')}</span>
          <div class="pp-chips" role="group" aria-labelledby="pp-tools-l-${pid}">${cands.map((k) => `<button type="button" class="chip pp-chip" role="checkbox" id="pp-tool-${pid}-${k}" aria-checked="${D.tools.includes(k)}" data-action="pp-tool" data-pid="${pid}" data-k="${k}">${tile(k)}<bdi>${esc(CONNS[k].name)}</bdi></button>`).join('')}</div></div>
        <div class="set-field"><span class="set-label" id="pp-model-l-${pid}">${lng('الموديل', 'Model')}</span>
          <div class="segmented segmented--field" role="radiogroup" aria-labelledby="pp-model-l-${pid}">${MODELS.map((x, i) => `<button type="button" role="radio" id="pp-model-${pid}-${i}" aria-checked="${x.n === D.model}" tabindex="${x.n === D.model ? 0 : -1}" data-action="pp-model" data-pid="${pid}" data-model="${esc(x.n)}"><bdi>${esc(x.n)}</bdi></button>`).join('')}</div></div>
        ${solo ? '' : `<div class="set-field"><span class="set-label" id="pp-mem-l-${pid}">${lng('مين يشوفه', 'Who sees it')}</span>
          <div class="panel-card" role="group" aria-labelledby="pp-mem-l-${pid}">${roster().filter((p) => p !== 'omar').map((p) => { const on = D.members.includes(p); return `<button type="button" class="panel-row tm-pick" role="checkbox" id="pp-mem-${pid}-${p}" aria-checked="${on}" data-action="pp-member" data-pid="${pid}" data-person="${p}">
            <span class="me__av pp-av" aria-hidden="true">${PEOPLE[p].av}</span><span class="panel-row__text"><span class="panel-row__t">${PEOPLE[p].name}</span><span class="panel-row__d">${PEOPLE[p].title}${PEOPLE[p].job ? ` · ${PEOPLE[p].job}` : ''}</span></span><span class="tm-check" aria-hidden="true">${on ? icon('check') : ''}</span></button>`; }).join('')}
            <div class="panel-row"><span class="me__av pp-av" aria-hidden="true">${PEOPLE.omar.av}</span><span class="panel-row__text"><span class="panel-row__t">${PEOPLE.omar.name}</span><span class="panel-row__d">${lng('المالك بيشوف كل الوكلاء', 'The Owner sees every agent')}</span></span></div></div></div>`}
      </div>
      <div class="card__actions"><button type="button" class="btn btn--secondary" data-action="pp-edit-cancel" data-pid="${pid}">${lng('إلغاء', 'Cancel')}</button>
        <button type="button" class="btn btn--primary" data-action="pp-approve" data-pid="${pid}" data-edited="1" id="pp-go-${pid}">${lng('وافق بالتعديلات', 'Approve with changes')}</button></div></div>`;
  }
  const rows = kv([
    [lng('الاسم', 'Name'), `<bdi>${esc(P0.name)}</bdi> · <bdi>${esc(handleFor(P0.name))}</bdi>`],
    [lng('الشغلانة', 'Job'), `${bx(P0.role)}<span class="pp-sub">${bx(P0.line)}</span>`],
    [lng('التعليمات', 'Instructions'), P0.instr.split('\n').map(bx).join('<br>')],
    [lng('الأدوات', 'Tools'), `<span class="pp-tools">${P0.tools.map((k) => tile(k)).join('')}</span>${toolsTxt(P0.tools)}`],
    [lng('الموديل', 'Model'), `<bdi>${esc(P0.model)}</bdi>`],
  ].concat(solo ? [[lng('ليه', 'Why'), bx(P0.why)]] : [
    [lng('مين يشوفه', 'Who sees it'), bx(whoTxt)],
    [lng('طلبه', 'Asked by'), `${by.name} (${by.title}${by.job ? ` · ${by.job}` : ''})<span class="pp-sub">${lng('ليه:', 'Why:')} ${bx(P0.why)}</span>`],
  ]));
  let out;
  if (P0.status === 'approved') {
    out = `<div class="card__outcome">${icon('check')}<span>${bx(P0.solo ? `${lng('وافقت ·', 'You approved ·')} ${P0.at}. ${P0.name} ${lng('ظهر في قايمة الوكلاء.', 'now shows in the agent list.')}` : `${lng('عمر وافق ·', 'Omar approved ·')} ${P0.at}. ${P0.name} ${lng('ظهر في قايمة الوكلاء عند', 'now shows in the agent list for')} ${P0.members.length ? memberNames(P0.members) : lng('المالك', 'the Owner')}.`)}</span>
      ${P0.agent && canSee(P0.agent) ? `<button type="button" class="link-btn" data-action="open-agent" data-agent="${P0.agent}">${bx(`${lng('افتح', 'Open')} ${P0.name}`)}</button>` : ''}</div>`;
  } else if (P0.status === 'rejected') {
    out = `<div class="card__outcome pp-out">${icon('x')}<span>${bx(P0.solo ? `${lng('رفضته ·', 'You declined ·')} ${P0.at}. ${lng('مفيش وكيل اتعمل.', 'No agent was created.')}${P0.reason ? ` ${lng('السبب:', 'Reason:')} «${P0.reason}»` : ''}` : `${lng('عمر رفض ·', 'Omar declined ·')} ${P0.at}. ${lng('السبب:', 'Reason:')} «${P0.reason}»`)}</span></div>`;
  } else if (!owner) {
    out = waitLineHTML(lng('مستني موافقة المالك. لحد ما عمر يرد مفيش وكيل اتعمل.', 'Waiting for the Owner’s OK. Until Omar answers, no agent exists.'));
  } else if (P0.mode === 'reject') {
    out = solo ? `<div class="pp-form"><div class="set-field"><label class="set-label" for="pp-why-${pid}">${lng('سبب الرفض (اختياري)', 'Reason for declining (optional)')}</label>
        <textarea class="set-input set-textarea" id="pp-why-${pid}" rows="3" data-pp="reason" data-pid="${pid}" placeholder="${lng('مثلاً: Ads بيتابع ليدز واتساب دلوقتي، نجرّبه شهر الأول.', 'e.g. Ads follows WhatsApp leads now, let’s try that for a month first.')}" aria-describedby="pp-why-hint-${pid}">${esc(P0.reasonDraft || '')}</textarea>
        <span class="set-hint" id="pp-why-hint-${pid}">${lng('السبب بيتكتب في السجل، عشان ترجعله بعدين.', 'The reason goes into the log, so you can come back to it.')}</span></div></div>
      <div class="card__actions"><button type="button" class="btn btn--secondary" data-action="pp-reject-cancel" data-pid="${pid}">${lng('إلغاء', 'Cancel')}</button>
        <button type="button" class="btn btn--primary" data-action="pp-reject" data-pid="${pid}">${lng('ارفض', 'Decline')}</button></div>`
    : `<div class="pp-form"><div class="set-field"><label class="set-label" for="pp-why-${pid}">${lng('سبب الرفض', 'Reason for declining')}</label>
        <textarea class="set-input set-textarea" id="pp-why-${pid}" rows="3" data-pp="reason" data-pid="${pid}" placeholder="${lng('مثلاً: Ads بيتابع ليدز واتساب دلوقتي، نجرّبه شهر الأول.', 'e.g. Ads follows WhatsApp leads now, let’s try that for a month first.')}" aria-describedby="pp-why-err-${pid} pp-why-hint-${pid}" aria-required="true">${esc(P0.reasonDraft || '')}</textarea>
        <span class="set-err" id="pp-why-err-${pid}" ${P0.reasonErr ? '' : 'hidden'}>${bx(`${lng('اكتب السبب، عشان', 'Write the reason, so')} ${by.first} ${lng('يعرف ليه.', 'knows why.')}`)}</span>
        <span class="set-hint" id="pp-why-hint-${pid}">${bx(`${lng('السبب هيوصل لـ', 'The reason goes to')} ${by.first} ${lng('في نفس المحادثة.', 'in this same chat.')}`)}</span></div></div>
      <div class="card__actions"><button type="button" class="btn btn--secondary" data-action="pp-reject-cancel" data-pid="${pid}">${lng('إلغاء', 'Cancel')}</button>
        <button type="button" class="btn btn--primary" data-action="pp-reject" data-pid="${pid}">${lng('ارفض', 'Decline')}</button></div>`;
  } else {
    out = `<div class="card__actions">
      <button type="button" class="btn btn--secondary" data-action="pp-reject-open" data-pid="${pid}" id="pp-no-${pid}">${lng('ارفض', 'Decline')}</button>
      <button type="button" class="btn btn--secondary" data-action="pp-edit" data-pid="${pid}" id="pp-edit-${pid}">${lng('عدّل وبعدين وافق', 'Edit, then approve')}</button>
      <button type="button" class="btn btn--primary" data-action="pp-approve" data-pid="${pid}" id="pp-ok-${pid}">${lng('وافق', 'Approve')}</button></div>`;
  }
  return `<div class="card pp-card${pending ? '' : ' is-resolved'}${fresh}${justCls(P0)}" role="group" aria-label="${lng('اقتراح وكيل جديد:', 'New agent proposal:')} ${esc(P0.name)}">${head}${rows}${out}</div>`;
}
const ppRefresh = (P0, focusId) => {
  refreshThread(P0.thread); rerenderAll();
  if (focusId) window.requestAnimationFrame(() => { const n = document.getElementById(focusId); if (n) n.focus(); });
};
function approveProposal(pid, edited) {
  const P0 = PROPS[pid]; if (!P0 || P0.status !== 'pending' || !isOwner()) return;
  if (edited) {
    const D = P0.draft; const nm = D.name.trim();
    const clash = AGENT_ORDER.some((k) => AGENTS[k].name.toLowerCase() === nm.toLowerCase());
    if (!nm || clash) { D.err = !nm ? lng('الوكيل محتاج اسم، ولو كلمة واحدة.', 'The agent needs a name, even one word.') : lng('فيه وكيل بالاسم ده. اختار اسم تاني.', 'There’s already an agent with this name. Pick another one.'); ppRefresh(P0, `pp-name-${pid}`); return; }
    Object.assign(P0, { name: nm, role: D.role.trim() || P0.role, instr: D.instr, tools: D.tools.slice(), model: D.model, members: D.members.slice() });
  }
  const tp = TEMPLATES.find((x) => x.id === P0.tpl) || {};
  const id = nid('ag');
  AGENTS[id] = {
    name: P0.name, handle: handleFor(P0.name), role: P0.role, custom: true, kind: 'team', tpl: P0.tpl,
    desc: `${P0.line}${tp.handoff ? ' ' + tp.handoff : ''}`, line: P0.line, handoff: tp.handoff || '', reply: tp.reply || '', routineEx: tp.routineEx || '',
    example: tp.example || 'قولي هتساعدني في إيه، وإيه الأدوات اللي محتاجها',
    conns: P0.tools.slice(), routines: [], files: [], perms: [], memory: [],
    model: P0.model, effort: state.defEffort || 'medium', instr: P0.instr, paused: false, checkinOn: true, checkinTime: '9:00',
    voiceLang: 'ar-EG', voice: 'noor', voiceSpeed: '1',
    skills: (tp.skills || []).map(([t0, d0]) => ({ t: t0, d: d0, on: true })),
    toolsOn: Object.fromEntries(P0.tools.map((k) => [k, true])),
  };
  FACES[id] = lookFill(P0.look);
  AGENT_ORDER.push(id);
  VOICE_SAMPLE[id] = AGENTS[id].example;
  P0.members.forEach((p) => { ACCESS[p] = ACCESS[p] || []; if (!ACCESS[p].includes(id)) ACCESS[p].push(id); });
  const solo = isSolo();
  Object.assign(P0, { status: 'approved', agent: id, at: nowTime(), mode: null, draft: null, justAt: Date.now(), solo });
  const names = P0.members.length ? memberNames(P0.members) : lng('المالك', 'the Owner');
  logAuto(ME(), meAct('وافق على وكيل جديد', 'وافقت على وكيل جديد', 'approved a new agent'), { agent: id, obj: P0.name, from: lng('اقتراح', 'Proposal'), to: solo ? lng('ظهر في قايمة الوكلاء', 'Shows in the agent list') : `${lng('ظهر عند', 'Shows for')} ${names}` });
  if (P0.card) sysMove(P0.card, 'done', { prog: solo ? lng('اتعمل بموافقتك', 'Created with your OK') : `${lng('اتعمل · ظهر عند', 'Created · shows for')} ${names}`, wait: '' });
  state.events.unshift({ agent: id, t: solo ? lng('اتعمل بعد ما وافقت على الاقتراح', 'was created after you approved the proposal') : `${lng('انضم للفريق بعد موافقة عمر، بطلب من', 'joined the team after Omar approved, at the request of')} ${PEOPLE[P0.by].first}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  ppRefresh(P0);
  toast(solo ? `${P0.name} ${lng('اتعمل وظهر في قايمة الوكلاء', 'was created and shows in the agent list')}` : `${P0.name} ${lng('اتعمل وظهر عند', 'was created and shows for')} ${names}`);
  agentSays(P0.thread, state.main, { text: solo ? `تمام، ${P0.name} اتعمل${edited ? ' بالتعديلات بتاعتك' : ''} وظهر في قايمة الوكلاء. ابدأ معاه من صفحته، أو قولّي هنا وأنا أسلّمهوله.` : `عمر وافق على ${P0.name}${edited ? ' بعد ما عدّل التفاصيل' : ''}. ظهر في قايمة الوكلاء عند ${names}، وتقدروا تبدأوا معاه من دلوقتي.`, activity: [lng('بيضيف الوكيل للفريق', 'Adding the agent to the team')] }, () => rerenderAll());
}
function rejectProposal(pid) {
  const P0 = PROPS[pid]; if (!P0 || P0.status !== 'pending' || !isOwner()) return;
  const why = (P0.reasonDraft || '').trim(); const solo = isSolo();
  if (!why && !solo) { P0.reasonErr = true; ppRefresh(P0, `pp-why-${pid}`); const n = $(`#pp-why-${pid}`); if (n) n.setAttribute('aria-invalid', 'true'); return; }
  Object.assign(P0, { status: 'rejected', reason: why, at: nowTime(), mode: null, reasonErr: false, justAt: Date.now(), solo });
  logAuto(ME(), meAct('رفض اقتراح وكيل', 'رفضت اقتراح وكيل', 'declined a new-agent proposal'), { obj: P0.name, from: lng('اقتراح', 'Proposal'), to: why || lng('من غير سبب مكتوب', 'No reason written'), only: [P0.by] });
  if (P0.card) sysMove(P0.card, 'done', { prog: lng('اقتراح اترفض', 'Proposal declined'), wait: '' });
  ppRefresh(P0);
  toast(solo ? lng('اترفض، ومفيش وكيل اتعمل', 'Declined. No agent was created') : `${lng('اترفض. السبب وصل لـ', 'Declined. The reason went to')} ${PEOPLE[P0.by].first}`, 'x');
  agentSays(P0.thread, state.main, { text: solo ? `تمام، مش هعمل ${P0.name}.${why ? ` كتبت السبب في السجل: «${why}»` : ''}\nلو حبيت نعدّل الاقتراح ونجرّب تاني، قولّي هنا.` : `عمر رفض اقتراح ${P0.name}. السبب: «${why}»\nلو عايز نعدّل الاقتراح ونبعته تاني، قولي هنا.`, activity: [lng('بيبلّغ اللي طلب', 'Telling the person who asked')] }, () => rerenderAll());
}

/* ================= agents come from asking Lead in plain words =================
   The workspace starts with Lead alone. You get a new agent by asking Lead in your own words: for the Owner it is made at
   once (no approve step) and a card in the chat says what was made; Lead asks at most one question, only when it truly
   needs it. A member's ask becomes the same card as a request in the Owner's «مستنيك»; a viewer can't ask. Every agent
   says when it was made and who asked. You change an agent by telling it («من دلوقتي…»). */
Object.assign(ICONS, {
  userPlus: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M18.5 8v6M15.5 11h6"/>',
});
/* what Lead can make, read from the person's words. `ask` is the one question worth asking before making it. */
const BP = {
  ads: { job: 'ads', name: 'Ads', face: 'ads', role: lng('وكيل الإعلانات', 'Ads agent'), short: lng('حملات Meta وGoogle', 'Meta and Google campaigns'),
    line: 'بيخطط حملات Meta وGoogle ويطلقها ويتابعها، ويوقف أي إعلان بيصرف على الفاضي.', apps: ['meta', 'gads', 'ga4'], tpl: 'meta',
    ask: { q: 'الميزانية الشهرية تقريبًا كام؟', why: 'هحطها حد ميعدّيهوش من غير ما يسألك.', opts: ['10,000 ج', '20,000 ج', '30,000 ج'] },
    made: 'هيبدأ يقرا حساباتك على Meta وGoogle، وأي نشر أو صرف أو رسالة لعميل هيرجعلك فيها قبل ما يعملها.',
    reply: 'تمام. هقرا نتايج الحملات اللي فاتت الأول وأرجعلك بخطة وتوزيع للميزانية. مش هطلق ولا هصرف أي حاجة قبل موافقتك.',
    example: 'اعمل خطة حملة رمضان لكورس المحاسب الشامل بميزانية 20,000 ج', re: /إعلان|اعلان|حملات|حملة|\bMeta\b|\bGoogle\b|ميتا|جوجل|ميديا باي/i },
  social: { job: 'social', name: 'Social', look: { shape: 'calm', color: 'mint' }, role: lng('وكيل السوشيال', 'Social agent'), short: lng('السوشيال', 'social media'),
    line: 'بيكتب بوستات وريلز لصفحة الأكاديمية، ويجهّز ردود على التعليقات اللي بتتكرر.', apps: ['meta', 'tiktok', 'canva'], tpl: 'social',
    made: 'هيكتب البوستات والردود ويسيبها مسودة. النشر والرد على الناس عليك انت.',
    reply: 'تمام. هكتب 3 بوستات بزاوية مختلفة لكل واحد وأحطهم هنا تختار. مش هنشر حاجة، انت اللي تنشر من الصفحة.',
    example: 'اكتب 3 بوستات للدفعة الجديدة من المحاسب الشامل بلهجة مصرية', re: /سوشيال|بوست|انستجرام|إنستجرام|Instagram|TikTok|تيك ?توك|ريلز/i },
  wa: { job: 'wa', name: 'FollowUp', look: { shape: 'brow', color: 'sage' }, role: lng('متابع ليدز واتساب', 'WhatsApp lead follow-up'), short: lng('متابعة ليدز واتساب', 'WhatsApp lead follow-up'),
    line: 'بيفرز الليدز الجديدة، ويكتب رسالة متابعة لكل واحد حسب سؤاله.', apps: ['wa', 'sheets'], tpl: 'wa',
    made: 'هيجهّز الرسايل والقايمة، وانت اللي تبعت من رقم الأكاديمية.',
    reply: 'تمام. هفرز الليدز اللي مردوش وأكتب رسالة لكل واحد حسب سؤاله. مش هبعت لحد، هسلّمك القايمة والرسايل جاهزة تبعتها انت.',
    example: 'جهّز رسايل متابعة لليدز اللي مردوش من يومين', re: /واتساب|ليدز|متابعة الليد/ },
  seo: { job: 'seo', name: 'Content', look: { shape: 'specs', color: 'slate' }, role: lng('وكيل المحتوى والسيو', 'Content & SEO agent'), short: lng('المقالات والسيو', 'articles and SEO'),
    line: 'بيبحث عن الكلمات ويكتب المقالات، ويسيبها مسودة على WordPress.', apps: ['gsc', 'wp'], tpl: 'writer',
    made: 'هيسيب كل مقال مسودة على WordPress، والنشر عليك انت.', reply: 'تمام. هبحث الكلمة الأول وأرجعلك بعنوانين وهيكل المقال قبل ما أكتب.',
    example: 'اكتب مقال عن الفرق بين المحاسب والمراجع في 1,500 كلمة', re: /مقال|\bSEO\b|سيو|محتوى|بلوج|مدونة/i },
  analyst: { job: 'analyst', name: 'Numbers', look: { shape: 'bars', color: 'mint' }, role: lng('محلل الأرقام', 'Numbers analyst'), short: lng('التقارير والأرقام', 'reports and numbers'),
    line: 'بيقرا أرقام Meta وGoogle وشيت المبيعات، ويكتب التقرير الأسبوعي. قراية بس.', apps: ['meta', 'gads', 'sheets'], tpl: 'numbers',
    made: 'بيقرا بس ومبيغيّرش أي حاجة في الحسابات.', reply: 'تمام. هقرا الأرقام وأرجعلك بالخلاصة في 3 نقط وبعدها الجدول.',
    example: 'ابعتلي ملخص آخر 7 أيام لكل القنوات', re: /تقرير|تقارير|أرقام|ارقام|تحليل|العائد/ },
  critic: { job: 'critic', name: 'Review', look: { shape: 'brow', color: 'stone' }, role: lng('المراجع', 'Reviewer'), short: lng('المراجعة قبل النشر', 'pre-publish reviews'),
    line: 'بيراجع أي إعلان أو مقال قبل ما يطلع: الوعود والأرقام واللهجة.', apps: [], tpl: 'hook',
    made: 'هيعلّق على كل سطر لوحده، ومش بيغيّر حاجة من غير ما ترجعله.', reply: 'تمام. ابعتلي النص وهعلّق على كل سطر: الوعود والأرقام واللهجة.',
    example: 'راجع نص إعلان الريلز الجديد قبل ما يتنشر', re: /راجع|مراجعة|يراجع|مراجع/ },
  radar: { job: 'radar', name: 'Radar', look: { shape: 'spark', color: 'lilac' }, role: lng('متابع المنافسين', 'Competitor watcher'), short: lng('متابعة المنافسين', 'competitor watching'),
    line: 'بيتابع إعلانات وأسعار الأكاديميات المنافسة في مصر والسعودية، ويبعتلك اللي اتغيّر بس.', apps: [], tpl: 'radar',
    made: 'هيبعتلك اللي اتغيّر بس، ومعاه رابط المصدر.', reply: 'تمام. هبص على مكتبة إعلانات Meta وصفحات المنافسين، وأبعتلك اللي اتغيّر بس.',
    example: 'شوف إعلانات المنافسين على Meta الأسبوع ده وقولي إيه الجديد', re: /منافس/ },
  news: { job: 'news', name: 'Letters', look: { shape: 'calm', color: 'lilac' }, role: lng('كاتب النيوزلتر', 'Newsletter writer'), short: lng('النيوزلتر', 'the newsletter'),
    line: 'بيكتب النشرة الأسبوعية للمشتركين، ويسيبها مسودة في Mailchimp.', apps: ['mail', 'sheets'], tpl: 'news',
    made: 'هيسيب النشرة مسودة، ومش هتتبعت غير لما انت تدوس إرسال.', reply: 'تمام. هجمع أخبار الأسبوع وأكتب النشرة بـ 3 عناوين تختار منهم.',
    example: 'جهّز نيوزلتر الأسبوع ده عن خصم الدفعة الجديدة', re: /نيوزلتر|نشرة|إيميل|ايميل/ },
};
const BP_ORDER = ['radar', 'news', 'social', 'critic', 'analyst', 'seo', 'ads', 'wa'];
const bpFor = (text) => BP_ORDER.find((k) => BP[k].re.test(text)) || null;
/* a ready-made gallery role, asked for through Lead */
function bpFromTpl(id) {
  const tp = TEMPLATES.find((x) => x.id === id); if (!tp) return null;
  const k = `tpl-${id}`;
  BP[k] = BP[k] || { job: `tpl-${id}`, name: tp.name, look: Object.assign({}, tp.look), role: tp.role, short: tp.role, line: tp.line, apps: tp.conns.slice(), tpl: tp.id, gallery: true,
    made: tp.handoff || 'أي نشر أو صرف أو رسالة لعميل هيرجعلك فيها الأول.', reply: tp.reply, example: tp.example, re: /$^/ };
  return k;
}
/* «عايز حد…» with no job Lead can read: its one question is what the agent should do */
function bpCustom(answer) {
  const k = nid('bp');
  const role = answer.replace(/^(?:يعني\s+)?/, '').trim();
  BP[k] = { job: k, name: 'Helper', look: { shape: 'round', color: 'sky' }, role: role.length > 34 ? `${role.slice(0, 32)}…` : role, short: role, line: `بيعمل ده: ${role}.`, apps: [],
    made: 'أي نشر أو صرف أو رسالة لعميل هيرجعلك فيها الأول.', reply: 'تمام، فهمت. هبدأ وأسألك عن أي حاجة ناقصة.', example: 'قولي هتبدأ بإيه، وإيه اللي محتاجه مني', re: /$^/ };
  return k;
}
/* what was made (or asked for), shared by the chat card, «مستنيك» and the agent's own page */
const MADE = {};
const nameFor = (base) => { let n = base; let i = 2; const taken = (x) => AGENT_ORDER.some((a) => inWorld(a) && AGENTS[a].name.toLowerCase() === x.toLowerCase()) || Object.values(MADE).some((P) => P.status === 'pending' && P.world === state.world && P.name === x); while (taken(n)) n = `${base}${i++}`; return n; };
const firstName = (p) => (p === state.as ? lng('انت', 'you') : PEOPLE[p] ? PEOPLE[p].first : '');
const existingFor = (job) => visibleAgents().find((a) => !isMain(a) && (a === job || AGENTS[a].job === job)) || null;
const evAdd = (e) => state.events.unshift(Object.assign(state.world === 'fresh' ? { ws: 'fresh' } : {}, e));
const NEVER = () => [lng('ينشر حاجة', 'Publish anything'), lng('يصرف فلوس', 'Spend money'), lng('يبعت لعميل', 'Message a customer')];

/* «اتعمل يوم … بطلب من …» on every agent's page */
function bornText(a) {
  const A = AGENTS[a]; const B = A && A.born; if (!B) return '';
  if (B.first) return B.today ? lng('موجود من أول يوم في المساحة · النهارده', 'Here since the workspace’s first day · today') : `${lng('موجود من أول يوم في المساحة ·', 'Here since the workspace’s first day ·')} ${lng(B.d, B.en)}`;
  const when = B.today ? `${lng('النهارده', 'today at')} ${B.at}` : `${lng('يوم', 'on')} ${lng(B.d, B.en)}`;
  const who = B.by === state.as ? lng('بطلب منك', 'at your request') : `${lng('بطلب من', 'at the request of')} ${PEOPLE[B.by] ? PEOPLE[B.by].first : ''}`;
  const ok = B.ok && B.ok !== B.by ? ` · ${lng('وافق', 'approved by')} ${B.ok === state.as ? lng('انت', 'you') : PEOPLE[B.ok].first}` : '';
  const gal = B.gallery ? ` · ${lng('من الجاهزين', 'from the ready-made agents')}` : '';
  return `${lng('اتعمل', 'Made')} ${when} ${who}${ok}${gal}`;
}
function bornHTML(a, where) {
  const txt = bornText(a); if (!txt) return '';
  const B = AGENTS[a].born; const th = B.thread && threads[B.thread] && threadVisible(threads[B.thread]) ? B.thread : null;
  return `<p class="born born--${where}">${icon('spark')}<span>${bx(txt)}</span>${th && where !== 'empty' ? `<button type="button" class="link-btn born__link" data-action="born-thread" data-thread="${th}">${lng('شوف الطلب', 'See the ask')}</button>` : ''}</p>`;
}

/* the quiet line at the top of a direct chat, when you work in a team */
function privLineHTML(t) {
  if (isSolo() || (t && (t.channel || t.team))) return '';
  if (t && !t.owner && !t.checkin) return '';
  const a = t ? t.agent : state.newChatAgent; if (!AGENTS[a]) return '';
  return `<p class="priv-line">${icon('lock')}<span>${lng('المحادثة دي بينك وبين', 'This chat is just between you and')} <bdi>${esc(AGENTS[a].name)}</bdi>${lng(' بس', '')}</span></p>`;
}
/* the composer's extras button says only what its menu holds for this person */
const plusLabel = (key) => [lng('إضافات: نادي حد', 'More: call someone')].concat(canManage() && !isSolo() && !chanOf(key) ? [lng('قناة جديدة', 'new channel')] : [], [lng('الأوامر', 'commands'), lng('إرفاق', 'attach')], canManage() ? [lng('الموديل', 'model')] : []).join(lng('، ', ', '));
/* «وكيل جديد» opens Lead's chat: one hint line, and the ready-made gallery as a small second way */
const newHintHTML = () => (state.newHint && !threads[state.chatThread] && isMain(state.newChatAgent) ? `<div class="new-hint" role="note">${icon('userPlus', 'new-hint__ic')}
    <p class="new-hint__t">${bx(isOwner() ? `${lng('قول لـ', 'Tell')} ${AGENTS[state.main].name} ${lng('محتاج وكيل يعمل إيه، بكلامك، وهو يعمله على طول.', 'what you need an agent for, in your own words, and it makes it right away.')}` : `${lng('قول لـ', 'Tell')} ${AGENTS[state.main].name} ${lng('محتاج وكيل يعمل إيه، وهو يجهّز الطلب ويبعته لعمر.', 'what you need an agent for, and it prepares the request for Omar.')}`)}</p>
    <button type="button" class="link-btn new-hint__alt" data-action="open-gallery-alt">${lng('أو اختار من الجاهزين', 'or pick a ready-made one')}</button></div>` : '');
function openLeadForAgent() {
  if (!canWrite()) return;
  if ($('#sheet').open) closeSheet();
  Object.assign(state, { chatThread: null, newChatAgent: state.main, newHint: true, dpSettings: false });
  setView('chat', { focusComposer: true });
  const ta = $('#ta-main'); if (ta) ta.setAttribute('placeholder', lng('مثلاً: عايز حد يتابع ليدز واتساب ويرد عليهم', 'e.g. عايز حد يتابع ليدز واتساب ويرد عليهم'));
}
/* the gallery is the second way in: picking a role asks Lead for it, in the chat */
function askLeadTpl(tplId) {
  const tp = tplId ? TEMPLATES.find((x) => x.id === tplId) : null;
  closeModal();
  window.setTimeout(() => {
    if (!tp) { openLeadForAgent(); return; }
    if ($('#sheet').open) closeSheet();
    Object.assign(state, { chatThread: null, newChatAgent: state.main, newHint: false });
    setView('chat');
    const ta = $('#ta-main'); if (!ta) return;
    ta.value = `اعملي وكيل «${tp.role}» زي اللي في الجاهزين`; syncComposer('main');
    state.soloTpl = tp.id; send('main');
  }, reduced() ? 0 : 210);
}

/* ---- Lead's turn when someone asks for an agent ---- */
function agentTalk(threadId, text, opts) {
  const t = threads[threadId]; const main = state.main; const o = opts || {};
  const raw = text.replace(/^\/agent\s*/, '').trim();
  const k = o.bp || (o.tpl ? bpFromTpl(o.tpl) : null) || bpFor(raw);
  const steps = [];
  if (!isMain(t.agent)) steps.push({ kind: 'handoff', from: t.agent, to: main, text: `${lng('اتسلّم لـ', 'Handed to')} ${AGENTS[main].name}`, detail: lng('طلب وكيل جديد', 'New-agent request') });
  const act = [lng('بيقرا طلبك', 'Reading your request')];
  /* there is already an agent for this job here: say so, and offer to hand the work over */
  const ex = k && !o.tpl && !/تاني|كمان واحد|واحد كمان/.test(raw) ? existingFor(BP[k].job) : null;
  if (ex) {
    steps.push({ kind: 'reply', a: main, payload: { activity: act, text: `عندك ${AGENTS[ex].name} بيمسك الشغلانة دي. قولّي محتاج منه إيه وأنا أسلّمهوله هنا، ولو عايز وكيل تاني مخصوص قولّي «اعمل واحد تاني» وإيه الفرق.` } });
    runSteps(threadId, steps, null, () => rerenderAll()); return;
  }
  /* no job Lead can read: its one question is what the agent should do */
  if (!k) {
    steps.push({ kind: 'reply', a: main, payload: { activity: act, text: 'حاضر. سؤال واحد بس عشان أعمله صح:',
      card: { type: 'ask1', status: 'pending', purpose: 'what', by: state.as, raw, q: 'الوكيل ده هيعمل إيه بالظبط؟', why: 'جملة واحدة كفاية.', opts: ['يرد على تعليقات الصفحة', 'يتابع المنافسين', 'يكتب النيوزلتر'] } } });
    runSteps(threadId, steps, null, () => rerenderAll()); return;
  }
  const B = BP[k];
  if (B.ask && !o.noAsk && o.answer == null) {
    steps.push({ kind: 'reply', a: main, payload: { activity: act, text: isOwner() ? `حلو، هعملك وكيل يمسك ${B.short}. سؤال واحد بس قبل ما أعمله:` : `حلو. هجهّز طلب وكيل يمسك ${B.short} وأبعته لعمر. سؤال واحد بس الأول:`,
      card: { type: 'ask1', status: 'pending', purpose: 'bp', bp: k, by: state.as, raw, q: B.ask.q, why: B.ask.why, opts: B.ask.opts } } });
    runSteps(threadId, steps, null, () => rerenderAll()); return;
  }
  makeOrRequest(threadId, k, raw, o.answer, steps);
}
function makeOrRequest(threadId, k, raw, answer, steps0) {
  const B = BP[k]; const owner = isOwner(); const main = state.main; const steps = steps0 || [];
  const P = { id: nid('mk'), kind: owner ? 'made' : 'request', bp: k, job: B.job, name: nameFor(B.name), role: B.role, line: B.line, apps: B.apps.slice(), face: B.face, look: B.look ? Object.assign({}, B.look) : null,
    tpl: B.tpl, gallery: !!B.gallery, reply: B.reply, example: B.example, cap: answer && B.ask ? answer : null, by: state.as, why: raw, thread: threadId, status: owner ? 'made' : 'pending', at: nowTime(), world: state.world };
  MADE[P.id] = P;
  const act = [lng('بيقرا طلبك', 'Reading your request'), lng('بيختار التطبيقات', 'Choosing the apps'), owner ? `${lng('بيعمل', 'Making')} ${P.name}` : lng('بيجهّز الطلب', 'Preparing the request')];
  if (owner) {
    steps.push({ kind: 'reply', a: main, payload: { activity: act, text: `تمام، عملتلك ${P.name}. ${B.made}`, card: { type: 'agentcard', pid: P.id } } });
    runSteps(threadId, steps, null, () => {
      const id = makeAgentFrom(P); P.agent = id; P.justAt = Date.now();
      logAuto(WHO.a(main), lng(`عمل وكيل جديد بطلب من ${AR_FIRST[P.by] || ''}`, `made a new agent at the request of ${PEOPLE[P.by].first}`), { agent: id, obj: P.name, to: P.role });
      evAdd({ agent: id, t: lng(`اتعمل بطلب من ${AR_FIRST[P.by] || ''} في المحادثة مع ${AGENTS[main].name}`, `was made at ${PEOPLE[P.by].first}’s request in the chat with ${AGENTS[main].name}`), m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
      refreshThread(threadId); rerenderAll();
      const tl = $(`[data-action="open-agent"][data-agent="${id}"]`); if (tl) { tl.classList.add('is-flash'); window.setTimeout(() => tl.classList.remove('is-flash'), 1500); }
      toast(`${P.name} ${lng('اتعمل وظهر في الوكلاء', 'was made and shows in your agents')}`, 'check', { action: 'open-agent-t', thread: id, label: `${lng('افتح', 'Open')} ${P.name}` });
    });
    return;
  }
  /* a member: nothing is made. The same card goes to the Owner as a request */
  steps.push({ kind: 'reply', a: main, payload: { activity: act, text: `فهمتك يا ${me().first}. مقدرش أعمل وكلاء غير بطلب من عمر، فجهّزت طلبك زي ما هيبقى بالظبط وبعته له. لسه مفيش وكيل اتعمل، وهقولك هنا أول ما يرد.`, card: { type: 'agentcard', pid: P.id } } });
  runSteps(threadId, steps, null, () => {
    const oid = nid('th'); const cid = nid('c'); const nm = me().first;
    threads[oid] = { id: oid, agent: main, owner: 'omar', title: `${nm} ${lng('طالب وكيل:', 'asks for an agent:')} ${P.role}`, time: nowTime(), day: 0, ts: ++tsSeq, card: cid, unread: { omar: 1 }, ws: state.world === 'fresh' ? 'fresh' : undefined,
      msgs: [{ id: nid('a'), role: 'agent', agent: main, time: nowTime(), text: `${nm} طلب وكيل ${P.role}. جهّزته زي ما هيبقى بالظبط، ومش هيتعمل غير لما تقول «اعمله».`, card: { type: 'agentcard', pid: P.id } }] };
    cards.unshift({ id: cid, col: 'waiting', title: `${lng('طلب وكيل:', 'Agent request:')} ${P.name}`, agent: main, chan: lng('طلب وكيل', 'Agent request'), due: '', thread: oid, request: P.id,
      wait: lng(`${nm} ${gv(state.as, 'طالبه', 'طالباه')} · مستني تقول «اعمله» أو «لأ»`, `${nm} asked for it · waiting for your yes or no`) });
    P.card = cid; P.ownerThread = oid;
    logAuto(WHO.a(main), lng(`جهّز طلب وكيل من ${AR_FIRST[P.by] || ''} وبعته لعمر`, `prepared an agent request from ${PEOPLE[P.by].first} and sent it to Omar`), { obj: P.name, only: [P.by] });
    rerenderAll();
    toast(lng('الطلب راح لعمر في «مستنيك». مفيش وكيل لحد ما يوافق', 'The request went to Omar’s “Waiting on you”. No agent until he says yes'), 'clock');
  });
}
function makeAgentFrom(P) {
  const id = nid('ag'); const tp = TEMPLATES.find((x) => x.id === P.tpl) || {};
  const instr = ['أي نشر أو صرف أو رسالة لعميل بيتسلّم للي طلب، وهو اللي يعملها.'].concat(P.cap ? [`ميزانية الشهر لحد ${P.cap}. أي صرف فوقها يستأذن الأول.`] : []).join('\n');
  AGENTS[id] = {
    name: P.name, handle: handleFor(P.name), role: P.role, custom: true, kind: 'team', tpl: P.tpl || null, job: P.job,
    desc: P.line, line: P.line, handoff: lng('مش بينشر ولا بيصرف ولا بيبعت لعميل لوحده: بيجهّز ويسلّمك.', 'Never publishes, spends or messages a customer on its own: it prepares and hands it to you.'),
    reply: P.reply || tp.reply || '', routineEx: tp.routineEx || '', example: P.example || tp.example || 'قولي هتبدأ بإيه، وإيه اللي محتاجه مني',
    conns: P.apps.slice(), routines: [], files: [], perms: [], memory: [], rules: [],
    model: state.defModel || 'Opus 5.5', effort: state.defEffort || 'medium', instr, paused: false, checkinOn: true, checkinTime: '9:00',
    voiceLang: 'ar-EG', voice: 'noor', voiceSpeed: '1',
    skills: (tp.skills || []).map(([t0, d0]) => ({ t: t0, d: d0, on: true })), toolsOn: Object.fromEntries(P.apps.map((k) => [k, true])),
    worlds: [P.world], isNew: true, cap: P.cap,
    born: { today: true, at: nowTime(), by: P.by, ok: P.kind === 'request' ? state.as : null, thread: P.kind === 'request' ? P.ownerThread : P.thread, gallery: P.gallery },
  };
  FACES[id] = P.face && FACES[P.face] ? FACES[P.face] : lookFill(P.look || { shape: 'round', color: 'sky' });
  AGENT_ORDER.push(id);
  VOICE_SAMPLE[id] = AGENTS[id].example;
  LEARN.per[id] = 'company';
  return id;
}
/* the Owner answers a member's request */
function approveRequest(pid) {
  const P = MADE[pid]; if (!P || P.kind !== 'request' || P.status !== 'pending' || !isOwner()) return;
  const id = makeAgentFrom(P); P.agent = id; P.status = 'ok'; P.okAt = nowTime(); P.justAt = Date.now(); P.mode = null;
  ACCESS[P.by] = ACCESS[P.by] || []; if (!ACCESS[P.by].includes(id)) ACCESS[P.by].push(id);
  const nm = PEOPLE[P.by].first;
  logAuto(ME(), meAct(`عمل وكيل طلبه ${AR_FIRST[P.by] || ''}`, `عملت وكيل طلبه ${AR_FIRST[P.by] || ''}`, `made an agent ${nm} asked for`), { agent: id, obj: P.name, from: lng('طلب', 'Request'), to: `${lng('ظهر عند', 'Shows for')} ${nm}` });
  if (P.card) sysMove(P.card, 'done', { prog: `${lng('اتعمل · ظهر عند', 'Made · shows for')} ${nm}`, wait: '' });
  evAdd({ agent: id, t: `${lng('اتعمل بطلب من', 'was made at the request of')} ${nm}${lng('، بعد ما عمر قال «اعمله»', ', after Omar said yes')}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  const rt = threads[P.thread];
  if (rt) { rt.msgs.push({ id: nid('a'), role: 'agent', agent: state.main, time: nowTime(), text: `عمر وافق على طلبك يا ${nm}، و${P.name} اتعمل. هتلاقيه في الوكلاء عندك، افتحه واديله أول شغلانة.` }); rt.unread = rt.unread || {}; rt.unread[P.by] = (rt.unread[P.by] || 0) + 1; bump(rt); }
  refreshThread(P.ownerThread); rerenderAll();
  toast(`${P.name} ${lng('اتعمل وظهر عند', 'was made and shows for')} ${nm}`);
  agentSays(P.ownerThread, state.main, { text: `تمام، ${P.name} اتعمل وظهر عند ${nm}. وقلتله في محادثته إن الوكيل جاهز.`, activity: [`${lng('بيعمل', 'Making')} ${P.name}`] }, () => rerenderAll());
}
function refuseRequest(pid) {
  const P = MADE[pid]; if (!P || P.kind !== 'request' || P.status !== 'pending' || !isOwner()) return;
  const why = (P.reasonDraft || '').trim();
  if (!why) { P.reasonErr = true; refreshThread(P.ownerThread); const n = $(`#ac-why-${pid}`); if (n) { n.setAttribute('aria-invalid', 'true'); n.focus(); } return; }
  const nm = PEOPLE[P.by].first;
  Object.assign(P, { status: 'no', reason: why, noAt: nowTime(), mode: null, reasonErr: false, justAt: Date.now() });
  logAuto(ME(), meAct(`رفض طلب وكيل من ${AR_FIRST[P.by] || ''}`, `رفضت طلب وكيل من ${AR_FIRST[P.by] || ''}`, `declined an agent request from ${nm}`), { obj: P.name, from: lng('طلب', 'Request'), to: why, only: [P.by] });
  if (P.card) sysMove(P.card, 'done', { prog: lng('الطلب اترفض', 'Request declined'), wait: '' });
  const rt = threads[P.thread];
  if (rt) { rt.msgs.push({ id: nid('a'), role: 'agent', agent: state.main, time: nowTime(), text: `عمر قال لأ على ${P.name} دلوقتي. السبب: «${why}»\nلو حابب نغيّر الطلب ونبعته تاني، قولّي هنا.` }); rt.unread = rt.unread || {}; rt.unread[P.by] = (rt.unread[P.by] || 0) + 1; bump(rt); }
  refreshThread(P.ownerThread); rerenderAll();
  toast(`${lng('اترفض، والسبب وصل لـ', 'Declined. The reason went to')} ${nm}`, 'x');
}

/* the card that says what Lead made, or what a member asked for */
function agentCardHTML(t, m) {
  const P = MADE[m.card.pid]; if (!P) return '';
  const fresh = m.fresh ? ' card-in' : ''; const pid = P.id;
  const req = P.kind === 'request'; const pend = req && P.status === 'pending'; const owner = isOwner();
  const nm = PEOPLE[P.by] ? PEOPLE[P.by].first : '';
  const live = P.agent && AGENTS[P.agent];
  const top = !req ? `<span class="badge badge--made">${icon('check')}${lng('اتعمل', 'Made')}${live && AGENTS[P.agent].isNew ? ` · ${lng('جديد', 'New')}` : P.dayLabel ? ` · ${lng(P.dayLabel[0], P.dayLabel[1])}` : ''}</span>`
    : pend ? `<span class="badge badge--req">${icon('userPlus')}${owner ? `${lng('طلب وكيل من', 'Agent request from')} ${nm}` : lng('طلب · لسه مااتعملش', 'Request · not made yet')}</span>`
    : P.status === 'ok' ? `<span class="badge badge--made">${icon('check')}${lng('اتعمل بعد ما عمر وافق', 'Made after Omar said yes')}</span>`
    : `<span class="badge">${icon('x')}${lng('عمر قال لأ', 'Omar said no')}</span>`;
  const fc = live ? face(P.agent, 44) : P.face && FACES[P.face] ? face(P.face, 44) : lookFace(P.look || { shape: 'round', color: 'sky' }, 44);
  const head = `<div class="hcard__top">${top}</div><div class="card__head">${fc}
    <div class="card__titles"><span class="card__title"><bdi>${esc(live ? AGENTS[P.agent].name : P.name)}</bdi></span><span class="card__sub">${bx(P.role)}</span></div></div>`;
  const apps = P.apps.length ? `<span class="pp-tools">${P.apps.map((k) => tile(k)).join('')}</span>${P.apps.map((k) => `<bdi>${esc(CONNS[k].name)}</bdi>${state.conns[k] === 'connected' ? '' : lng(' (محتاج توصيل)', ' (needs connecting)')}`).join(lng('، ', ', '))}` : lng('من غير تطبيقات: بيشتغل على اللي تبعتهوله', 'No apps: it works on what you send it');
  const never = `<ul class="ac-never">${NEVER().map((x) => `<li>${icon('hand')}<span>${x}</span></li>`).join('')}</ul>${P.cap ? `<span class="pp-sub">${bx(`${lng('والميزانية لحد', 'And a budget of up to')} ${P.cap} ${lng('في الشهر', 'a month')}`)}</span>` : ''}`;
  const rows = [[lng('الشغلانة', 'Job'), bx(P.line)], [lng('التطبيقات', 'Apps'), apps], [lng('مش هيعمل من غير ما يسألك', 'Won’t do without asking you'), never]];
  if (req) rows.push([lng('طلبه', 'Asked by'), `${esc(PEOPLE[P.by].name)}${PEOPLE[P.by].job ? ` · ${esc(PEOPLE[P.by].job)}` : ''}<span class="pp-sub">${bx(`«${P.why}»`)}</span>`], [lng('هيظهر عند', 'Will show for'), bx(`${nm} ${lng('والمالك', 'and the Owner')}`)]);
  const kv = `<dl class="kv pp-kv ac-kv">${rows.map(([k0, v]) => `<div class="kv__row"><dt>${k0}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  let out;
  if (!req) {
    out = live && canSee(P.agent) ? `<div class="card__actions ac-actions"><button type="button" class="btn btn--primary" data-action="ac-open" data-agent="${P.agent}">${bx(`${lng('افتح', 'Open')} ${AGENTS[P.agent].name}`)}</button></div>
      <p class="ac-tip">${icon('chat')}<span>${lng('عايز تغيّر حاجة فيه؟ قولّه في المحادثة بتاعته.', 'Want to change something? Tell it in its chat.')}</span></p>`
      : waitLineHTML(`${lng('بيتعمل', 'Being made')}…`);
  } else if (P.status === 'ok') {
    out = `<div class="card__outcome">${icon('check')}<span>${bx(`${lng('عمر وافق ·', 'Omar said yes ·')} ${P.okAt}. ${live ? AGENTS[P.agent].name : P.name} ${lng('ظهر عند', 'now shows for')} ${nm}.`)}</span>
      ${live && canSee(P.agent) ? `<button type="button" class="link-btn" data-action="ac-open" data-agent="${P.agent}">${bx(`${lng('افتح', 'Open')} ${AGENTS[P.agent].name}`)}</button>` : ''}</div>`;
  } else if (P.status === 'no') {
    out = `<div class="card__outcome pp-out">${icon('x')}<span>${bx(`${lng('عمر قال لأ ·', 'Omar said no ·')} ${P.noAt}. ${lng('السبب:', 'Reason:')} «${P.reason}»`)}</span></div>`;
  } else if (!owner) {
    out = waitLineHTML(lng('لسه مااتعملش. لما عمر يقول «اعمله» هيظهر عندك في الوكلاء، وهقولك هنا.', 'Not made yet. When Omar says yes it shows in your agents, and I’ll tell you here.'));
  } else if (P.mode === 'no') {
    out = `<div class="pp-form"><div class="set-field"><label class="set-label" for="ac-why-${pid}">${lng('ليه لأ؟', 'Why not?')}</label>
        <textarea class="set-input set-textarea" id="ac-why-${pid}" rows="3" data-ac="reason" data-pid="${pid}" placeholder="${lng('مثلاً: Ads بيتابع ليدز واتساب دلوقتي، نجرّبه شهر الأول.', 'e.g. Ads follows WhatsApp leads now, let’s try that for a month first.')}" aria-describedby="ac-why-err-${pid} ac-why-hint-${pid}" aria-required="true"${P.reasonErr ? ' aria-invalid="true"' : ''}>${esc(P.reasonDraft || '')}</textarea>
        <span class="set-err" id="ac-why-err-${pid}" ${P.reasonErr ? '' : 'hidden'}>${bx(`${lng('اكتب السبب، عشان', 'Write the reason, so')} ${nm} ${lng('يعرف ليه.', 'knows why.')}`)}</span>
        <span class="set-hint" id="ac-why-hint-${pid}">${bx(`${lng('السبب هيوصل لـ', 'The reason goes to')} ${nm} ${lng('في محادثته مع Lead.', 'in their chat with Lead.')}`)}</span></div></div>
      <div class="card__actions"><button type="button" class="btn btn--secondary" data-action="ac-no-cancel" data-pid="${pid}">${lng('إلغاء', 'Cancel')}</button>
        <button type="button" class="btn btn--primary" data-action="ac-no" data-pid="${pid}">${lng('ابعت الرفض', 'Send the no')}</button></div>`;
  } else {
    out = `<div class="card__actions">
      <button type="button" class="btn btn--secondary" data-action="ac-no-open" data-pid="${pid}" id="ac-no-${pid}">${lng('لأ', 'No')}</button>
      <button type="button" class="btn btn--primary" data-action="ac-yes" data-pid="${pid}" id="ac-yes-${pid}">${lng('اعمله', 'Make it')}</button></div>`;
  }
  return `<div class="card pp-card ac-card${req && P.status !== 'ok' ? ' ac-card--req' : ''}${pend ? '' : req ? ' is-resolved' : ''}${fresh}${justCls(P)}" role="group" aria-label="${req ? lng('طلب وكيل:', 'Agent request:') : lng('وكيل اتعمل:', 'Agent made:')} ${esc(P.name)}">${head}${kv}${out}</div>`;
}
/* Lead's one question before it makes an agent */
function ask1HTML(t, m) {
  const c = m.card; const fresh = m.fresh ? ' card-in' : '';
  const done = c.status !== 'pending'; const mine = c.by === state.as && canWrite();
  const body = done ? `<div class="card__outcome">${icon('check')}<span>${bx(c.answer)}</span></div>`
    : mine ? `<div class="ask1__opts" role="group" aria-label="${esc(c.q)}">${c.opts.map((o, i) => `<button type="button" class="chip chip--text" data-action="ask1" data-thread="${t.id}" data-msg="${m.id}" data-idx="${i}">${bx(o)}</button>`).join('')}</div>
      <p class="ask1__or">${c.purpose === 'offer' ? '' : lng('أو اكتب الإجابة تحت', 'or type the answer below')}</p>`
    : waitLineHTML(`${lng('مستني', 'Waiting for')} ${PEOPLE[c.by] ? PEOPLE[c.by].first : ''}`);
  return `<div class="card ask1${done ? ' is-resolved' : ''}${fresh}${justCls(c)}" role="group" aria-label="${esc(c.q)}">
    <div class="ask1__head"><span class="ask1__q">${bx(c.q)}</span>${c.why ? `<span class="ask1__why">${bx(c.why)}</span>` : ''}</div>${body}</div>`;
}
const YES_RE = /^(?:آه|اه|أه|ايوه|أيوه|ايوا|اعمله|اعمليه|اطلبه|تمام|ماشي|يلا|أكيد|اكيد|نعم)/;
function answerAsk1(threadId, msgId, val, typed) {
  const t = threads[threadId]; const m = t && t.msgs.find((x) => x.id === msgId); const c = m && m.card;
  if (!c || c.type !== 'ask1' || c.status !== 'pending' || c.by !== state.as || !canWrite()) return false;
  c.status = 'answered'; c.answer = val; c.justAt = Date.now();
  if (!typed) { t.msgs.push({ id: nid('u'), role: 'user', by: state.as, text: val, time: nowTime(), fresh: true, ord: ++logOrd }); bump(t); }
  state.newHint = false;
  refreshThread(threadId); scrollMounts(threadId); rerenderAll();
  if (c.purpose === 'bp') makeOrRequest(threadId, c.bp, c.raw, val);
  else if (c.purpose === 'what') { const k = bpFor(val) || bpCustom(val); makeOrRequest(threadId, k, `${c.raw} · ${val}`, null); }
  else if (c.purpose === 'offer') {
    if (YES_RE.test(val.trim())) agentTalk(threadId, c.raw, { bp: c.bp, noAsk: true });
    else agentSays(threadId, state.main, { text: 'تمام. لو احتجته بعدين قولّي «اعمل وكيل» وأنا أعمله في دقيقة.', activity: [lng('بيقرا ردك', 'Reading your answer')] }, () => rerenderAll());
  }
  return true;
}
function answerAskTyped(threadId, text) {
  const t = threads[threadId]; if (!t) return false;
  const m = t.msgs.slice().reverse().find((x) => x.card && x.card.type === 'ask1' && x.card.status === 'pending' && x.card.by === state.as);
  return m ? answerAsk1(threadId, m.id, text, true) : false;
}
/* work that needs an agent nobody here has yet: Lead offers to make it (or to ask Omar for it) */
const JOB_BP = { ads: 'ads', seo: 'seo', analyst: 'analyst', critic: 'critic' };
function offerAgent(threadId, job, text) {
  const k = JOB_BP[job] || job; const B = BP[k]; if (!B) return;
  agentSays(threadId, state.main, { activity: [lng('بيقرا طلبك', 'Reading your request')],
    text: isOwner() ? `لسه مفيش وكيل عندك يمسك ${B.short}. تحب أعملك واحد؟ وبعدها أسلّمهوله على طول.` : `لسه مفيش وكيل هنا يمسك ${B.short}. تحب أجهّز طلب لعمر؟`,
    card: { type: 'ask1', status: 'pending', purpose: 'offer', bp: k, by: state.as, raw: text, q: isOwner() ? lng('أعمله؟', 'Make it?') : lng('أطلبه من عمر؟', 'Ask Omar for it?'), why: '', opts: isOwner() ? ['اعمله', 'مش دلوقتي'] : ['اطلبه من عمر', 'مش دلوقتي'] } }, () => rerenderAll());
}

/* ---- changing an agent by telling it: a lasting rule, saved and written in the log ---- */
const RULE_RE = /^(?:@\S+\s+)?(?:من دلوقتي|من دلوقت|من الآن|من هنا ورايح|من النهارده|بعد كده)\s*[،,]?\s*/;
function addRule(a, text, by) {
  const A = AGENTS[a]; A.rules = A.rules || [];
  const R = { id: nid('rl'), t: text, by, at: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` }; A.rules.unshift(R); return R;
}
/* a member in a team teaches an agent something for everyone: it becomes a suggestion for the Owner or a Manager */
function suggestTurn(threadId, a, body, kind) {
  const t = threads[threadId]; const A = AGENTS[a]; const nm = me().first;
  agentSays(threadId, a, { text: `تمام يا ${nm}، هشتغل كده في شغلي معاك من دلوقتي. وعشان دي حاجة هتمشي على الفريق كله، هقترحها على عمر وسارة في «اقتراحات التعلّم»، ولما حد فيهم يوافق هتبقى للكل.`,
    activity: [lng('بيقرا اللي قلته', 'Reading what you said'), lng('بيجهّز الاقتراح', 'Preparing the suggestion')] }, () => {
    const L = lrn({ kind, agent: a, status: 'pending', by: state.as, text: body, g: groupGuess(body), thread: threadId, at: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
    logAuto(WHO.a(a), lng(`اقترح ${kind === 'rule' ? 'قاعدة' : 'ملاحظة'} للفريق اتعلّمها من ${AR_FIRST[state.as] || ''} · مستنية موافقة`, `suggested a ${kind === 'rule' ? 'rule' : 'note'} for the team, learned from ${nm} · waiting for an OK`), { agent: a, obj: body, only: [state.as], mgr: true, link: { action: 'sov-learn', learn: L.id, label: lng('افتحها في الاقتراحات', 'Open it in suggestions'), need: 'learning' } });
    t.msgs.push({ id: nid('n'), role: 'note', icon: 'clock', text: lng(`اتبعتت اقتراح لعمر وسارة · في «اقتراحات التعلّم»`, 'Sent as a suggestion to Omar and Sara · in “Learning suggestions”'), link: { action: 'sov-learn', learn: L.id, label: lng('شوفها', 'See it'), need: 'learning' }, fresh: true });
    refreshThread(threadId); scrollMounts(threadId); rerenderAll();
  }, lng('بيجهّز', 'Preparing'));
  void A;
}
function ruleTurn(threadId, a, text) {
  if (!AGENTS[a] || !RULE_RE.test(text.trim())) return false;
  const t = threads[threadId]; const A = AGENTS[a]; const nm = me().first;
  const body = text.trim().replace(/^@\S+\s+/, '').trim();
  if (!isSolo() && !canManage()) { suggestTurn(threadId, a, body, 'rule'); return true; }
  const toCustomer = /عميل|العملا|للعميل/.test(body);
  const rest = body.replace(RULE_RE, '').trim();
  agentSays(threadId, a, { text: toCustomer ? `تمام يا ${nm}. من دلوقتي أي حاجة رايحة لعميل، رسالة أو عرض أو رد، هجهّزها وأستناك تشوفها الأول، وانت اللي تبعت.` : `تمام يا ${nm}، من دلوقتي هشتغل كده: «${rest || body}».`,
    activity: [lng('بيقرا القاعدة', 'Reading the rule'), lng('بيحفظها في إعداده', 'Saving it to its setup')] }, () => {
    addRule(a, body, state.as);
    logAuto(WHO.a(a), lng('حفظ قاعدة جديدة', 'saved a new rule'), { agent: a, obj: body, to: `${lng('من', 'From')} ${nm} ${lng('في المحادثة · شغالة من دلوقتي', 'in the chat · in effect now')}`, link: { action: 'sov-agent-open', agent: a, label: lng('شوفها في إعداده', 'See it in its setup'), icon: 'gear' } });
    evAdd({ agent: a, t: `${lng('حفظ قاعدة من', 'Saved a rule from')} ${nm}: «${body}»`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
    t.msgs.push({ id: nid('n'), role: 'note', icon: 'check', saved: true, text: `${lng('قاعدة عند', 'A rule for')} ${A.name} · ${lng('اتكتبت في السجل', 'written in the log')}`, link: { action: 'sov-agent-open', agent: a, label: lng('شوفها', 'See it') }, fresh: true });
    refreshThread(threadId); scrollMounts(threadId); rerenderAll();
  }, lng('بيحفظ', 'Saving'));
  return true;
}
/* the rules an agent was told, on its page in the settings overlay */
function rulesHTML(a) {
  const R = AGENTS[a].rules || [];
  return `<section class="dp-sec" aria-labelledby="rl-h-${a}"><h3 class="dp-label" id="rl-h-${a}"><span>${lng('قواعد اتقالتله', 'Rules it was told')} <span class="muted num">${R.length}</span></span></h3>
    ${R.length ? `<ul class="panel-card rl-list">${R.map((r) => `<li class="panel-row rl-row"><span class="panel-row__icon">${icon('check')}</span><span class="panel-row__text"><span class="panel-row__t" dir="rtl">${bx(r.t)}</span><span class="panel-row__d">${bx(`${lng('قالها', 'Said by')} ${firstName(r.by)} · ${r.at}`)}</span></span></li>`).join('')}</ul>`
      : `<div class="panel-card"><p class="panel-empty">${bx(lng('لسه محدش قاله قاعدة. اكتبله في المحادثة «من دلوقتي…» وهتتحفظ هنا.', 'Nobody has told it a rule yet. Write “من دلوقتي…” in its chat and it’s saved here.'))}</p></div>`}</section>`;
}
/* the settings overlay shows each agent's setup; the simplest way to change one is to tell it */
function talkTipHTML(a) {
  const ag = a || (visibleAgents().find((x) => !isMain(x)) || state.main);
  return `<p class="talk-tip">${icon('chat')}<span>${bx(a ? `${lng('أسهل طريقة تغيّر', 'The simplest way to change')} ${AGENTS[ag].name} ${lng('إنك تقوله في المحادثة، زي «من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها». بيتحفظ هنا وبيتكتب في السجل.', 'is to tell it in its chat, like “من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها”. It’s saved here and written in the log.')}`
    : lng('أسهل طريقة تغيّر وكيل إنك تقوله في المحادثة بتاعته، زي «من دلوقتي…». بيتحفظ عنده وبيتكتب في السجل.', 'The simplest way to change an agent is to tell it in its chat, like “من دلوقتي…”. It’s saved on the agent and written in the log.'))}</span>
    ${canWrite() && canSee(ag) && !isMain(ag) ? `<button type="button" class="link-btn" data-action="sov-talk" data-agent="${ag}">${bx(`${lng('كلّم', 'Talk to')} ${AGENTS[ag].name}`)}</button>` : ''}</p>`;
}
/* «مستنيك» holds two different things: a step handed to you, and a member asking for an agent. Each gets its own tag. */
const HAND_RE = /^(?:اتسلّمتلك|Handed to you):\s*/;
const waitTxt = (c) => String(c.wait || '').replace(HAND_RE, '');
function waitTagHTML(c, inline) {
  if (c.request && MADE[c.request]) return `<span class="wtag wtag--req${inline ? ' wtag--inline' : ''}">${icon('userPlus')}${lng('طلب وكيل من', 'Agent request from')} ${esc(PEOPLE[MADE[c.request].by].first)}</span>`;
  if (HAND_RE.test(c.wait || '')) return `<span class="wtag wtag--hand${inline ? ' wtag--inline' : ''}">${icon('hand')}${lng('اتسلّمتلك', 'Handed to you')}</span>`;
  return '';
}

/* clicks for this section */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset; const P = d.pid ? MADE[d.pid] : null;
  switch (d.action) {
    case 'ac-open': case 'open-agent-t': { const a = d.agent || d.thread; if (!a || !canSee(a)) break; $('#toast-host').innerHTML = ''; if ($('#sheet').open) closeSheet(); openAgentChat(a); break; }
    case 'ac-yes': if (P) approveRequest(P.id); break;
    case 'ac-no-open': if (P && isOwner()) { P.mode = 'no'; P.reasonErr = false; refreshThread(P.ownerThread); window.requestAnimationFrame(() => { const n = $(`#ac-why-${P.id}`); if (n) n.focus(); }); } break;
    case 'ac-no-cancel': if (P) { P.mode = null; P.reasonErr = false; refreshThread(P.ownerThread); window.requestAnimationFrame(() => { const n = $(`#ac-no-${P.id}`); if (n) n.focus(); }); } break;
    case 'ac-no': if (P) refuseRequest(P.id); break;
    case 'ask1': { const t = threads[d.thread]; const m = t && t.msgs.find((x) => x.id === d.msg); if (m && m.card) answerAsk1(d.thread, d.msg, m.card.opts[Number(d.idx)], false); break; }
    case 'born-thread': { const t = threads[d.thread]; if (!t || !threadVisible(t)) break; sovLeave(() => { if ($('#sheet').open) closeSheet(); openThread(d.thread); }); break; }
    case 'sov-talk': { const a = d.agent; if (!canSee(a)) break; sovLeave(() => { if ($('#sheet').open) closeSheet(); openAgentChat(a); }); break; }
    default: break;
  }
});
document.addEventListener('input', (e) => {
  const f = e.target.dataset && e.target.dataset.ac; if (f !== 'reason') return;
  const P = MADE[e.target.dataset.pid]; if (!P) return;
  P.reasonDraft = e.target.value;
  if (e.target.value.trim() && P.reasonErr) { P.reasonErr = false; const er = $(`#ac-why-err-${P.id}`); if (er) er.hidden = true; e.target.removeAttribute('aria-invalid'); }
});

/* ---- «الفريق»: one row per member, a switch per agent (Owner and Manager) ---- */
function teamDlgHTML() {
  if (isSolo()) return teamSoloHTML();
  return `<header class="modal__head"><div class="modal__titles"><h2 class="modal__title" id="team-title">${lng('الفريق', 'Team')}</h2>
      <p class="modal__sub">${bx(lng('الشركة ليها وكلاء واحدين وذاكرة واحدة للكل. اختار كل عضو بيشتغل مع أنهي وكلاء: الوكيل اللي مش مسموحله بيه مش هيظهرله خالص. الرئيسي ظاهر للكل.', 'The company has one set of agents and one memory for everyone. Choose which agents each member works with: an agent they aren’t allowed is never shown to them. The main agent is shown to everyone.'))}</p></div>
      <button type="button" class="circle-btn" data-action="team-close" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></header>
    <div class="modal__body ta">${teamTableHTML()}</div>
    <footer class="modal__foot modal__foot--end"><button type="button" class="btn btn--primary" data-action="team-close">${lng('خلصت', 'Done')}</button></footer>`;
}
function openTeamDlg() {
  if (!canManage()) return;
  Object.assign(state, { inviting: false, invErr: '', invEmail: '', invRole: 'contributor' });
  $('#team').classList.toggle('team-dlg--solo', isSolo());
  $('#team-inner').innerHTML = teamDlgHTML();
  showDlg($('#team'));
  const f = isSolo() ? $('#inv-email') : $('#team .switch'); if (f) f.focus();
}

/* ---- «شايف كـ»: the whole prototype re-renders as another person of the same company ---- */
function setPerson(p, world) {
  world = world || 'team';
  if (!PEOPLE[p] || (p === state.as && world === state.world)) return;
  applyPerson(p, world);
  const P0 = me();
  toast(world === 'solo' && isSolo() ? lng('دلوقتي شايف كـ عمر لوحده · انت والوكلاء بس', 'Now viewing as Omar alone · just you and the agents') : `${lng('دلوقتي شايف كـ', 'Now viewing as')} ${P0.name} · ${P0.title}`, 'eye');
  window.requestAnimationFrame(() => { const b = $('#btn-me'); if (b && !canWrite()) b.focus(); });
}
/* the whole prototype re-renders as this person, in this workspace (shared by «شايف كـ» and the first run) */
function applyPerson(p, world) {
  state.as = p; state.world = world;
  syncCoder(); // Coder is in a workspace only once it was added there from the gallery
  Object.assign(state, { drafts: {}, dpSettings: false, dpConfirm: null, memAdding: false, memEditing: null, teamAdding: false, addingIdea: false, dpAddingRoutine: false, dpManageTools: false, noteEdit: null, noteEditSurf: null, noteDraft: null, chAddingPerson: false, sheetTab: 'chat', inviting: false });
  if (state.logWho.startsWith('a:') && !canSee(state.logWho.slice(2))) state.logWho = 'all';
  if (state.logWho.startsWith('p:') && !inWs(state.logWho.slice(2))) state.logWho = 'all';
  if (state.logCard !== 'all' && !cardVisible(cardById(state.logCard))) state.logCard = 'all';
  state.attach.main = [];
  if (state.boardFilter !== 'all' && !canSee(state.boardFilter)) state.boardFilter = 'all';
  if (!canSee(state.newChatAgent)) state.newChatAgent = state.main;
  if (!canSee(state.detailsAgent)) state.detailsAgent = state.main;
  ['apps', 'viewer', 'preview', 'team'].forEach((id) => { const dl = $(`#${id}`); if (dl && dl.open) dl.close(); });
  if ($('#modal').open) $('#modal').close();
  if ($('#sheet').open) $('#sheet').close();
  MOT.seenWait = null; MOT.sbCount = null;
  syncMorning();
  state.chatThread = world === 'fresh' ? null : 'th-morning';
  state.newChatAgent = state.main; state.newHint = false;
  if (world === 'fresh') state.detailsOpen = false; // the first run is one conversation with Lead and nothing else
  else if (state.leftFresh !== false && state.wasFresh) state.detailsOpen = true;
  state.wasFresh = world === 'fresh';
  setView('chat');
}

$('#team').addEventListener('cancel', (e) => { e.preventDefault(); closeDlg($('#team')); });
$('#team').addEventListener('click', (e) => { if (e.target === $('#team')) closeDlg($('#team')); });
$('#team').addEventListener('close', () => { $('#team-inner').innerHTML = ''; const b = $('#btn-me'); if (b) b.focus(); });
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset; const P0 = d.pid ? PROPS[d.pid] : null;
  switch (d.action) {
    case 'set-as': setPerson(d.person, d.world); break;
    case 'open-team': openTeamDlg(); break;
    case 'team-close': closeDlg($('#team')); break;
    case 'ta-toggle': {
      if (!canManage()) break;
      const p = d.person; const a = d.agent; const list = ACCESS[p] || (ACCESS[p] = []);
      const i = list.indexOf(a); const on = i < 0;
      if (on) list.push(a); else list.splice(i, 1);
      logAuto(ME(), lng(gv(state.as, `غيّر الوكلاء اللي ${AR_FIRST[p]} بيشتغل معاهم`, `غيّرت الوكلاء اللي ${AR_FIRST[p]} بيشتغل معاهم`), `changed which agents ${PEOPLE[p].first} works with`), { agent: a, obj: AGENTS[a].name, from: on ? lng('مقفول', 'Off') : lng('مسموح', 'Allowed'), to: on ? lng('مسموح', 'Allowed') : lng('مقفول', 'Off'), only: [p], mgr: true });
      if ($('#team').open) $('#team-inner').innerHTML = teamDlgHTML(); else if (state.sov) renderSov();
      { const b = $(`#ta-${p}-${a}`); if (b) b.focus(); }
      toast(on ? `${AGENTS[a].name} ${lng('ظهر عند', 'now shows for')} ${PEOPLE[p].first}` : `${AGENTS[a].name} ${lng('اتشال من عند', 'is hidden from')} ${PEOPLE[p].first}`, on ? 'check' : 'x');
      break;
    }
    case 'make-main': makeMain(d.agent); break;
    case 'ask-mgr': answerAskMgr(d.thread, d.msg, d.answer === 'yes'); break;
    case 'tpl-ask': askLeadTpl(d.tpl || null); break;
    case 'pp-approve': if (P0) approveProposal(P0.id, d.edited === '1'); break;
    case 'pp-edit': if (P0 && isOwner()) { P0.mode = 'edit'; P0.draft = { name: P0.name, role: P0.role, instr: P0.instr, tools: P0.tools.slice(), model: P0.model, members: P0.members.slice(), err: '' }; ppRefresh(P0, `pp-name-${P0.id}`); } break;
    case 'pp-edit-cancel': if (P0) { P0.mode = null; P0.draft = null; ppRefresh(P0, `pp-edit-${P0.id}`); } break;
    case 'pp-reject-open': if (P0 && isOwner()) { P0.mode = 'reject'; P0.reasonErr = false; ppRefresh(P0, `pp-why-${P0.id}`); } break;
    case 'pp-reject-cancel': if (P0) { P0.mode = null; P0.reasonErr = false; ppRefresh(P0, `pp-no-${P0.id}`); } break;
    case 'pp-reject': if (P0) rejectProposal(P0.id); break;
    case 'pp-tool': if (P0 && P0.draft) { const L = P0.draft.tools; const i = L.indexOf(d.k); if (i >= 0) L.splice(i, 1); else L.push(d.k); ppRefresh(P0, `pp-tool-${P0.id}-${d.k}`); } break;
    case 'pp-model': if (P0 && P0.draft) { P0.draft.model = d.model; ppRefresh(P0, el.id); } break;
    case 'pp-member': if (P0 && P0.draft) { const L = P0.draft.members; const i = L.indexOf(d.person); if (i >= 0) L.splice(i, 1); else L.push(d.person); ppRefresh(P0, `pp-mem-${P0.id}-${d.person}`); } break;
    default: break;
  }
});
document.addEventListener('input', (e) => {
  const f = e.target.dataset && e.target.dataset.pp; if (!f) return;
  const P0 = PROPS[e.target.dataset.pid]; if (!P0) return;
  if (f === 'reason') { P0.reasonDraft = e.target.value; if (e.target.value.trim() && P0.reasonErr) { P0.reasonErr = false; const er = $(`#pp-why-err-${P0.id}`); if (er) er.hidden = true; e.target.removeAttribute('aria-invalid'); } return; }
  if (!P0.draft) return;
  P0.draft[f] = e.target.value;
  if (f === 'name' && e.target.value.trim() && P0.draft.err) { P0.draft.err = ''; const er = $(`#pp-name-err-${P0.id}`); if (er) er.hidden = true; }
});

/* ================= one company log · channels · mentions in «مستنيك» =================
   One record of what happened in the company, shown in three places: under every board card («السجل»), on every
   agent's page (its own lines) and the company page «سجل النشاط». Every change writes its own line (who, old → new,
   when). Members add notes under a card and can call a member or an agent with @; the writer can edit a note for
   5 minutes, then it is locked for good. Nothing in the log is ever deleted, by anyone.
   Channels are team conversations: members and agents write in one thread, and an agent there reads and answers only
   when someone calls it by name. Inside a channel every member sees and can call the channel's agents; outside it
   nothing changes. Notifications live inside gtmworks only: unread counts and «مستنيك». */
const PH = { omar: '@عمر', sara: '@سارة', youssef: '@يوسف', mona: '@منى', karim: '@كريم' };
const AR_FIRST = { omar: 'عمر', sara: 'سارة', youssef: 'يوسف', mona: 'منى', karim: 'كريم' };
const FEM = { sara: true, mona: true };
const gv = (p, m, f) => (FEM[p] ? f : m);                 // Arabic verb by the person's gender
const WHO = { p: (id) => ({ k: 'p', id }), a: (id) => ({ k: 'a', id }), sys: () => ({ k: 's' }) };
const ME = () => WHO.p(state.as);
const qt = (s) => lng(`«${s}»`, `“${s}”`);
const EDIT_MS = 5 * 60 * 1000;
Object.assign(state, { sheetTab: 'chat', noteEdit: null, noteEditSurf: null, noteDraft: null, logWho: 'all', logCard: 'all', readMent: {}, chAddingPerson: false });
const ROUTE_TIP = () => bx(lng('الوكلاء مش بيقروا ولا بيردّوا غير لما حد يناديهم باسمهم، زي @Critic. الكلام العادي بين الأعضاء مش بيروح لأي وكيل.', 'Agents read and reply only when someone calls them by name, like @Critic. Ordinary talk between members goes to no agent.'));

/* people are called the same way as agents (@عمر next to @Ads), and look the same */
const PH_RE = /@(?:عمر|سارة|يوسف|منى|كريم)/g;
const mx = (s) => bx(s).replace(PH_RE, (m) => `<bdi class="mention">${m}</bdi>`);
const peopleIn = (text) => roster().filter((p) => String(text || '').includes(PH[p]));
function agentsNamed(text, pool) {
  const out = [];
  (String(text || '').match(/@[^\s@،,.:؟?!]+/g) || []).forEach((h) => {
    const a = pool.find((k) => AGENTS[k] && AGENTS[k].handle.toLowerCase() === h.toLowerCase());
    if (a && !out.includes(a)) out.push(a);
  });
  return out;
}

/* who did it: a person (initial), an agent (its face) or gtmworks itself (the logo) */
const SYS_MARK = (s) => `<svg class="lg-sys" viewBox="0 0 32 32" width="${s}" height="${s}" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><path d="M21.5 11.5a7 7 0 1 0 1 7.5h-6.5" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const personAv = (p, s) => `<span class="me__av lg-av" style="--av:${s}px" aria-hidden="true">${PEOPLE[p].av}</span>`;
const whoAv = (w, s = 28) => (w.k === 'a' ? face(w.id, s) : w.k === 'p' ? personAv(w.id, s) : SYS_MARK(s));
const whoName = (w) => (w.k === 'a' ? `<bdi>${esc(AGENTS[w.id].name)}</bdi>` : w.k === 'p' ? esc(PEOPLE[w.id].first) : '<bdi>gtmworks</bdi>');
function dayName(back) {
  if (back === 0) return lng('النهارده', 'Today');
  if (back === 1) return lng('امبارح', 'Yesterday');
  const d = new Date(TODAY); d.setDate(d.getDate() - back);
  return RTL ? `${DAYN[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : `${DAY_EN[d.getDay()]}, ${MONTH_EN[d.getMonth()]} ${d.getDate()}`;
}
const timeOf = (ms) => { const d = new Date(ms); let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0'); const pm = h >= 12; h = h % 12 || 12; return `${h}:${m} ${pm ? lng('م', 'PM') : lng('ص', 'AM')}`; };

/* ---- the record ---- */
const LOG = [];
let logOrd = 0;
function logAdd(e) {
  const x = Object.assign({ id: nid('lg'), kind: 'auto', day: 0, time: nowTime() }, e);
  if (!x.ws && state.world === 'fresh') x.ws = 'fresh';
  x.ord = ++logOrd; LOG.push(x); return x;
}
let logsQueued = false;
function scheduleLogs() { if (logsQueued) return; logsQueued = true; window.requestAnimationFrame(() => { logsQueued = false; refreshLogs(); }); }
/* every change writes one line by itself */
function logAuto(who, act, opts) { const e = logAdd(Object.assign({ who, act, justAt: Date.now() }, opts || {})); scheduleLogs(); return e; }
const meAct = (m, f, en) => lng(gv(state.as, m, f), en);

function agentOkFor(e, a) {
  if (canSee(a)) return true;
  const c = e.card && cardById(e.card); const t = c && c.thread && threads[c.thread];
  if (t && t.channel && inChannel(t) && t.team.includes(a)) return true;
  const ch = e.chan && threads[e.chan];
  return !!(ch && inChannel(ch) && ch.team.includes(a));
}
/* a line shows only where its card, agent or channel shows */
function entryVisible(e) {
  if (!wsOk(e)) return false;
  /* a line about somebody who isn't in this workspace isn't part of it (alone: nobody but you) */
  if (e.who.k === 'p' && !inWs(e.who.id)) return false;
  if ((e.only || []).concat(e.needs || []).some((p) => !inWs(p))) return false;
  if (e.replyTo) { const q = LOG.find((x) => x.id === e.replyTo); if (q && !entryVisible(q)) return false; }
  if (e.card) { const c = cardById(e.card); if (!c || !cardVisible(c)) return false; }
  if (e.who.k === 'a' && !agentOkFor(e, e.who.id)) return false;
  if (e.agent && !agentOkFor(e, e.agent)) return false;
  if (e.chan) { const t = threads[e.chan]; if (!t || !chanOk(t) || !(inChannel(t) || canManage())) return false; }
  if (e.only && !(e.only.includes(state.as) || isOwner() || (e.mgr && canManage()))) return false;
  return true;
}
const noteLeft = (e) => (e.at ? EDIT_MS - (Date.now() - e.at) : -1);
const leftClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const leftTxt = (ms) => `${lng('تقدر تعدّلها لمدة', 'You can edit it for')} <span class="num">${leftClock(ms)}</span>`;

function entryHTML(e, ctx) {
  const surf = ctx.surf || 'page';
  const note = e.kind === 'note';
  const pw = e.who.k === 'p' ? e.who.id : null;
  const mine = pw === state.as;
  const left = note && pw ? noteLeft(e) : -1;
  const editing = note && mine && canWrite() && left > 0 && state.noteEdit === e.id && state.noteEditSurf === surf;
  const act = note ? (e.working ? lng('شغال على الطلب', 'is working on it') : e.reply ? lng('ردّ في السجل', 'replied in the log') : pw ? lng(gv(pw, 'كتب ملاحظة', 'كتبت ملاحظة'), 'wrote a note') : lng('كتب ملاحظة', 'wrote a note')) : e.act;
  const head = `<p class="lg-line"><b class="lg-name">${whoName(e.who)}</b>${mine ? ` <span class="lg-you">${lng('(انت)', '(you)')}</span>` : ''} <span class="lg-act">${bx(act)}</span>${e.obj ? ` <span class="lg-obj">${bx(qt(e.obj))}</span>` : ''}</p>`;
  const change = e.to != null ? `<p class="lg-change">${e.from != null ? `<span class="sr-only">${lng('من', 'from')}</span><span class="lg-val lg-val--old">${bx(e.from)}</span>${icon('arrow', 'lg-arrow')}<span class="sr-only">${lng('لـ', 'to')}</span>` : ''}<span class="lg-val">${bx(e.to)}</span></p>` : '';
  let body = '';
  if (note) {
    if (e.working) body = `<p class="lg-note lg-note--working"><span class="dot dot--working" aria-hidden="true"></span><span class="shimmer">${bx(e.workLine || lng('شغال', 'Working'))}…</span></p>`;
    else if (editing) {
      body = `<div class="lg-edit"><label class="sr-only" for="note-edit-t-${surf}">${lng('عدّل الملاحظة', 'Edit the note')}</label>
        <textarea class="set-input set-textarea lg-edit__t" id="note-edit-t-${surf}" data-note-edit="${e.id}" rows="3" dir="auto" aria-describedby="note-edit-err-${surf}">${esc(state.noteDraft != null ? state.noteDraft : e.text)}</textarea>
        <span class="set-err" id="note-edit-err-${surf}" hidden>${lng('الملاحظة مينفعش تبقى فاضية. اكتب حاجة، أو الغي التعديل.', 'A note can’t be empty. Write something, or cancel the edit.')}</span>
        <div class="lg-edit__row"><span class="lg-left" data-note-left="${e.id}">${leftTxt(left)}</span><span class="od-fill"></span>
          <button type="button" class="btn btn--secondary btn--sm" data-action="note-edit-cancel" data-entry="${e.id}">${lng('إلغاء', 'Cancel')}</button>
          <button type="button" class="btn btn--primary btn--sm" data-action="note-edit-save" data-entry="${e.id}">${lng('احفظ', 'Save')}</button></div></div>`;
    } else body = `<p class="lg-note" dir="auto">${mx(e.text)}</p>`;
  }
  const meta = [`<span class="lg-time num">${esc(e.time)}</span>`];
  if (ctx.cardLink && e.card) { const c = cardById(e.card); if (c) meta.push(`<button type="button" class="link-btn lg-card" data-action="log-card" data-card="${c.id}" aria-label="${lng('افتح سجل كارت', 'Open the log of')} ${esc(c.title)}">${icon('board')}<span class="od-truncate">${bx(c.title)}</span></button>`); }
  if (ctx.cardLink && e.chan && threads[e.chan] && inChannel(threads[e.chan])) meta.push(`<button type="button" class="link-btn lg-card" data-action="open-thread" data-thread="${e.chan}">${icon('hash')}<span class="od-truncate">${bx(threads[e.chan].title)}</span></button>`);
  if (e.link && (!e.link.need || sovHas(e.link.need)) && (!e.link.agent || canSee(e.link.agent))) meta.push(`<button type="button" class="link-btn lg-link" data-action="${e.link.action}"${e.link.learn ? ` data-learn="${e.link.learn}"` : ''}${e.link.agent ? ` data-agent="${e.link.agent}"` : ''}>${icon(e.link.icon || 'bulb')}<span>${esc(e.link.label)}</span></button>`);
  if (note && e.edited) meta.push(`<span class="lg-edited">${icon('pencil')}${lng('اتعدّلت', 'Edited')}</span>`);
  if (note && pw && !editing) {
    if (left > 0 && mine && canWrite()) meta.push(`<button type="button" class="link-btn" data-action="note-edit" data-entry="${e.id}" id="note-edit-${surf}-${e.id}">${icon('pencil')}${lng('عدّل', 'Edit')}</button><span class="lg-left" data-note-left="${e.id}">${leftTxt(left)}</span>`);
    else if (left <= 0) meta.push(`<span class="lg-lock" title="${lng('عدّى عليها 5 دقايق، فمبقتش تتعدّل', 'More than 5 minutes have passed, so it can’t be edited')}">${icon('lock')}${lng('اتقفلت', 'Locked')}</span>`);
  }
  const just = e.justAt && Date.now() - e.justAt < 900 ? ' is-just' : '';
  return `<li class="lg-row${note ? ' lg-row--note' : ''}${just}" data-entry="${e.id}">${whoAv(e.who, 28)}<div class="lg-body">${head}${change}${body}<p class="lg-meta">${meta.join('<span class="lg-dot" aria-hidden="true">·</span>')}</p></div></li>`;
}
/* grouped by day; newest first on the pages, oldest first under a card (it reads like a conversation there) */
function logGroupsHTML(list, ctx, oldestFirst) {
  const days = Array.from(new Set(list.map((e) => e.day))).sort((a, b) => (oldestFirst ? b - a : a - b));
  return days.map((d) => {
    const items = list.filter((e) => e.day === d).sort((x, y) => (oldestFirst ? x.ord - y.ord : y.ord - x.ord));
    return `<section class="lg-day" aria-label="${esc(dayName(d))}"><h3 class="lg-day__h">${esc(dayName(d))}</h3><ol class="lg-list">${items.map((e) => entryHTML(e, ctx)).join('')}</ol></section>`;
  }).join('');
}
const foreverHTML = () => `<p class="lg-forever">${icon('lock')}<span>${lng('مفيش حاجة في السجل بتتمسح، ولا حتى من المالك. الملاحظة بيعدّلها اللي كتبها بس، في أول 5 دقايق.', 'Nothing in the log is ever deleted, not even by the Owner. Only the writer can edit a note, in its first 5 minutes.')}</span></p>`;
const cardLog = (c) => LOG.filter((e) => e.card === c.id && entryVisible(e));
const agentLog = (a) => LOG.filter((e) => entryVisible(e) && (e.agent === a || (e.who.k === 'a' && e.who.id === a) || (e.agents || []).includes(a)));

/* ---- (a) under every board card: «السجل» in the card's sheet ---- */
function cardLogHTML(c) {
  const list = cardLog(c);
  return `<div class="lg-wrap">${list.length ? logGroupsHTML(list, { surf: 'sheet' }, true) : `<div class="panel-card"><p class="panel-empty">${lng('لسه مفيش حاجة في سجل الكارت ده. أي تغيير عليه هيتكتب هنا لوحده.', 'Nothing in this card’s log yet. Any change to it is written here on its own.')}</p></div>`}${foreverHTML()}</div>`;
}
function noteComposerHTML() {
  return `<div class="composer note-composer" data-composer="note">
      <div class="menu" data-pop="note" role="listbox" aria-label="${lng('نادي حد', 'Call someone')}" hidden></div>
      <div class="composer__row">
        <label class="sr-only" for="ta-note">${lng('اكتب ملاحظة في سجل الكارت', 'Write a note in the card’s log')}</label>
        <textarea class="composer__input" id="ta-note" rows="1" dir="auto" data-nta="note" placeholder="${isSolo() ? lng('اكتب ملاحظة، و@ تنادي وكيل…', 'Write a note, @ to call an agent…') : lng('اكتب ملاحظة للفريق، و@ تنادي حد أو وكيل…', 'Write a note for the team, @ to call someone or an agent…')}" aria-autocomplete="list" aria-expanded="false" aria-describedby="note-hint"></textarea>
        <button type="button" class="composer__send" data-action="note-send" aria-label="${lng('سجّل الملاحظة', 'Add the note')}" disabled>${icon('send')}</button>
      </div></div>
    <p class="note-hint" id="note-hint">${icon('clock')}<span>${lng('تقدر تعدّل ملاحظتك 5 دقايق بس، وبعدها بتتقفل. والوكيل اللي تناديه بيرد هنا.', 'You can edit your note for 5 minutes only, then it locks. An agent you call answers here.')}</span></p>`;
}
const roNoteHTML = () => `<p class="ro-line">${icon('eye')}<span>${lng('حسابك للمشاهدة بس: بتقرا السجل كله، من غير ما تكتب ملاحظات.', 'Your account is view-only: you can read the whole log, without writing notes.')}</span></p>`;
function renderSheetBody(focus) {
  const c = cardById(state.sheetCard); const body = $('#sheet-body'); if (!c || !body) return;
  if (state.sheetTab === 'req' && c.code) {
    body.innerHTML = `<div class="transcript code-pane" id="sheet-req" tabindex="-1" role="tabpanel" aria-labelledby="sh-tab-req">${codeReqHTML(c)}</div>
      <div class="composer-area">${canWrite() ? `<p class="cx-foot">${icon('chat')}<span>${bx(lng('عايز تغيّر حاجة في الطلب؟ اكتب لـ Coder في «المحادثة» وهو يضيفها لنقط القبول.', 'Want to change something in the request? Write to Coder in “Chat” and it adds it to the acceptance points.'))}</span><button type="button" class="link-btn" data-action="sheet-tab" data-tab="chat">${lng('افتح المحادثة', 'Open the chat')}</button></p>` : roLineHTML()}</div>`;
    if (focus) window.requestAnimationFrame(() => { const ta = $('#cx-ans'); const box = $('#sheet-req'); if (ta) ta.focus(); else if (box) box.focus({ preventScroll: true }); });
    return;
  }
  if (state.sheetTab === 'log') {
    body.innerHTML = `<div class="transcript sheet-log" id="sheet-log" tabindex="-1" role="tabpanel" aria-labelledby="sh-tab-log">${cardLogHTML(c)}</div>
      <div class="composer-area">${canWrite() ? noteComposerHTML() : roNoteHTML()}</div>`;
    const box = $('#sheet-log'); box.scrollTop = box.scrollHeight;
    if (focus) window.requestAnimationFrame(() => { const ta = $('#ta-note'); if (ta) ta.focus(); });
    return;
  }
  /* the card came from another member's private chat with an agent: the chat itself stays theirs */
  { const th0 = c.thread && threads[c.thread];
    if (th0 && !threadMine(th0)) {
      const own = PEOPLE[th0.owner];
      body.innerHTML = `<div class="transcript" id="sheet-transcript" role="tabpanel" aria-labelledby="sh-tab-chat" tabindex="-1"><div class="transcript__col"><div class="empty-chat priv-sheet">
        <span class="priv-sheet__ic" aria-hidden="true">${icon('lock')}</span>
        <h2>${bx(`${lng('المحادثة دي بين', 'This chat is between')} ${own ? own.first : ''} ${lng('و', 'and ')}${AGENTS[th0.agent].name} ${lng('بس', 'only')}`)}</h2>
        <p>${bx(lng('الشغل المشترك على الكارت ده: حالته وسجلّه. لو عندك حاجة تقولها، اكتبها ملاحظة في السجل وهتوصل للكل.', 'The shared work on this card is its status and its log. If you have something to say, write it as a note in the log and everyone sees it.'))}</p>
        <button type="button" class="btn btn--secondary" data-action="sheet-tab" data-tab="log">${icon('history')}<span>${lng('افتح السجل', 'Open the log')}</span></button>
      </div></div></div><div class="composer-area"></div>`;
      if (focus) window.requestAnimationFrame(() => { const b = $('#sheet-transcript [data-action="sheet-tab"]'); if (b) b.focus(); });
      return;
    } }
  body.innerHTML = `<div class="transcript" id="sheet-transcript" role="tabpanel" aria-labelledby="sh-tab-chat"></div>
    <div class="composer-area">${canWrite() ? composerHTML('sheet', c.agent) : roLineHTML()}</div>`;
  state.attach.sheet = [];
  const tr = $('#sheet-transcript'); tr.dataset.forceBottom = '1';
  renderTranscript(tr, c.thread, 'sheet', c);
  if (c.thread && threads[c.thread] && threads[c.thread].unread) threads[c.thread].unread[state.as] = 0;
  syncComposer('sheet');
  tr.scrollTop = tr.scrollHeight;
  if (focus) window.requestAnimationFrame(() => { const ta = $('#ta-sheet'); if (ta) ta.focus(); });
}
function keepFocus(box) {
  const ae = document.activeElement;
  if (!ae || !ae.id || !box.contains(ae)) return null;
  let sel = null; if (/INPUT|TEXTAREA/.test(ae.tagName)) { try { sel = [ae.selectionStart, ae.selectionEnd]; } catch (err) { sel = null; } }
  return { id: ae.id, sel };
}
function restoreFocus(f, scope) {
  if (!f) return; const n = (scope || document).querySelector(`#${CSS.escape(f.id)}`); if (!n) return;
  n.focus({ preventScroll: true }); if (f.sel) { try { n.setSelectionRange(f.sel[0], f.sel[1]); } catch (err) { /* not a text field */ } }
}
function renderSheetLog() {
  const box = $('#sheet-log'); const c = cardById(state.sheetCard); if (!box || !c) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80; const keep = box.scrollTop; const f = keepFocus(box);
  box.innerHTML = cardLogHTML(c);
  box.scrollTop = atBottom ? box.scrollHeight : keep; restoreFocus(f, box);
}

/* ---- (b) on every agent's page: that agent's lines ---- */
function agentLogHTML(a) {
  const list = agentLog(a);
  return `<section class="dp-sec"><h3 class="dp-label"><span>${lng('السجل', 'Log')} <span class="muted num">${list.length}</span></span><button type="button" class="link-btn" data-action="log-open-agent" data-agent="${a}">${lng('افتح سجل النشاط', 'Open the activity log')}</button></h3>
    ${list.length ? `<div class="lg-wrap lg-wrap--panel">${logGroupsHTML(list, { surf: 'panel', cardLink: true })}</div>` : `<div class="panel-card"><p class="panel-empty">${lng('لسه مفيش حاجة في سجل الوكيل ده.', 'Nothing in this agent’s log yet.')}</p></div>`}
    ${foreverHTML()}</section>`;
}

/* ---- (c) the company page «سجل النشاط»: newest first, filters by person or agent and by card ---- */
function logMatchWho(e, w) {
  if (w === 'all') return true;
  const [k, id] = w.split(':');
  if (k === 's') return e.who.k === 's';
  if (k === 'p') return e.who.k === 'p' && e.who.id === id;
  return (e.who.k === 'a' && e.who.id === id) || e.agent === id || (e.agents || []).includes(id);
}
function renderLogPage() {
  const v = $('#view-log'); if (!v) return;
  const old = $('.lgp', v); const keep = old ? old.scrollTop : 0; const f = keepFocus(v);
  const all = LOG.filter(entryVisible);
  const w = state.logWho; const cd = state.logCard;
  const list = all.filter((e) => logMatchWho(e, w) && (cd === 'all' || e.card === cd));
  const ppl = roster(); const ags = visibleAgents();
  const crd = cards.filter((c) => cardVisible(c) && all.some((e) => e.card === c.id));
  const opt = (val, label) => `<option value="${esc(val)}" ${val === w ? 'selected' : ''}>${esc(label)}</option>`;
  const filtered = w !== 'all' || cd !== 'all';
  const n = list.length;
  v.innerHTML = `<div class="lgp">
    <header class="page-head"><div class="od-field"><h1 class="page-title">${lng('سجل النشاط', 'Activity log')}</h1>
      <p class="page-sub">${bx(`${lng('كل اللي اتغيّر في', 'Everything that changed at')} ${state.companyName}${lng(': مين عمل إيه وإمتى، من الأحدث للأقدم.', ': who did what and when, newest first.')}`)}</p></div></header>
    <div class="lgp-tools" role="group" aria-label="${lng('فلاتر السجل', 'Log filters')}">
      <div class="lgp-field"><label for="lg-who">${lng('مين', 'Who')}</label>
        <select class="set-input" id="lg-who">${opt('all', lng('الكل', 'Everyone'))}
          <optgroup label="${lng('الناس', 'People')}">${ppl.map((p) => opt(`p:${p}`, PEOPLE[p].name)).join('')}</optgroup>
          <optgroup label="${lng('الوكلاء', 'Agents')}">${ags.map((a) => opt(`a:${a}`, AGENTS[a].name)).join('')}</optgroup>
          ${opt('s', lng('gtmworks (تلقائي)', 'gtmworks (automatic)'))}</select></div>
      <div class="lgp-field"><label for="lg-card">${lng('الكارت', 'Card')}</label>
        <select class="set-input" id="lg-card"><option value="all" ${cd === 'all' ? 'selected' : ''}>${lng('كل الكروت', 'All cards')}</option>${crd.map((c) => `<option value="${c.id}" ${c.id === cd ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></div>
      ${filtered ? `<button type="button" class="link-btn lgp-clear" data-action="log-clear">${lng('اعرض الكل', 'Show everything')}</button>` : ''}
      <span class="lgp-count" aria-live="polite">${n} ${n === 1 ? lng('سطر', 'entry') : lng('سطر', 'entries')}</span>
    </div>
    <div class="lgp-body">${n ? logGroupsHTML(list, { surf: 'page', cardLink: true }) : !all.length ? `<div class="panel-card lgp-empty"><p class="panel-empty">${bx(lng('لسه مفيش حاجة في السجل. أول ما Lead يعمل وكيل، أو حد يغيّر حاجة، هتتكتب هنا لوحدها.', 'Nothing in the log yet. As soon as Lead makes an agent, or someone changes something, it’s written here on its own.'))}</p></div>` : `<div class="panel-card lgp-empty"><p class="panel-empty">${lng('مفيش سطور بالفلاتر دي. جرّب «الكل»، أو كارت تاني.', 'No entries match these filters. Try “Everyone”, or another card.')}</p>
      <button type="button" class="btn btn--secondary btn--sm" data-action="log-clear">${lng('اعرض الكل', 'Show everything')}</button></div>`}${foreverHTML()}</div>
  </div>`;
  const nw = $('.lgp', v); if (nw && keep) nw.scrollTop = keep;
  restoreFocus(f, v);
}
function refreshLogs() {
  if (state.view === 'log') renderLogPage();
  if (state.sheetCard) { renderSheetHead(); if (state.sheetTab === 'log') renderSheetLog(); }
  if (state.view === 'chat' && state.dpTab === 'log' && !state.dpSettings && $('#dp-panel')) renderDetails();
}

/* ---- notes: write, call someone with @, edit for 5 minutes, then locked ---- */
function syncNoteComposer() {
  const ta = $('#ta-note'); if (!ta) return;
  ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
  const b = $('[data-action="note-send"]'); if (b) b.disabled = !ta.value.trim();
}
function notePool(c) {
  const t = c && c.thread && threads[c.thread];
  const extra = t && t.channel && inChannel(t) ? t.team : [];
  return visibleAgents().concat(extra.filter((a) => !canSee(a)));
}
function noteReplyText(a, c, by) {
  const nm = AR_FIRST[by] || '';
  const ch = DATA['7'].ch;
  const R = {
    analyst: `آخر 7 أيام (5 – 11 نوفمبر): الليد في Meta بـ ${fmt1(ch.meta.spend / ch.meta.leads)} ج، وفي Google بـ ${fmt1(ch.google.spend / ch.google.leads)} ج. هضيف الرقمين لـ «${c.title}» وأحدّثهم كل يوم الصبح هنا.`,
    ads: `تمام يا ${nm}. هظبط «${c.title}» على كلامك، ومش هطلق ولا هصرف حاجة قبل موافقتكم. هكتب هنا أول ما المسودة تجهز.`,
    critic: `استلمت يا ${nm}. هراجع «${c.title}» سطر سطر، الوعود والأرقام واللهجة، وأكتب ملاحظاتي هنا قبل ما حاجة تطلع.`,
    seo: `تمام يا ${nm}. هبص على ترتيب الكلمات بتاعة «${c.title}» في Search Console، وأرجعلك هنا بالنتيجة النهارده.`,
  };
  if (R[a]) return R[a];
  if (isMain(a)) return `ده عندي يا ${nm}. هتابع «${c.title}» مع الوكيل المسؤول، وأكتب هنا أول ما يتحرك.`;
  return `تمام يا ${nm}، فهمت. هشتغل على ده وأكتب هنا أول ما أخلص، ولو فيه نشر أو صرف أو رسالة لعميل هسلّمها لحد منكم.`;
}
function sendNote() {
  const ta = $('#ta-note'); const c = cardById(state.sheetCard);
  if (!ta || !c || !canWrite()) return;
  const text = ta.value.trim(); if (!text) return;
  const ags = agentsNamed(text, notePool(c));
  const note = logAdd({ kind: 'note', who: ME(), text, at: Date.now(), card: c.id, agents: ags, justAt: Date.now() });
  ta.value = ''; syncNoteComposer(); closePop('note');
  /* an agent called in a note is a real request: it works on it and answers with its own note here */
  ags.slice(0, 2).forEach((a, i) => {
    const w = logAdd({ kind: 'note', who: WHO.a(a), working: true, reply: true, card: c.id, agent: a, workLine: `${lng('شغال على طلب', 'Working on the request from')} ${PEOPLE[state.as].first}`, justAt: Date.now() });
    later(2600 + i * 1200, () => { w.working = false; w.text = noteReplyText(a, c, note.who.id); w.time = nowTime(); w.justAt = Date.now(); refreshLogs(); renderSidebar(); });
  });
  refreshLogs();
  const box = $('#sheet-log'); if (box) box.scrollTop = box.scrollHeight;
  const ppl = peopleIn(text).filter((p) => p !== state.as);
  if (ppl.length) toast(`${memberNames(ppl)} ${ppl.length > 1 ? lng('هيلاقوها في «مستنيك»', 'will find it in “Waiting on you”') : lng('هيلاقيها في «مستنيك»', 'will find it in “Waiting on you”')}`, 'at');
  else if (ags.length) toast(`${namesOf(ags)} ${lng('شغال على طلبك، والرد هيبقى هنا', 'is working on your request; the answer lands here')}`, 'at');
  const nt = $('#ta-note'); if (nt) nt.focus();
}
const entryById = (id) => LOG.find((x) => x.id === id) || null;
function startNoteEdit(id, surf) {
  const e = entryById(id); if (!e || e.who.k !== 'p' || e.who.id !== state.as || !canWrite()) return;
  if (noteLeft(e) <= 0) { refreshLogs(); toast(lng('عدّى عليها 5 دقايق، فاتقفلت ومبقتش تتعدّل', 'More than 5 minutes have passed, so it’s locked'), 'lock'); return; }
  state.noteEdit = id; state.noteEditSurf = surf; state.noteDraft = e.text;
  refreshLogs();
  const scope = surf === 'sheet' ? $('#sheet') : surf === 'panel' ? $('#details') : $('#view-log');
  const t = scope && $(`#note-edit-t-${surf}`, scope); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
}
function endNoteEdit(id, focusEdit) {
  const surf = state.noteEditSurf;
  state.noteEdit = null; state.noteEditSurf = null; state.noteDraft = null;
  refreshLogs();
  if (focusEdit) {
    const scope = surf === 'sheet' ? $('#sheet') : surf === 'panel' ? $('#details') : $('#view-log');
    const b = scope && $(`#note-edit-${surf}-${id}`, scope); if (b) b.focus();
  }
}
function saveNoteEdit(id) {
  const e = entryById(id); if (!e || e.who.id !== state.as) return;
  if (noteLeft(e) <= 0) { endNoteEdit(id, false); toast(lng('الـ5 دقايق خلصوا قبل ما تحفظ، والملاحظة اتقفلت زي ما هي', 'The 5 minutes ran out before you saved; the note is locked as it was'), 'lock'); return; }
  const surf = state.noteEditSurf;
  const v = (state.noteDraft != null ? state.noteDraft : e.text).trim();
  if (!v) { const er = $(`#note-edit-err-${surf}`); const t = $(`#note-edit-t-${surf}`); if (er) er.hidden = false; if (t) { t.setAttribute('aria-invalid', 'true'); t.focus(); } return; }
  const changed = v !== e.text;
  if (changed) { e.text = v; e.edited = true; }
  endNoteEdit(id, true);
  toast(changed ? lng('الملاحظة اتعدّلت، وعليها علامة «اتعدّلت»', 'Note edited; it now carries an “Edited” mark') : lng('مفيش تغيير', 'No change'), changed ? 'pencil' : 'check');
}
/* the clock on notes still open for editing; at 0 the note locks for good */
window.setInterval(() => {
  let expired = false;
  $$('[data-note-left]').forEach((n) => {
    const e = entryById(n.dataset.noteLeft); if (!e) return;
    const left = noteLeft(e); if (left <= 0) expired = true; else n.innerHTML = leftTxt(left);
  });
  if (!expired) return;
  if (state.noteEdit) { const e = entryById(state.noteEdit); if (e && noteLeft(e) <= 0) { state.noteEdit = null; state.noteEditSurf = null; state.noteDraft = null; toast(lng('الـ5 دقايق خلصوا، والملاحظة اتقفلت زي ما هي', 'The 5 minutes are up; the note is locked as it was'), 'lock'); } }
  refreshLogs();
}, 1000);

/* ---- mentions of me, from a channel or a log note: they wait in «مستنيك» until opened ---- */
function mentionsOf(p) {
  const out = [];
  Object.values(threads).forEach((t) => {
    if (!t.channel || !t.people.includes(p) || !threadVisible(t)) return;
    t.msgs.forEach((m) => {
      if (m.role === 'user' && m.by && m.by !== p && String(m.text || '').includes(PH[p])) out.push({ id: `c:${t.id}:${m.id}`, src: 'chan', who: WHO.p(m.by), text: m.text, thread: t.id, msg: m.id, time: m.time, k: m.ord || 0 });
    });
  });
  LOG.forEach((e) => {
    if (e.kind !== 'note' || e.working || !e.text || !e.text.includes(PH[p]) || (e.who.k === 'p' && e.who.id === p) || !entryVisible(e)) return;
    out.push({ id: `n:${e.id}`, src: 'note', who: e.who, text: e.text, card: e.card, entry: e.id, time: e.time, k: e.ord + 10000 });
  });
  return out.sort((x, y) => y.k - x.k);
}
const readSet = () => state.readMent[state.as] || (state.readMent[state.as] = new Set());
const unreadMentions = () => mentionsOf(state.as).filter((x) => !readSet().has(x.id));
function mentionWhere(x) {
  if (x.src === 'chan') return `${lng('في', 'in')} <span class="od-nowrap">#${bx(threads[x.thread].title)}</span>`;
  const c = cardById(x.card); return `${lng('في سجل', 'in the log of')} ${bx(qt(c ? c.title : ''))}`;
}
const mentionVerb = (x) => (x.who.k === 'p' ? lng(gv(x.who.id, 'ذكرك', 'ذكرتك'), 'mentioned you') : lng('ذكرك', 'mentioned you'));
function mentionCardHTML(x) {
  return `<button type="button" class="mcard" data-action="open-mention" data-mention="${esc(x.id)}">
    <span class="mcard__top">${whoAv(x.who, 20)}<span class="od-fill mcard__who"><b>${whoName(x.who)}</b> ${mentionVerb(x)} ${mentionWhere(x)}</span><span class="mcard__time num">${esc(x.time)}</span></span>
    <span class="mcard__q od-clamp-3">${mx(x.text)}</span></button>`;
}
function mentionGroupHTML(list) {
  if (!list.length) return '';
  return `<div class="mn-group" role="group" aria-labelledby="mn-h"><h3 class="mn-h" id="mn-h">${icon('at')}<span>${lng('اتذكرت فيها', 'Mentions of you')}</span> <span class="num">${list.length}</span></h3>
    ${list.map(mentionCardHTML).join('')}${cards.some((c) => c.col === 'waiting' && cardVisible(c)) ? '<div class="mn-sep" role="separator"></div>' : ''}</div>`;
}
function mentionRowHTML(x) {
  return `<button type="button" class="panel-row" data-action="open-mention" data-mention="${esc(x.id)}">${whoAv(x.who, 24)}
    <span class="panel-row__text"><span class="panel-row__t"><b>${whoName(x.who)}</b> ${mentionVerb(x)} ${mentionWhere(x)}</span><span class="panel-row__d od-clamp-2">${mx(x.text)}</span></span>
    <span class="panel-row__meta">${icon('chevron')}</span></button>`;
}
function spotIn(box, el) {
  if (!box || !el) return;
  const d = el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3;
  box.scrollTop += d;
  el.classList.remove('is-spot'); void el.offsetWidth; el.classList.add('is-spot');
}
function openMention(id) {
  const x = mentionsOf(state.as).find((m) => m.id === id); if (!x) return;
  readSet().add(id);
  if (x.src === 'chan') {
    if ($('#sheet').open) { state.sheetCard = null; $('#sheet').close(); }
    openThread(x.thread);
    window.requestAnimationFrame(() => { const tr = $('#chat-transcript'); spotIn(tr, tr && $(`[data-msg="${x.msg}"] .bubble`, tr)); });
  } else {
    if (!cardById(x.card)) return;
    if ($('#sheet').open && state.sheetCard === x.card) { state.sheetTab = 'log'; renderSheetHead(); renderSheetBody(false); }
    else openSheet(x.card, 'log');
    window.requestAnimationFrame(() => { const box = $('#sheet-log'); spotIn(box, box && $(`[data-entry="${x.entry}"] .lg-body`, box)); });
    renderSidebar(); if (state.view === 'board') renderBoard(); if (state.view === 'chat') refreshMounted();
  }
}

/* ---- channels ---- */
const unreadOf = (t) => (t && t.unread ? t.unread[state.as] || 0 : 0);
/* a new message counts as unread for everyone who can read it, except its writer and whoever has it open */
function noteUnread(threadId, except) {
  const t = threads[threadId]; if (!t) return;
  t.unread = t.unread || {};
  const open = (state.view === 'chat' && state.chatThread === threadId) || (!!state.sheetCard && state.sheetTab === 'chat' && (cardById(state.sheetCard) || {}).thread === threadId);
  (t.channel ? t.people : [state.as]).forEach((p) => {
    if (p === except || (p === state.as && open)) return;
    t.unread[p] = (t.unread[p] || 0) + 1;
  });
}
const chanOf = (key) => { const t = threads[threadOfKey(key)]; return t && t.channel ? t : null; };
const chanAgentsPool = () => (isOwner() ? [state.main].concat(AGENT_ORDER.filter((a) => a !== state.main)) : visibleAgents());
/* @ in a channel (or a log note): the channel's members and agents (even one hidden from me elsewhere) */
function mentionMenu(key, q) {
  const ch = key === 'note' ? null : chanOf(key);
  const agentList = key === 'note' ? notePool(cardById(state.sheetCard)) : ch ? ch.team : visibleAgents();
  const items = [];
  if (key === 'note' || ch) {
    (ch ? ch.people : roster()).filter((p) => p !== state.as && (PH[p].slice(1).includes(q) || PEOPLE[p].name.toLowerCase().includes(q))).forEach((p) => {
      items.push({ sec: lng('حد من الفريق', 'Someone on the team'), ins: PH[p] + ' ', html: `${personAv(p, 22)}<span class="menu__t">${esc(PEOPLE[p].name)}<span class="menu__d">${esc(PEOPLE[p].title)}${PEOPLE[p].job ? ` · ${esc(PEOPLE[p].job)}` : ''}${p === 'mona' ? ` · ${lng('بتقرا بس', 'reads only')}` : ''}</span></span><bdi class="menu__hint" dir="rtl">${PH[p]}</bdi>` });
    });
  }
  agentList.filter((a) => AGENTS[a] && (AGENTS[a].handle.toLowerCase().includes(q) || AGENTS[a].name.toLowerCase().includes(q))).forEach((a) => {
    const only = !canSee(a);
    items.push({ sec: lng('نادي وكيل', 'Call an agent'), ins: AGENTS[a].handle + ' ', html: `${face(a, 22)}<span class="menu__t"><bdi>${esc(AGENTS[a].name)}</bdi><span class="menu__d">${only ? lng('ظاهر لك في القناة دي بس', 'Shown to you in this channel only') : `${STATUS_TXT[agentStatus(a)]} · ${esc(AGENTS[a].role)}`}</span></span>` });
  });
  return items;
}
function chIntroHTML(t) {
  const hidden = t.team.filter((a) => !canSee(a));
  return `<div class="ch-intro"><span class="ch-intro__h">#${bx(t.title)}</span>
    <span>${t.people.length} ${lng('أعضاء', 'members')}${t.team.length ? ` · ${namesHTML(t.team)}` : ` · ${lng('مفيش وكلاء', 'no agents')}`}</span>
    <p>${icon('at')}<span>${ROUTE_TIP()}</span></p>
    ${hidden.length ? `<p class="ch-intro__only">${icon('eye')}<span>${namesHTML(hidden)} ${hidden.length > 1 ? lng('ظاهرين لك في القناة دي بس، وتقدر تناديهم هنا. برّه القناة مش هيظهروا عندك.', 'are shown to you in this channel only, and you can call them here. Outside the channel they stay hidden.') : lng('ظاهر لك في القناة دي بس، وتقدر تناديه هنا. برّه القناة مش هيظهر عندك.', 'is shown to you in this channel only, and you can call it here. Outside the channel it stays hidden.')}</span></p>` : ''}</div>`;
}
function chAddPerson(p) {
  const t = teamThreadNow(); if (!t || !t.channel || !canManage() || t.people.includes(p)) return;
  t.people.push(p); t.unread = t.unread || {}; t.unread[p] = (t.unread[p] || 0) + 1;
  t.msgs.push({ id: nid('n'), role: 'note', icon: 'team', text: `${me().first} ${meAct('ضاف', 'ضافت', 'added')} ${PEOPLE[p].first} ${lng('للقناة', 'to the channel')}`, fresh: true });
  logAuto(ME(), meAct(`ضاف ${PEOPLE[p].first} لقناة`, `ضافت ${PEOPLE[p].first} لقناة`, `added ${PEOPLE[p].first} to the channel`), { chan: t.id, obj: `#${t.title}` });
  state.chAddingPerson = false;
  refreshThread(t.id); scrollMounts(t.id); rerenderAll();
  const b = $('#ch-add-open'); if (b) b.focus();
  toast(`${PEOPLE[p].first} ${lng('بقى في', 'is now in')} #${t.title}`);
}
function chRemovePerson(p) {
  const t = teamThreadNow(); if (!t || !t.channel || !canManage() || t.general || p === state.as) return;
  const i = t.people.indexOf(p); if (i < 0) return;
  t.people.splice(i, 1);
  t.msgs.push({ id: nid('n'), role: 'note', icon: 'team', text: `${me().first} ${meAct('شال', 'شالت', 'removed')} ${PEOPLE[p].first} ${lng('من القناة', 'from the channel')}`, fresh: true });
  logAuto(ME(), meAct(`شال ${PEOPLE[p].first} من قناة`, `شالت ${PEOPLE[p].first} من قناة`, `removed ${PEOPLE[p].first} from the channel`), { chan: t.id, obj: `#${t.title}` });
  refreshThread(t.id); scrollMounts(t.id); rerenderAll();
  const b = $('#ch-add-open'); if (b) b.focus();
  toast(`${PEOPLE[p].first} ${lng('خرج من', 'left')} #${t.title}`, 'x');
}

/* ---- seed: RS Learning's channels, log and a proposal waiting on the Owner ---- */
{
  const tt = threads['th-team'];
  Object.assign(tt, { channel: true, title: 'حملة ديسمبر', people: ['omar', 'sara', 'youssef'], unread: { omar: 2, sara: 0, youssef: 1, mona: 0 } });
  const t1 = tt.msgs.find((m) => m.id === 't1');
  t1.by = 'sara'; t1.text = `@Ads @SEO ${t1.text}`;
  tt.msgs.push(
    { id: 't11', role: 'user', by: 'sara', time: lng('10:52 ص', '10:52 AM'), text: 'يوسف، استهداف الرياض لسه على 22–30 سنة؟ الليد هناك طالع أغلى من القاهرة.' },
    { id: 't12', role: 'user', by: 'youssef', time: lng('10:55 ص', '10:55 AM'), text: 'آه لسه. هوسّعه لـ 22–35 النهارده وأشوف تكلفة الليد بكرة الصبح.' },
    { id: 't13', role: 'user', by: 'sara', time: lng('10:56 ص', '10:56 AM'), text: 'تمام، وخلّي نص الرياض بلهجة سعودية خفيفة زي ما اتفقنا.' },
    { id: 't14', role: 'user', by: 'youssef', time: lng('11:02 ص', '11:02 AM'), text: '@Critic راجع النص ده قبل ما أرفعه للرياض: «تبغى تشتغل محاسب؟ ابدأ بشهادة معتمدة خلال 3 شهور»' },
    { id: 't15', role: 'agent', agent: 'critic', time: lng('11:03 ص', '11:03 AM'), text: 'راجعته يا يوسف:\n• «خلال 3 شهور» وعد بمدة مقدرش نثبته لكل الطلبة، الأحسن «ابدأ بشهادة معتمدة وتدريب عملي»\n• اللهجة السعودية مظبوطة ومفيهاش كلمات مصرية\n\nبعد التعديل ده جاهز يترفع مسودة.' },
    { id: 't16', role: 'user', by: 'sara', time: lng('11:10 ص', '11:10 AM'), text: '@عمر المقال جاهز مسودة على WordPress، محتاج تنشره النهارده عشان يلحق تسجيل الدفعة الجديدة.' },
  );
  threads['ch-general'] = {
    id: 'ch-general', channel: true, general: true, agent: 'lead', team: ['lead'], people: TEAM_ORDER.slice(), title: lng('عام', 'عام'), time: lng('9:20 ص', '9:20 AM'), day: 0, ts: 660, card: null,
    unread: { omar: 2, sara: 0, youssef: 1, mona: 3 },
    msgs: [
      { id: 'g1', role: 'user', by: 'omar', time: lng('9:05 ص', '9:05 AM'), text: 'صباح الخير يا جماعة. الدفعة الجديدة من «المحاسب الشامل» بتبدأ 1 ديسمبر، فكل حملات التسجيل لازم تبقى جاهزة قبل 20 نوفمبر.' },
      { id: 'g2', role: 'user', by: 'youssef', time: lng('9:12 ص', '9:12 AM'), text: 'تمام. حملة Meta هتبقى جاهزة الأسبوع ده، وGoogle Search بعدها بيومين.' },
      { id: 'g3', role: 'user', by: 'sara', time: lng('9:15 ص', '9:15 AM'), text: '@Lead لخّصلنا مين مستني إيه النهارده.' },
      { id: 'g4', role: 'agent', agent: 'lead', time: lng('9:15 ص', '9:15 AM'), text: 'ده اللي واقف النهارده:\n• حملة Meta للمحاسب الشامل: مستنية عمر يختار زاوية الإعلان\n• مقال «كورس محاسبة اونلاين»: مستني موافقة النشر\n• حملة ديسمبر: المقال اتسلّم لعمر ينشره على WordPress\n\nالباقي ماشي لوحده، وهقولكم هنا لو حاجة وقفت.' },
      { id: 'g5', role: 'user', by: 'sara', time: lng('9:20 ص', '9:20 AM'), text: '@منى تقرير الأسبوع هيبقى جاهز الخميس، هتلاقيه في صفحة الأرقام.' },
    ],
  };
  let o = 0; ['ch-general', 'th-team'].forEach((id) => threads[id].msgs.forEach((m) => { m.ord = ++o; }));
  threads['th-report'].unread = { omar: 1, youssef: 1, mona: 1 };
  threads['th-critic'].unread = { omar: 1 };

  /* a new-agent request from Youssef, waiting on the Owner. His chat with Lead stays his; Lead tells Omar in Omar's own chat */
  const P0 = { id: 'rq-seed', kind: 'request', bp: 'wa', job: 'wa', name: 'FollowUp', role: BP.wa.role, line: BP.wa.line, apps: BP.wa.apps.slice(), look: Object.assign({}, BP.wa.look), tpl: 'wa',
    reply: BP.wa.reply, example: BP.wa.example, by: 'youssef', why: 'الليدز بتبرد قبل ما حد يرد عليها، و38 ليد الأسبوع ده محدش كلّمهم',
    status: 'pending', thread: 'th-wa', ownerThread: 'th-wa-req', card: 'c-prop', at: lng('9:41 ص', '9:41 AM'), world: 'team' };
  MADE[P0.id] = P0;
  threads['th-wa'] = { id: 'th-wa', agent: 'lead', owner: 'youssef', title: 'وكيل يتابع ليدز واتساب', time: lng('9:41 ص', '9:41 AM'), day: 0, ts: 560, card: null,
    msgs: [
      { id: 'w1', role: 'user', by: 'youssef', time: lng('9:40 ص', '9:40 AM'), text: 'عايز حد يتابع ليدز واتساب ويجهّز رسايل المتابعة، الليدز بتبرد قبل ما حد يرد عليها' },
      { id: 'w2', role: 'agent', agent: 'lead', time: lng('9:41 ص', '9:41 AM'), text: 'فهمتك يا يوسف. مقدرش أعمل وكلاء غير بطلب من عمر، فجهّزت طلبك زي ما هيبقى بالظبط وبعته له. لسه مفيش وكيل اتعمل، وهقولك هنا أول ما يرد.', card: { type: 'agentcard', pid: P0.id } },
    ] };
  threads['th-wa-req'] = { id: 'th-wa-req', agent: 'lead', owner: 'omar', title: 'يوسف طالب وكيل: متابعة ليدز واتساب', time: lng('9:41 ص', '9:41 AM'), day: 0, ts: 561, card: 'c-prop', unread: { omar: 1 },
    msgs: [
      { id: 'wr1', role: 'agent', agent: 'lead', time: lng('9:41 ص', '9:41 AM'), text: 'يوسف طلب وكيل يتابع ليدز واتساب. جهّزته زي ما هيبقى بالظبط، ومش هيتعمل غير لما تقول «اعمله».', card: { type: 'agentcard', pid: P0.id } },
    ] };
  cards.unshift({ id: 'c-prop', col: 'waiting', title: `${lng('طلب وكيل:', 'Agent request:')} ${P0.name}`, agent: 'lead', chan: lng('طلب وكيل', 'Agent request'), due: '', thread: 'th-wa-req', request: P0.id,
    wait: lng('يوسف طالبه · مستني تقول «اعمله» أو «لأ»', 'Youssef asked for it · waiting for your yes or no') });

  const S = (day, time, e) => logAdd(Object.assign({ day, time }, e));
  const T = (ar, en) => lng(ar, en);
  const now = Date.now(); const ch = DATA['7'].ch;
  /* how the company came to be: Lead alone first, then the agents it made over a few weeks, each at somebody's ask */
  AGENTS.lead.born = { first: true, d: '10 أكتوبر', en: 'Oct 10' };
  Object.assign(AGENTS.ads, { job: 'ads', born: { d: '10 أكتوبر', en: 'Oct 10', by: 'omar', thread: 'th-made-ads' } });
  Object.assign(AGENTS.seo, { job: 'seo', born: { d: '14 أكتوبر', en: 'Oct 14', by: 'omar' } });
  Object.assign(AGENTS.analyst, { job: 'analyst', born: { d: '22 أكتوبر', en: 'Oct 22', by: 'sara', ok: 'omar' } });
  /* working alone shows the same story with fewer agents: Critic came with the team */
  Object.assign(AGENTS.critic, { job: 'critic', worlds: ['team'], born: { d: '3 نوفمبر', en: 'Nov 3', by: 'omar' } });
  if (AGENTS.coder) Object.assign(AGENTS.coder, { job: 'coder', born: { d: '6 نوفمبر', en: 'Nov 6', by: 'omar', gallery: true } });
  AGENTS.ads.rules = [{ id: 'rl-seed', t: 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها', by: 'omar', at: lng('امبارح · 6:40 م', 'Yesterday · 6:40 PM') }];
  const PA = { id: 'mk-ads', kind: 'made', bp: 'ads', job: 'ads', name: 'Ads', role: BP.ads.role, line: BP.ads.line, apps: BP.ads.apps.slice(), face: 'ads', by: 'omar', why: 'عايز حد يمسك إعلانات Meta وGoogle',
    status: 'made', agent: 'ads', cap: '20,000 ج', thread: 'th-made-ads', dayLabel: ['10 أكتوبر', 'Oct 10'], world: 'team' };
  MADE[PA.id] = PA;
  threads['th-made-ads'] = { id: 'th-made-ads', agent: 'lead', owner: 'omar', title: 'وكيل لإعلانات Meta وGoogle', time: lng('10 أكتوبر', 'Oct 10'), day: 32, dayLabel: lng('الجمعة 10 أكتوبر', 'Friday, Oct 10'), ts: 90, card: null,
    msgs: [
      { id: 'ma1', role: 'user', by: 'omar', time: lng('11:02 ص', '11:02 AM'), text: 'عايز حد يمسك إعلانات Meta وGoogle' },
      { id: 'ma2', role: 'agent', agent: 'lead', time: lng('11:02 ص', '11:02 AM'), text: 'حلو، هعملك وكيل يمسك حملات Meta وGoogle. سؤال واحد بس قبل ما أعمله:',
        card: { type: 'ask1', status: 'answered', answer: '20,000 ج', purpose: 'bp', bp: 'ads', by: 'omar', q: BP.ads.ask.q, why: BP.ads.ask.why, opts: BP.ads.ask.opts } },
      { id: 'ma3', role: 'user', by: 'omar', time: lng('11:03 ص', '11:03 AM'), text: '20,000 ج' },
      { id: 'ma4', role: 'agent', agent: 'lead', time: lng('11:03 ص', '11:03 AM'), text: `تمام، عملتلك Ads. ${BP.ads.made}`, card: { type: 'agentcard', pid: PA.id } },
      { id: 'ma5', role: 'user', by: 'omar', time: lng('11:05 ص', '11:05 AM'), text: 'تمام. خليه يبدأ بحملة «المحاسب الشامل»' },
      { id: 'ma6', role: 'agent', agent: 'lead', time: lng('11:05 ص', '11:05 AM'), text: 'سلّمتها لـ Ads في محادثته، وهيرجعلك بالخطة وتوزيع الميزانية قبل ما يطلق أي حاجة.' },
    ] };
  /* a lasting rule, told to Ads in its own chat */
  threads['th-rule-ads'] = { id: 'th-rule-ads', agent: 'ads', owner: 'omar', title: 'قاعدة: مفيش حاجة للعميل قبل ما أشوفها', time: lng('6:40 م', '6:40 PM'), day: 1, ts: 470, card: null,
    msgs: [
      { id: 'ra1', role: 'user', by: 'omar', time: lng('6:39 م', '6:39 PM'), text: 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها' },
      { id: 'ra2', role: 'agent', agent: 'ads', time: lng('6:40 م', '6:40 PM'), text: 'تمام يا عمر. من دلوقتي أي حاجة رايحة لعميل، رسالة أو عرض أو رد على تعليق، هجهّزها وأستناك تشوفها الأول، وانت اللي تبعت.' },
      { id: 'ra3', role: 'note', icon: 'check', saved: true, text: lng('قاعدة عند Ads · اتكتبت في السجل', 'A rule for Ads · written in the log'), link: { action: 'sov-agent-open', agent: 'ads', label: lng('شوفها', 'See it') } },
    ] };
  S(32, T('11:03 ص', '11:03 AM'), { who: WHO.a('lead'), act: T('عمل وكيل جديد بطلب من عمر', 'made a new agent at the request of Omar'), agent: 'ads', obj: 'Ads', to: BP.ads.role });
  S(28, T('2:20 م', '2:20 PM'), { who: WHO.a('lead'), act: T('عمل وكيل جديد بطلب من عمر', 'made a new agent at the request of Omar'), agent: 'seo', obj: 'SEO', to: AGENTS.seo.role });
  S(20, T('12:10 م', '12:10 PM'), { who: WHO.p('omar'), act: T('عمل وكيل طلبته سارة', 'made an agent Sara asked for'), agent: 'analyst', obj: 'Analyst', from: T('طلب', 'Request'), to: T('ظهر عند سارة', 'Shows for Sara') });
  S(8, T('10:30 ص', '10:30 AM'), { who: WHO.a('lead'), act: T('عمل وكيل جديد بطلب من عمر', 'made a new agent at the request of Omar'), agent: 'critic', obj: 'Critic', to: AGENTS.critic.role });
  /* الحد 8 نوفمبر */
  S(3, T('11:20 ص', '11:20 AM'), { who: WHO.a('ads'), act: T('أطلق حملة إعادة استهداف لزوار صفحة الكورس', 'launched a retargeting campaign for course-page visitors'), card: 'c-live1', to: T('250 ج يومياً', 'EGP 250/day') });
  /* الاتنين 9 نوفمبر */
  S(2, T('9:00 ص', '9:00 AM'), { who: WHO.sys(), act: T('فتح قناة', 'opened the channel'), obj: '#عام', chan: 'ch-general', to: T('كل أعضاء الشركة · Lead', 'Everyone in the company · Lead') });
  S(2, T('9:05 ص', '9:05 AM'), { who: WHO.a('ads'), act: T('وقّف إعلانين تكلفة الليد فيهم عدّت 45 ج', 'paused 2 ads whose cost per lead passed EGP 45'), card: 'c-live2', from: T('2 إعلان شغالين', '2 ads running'), to: T('واقفين · وفّر 1,240 ج', 'Paused · saved EGP 1,240') });
  S(2, T('10:20 ص', '10:20 AM'), { who: WHO.p('omar'), act: T('غيّر موديل', 'changed the model of'), obj: 'Ads', agent: 'ads', from: 'GPT-5', to: 'Opus 5.5' });
  S(2, T('11:00 ص', '11:00 AM'), { who: WHO.p('sara'), act: T('غيّرت الوكلاء اللي يوسف بيشتغل معاهم', 'changed which agents Youssef works with'), obj: 'Analyst', agent: 'analyst', from: T('مقفول', 'Off'), to: T('مسموح', 'Allowed'), only: ['youssef', 'sara'], mgr: true });
  /* امبارح */
  S(1, T('10:05 ص', '10:05 AM'), { who: WHO.p('sara'), act: T('ضافت فكرة', 'added an idea'), card: 'c-idea1', to: colName('ideas') });
  S(1, T('12:50 م', '12:50 PM'), { who: WHO.a('seo'), act: T('سلّم نسخة 1 من المقال', 'delivered version 1 of the article'), card: 'c-seo', to: T('1,850 كلمة · لـ Critic', '1,850 words · to Critic') });
  S(1, T('1:10 م', '1:10 PM'), { who: WHO.a('critic'), act: T('رجّع المقال بتعديلين', 'sent the article back with 2 edits'), card: 'c-seo', from: T('«شغل مضمون»', '“guaranteed job”'), to: T('من غير وعود', 'No promises') });
  S(1, T('1:30 م', '1:30 PM'), { who: WHO.a('seo'), act: T('سلّم نسخة 2 من المقال', 'delivered version 2 of the article'), card: 'c-seo', from: T('نسخة 1', 'Version 1'), to: T('نسخة 2 · بعد تعديلين', 'Version 2 · after 2 edits') });
  S(1, T('1:31 م', '1:31 PM'), { who: WHO.sys(), act: T('نقل الكارت', 'moved the card'), card: 'c-seo', from: colName('progress'), to: colName('waiting') });
  S(1, T('2:05 م', '2:05 PM'), { kind: 'note', who: WHO.p('sara'), card: 'c-seo', at: now - 21 * 3600 * 1000, edited: true, text: '@عمر المقال لازم يطلع قبل الخميس عشان يلحق تسجيل الدفعة الجديدة. راجعت الأرقام اللي فيه، وكلها مطابقة لصفحة الكورس.' });
  S(1, T('4:00 م', '4:00 PM'), { who: WHO.p('omar'), act: T('عمل قناة', 'created the channel'), obj: '#حملة ديسمبر', chan: 'th-team', to: T('عمر وسارة ويوسف · Ads وCritic وSEO', 'Omar, Sara, Youssef · Ads, Critic, SEO') });
  S(1, T('6:15 م', '6:15 PM'), { who: WHO.a('critic'), act: T('راجع نصوص إعلانات ديسمبر', 'reviewed the December ad scripts'), card: 'c-critic', from: T('8 نصوص', '8 scripts'), to: T('5 تمام · 3 يتعدّلوا', '5 fine · 3 to fix') });
  S(1, T('6:16 م', '6:16 PM'), { who: WHO.a('critic'), act: T('سلّم الملاحظات لـ Ads', 'handed the notes to Ads'), card: 'c-critic', agent: 'ads', to: T('3 ملاحظات', '3 notes') });
  S(1, T('6:40 م', '6:40 PM'), { who: WHO.a('ads'), act: T('حفظ قاعدة جديدة', 'saved a new rule'), agent: 'ads', obj: 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها', to: T('من عمر في المحادثة · شغالة من دلوقتي', 'From Omar in the chat · in effect now'), link: { action: 'sov-agent-open', agent: 'ads', label: T('شوفها في إعداده', 'See it in its setup'), icon: 'gear' } });
  /* النهارده */
  S(0, T('9:30 ص', '9:30 AM'), { who: WHO.a('analyst'), act: T('بدأ التقرير الأسبوعي', 'started the weekly report'), card: 'c-report', to: T('من غير مبيعات GA4', 'Without GA4 sales') });
  S(0, T('9:41 ص', '9:41 AM'), { who: WHO.a('lead'), act: T('جهّز طلب وكيل من يوسف وبعته لعمر', 'prepared an agent request from Youssef and sent it to Omar'), obj: P0.name, only: ['youssef'] });
  S(0, T('10:11 ص', '10:11 AM'), { who: WHO.p('sara'), act: T('نقلت الكارت', 'moved the card'), card: 'c-meta', from: colName('planned'), to: colName('progress') });
  S(0, T('10:13 ص', '10:13 AM'), { who: WHO.p('omar'), act: T('سمح مرة واحدة', 'allowed once'), card: 'c-meta', obj: T('قراءة جماهير صفحة الأكاديمية', 'Read the academy page’s audiences'), from: T('مستني موافقة', 'Waiting for OK'), to: T('قراءة بس · مفيش صرف', 'Read only · no spend') });
  S(0, T('10:14 ص', '10:14 AM'), { who: WHO.sys(), act: T('نقل الكارت', 'moved the card'), card: 'c-meta', from: colName('progress'), to: colName('waiting') });
  S(0, T('10:32 ص', '10:32 AM'), { who: WHO.a('ads'), act: T('سلّم 3 نصوص Meta', 'delivered 3 Meta scripts'), card: 'c-team', to: T('نسخة 1 · زاوية «من خريج لمحاسب شغال»', 'Version 1 · “من خريج لمحاسب شغال” angle') });
  S(0, T('10:36 ص', '10:36 AM'), { who: WHO.a('critic'), act: T('رفض نص 2', 'refused script 2'), card: 'c-team', obj: 'أضمن طريق لأول وظيفة محاسبة', from: T('مسودة', 'Draft'), to: T('يتعدّل · وعد مقدرش نثبته', 'To fix · a promise we can’t prove') });
  S(0, T('10:37 ص', '10:37 AM'), { who: WHO.a('ads'), act: T('سلّم نسخة 2 من نص 2', 'delivered version 2 of script 2'), card: 'c-team', from: 'أضمن طريق لأول وظيفة محاسبة', to: 'أقصر طريق لأول شغلانة محاسبة' });
  S(0, T('10:40 ص', '10:40 AM'), { who: WHO.a('seo'), act: T('سلّم المقال مسودة على WordPress', 'delivered the article as a WordPress draft'), card: 'c-team', to: T('1,600 كلمة · Critic وافق بعد تعديل', '1,600 words · Critic approved after 1 edit') });
  S(0, T('10:40 ص', '10:40 AM'), { who: WHO.sys(), act: T('نقل الكارت', 'moved the card'), card: 'c-team', from: colName('progress'), to: colName('waiting') });
  S(0, T('10:58 ص', '10:58 AM'), { kind: 'note', who: WHO.p('sara'), card: 'c-meta', at: now - 50 * 60 * 1000, text: '@يوسف راجع استهداف الرياض قبل ما نطلق، الليد هناك طالع أغلى من القاهرة.' });
  S(0, T('11:03 ص', '11:03 AM'), { who: WHO.a('critic'), act: T('راجع نص الرياض بطلب من يوسف في #حملة ديسمبر', 'reviewed the Riyadh script for Youssef in #حملة ديسمبر'), card: 'c-team', from: '«خلال 3 شهور»', to: '«وتدريب عملي»' });
  const ask = S(0, T('11:20 ص', '11:20 AM'), { kind: 'note', who: WHO.p('sara'), card: 'c-report', at: now - 40 * 60 * 1000, agents: ['analyst'], text: '@Analyst ابعتلنا تكلفة الليد في Meta وGoogle لآخر 7 أيام، محتاجينها قبل اجتماع بكرة.' });
  S(0, T('11:21 ص', '11:21 AM'), { kind: 'note', who: WHO.a('analyst'), reply: true, card: 'c-report', agent: 'analyst', replyTo: ask.id,
    text: `آخر 7 أيام (5 – 11 نوفمبر): الليد في Meta بـ ${fmt1(ch.meta.spend / ch.meta.leads)} ج، وفي Google بـ ${fmt1(ch.google.spend / ch.google.leads)} ج. حطّيتهم في أول التقرير الأسبوعي، ولو GA4 اتوصل هضيف المبيعات جنبهم.` });
  /* a note still inside its 5 minutes (Omar wrote it 1:48 ago) */
  S(0, timeOf(now - 108000), { kind: 'note', who: WHO.p('omar'), card: 'c-meta', at: now - 108000, needs: ['youssef'], text: 'الزاوية الأولى أقرب لجمهورنا، بس هستنى رأي يوسف في الرياض قبل ما أوافق على الإطلاق.' });
}

/* a card moved by gtmworks itself (after an approval or «عملتها») */
function sysMove(cid, to, patch) {
  const c = cardById(cid); const from = c ? c.col : null;
  moveCard(cid, to, patch);
  if (c && from !== to) logAuto(WHO.sys(), lng('نقل الكارت', 'moved the card'), { card: cid, from: colName(from), to: colName(to) });
}

/* ---- events for this round ---- */
const surfOf = (el) => (el.closest('#sheet') ? 'sheet' : el.closest('#details') ? 'panel' : 'page');
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'sheet-tab': {
      if (state.sheetTab === d.tab) break;
      state.sheetTab = d.tab; state.noteEdit = null;
      renderSheetHead(); renderSheetBody(false);
      const b = $(`#sh-tab-${d.tab}`); if (b) b.focus();
      break;
    }
    case 'note-send': sendNote(); break;
    case 'note-edit': startNoteEdit(d.entry, surfOf(el)); break;
    case 'note-edit-cancel': endNoteEdit(d.entry, true); break;
    case 'note-edit-save': saveNoteEdit(d.entry); break;
    case 'log-card': openSheet(d.card, 'log'); break;
    case 'log-open-agent': {
      state.logWho = `a:${d.agent}`; state.logCard = 'all';
      if (overlayDetails()) { $('#details').classList.remove('is-open'); syncScrim(); }
      setView('log'); { const s = $('#lg-who'); if (s) s.focus(); } break;
    }
    case 'log-clear': state.logWho = 'all'; state.logCard = 'all'; renderLogPage(); { const s = $('#lg-who'); if (s) s.focus(); } break;
    case 'open-mention': openMention(d.mention); break;
    case 'channel-new': openTeamCreate(el); break;
    case 'ch-person': {
      const D = state.modal && state.modal.draft; if (!D || d.person === state.as) break;
      const i = D.people.indexOf(d.person); if (i >= 0) D.people.splice(i, 1); else D.people.push(d.person);
      renderModal(); { const b = $(`#ch-pick-${d.person}`); if (b) b.focus(); } break;
    }
    case 'ch-add-open': state.chAddingPerson = !state.chAddingPerson; renderDetails(); { const b = $('#ch-add-open'); if (b) b.focus(); } break;
    case 'ch-add': chAddPerson(d.person); break;
    case 'ch-remove': chRemovePerson(d.person); break;
    default: break;
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.nta) { syncNoteComposer(); updatePop('note'); return; }
  if (t.dataset && t.dataset.noteEdit) {
    state.noteDraft = t.value;
    if (t.value.trim()) { const er = t.parentElement.querySelector('.set-err'); if (er) er.hidden = true; t.removeAttribute('aria-invalid'); }
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'lg-who') { state.logWho = e.target.value; renderLogPage(); }
  if (e.target.id === 'lg-card') { state.logCard = e.target.value; renderLogPage(); }
});
/* capture phase: these keys must not reach the sheet's Esc-to-close or the details tabs */
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.nta) {
    if (popState.note) {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); movePop('note', 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); movePop('note', -1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pickPop('note', popState.note.idx); syncNoteComposer(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop('note'); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); sendNote(); }
    return;
  }
  if (t.dataset && t.dataset.noteEdit) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); saveNoteEdit(t.dataset.noteEdit); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endNoteEdit(t.dataset.noteEdit, true); }
    return;
  }
  if (t.getAttribute && t.getAttribute('role') === 'tab' && t.closest('.sheet-tabs') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); e.stopPropagation();
    const sc = cardById(state.sheetCard); const tabs = sc && sc.code ? ['req', 'chat', 'log'] : ['chat', 'log'];
    const i = tabs.indexOf(state.sheetTab); const dir = (e.key === 'ArrowLeft') === RTL ? 1 : -1;
    const nx = tabs[(i + dir + tabs.length) % tabs.length];
    state.sheetTab = nx; state.noteEdit = null; renderSheetHead(); renderSheetBody(false);
    const b = $(`#sh-tab-${nx}`); if (b) b.focus();
  }
}, true);
document.addEventListener('focusout', (e) => {
  if (e.target.id !== 'tm-name' || !state.modal || !state.modal.draft || e.target.value.trim()) return;
  if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-action="close-modal"]')) return;
  state.modal.draft.nameErr = true;
  const er = $('#tm-name-err'); if (er) er.hidden = false; e.target.setAttribute('aria-invalid', 'true');
});



/* ================= one system: working alone or with a team =================
   One product for a person working alone and for a team. Alone only hides the team parts; it is the same layout.
   The first run asks one question («هتشتغل لوحدك ولا مع تيم؟»). «مع تيم» goes on to invites; «لوحدي» opens straight
   away. Alone, «الفريق» stays reachable with «اعزم عضو»: the first invite turns channels and per-member agents on by
   themselves, with «عام» already there. There is no way back to alone while other members exist. */
Object.assign(state, { inviting: false, invErr: '', invEmail: '', invRole: 'contributor', fr: null, soloTpl: null });
const ROLES = ['manager', 'contributor', 'viewer'];
const ROLE_T = { manager: lng('مدير', 'Manager'), contributor: lng('مساهم', 'Contributor'), viewer: lng('مشاهدة', 'Viewer') };
const ROLE_D = {
  manager: lng('بيختار الوكلاء لكل عضو، وبيكتب ويوافق في كل حاجة.', 'Chooses the agents for each member, and writes and approves everywhere.'),
  contributor: lng('بيكتب ويوافق في الوكلاء اللي تختارهاله.', 'Writes and approves with the agents you choose for them.'),
  viewer: lng('بيقرا بس، من غير كتابة أو موافقة.', 'Reads only, without writing or approving.'),
};
const soloGrown = () => state.roster.solo.length > 1;
/* «شايف كـ»: four views (a prototype aid) */
const VIEWS = [
  { p: 'omar', w: 'solo', t: () => lng('لوحدي (مالك)', 'Alone (Owner)'), d: () => (soloGrown() ? `${lng('عمر · بدأ لوحده وعزم', 'Omar · started alone, then invited')} ${memberNames(state.roster.solo.slice(1))}` : lng('عمر · من غير تيم، هو والوكلاء بس', 'Omar · no team, just him and the agents')) },
  { p: 'omar', w: 'team', t: () => lng('عمر · مالك في تيم', 'Omar · Owner in a team'), d: () => lng('شايف كل الوكلاء والقنوات', 'Sees every agent and channel') },
  { p: 'sara', w: 'team', t: () => lng('سارة · مديرة', 'Sara · Manager'), d: () => lng('بتدير الفريق والوكلاء وبتوافق على اقتراحات التعلّم', 'Manages the team and agents, approves learning suggestions') },
  { p: 'youssef', w: 'team', t: () => lng('يوسف · مساهم', 'Youssef · Contributor'), d: () => `${lng('عضو في التيم، شغلته ميديا باير', 'A team member whose job is media buying')} · ${bx(lng('Ads وAnalyst بس', 'Ads and Analyst only'))}` },
  { p: 'mona', w: 'team', t: () => lng('منى · مشاهدة', 'Mona · Viewer'), d: () => lng('بتقرا بس، من غير كتابة', 'Reads only, never writes') },
];

/* two board cards say who did them; alone there is nobody else */
[['c-idea1', lng('فكرة سجّلتها امبارح', 'An idea you saved yesterday')], ['c-done1', lng('اتبعتلك الخميس', 'Sent to you on Thursday')]].forEach(([id, alone]) => {
  const c = cardById(id); if (!c) return;
  const orig = c.prog; let v = orig;
  Object.defineProperty(c, 'prog', { get: () => (isSolo() && v === orig ? alone : v), set: (x) => { v = x; }, enumerable: true, configurable: true });
});

/* ---- invites ---- */
let invSeq = 0;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/* an email inside Arabic copy stays one left-to-right run */
const errH = (m) => esc(m || '').replace(/[\w.+-]+@[\w.-]+/g, (x) => `<bdi dir="ltr">${x}</bdi>`);
function inviteErr(email, taken) {
  const v = String(email || '').trim();
  if (!v) return lng('اكتب إيميل العضو.', 'Write the member’s email.');
  if (!EMAIL_RE.test(v)) return lng('الإيميل ده ناقصه حاجة. اكتبه كامل، زي nour@rslearning.com', 'This email is missing something. Write it in full, like nour@rslearning.com');
  const used = (taken || []).concat(roster().map((p) => PEOPLE[p].email).filter(Boolean));
  if (used.some((x) => x.toLowerCase() === v.toLowerCase())) return lng('الإيميل ده اتعزم قبل كده.', 'This email has already been invited.');
  return '';
}
function addInvitee(email, role) {
  const id = `inv${++invSeq}`;
  const local = email.split('@')[0];
  const word = local.split(/[._\-+0-9]+/).filter(Boolean)[0] || local;
  const first = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  PEOPLE[id] = { name: first, first, av: first.charAt(0).toUpperCase(), role, title: ROLE_T[role], job: email, email, pending: true };
  PH[id] = `@${first}`; AR_FIRST[id] = first; ACCESS[id] = [];
  return id;
}
const generalOf = () => Object.values(threads).find((t) => t.channel && t.general && (t.ws || 'team') === state.world) || null;
/* the first invite from alone: «عام» opens with you and the new member; every chat, card and log line stays as it was */
function openGeneral(id) {
  const cid = `ch-gen-${++invSeq}`; const now = nowTime(); const nm = PEOPLE[id].first; const L = AGENTS[state.main];
  threads[cid] = { id: cid, channel: true, general: true, ws: state.world, agent: state.main, team: [state.main], people: [state.as, id], title: 'عام', time: now, day: 0, ts: ++tsSeq, card: null, unread: { [id]: 2 },
    msgs: [
      { id: nid('n'), role: 'note', icon: 'team', text: `${me().first} ${meAct('عزم', 'عزمت', 'invited')} ${nm}، ${lng('و«عام» اتفتحت لكل أعضاء المساحة', 'and “عام” opened for everyone in the workspace')}` },
      { id: nid('g'), role: 'agent', agent: state.main, time: now, ord: ++logOrd, text: `أهلاً يا ${nm}. دي «عام»: أي حد في المساحة بيكتب هنا، وأنا مش بقرا ولا برد غير لما حد يناديني باسمي، زي ${L.handle}.\nاللي واقف النهارده: حملة Meta للمحاسب الشامل مستنية زاوية الإعلان، ومقال «كورس محاسبة اونلاين» مستني موافقة النشر.` },
    ] };
  logAuto(WHO.sys(), lng('فتح قناة', 'opened the channel'), { obj: '#عام', chan: cid, to: `${memberNames([state.as, id])} · ${L.name}` });
  return cid;
}
function inviteFormHTML() {
  const r = state.invRole || 'contributor';
  return `<div class="inv">
      <div class="inv-row">
        <div class="set-field"><label class="set-label" for="inv-email">${lng('إيميل العضو', 'Member’s email')} <span aria-hidden="true">*</span></label>
          <input class="set-input" id="inv-email" type="email" dir="ltr" autocomplete="off" spellcheck="false" placeholder="nour@rslearning.com" value="${esc(state.invEmail || '')}" aria-required="true" aria-describedby="inv-email-err"${state.invErr ? ' aria-invalid="true"' : ''}>
          <span class="set-err" id="inv-email-err" ${state.invErr ? '' : 'hidden'}>${errH(state.invErr)}</span></div>
        <div class="set-field"><label class="set-label" for="inv-role">${lng('الدور', 'Role')}</label>
          <select class="set-input" id="inv-role" aria-describedby="inv-role-d">${ROLES.map((k) => `<option value="${k}" ${k === r ? 'selected' : ''}>${ROLE_T[k]}</option>`).join('')}</select></div>
        <button type="button" class="btn btn--primary inv-go" data-action="invite-send">${lng('اعزم', 'Invite')}</button>
      </div>
      <p class="set-hint" id="inv-role-d">${ROLE_T[r]}: ${ROLE_D[r]}</p>
    </div>`;
}
function teamSoloHTML() {
  const Q = me();
  return `<header class="modal__head"><div class="modal__titles"><h2 class="modal__title" id="team-title">${lng('الفريق', 'Team')}</h2>
      <p class="modal__sub">${bx(lng('انت لوحدك في المساحة دي دلوقتي: انت والوكلاء بس. لما تحب حد يشتغل معاك، اعزمه من هنا.', 'It’s just you in this workspace for now: you and the agents. When you want someone to work with you, invite them here.'))}</p></div>
      <button type="button" class="circle-btn" data-action="team-close" aria-label="${lng('اقفل', 'Close')}">${icon('x')}</button></header>
    <div class="modal__body ta ta--solo">
      <ul class="panel-card" aria-label="${lng('أعضاء المساحة', 'Workspace members')}"><li class="panel-row"><span class="me__av pp-av" aria-hidden="true">${Q.av}</span>
        <span class="panel-row__text"><span class="panel-row__t">${esc(Q.name)} <span class="ch-you">${lng('(انت)', '(you)')}</span></span><span class="panel-row__d">${Q.title} · ${lng('بتشوف كل الوكلاء وبتوافق على كل حاجة', 'You see every agent and approve everything')}</span></span></li></ul>
      <section class="inv-sec" aria-labelledby="inv-h"><h3 class="dp-label" id="inv-h"><span>${lng('اعزم عضو', 'Invite a member')}</span></h3>${inviteFormHTML()}</section>
      <p class="inv-note">${icon('team')}<span>${lng('أول ما تعزم حد، القنوات والوكلاء لكل عضو بيشتغلوا.', 'As soon as you invite someone, channels and per-member agents turn on.')}</span></p>
    </div>
    <footer class="modal__foot modal__foot--end"><button type="button" class="btn btn--secondary" data-action="team-close">${lng('خلصت', 'Done')}</button></footer>`;
}
function renderTeamDlg(focusId) {
  const dlg = $('#team');
  if (!dlg.open) { if (state.sov && state.sov.sec === 'company') { renderSov(); if (focusId) { const n = document.getElementById(focusId); if (n) n.focus(); } } return; }
  dlg.classList.toggle('team-dlg--solo', isSolo());
  $('#team-inner').innerHTML = teamDlgHTML();
  if (focusId) { const n = document.getElementById(focusId); if (n) n.focus(); }
}
function showInvErr(msg) {
  const inp = $('#inv-email'); const er = $('#inv-email-err');
  if (er) { er.innerHTML = errH(msg); er.hidden = !msg; }
  if (inp) { if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
}
function sendInvite() {
  if (!isOwner()) return;
  const inp = $('#inv-email'); const sel = $('#inv-role'); if (!inp) return;
  const email = inp.value.trim(); const role = sel ? sel.value : 'contributor';
  const err = inviteErr(email);
  if (err) { state.invEmail = inp.value; state.invErr = err; showInvErr(err); inp.focus(); return; }
  const wasSolo = isSolo();
  const id = addInvitee(email, role);
  roster().push(id);
  logAuto(ME(), meAct('عزم عضو', 'عزمت عضو', 'invited a member'), { obj: email, to: `${ROLE_T[role]} · ${lng('اتبعتله دعوة', 'Invite sent')}`, needs: [id] });
  const g = generalOf(); let gid = null;
  if (g) { g.people.push(id); g.unread = g.unread || {}; g.unread[id] = 1; g.msgs.push({ id: nid('n'), role: 'note', icon: 'team', text: `${me().first} ${meAct('عزم', 'عزمت', 'invited')} ${PEOPLE[id].first}، ${lng('ودخل «عام» على طول', 'who joined “عام” right away')}`, fresh: true }); }
  else gid = openGeneral(id);
  Object.assign(state, { invEmail: '', invErr: '', inviting: false, invRole: 'contributor' });
  renderTeamDlg('inv-toggle');
  rerenderAll();
  if (wasSolo) {
    toast(`${PEOPLE[id].first} ${lng('اتعزم. القنوات والوكلاء لكل عضو اشتغلوا، و«عام» جاهزة', 'is invited. Channels and per-member agents are on, and “عام” is ready')}`, 'team');
    const it = gid && $(`[data-action="open-thread"][data-thread="${gid}"]`);
    if (it) { it.classList.add('is-flash'); window.setTimeout(() => it.classList.remove('is-flash'), 1500); }
  } else toast(`${lng('اتبعتت دعوة لـ', 'Invite sent to')} ${email}`);
}

/* ---- alone, a new agent goes through the main agent's proposal, approved right there in the chat ---- */
function soloPropose(tplId) {
  const tp = tplId ? TEMPLATES.find((x) => x.id === tplId) : null;
  closeModal();
  window.setTimeout(() => {
    if ($('#sheet').open) closeSheet();
    state.chatThread = null; state.newChatAgent = state.main; setView('chat');
    const ta = $('#ta-main'); if (!ta) return;
    if (!tp) {
      ta.value = '/agent محتاج وكيل '; syncComposer('main'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      toast(`${lng('اكتب لـ', 'Tell')} ${AGENTS[state.main].name} ${lng('الوكيل الجديد هيعمل إيه، وهو يجهّزلك الاقتراح', 'what the new agent should do, and it prepares the proposal')}`, 'compose');
      return;
    }
    ta.value = `/agent محتاج وكيل «${tp.role}»`;
    state.soloTpl = tp.id; send('main');
  }, reduced() ? 0 : 210);
}

/* ---- first run: one question, then invites for a team ---- */
const FR_PH = ['nour@rslearning.com', 'karim@rslearning.com', 'hala@rslearning.com'];
const frRow = () => ({ email: '', role: 'contributor', err: '' });
function frArt(mode) {
  const ppl = mode === 'solo' ? ['omar'] : ['omar', 'sara', 'youssef', 'mona'];
  return `<span class="fr-art" aria-hidden="true"><span class="fr-ppl">${ppl.map((p) => personAv(p, 32)).join('')}</span><span class="fr-art__plus">${icon('plus')}</span>${face(state.main, 32)}</span>`;
}
function frHTML() {
  const F = state.fr;
  const bar = `<header class="fr__bar"><span class="ws">${SYS_MARK(28)}<bdi class="ws__name">gtmworks</bdi></span><span class="badge fr__proto">${lng('للنموذج بس', 'Prototype aid')}</span>
      <button type="button" class="circle-btn" data-action="fr-close" aria-label="${lng('اقفل ورجّعني للمساحة', 'Close and go back to the workspace')}">${icon('x')}</button></header>`;
  let body;
  if (F.step === 'mode') {
    const opts = [['solo', lng('لوحدي', 'Alone'), lng('انت وLead بس، وتطلب منه أي وكيل محتاجه. تقدر تعزم حد بعدين في أي وقت.', 'Just you and Lead, and you ask it for any agent you need. You can invite someone later, any time.')],
      ['team', lng('مع تيم', 'With a team'), lng('بتبدأ مع Lead، وكل واحد في التيم يطلب منه الوكيل اللي محتاجه. الشغل المشترك في القنوات.', 'You start with Lead, and everyone on the team asks it for the agent they need. Shared work lives in channels.')]];
    body = `<div class="fr__head"><p class="fr__eyebrow">${lng('أهلاً في', 'Welcome to')} <bdi>gtmworks</bdi> · <bdi>RS Learning</bdi></p>
        <h1 class="fr__title" id="fr-title">${lng('هتشتغل لوحدك ولا مع تيم؟', 'Will you work alone or with a team?')}</h1>
        <p class="fr__sub">${bx(lng('في الحالتين بتبدأ مع Lead لوحده، ومنه تطلب أي وكيل بكلامك. ولو بدأت لوحدك، تقدر تعزم حد بعدين وقت ما تحب.', 'Either way you start with Lead alone, and ask it for any agent in your own words. If you start alone, you can invite someone whenever you like.'))}</p></div>
      <div class="fr__choices" role="radiogroup" aria-labelledby="fr-title">${opts.map(([k, t, d]) => { const on = F.mode === k; const tab = (F.mode ? on : k === 'solo') ? 0 : -1;
        return `<button type="button" class="cr-kind fr-choice" role="radio" id="fr-mode-${k}" aria-checked="${on}" tabindex="${tab}" data-action="fr-mode" data-mode="${k}">${frArt(k)}<span class="cr-kind__t">${t}</span><span class="cr-kind__d">${d}</span>${on ? icon('check', 'cr-kind__check') : ''}</button>`; }).join('')}</div>
      <div class="fr__actions"><span class="fr__hint" id="fr-go-hint">${F.mode ? '' : lng('اختار واحدة عشان تكمّل', 'Pick one to continue')}</span>
        <button type="button" class="btn btn--primary" data-action="fr-next" id="fr-go" ${F.mode ? '' : 'disabled'} aria-describedby="fr-go-hint">${F.mode === 'team' ? lng('كمّل', 'Continue') : lng('افتح المساحة', 'Open the workspace')}</button></div>`;
  } else {
    const n = F.rows.length;
    body = `<div class="fr__head"><button type="button" class="link-btn fr__back" data-action="fr-back" id="fr-back">${icon('chevronRight')}<span>${lng('رجوع', 'Back')}</span></button>
        <p class="fr__eyebrow">${lng('مع تيم · الخطوة 2 من 2', 'With a team · Step 2 of 2')}</p>
        <h1 class="fr__title" id="fr-title">${lng('مين معاك في التيم؟', 'Who’s on your team?')}</h1>
        <p class="fr__sub">${bx(lng('ابعت دعوة بالإيميل لكل واحد واختار دوره. تقدر تتخطى دلوقتي وتعزمهم بعدين من «الفريق».', 'Send each person an invite by email and pick their role. You can skip for now and invite them later from “Team”.'))}</p></div>
      <div class="fr-rows" role="group" aria-labelledby="fr-title">${F.rows.map((r, i) => `<div class="fr-row">
          <div class="set-field"><label class="set-label" for="fr-email-${i}">${lng('إيميل العضو', 'Member’s email')} <span class="num">${i + 1}</span></label>
            <input class="set-input" id="fr-email-${i}" type="email" dir="ltr" autocomplete="off" spellcheck="false" placeholder="${FR_PH[i % FR_PH.length]}" value="${esc(r.email)}" data-fr-email="${i}" aria-describedby="fr-email-err-${i}"${r.err ? ' aria-invalid="true"' : ''}>
            <span class="set-err" id="fr-email-err-${i}" ${r.err ? '' : 'hidden'}>${errH(r.err)}</span></div>
          <div class="set-field"><label class="set-label" for="fr-role-${i}">${lng('الدور', 'Role')}</label>
            <select class="set-input" id="fr-role-${i}" data-fr-role="${i}">${ROLES.map((k) => `<option value="${k}" ${k === r.role ? 'selected' : ''}>${ROLE_T[k]}</option>`).join('')}</select></div>
          ${n > 1 ? `<button type="button" class="circle-btn fr-row__rm" data-action="fr-rm-row" data-row="${i}" aria-label="${lng('شيل العضو', 'Remove member')} ${i + 1}">${icon('x')}</button>` : '<span class="fr-row__rm od-spacer" aria-hidden="true"></span>'}
        </div>`).join('')}</div>
      <div><button type="button" class="link-btn fr-add" data-action="fr-add-row" id="fr-add">${icon('plus')}<span>${lng('ضيف عضو', 'Add a member')}</span></button></div>
      <dl class="fr-roles">${ROLES.map((k) => `<div class="fr-roles__r"><dt>${ROLE_T[k]}</dt><dd>${ROLE_D[k]}</dd></div>`).join('')}</dl>
      <div class="fr__actions"><button type="button" class="btn btn--secondary" data-action="fr-skip">${lng('اتخطى', 'Skip')}</button>
        <button type="button" class="btn btn--primary" data-action="fr-open" id="fr-open">${lng('افتح المساحة', 'Open the workspace')}</button></div>`;
  }
  return `${bar}<div class="fr__body"><div class="fr__col fr__col--${F.step}">${body}</div></div>`;
}
function renderFr(focusId) {
  $('#fr-inner').innerHTML = frHTML();
  if (focusId) window.requestAnimationFrame(() => { const n = document.getElementById(focusId); if (n) n.focus(); });
}
function openFirstRun() {
  closeMeMenu(false);
  state.fr = { step: 'mode', mode: null, rows: [frRow()] };
  renderFr();
  showDlg($('#firstrun'));
  window.requestAnimationFrame(() => { const b = $('#fr-mode-solo'); if (b) b.focus(); });
}
function frValidate() {
  const F = state.fr; const seen = [];
  F.rows.forEach((r) => { const v = r.email.trim(); r.err = v ? inviteErr(v, seen) : ''; if (v && !r.err) seen.push(v); });
  return F.rows.findIndex((r) => r.err);
}
function finishFr(mode, rows) {
  /* the first run opens a real empty start: Lead alone, an empty board, nothing else. A fresh run wipes the last one. */
  Object.keys(threads).forEach((id) => { if (threads[id].ws === 'fresh') delete threads[id]; });
  for (let i = cards.length - 1; i >= 0; i -= 1) if (cards[i].ws === 'fresh') cards.splice(i, 1);
  for (let i = LOG.length - 1; i >= 0; i -= 1) if (LOG[i].ws === 'fresh') LOG.splice(i, 1);
  for (let i = AGENT_ORDER.length - 1; i >= 0; i -= 1) { const W = AGENTS[AGENT_ORDER[i]].worlds; if (W && W.length === 1 && W[0] === 'fresh') AGENT_ORDER.splice(i, 1); }
  for (let i = state.events.length - 1; i >= 0; i -= 1) if (state.events[i].ws === 'fresh') state.events.splice(i, 1);
  if (mode === 'solo') state.roster.fresh = ['omar'];
  else {
    const ids = rows.map((r) => addInvitee(r.email.trim(), r.role));
    state.roster.fresh = ['omar'].concat(ids);
    state.world = 'fresh';
    ids.forEach((id) => logAdd({ ws: 'fresh', who: WHO.p('omar'), act: lng('عزم عضو', 'invited a member'), obj: PEOPLE[id].email, to: `${PEOPLE[id].title} · ${lng('اتبعتله دعوة', 'Invite sent')}`, needs: [id], justAt: Date.now() }));
    state.frInvites = ids.length;
  }
  state.freshMode = mode;
  closeDlg($('#firstrun'));
  applyPerson('omar', 'fresh');
  const k = state.frInvites || 0; state.frInvites = 0;
  window.requestAnimationFrame(() => { const ta = $('#ta-main'); if (ta) ta.focus(); });
  toast(mode === 'solo' ? lng('مساحتك جاهزة: انت وLead بس. قوله محتاج وكيل لإيه وهو يعمله', 'Your workspace is ready: just you and Lead. Tell it what you need an agent for and it makes it')
    : k ? `${k === 1 ? lng('اتبعتت دعوة واحدة', 'One invite sent') : `${lng('اتبعت', 'Sent')} ${k} ${lng('دعوات', 'invites')}`} · ${lng('ابدأ مع Lead واطلب منه أول وكيل', 'start with Lead and ask it for your first agent')}`
    : lng('المساحة مفتوحة · ابدأ مع Lead واطلب منه أول وكيل', 'The workspace is open · start with Lead and ask it for your first agent'), mode === 'solo' ? 'check' : 'team');
}

$('#firstrun').addEventListener('cancel', (e) => {
  e.preventDefault();
  if (state.fr && state.fr.step === 'invite') { state.fr.step = 'mode'; renderFr('fr-mode-team'); return; }
  closeDlg($('#firstrun'));
});
$('#firstrun').addEventListener('close', () => { $('#fr-inner').innerHTML = ''; state.fr = null; const b = $('#btn-me'); if (b) b.focus(); });
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset; const F = state.fr;
  switch (d.action) {
    case 'first-run': openFirstRun(); break;
    case 'fr-close': closeDlg($('#firstrun')); break;
    case 'fr-mode': if (F) { F.mode = d.mode; renderFr(`fr-mode-${d.mode}`); } break;
    case 'fr-next': if (F && F.mode) { if (F.mode === 'solo') finishFr('solo', []); else { F.step = 'invite'; renderFr('fr-email-0'); } } break;
    case 'fr-back': if (F) { F.step = 'mode'; renderFr('fr-mode-team'); } break;
    case 'fr-add-row': if (F) { F.rows.push(frRow()); renderFr(`fr-email-${F.rows.length - 1}`); } break;
    case 'fr-rm-row': if (F) { const i = Number(d.row); F.rows.splice(i, 1); renderFr(F.rows.length > 1 ? `fr-email-${Math.min(i, F.rows.length - 1)}` : 'fr-add'); } break;
    case 'fr-skip': if (F) finishFr('team', []); break;
    case 'fr-open': if (F) { const bad = frValidate(); if (bad >= 0) { renderFr(`fr-email-${bad}`); break; } finishFr('team', F.rows.filter((r) => r.email.trim())); } break;
    case 'invite-send': sendInvite(); break;
    case 'invite-toggle': state.inviting = !state.inviting; state.invErr = ''; state.invEmail = ''; renderTeamDlg(state.inviting ? 'inv-email' : 'inv-toggle'); break;
    default: break;
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.frEmail != null && state.fr) {
    const r = state.fr.rows[Number(t.dataset.frEmail)]; if (!r) return; r.email = t.value;
    if (r.err && !inviteErr(t.value)) { r.err = ''; const er = $(`#fr-email-err-${t.dataset.frEmail}`); if (er) er.hidden = true; t.removeAttribute('aria-invalid'); }
    return;
  }
  if (t.id === 'inv-email') { state.invEmail = t.value; if (state.invErr && !inviteErr(t.value)) { state.invErr = ''; showInvErr(''); } }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.frRole != null && state.fr) { const r = state.fr.rows[Number(t.dataset.frRole)]; if (r) r.role = t.value; return; }
  if (t.id === 'inv-role') { state.invRole = t.value; const h = $('#inv-role-d'); if (h) h.textContent = `${ROLE_T[t.value]}: ${ROLE_D[t.value]}`; }
});
/* checked when you leave the field, never on every key */
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.frEmail != null && state.fr) {
    const i = t.dataset.frEmail; const r = state.fr.rows[Number(i)]; const v = t.value.trim();
    if (!r || !v) return;
    const err = inviteErr(v, state.fr.rows.slice(0, Number(i)).map((x) => x.email.trim()).filter(Boolean)); r.err = err;
    const er = $(`#fr-email-err-${i}`); if (er) { er.innerHTML = errH(err); er.hidden = !err; }
    if (err) t.setAttribute('aria-invalid', 'true'); else t.removeAttribute('aria-invalid');
    return;
  }
  if (t.id === 'inv-email' && t.value.trim() && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-action="team-close"], [data-action="invite-toggle"]'))) {
    const err = inviteErr(t.value); state.invErr = err; state.invEmail = t.value; showInvErr(err);
  }
});
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.frEmail != null && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const b = $('#fr-open'); if (b) b.click(); return; }
  if (t.id === 'inv-email' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendInvite(); return; }
  if (t.dataset && t.dataset.action === 'fr-mode' && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
    e.preventDefault(); const nx = t.dataset.mode === 'solo' ? 'team' : 'solo';
    state.fr.mode = nx; renderFr(`fr-mode-${nx}`);
  }
});

/* ================= settings in one place · company knowledge · learning · agents changing themselves =================
   Nobody ever has to open anything behind gtmworks: every setting lives in one overlay over the workspace (a list of
   sections on one side, the open section beside it). Closing it returns to the same screen and focus. The Owner and a
   Manager change things; a contributor reads; a viewer sees only their own account and the agents they work with.
   Company knowledge is shared by every agent; an agent's memory stays its own. Agents save notes and write or improve
   their own skills (each save in the log), or ask first, per company with a per-agent override. Their model, tools,
   apps and core instructions change only with the Owner's OK: the agent (or the main agent for it) proposes the
   change as a card in the chat, it waits in «مستنيك», and nothing changes until the Owner decides. */
Object.assign(ICONS, {
  building: '<path d="M4.5 20.5h15M6.5 20.5V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15M14.5 9.5h3a1 1 0 0 1 1 1v10M9.5 8h2M9.5 11.5h2M9.5 15h2"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 8h6"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10M10 12.5h4"/>',
  gauge: '<path d="M4 17.5a8 8 0 1 1 16 0"/><path d="M12 17.5l3.5-5"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  bot: '<rect x="5" y="7.5" width="14" height="11" rx="3"/><path d="M12 4.5v3M9.5 12.5v1M14.5 12.5v1"/>',
  spark: '<path d="M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9z"/><path d="M18.5 15v5M16 17.5h5"/>',
});
Object.assign(state, { sov: null, companyName: 'RS Learning', defModel: 'Opus 5.5', defEffort: 'medium', backupAuto: true, useP: '7', lnFilter: 'all' });

/* ---- memory notes: which member a note came from (a person's name at the start of «from») ---- */
const BY_NAME = [['سارة', 'sara'], ['Sara', 'sara'], ['عمر', 'omar'], ['Omar', 'omar'], ['يوسف', 'youssef'], ['Youssef', 'youssef'], ['منى', 'mona'], ['Mona', 'mona'], ['كريم', 'karim'], ['Karim', 'karim']];
AGENT_ORDER.forEach((a) => (AGENTS[a].memory || []).forEach((m) => {
  if (m.src !== 'told' || m.by) return;
  const hit = BY_NAME.find(([n]) => String(m.from).startsWith(n)); if (hit) m.by = hit[1];
}));
{ const m = mem('audience', 'told', 'استهداف الرياض بقى 22–35 سنة بدل 22–30، عشان الليد هناك كان أغلى من القاهرة.', lng('يوسف · النهارده', 'Youssef · Today')); m.by = 'youssef'; AGENTS.ads.memory.splice(3, 0, m); }

/* ---- company knowledge: five shared pages every agent reads (content stays Arabic, like the chats) ---- */
const KNOW = [
  { k: 'voice', t: lng('صوت البراند', 'Brand voice'), by: 'sara', at: lng('امبارح · 6:15 م', 'Yesterday · 6:15 PM'),
    body: 'بنكلّم خريج تجارة أو محاسب في أول طريقه زي زميل أكبر منه بسنتين، مش زي مدرّس.\n• إعلانات مصر بالعامية المصرية، وإعلانات الرياض وجدة بلهجة سعودية خفيفة.\n• المقالات بفصحى بسيطة، والعنوان فيه السنة.\n• اسم RS Learning بيتكتب بالإنجليزي دايماً، من غير ترجمة.\n• مفيش علامات تعجب ولا إيموجي في نص الإعلان.\n• نبدأ بالفايدة اللي هتوصل للطالب، وبعدها تفاصيل الكورس.' },
  { k: 'audience', t: lng('الجمهور', 'Audience'), by: 'sara', at: lng('الاتنين 9 نوفمبر · 11:00 ص', 'Mon Nov 9 · 11:00 AM'),
    body: 'الجمهور الأساسي: خريجين تجارة من 22 لـ 30 سنة في القاهرة والجيزة والإسكندرية، عايزين أول شغلانة محاسبة.\n• الرياض وجدة: محاسبين شغالين من 22 لـ 35 سنة، بيدوّروا على شهادة معتمدة أكتر من أول شغلانة.\n• أغلبهم بيقارنوا الأسعار قبل ما يسجّلوا، وبيسألوا عن التقسيط.\n• جزء كبير من ليدز Google بييجي بعد 10 بالليل.' },
  { k: 'products', t: lng('المنتجات والأسعار', 'Products and prices'), by: 'omar', at: lng('الأحد 8 نوفمبر · 4:30 م', 'Sun Nov 8 · 4:30 PM'),
    body: '• المحاسب الشامل: 2,400 ج · الدفعة الجديدة بتبدأ 1 ديسمبر · التقسيط على 3 دفعات\n• دبلومة الضرائب: 1,800 ج · أونلاين بالكامل\n• Excel للمحاسبين: 950 ج · كورس قصير\n• المحاسبة على Odoo: 1,500 ج\nأي سعر أو خصم في إعلان أو مقال لازم يطابق صفحة الكورس على موقع الأكاديمية.' },
  { k: 'banned', t: lng('الممنوع', 'Banned claims'), by: 'sara', at: lng('الخميس 5 نوفمبر · 2:10 م', 'Thu Nov 5 · 2:10 PM'),
    body: 'حاجات مانقولهاش في أي إعلان أو مقال أو رسالة:\n• «شغل مضمون» أو «وظيفة مضمونة 100%»: وعد مقدرش نثبته.\n• «أرخص كورس في مصر» و«الأول في مصر»: مفيش مصدر للمقارنة.\n• مدة للوظيفة زي «خلال 3 شهور».\n• أسماء شركات بتوظّف خريجينا من غير إذن مكتوب منهم.\n• أرقام رواتب من غير مصدر واضح.' },
  { k: 'decisions', t: lng('القرارات', 'Decisions'), by: 'omar', at: lng('امبارح · 4:00 م', 'Yesterday · 4:00 PM'),
    body: '• الاتنين 9 نوفمبر · عمر: الدفعة الجديدة بتبدأ 1 ديسمبر، وكل حملات التسجيل جاهزة قبل 20 نوفمبر.\n• الأحد 8 نوفمبر · عمر: إعادة الاستهداف بـ 250 ج في اليوم، مش أكتر.\n• الاتنين 2 نوفمبر · سارة: أي إعلان تكلفة الليد فيه تعدّي 45 ج بيقف لوحده.\n• امبارح · عمر: مفيش وكيل جديد، ولا تغيير في موديل وكيل أو أدواته أو تعليماته، من غير موافقة المالك.' },
];
const knowBy = (P) => (inWs(P.by) ? P.by : state.as);
function knowBodyHTML(txt) {
  let out = ''; let ul = [];
  const flush = () => { if (ul.length) { out += `<ul class="know-ul">${ul.map((l) => `<li>${bx(l)}</li>`).join('')}</ul>`; ul = []; } };
  String(txt).split('\n').map((s) => s.trim()).filter(Boolean).forEach((l) => {
    if (/^[•\-]\s*/.test(l)) ul.push(l.replace(/^[•\-]\s*/, '')); else { flush(); out += `<p>${bx(l)}</p>`; }
  });
  flush(); return out;
}

/* ---- learning: per company, with a per-agent override ---- */
const LEARN = { company: 'auto', per: { lead: 'company', ads: 'company', seo: 'company', analyst: 'ask', critic: 'company' } };
const LEARN_T = { auto: lng('يتعلّم لوحده', 'Learns on its own'), ask: lng('يستأذن الأول', 'Asks first') };
const learnModeOf = (a) => { const v = LEARN.per[a] || 'company'; return v === 'company' ? LEARN.company : v; };
/* a skill Ads wrote by itself last night and improved this morning: two readable versions */
const CPL_SKILL = {
  t: 'متابعة تكلفة الليد بالساعة', d: lng('بيقرا تكلفة الليد كل ساعة بالليل ويوقّف اللي عدّى 45 ج', 'Reads cost per lead hourly at night and pauses anything over EGP 45'),
  on: true, learned: true, sid: 'cpl', ver: 2,
  vers: [
    ['كل ساعة من 6 م لحد 12 بالليل، يقرا تكلفة الليد لكل إعلان شغال.', 'لو إعلان عدّى 45 ج لليد يوقّفه، ويكتب السبب في السجل.', 'الصبح يبعت ملخص باللي وقف وليه.'],
    ['كل ساعة من 6 م لحد 12 بالليل، يقرا تكلفة الليد لكل إعلان شغال.', 'لو إعلان عدّى 45 ج لليد يوقّفه، ويكتب السبب في السجل.', 'بعد 10 بالليل يقارن Google بـ Meta: لو Google أرخص بـ 15% أو أكتر، يقترح ينقل جزء من ميزانية الصبح. اقتراح بس، مفيش صرف من غير موافقة.', 'الصبح يبعت ملخص باللي وقف وليه، واللي اقترحه.'],
  ],
};
AGENTS.ads.skills.push(CPL_SKILL);
const SKILLS = { cpl: CPL_SKILL };
const LEARNED = [];
let lnSeq = 0;
const lrn = (o) => { const x = Object.assign({ id: `ln-${++lnSeq}`, status: 'saved', ord: lnSeq }, o); LEARNED.push(x); return x; };
const memOf = (a, part) => AGENTS[a].memory.find((m) => m.t.includes(part)) || null;
lrn({ kind: 'note', agent: 'critic', mem: memOf('critic', 'أول 3 ثواني'), thread: 'th-critic', at: lng('امبارح · 6:20 م', 'Yesterday · 6:20 PM') });
lrn({ kind: 'note', agent: 'seo', mem: memOf('seo', 'أسئلة شائعة'), thread: 'th-seo', at: lng('امبارح · 1:35 م', 'Yesterday · 1:35 PM') });
const LN_NEW = lrn({ kind: 'skill', agent: 'ads', skill: CPL_SKILL, thread: 'th-meta', at: lng('امبارح · 11:40 م', 'Yesterday · 11:40 PM'), why: 'من روتين «متابعة أداء الحملات»: وقّف إعلانين عدّوا 45 ج، فكتب الخطوات دي عشان يعملها كل ليلة بنفس الطريقة.' });
const LN_UP = lrn({ kind: 'skillup', agent: 'ads', skill: CPL_SKILL, from: 1, to: 2, thread: 'th-meta', at: lng('النهارده · 8:12 ص', 'Today · 8:12 AM'), why: 'Analyst لقى إن 38% من ليدز Google بتيجي بعد 10 بالليل، فـ Ads ضاف خطوة تقارن القناتين في الوقت ده، وعدّل ملخص الصبح.' });
lrn({ kind: 'note', agent: 'ads', mem: memOf('ads', '38%'), thread: 'th-meta', at: lng('النهارده · 8:40 ص', 'Today · 8:40 AM') });
lrn({ kind: 'note', agent: 'analyst', status: 'pending', g: 'lessons', text: 'الأسبوع اللي فيه إجازة رسمية الليدز بتقل فيه، فلازم أكتب ملاحظة جنب أي مقارنة بيه.', thread: 'th-report', at: lng('النهارده · 9:50 ص', 'Today · 9:50 AM') });
lrn({ kind: 'skill', agent: 'analyst', status: 'pending', thread: 'th-report', at: lng('النهارده · 10:05 ص', 'Today · 10:05 AM'),
  skill: { t: 'فصل ليدز السعودية عن مصر في التقرير', d: lng('تكلفة الليد لكل بلد لوحدها', 'Cost per lead for each country on its own'), on: true, learned: true, sid: 'ksa', ver: 1,
    vers: [['يقسم الليدز حسب البلد من عمود المدينة في شيت الليدز.', 'يحسب تكلفة الليد لكل بلد لوحدها.', 'يحط جدول البلدين بعد الخلاصة على طول.']] },
  why: 'سارة سألت مرتين الأسبوع ده عن الرياض لوحدها، فكتب الطريقة دي عشان تبقى في كل تقرير.' });
SKILLS.ksa = LEARNED[LEARNED.length - 1].skill;
/* Youssef taught Ads something for the whole team in his own chat: it waits as a suggestion for Omar or Sara */
threads['th-yo-ads'] = { id: 'th-yo-ads', agent: 'ads', owner: 'youssef', title: 'لهجة إعلانات السعودية', time: lng('9:22 ص', '9:22 AM'), day: 0, ts: 540, card: null,
  msgs: [
    { id: 'ya1', role: 'user', by: 'youssef', time: lng('9:20 ص', '9:20 AM'), text: 'من دلوقتي أي إعلان للسعودية يتكتب بلهجة سعودية خفيفة، مش مصري' },
    { id: 'ya2', role: 'agent', agent: 'ads', time: lng('9:21 ص', '9:21 AM'), text: 'تمام يا يوسف، هشتغل كده في شغلي معاك من دلوقتي. وعشان دي حاجة هتمشي على الفريق كله، هقترحها على عمر وسارة في «اقتراحات التعلّم»، ولما حد فيهم يوافق هتبقى للكل.' },
    { id: 'ya3', role: 'note', icon: 'clock', text: lng('اتبعتت اقتراح لعمر وسارة · في «اقتراحات التعلّم»', 'Sent as a suggestion to Omar and Sara · in “Learning suggestions”') },
  ] };
const LN_YO = lrn({ kind: 'rule', agent: 'ads', status: 'pending', by: 'youssef', text: 'أي إعلان للسعودية يتكتب بلهجة سعودية خفيفة، مش مصري', thread: 'th-yo-ads', at: lng('النهارده · 9:21 ص', 'Today · 9:21 AM') });
threads['th-yo-ads'].msgs[2].link = { action: 'sov-learn', learn: LN_YO.id, label: lng('شوفها', 'See it'), need: 'learning' };
logAdd({ day: 0, time: lng('9:21 ص', '9:21 AM'), who: WHO.a('ads'), act: lng('اقترح قاعدة للفريق اتعلّمها من يوسف · مستنية موافقة', 'suggested a rule for the team, learned from Youssef · waiting for an OK'), agent: 'ads', obj: LN_YO.text, only: ['youssef'], mgr: true, link: { action: 'sov-learn', learn: LN_YO.id, label: lng('افتحها في الاقتراحات', 'Open it in suggestions'), need: 'learning' } });
const lnById = (id) => LEARNED.find((x) => x.id === id) || null;
const lnVisible = (L) => !!AGENTS[L.agent] && canSee(L.agent);
const lnPending = () => LEARNED.filter((L) => L.status === 'pending' && lnVisible(L));

/* ---- settings changes an agent proposes (for itself, or the main agent for another agent) ---- */
const CHG = {};
const accessT = (k) => (k === 'write' ? lng('قراءة وكتابة', 'Read and write') : lng('قراءة بس', 'Read only'));
function chgSeed(o) { CHG[o.id] = Object.assign({ status: 'pending', mode: null, draft: null, reasonDraft: '' }, o); return CHG[o.id]; }
const chgPendingFor = (a) => Object.values(CHG).find((C) => C.agent === a && C.status === 'pending') || null;
const chgVisible = (C) => canSee(C.agent) && canSee(C.by) && (!threads[C.thread] || threadVisible(threads[C.thread]));
const chgWhat = (C) => (C.kind === 'tool' ? `${lng('أداة جديدة:', 'New tool:')} ${CONNS[C.tool].name}` : `${lng('موديل جديد:', 'New model:')} ${C.model}`);
function chgFromTo(C) {
  if (C.kind === 'tool') {
    const cur = C.fromTools.map((k) => CONNS[k].name).join(lng('، ', ', ')) || lng('من غير أدوات', 'No tools');
    return [cur, `${cur}${lng('، ', ', ')}${CONNS[C.tool].name} (${accessT(C.access)})`];
  }
  return [C.fromModel, C.model];
}
{
  const c1 = chgSeed({ id: 'chg-seo', agent: 'seo', by: 'seo', kind: 'tool', tool: 'sheets', access: 'read', fromTools: AGENTS.seo.conns.slice(), thread: 'th-seo-sheet', card: 'c-chg-seo',
    why: 'عشان أعرف أنهي مقال بيجيب تسجيلات فعلاً، مش زيارات بس. شيت الليدز فيه عمود «جه منين».' });
  const c2 = chgSeed({ id: 'chg-analyst', agent: 'analyst', by: 'lead', kind: 'model', model: 'Gemini 2.5 Pro', fromModel: AGENTS.analyst.model, thread: 'th-lead-model', card: 'c-chg-analyst',
    why: 'تقرير الـ 90 يوم بيقرا أرقام كتير من 4 مصادر وبيتأخر عن ميعاده. Gemini 2.5 Pro أسرع في الأرقام الكبيرة، والتقرير الأسبوعي هيفضل بنفس الشكل.' });
  threads['th-seo-sheet'] = { id: 'th-seo-sheet', agent: 'seo', title: 'أنهي مقالات بتجيب تسجيلات؟', time: lng('10:20 ص', '10:20 AM'), day: 0, ts: 625, card: 'c-chg-seo',
    msgs: [
      { id: 'q1', role: 'user', by: 'omar', time: lng('10:18 ص', '10:18 AM'), text: 'أنهي مقالات جابت تسجيلات فعلاً الشهر ده؟ مش زيارات.' },
      { id: 'q2', role: 'agent', agent: 'seo', time: lng('10:20 ص', '10:20 AM'), text: 'أقدر أقولك الزيارات والترتيب من Search Console، بس التسجيلات نفسها في شيت الليدز، ومعنديش وصول ليه.\nاقترحت أضيف Google Sheets لأدواتي، قراءة بس. ده تغيير في إعداداتي، فمش هيحصل قبل موافقة المالك.', card: { type: 'change', pid: c1.id } },
    ] };
  threads['th-lead-model'] = { id: 'th-lead-model', agent: 'lead', title: 'تقرير الـ 90 يوم بيتأخر', time: lng('11:30 ص', '11:30 AM'), day: 0, ts: 700, card: 'c-chg-analyst',
    msgs: [
      { id: 'r1', role: 'user', by: 'omar', time: lng('11:26 ص', '11:26 AM'), text: 'تقرير آخر 90 يوم لسه مخلصش؟ كنت محتاجه قبل اجتماع بكرة.' },
      { id: 'r2', role: 'agent', agent: 'lead', time: lng('11:30 ص', '11:30 AM'), text: 'Analyst لسه شغال عليه. التقرير ده بيقرا 90 يوم من Meta وGoogle وGA4 وشيت المبيعات، والمرة اللي فاتت اتأخر ساعة عن ميعاده.\nاقترحت نغيّر موديل Analyst لـ Gemini 2.5 Pro، أسرع في الأرقام الكبيرة. ده تغيير في إعدادات Analyst، فمش هيحصل غير بموافقة المالك.', card: { type: 'change', pid: c2.id } },
    ] };
  cards.unshift({ id: 'c-chg-seo', col: 'waiting', title: `${AGENTS.seo.name} ${lng('عايز أداة: Google Sheets', 'wants a tool: Google Sheets')}`, agent: 'seo', chan: lng('إعدادات', 'Settings'), due: '', thread: 'th-seo-sheet', change: c1.id,
    wait: lng('اقتراح تغيير في إعداداته · مستني موافقتك', 'A change to its settings · waiting for your OK') });
  cards.unshift({ id: 'c-chg-analyst', col: 'waiting', title: lng('Analyst على Gemini 2.5 Pro؟', 'Analyst on Gemini 2.5 Pro?'), agent: 'lead', chan: lng('إعدادات', 'Settings'), due: '', thread: 'th-lead-model', change: c2.id,
    wait: lng('Lead اقترحه لـ Analyst · مستني موافقتك', 'Lead proposed it for Analyst · waiting for your OK') });

  /* the log: what the agents learned and proposed, in its day and time */
  const S = (day, time, e) => logAdd(Object.assign({ day, time }, e));
  S(1, lng('6:20 م', '6:20 PM'), { who: WHO.a('critic'), act: lng('حفظ ملاحظة في ذاكرته لوحده', 'saved a note to its memory on its own'), agent: 'critic', obj: 'نص الفيديو لازم الفكرة تبان في أول 3 ثواني', link: { action: 'sov-learn', learn: 'ln-1', label: lng('شوفها في التعلّم', 'See it in Learning'), need: 'learning' } });
  S(1, lng('1:35 م', '1:35 PM'), { who: WHO.a('seo'), act: lng('حفظ ملاحظة في ذاكرته لوحده', 'saved a note to its memory on its own'), agent: 'seo', obj: 'المقالات اللي فيها أسئلة شائعة ترتيبها أحسن', link: { action: 'sov-learn', learn: 'ln-2', label: lng('شوفها في التعلّم', 'See it in Learning'), need: 'learning' } });
  S(1, lng('11:40 م', '11:40 PM'), { who: WHO.a('ads'), act: lng('اتعلّم مهارة جديدة لوحده', 'learned a new skill on its own'), agent: 'ads', obj: CPL_SKILL.t, to: lng('نسخة 1 · من روتين «متابعة أداء الحملات»', 'Version 1 · from the “متابعة أداء الحملات” routine'), link: { action: 'sov-learn', learn: LN_NEW.id, label: lng('شوف المهارة', 'See the skill'), need: 'learning' } });
  S(0, lng('8:12 ص', '8:12 AM'), { who: WHO.a('ads'), act: lng('حسّن مهارة لوحده', 'improved a skill on its own'), agent: 'ads', obj: CPL_SKILL.t, from: lng('نسخة 1', 'Version 1'), to: lng('نسخة 2 · خطوة جديدة بعد 10 بالليل', 'Version 2 · a new step after 10 PM'), link: { action: 'sov-learn', learn: LN_UP.id, label: lng('شوف قبل وبعد', 'See before and after'), need: 'learning' } });
  S(0, lng('8:40 ص', '8:40 AM'), { who: WHO.a('ads'), act: lng('حفظ ملاحظة في ذاكرته لوحده', 'saved a note to its memory on its own'), agent: 'ads', obj: '38% من ليدز Google بتيجي بعد 10 بالليل', to: lng('من Analyst', 'From Analyst') });
  S(0, lng('9:50 ص', '9:50 AM'), { who: WHO.a('analyst'), act: lng('عايز يحفظ ملاحظة · مستني موافقة', 'wants to save a note · waiting for an OK'), agent: 'analyst', obj: 'الأسبوع اللي فيه إجازة رسمية الليدز بتقل فيه', link: { action: 'sov-learn', learn: 'ln-6', label: lng('افتحها في التعلّم', 'Open it in Learning'), need: 'learning' } });
  S(0, lng('10:20 ص', '10:20 AM'), { who: WHO.a('seo'), act: lng('اقترح تغيير في إعداداته', 'proposed a change to its settings'), agent: 'seo', card: 'c-chg-seo', obj: 'Google Sheets', to: lng('أداة جديدة · مستني موافقة المالك', 'New tool · waiting for the Owner’s OK') });
  S(0, lng('11:30 ص', '11:30 AM'), { who: WHO.a('lead'), act: lng('اقترح تغيير موديل', 'proposed a model change for'), agent: 'analyst', card: 'c-chg-analyst', obj: 'Analyst', from: 'Opus 5.5', to: lng('Gemini 2.5 Pro · مستني موافقة المالك', 'Gemini 2.5 Pro · waiting for the Owner’s OK') });
  /* the seeded log is ordered by its clock: re-number each day's lines by time, keeping the same numbers */
  const mins = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})\s*(ص|م|AM|PM)/); if (!m) return 0; let h = Number(m[1]) % 12; if (m[3] === 'م' || m[3] === 'PM') h += 12; return h * 60 + Number(m[2]); };
  const ords = LOG.map((e) => e.ord).sort((a, b) => a - b);
  LOG.slice().sort((x, y) => (y.day - x.day) || (mins(x.time) - mins(y.time)) || (x.ord - y.ord)).forEach((e, i) => { e.ord = ords[i]; });
}

/* ---- the change-proposal card in the chat ---- */
function chgHTML(t, m) {
  const C = CHG[m.card.pid]; if (!C) return '';
  const A = AGENTS[C.agent]; const B = AGENTS[C.by]; const pid = C.id;
  const pending = C.status === 'pending'; const owner = isOwner(); const solo = isSolo();
  const fresh = m.fresh ? ' card-in' : '';
  const self = C.by === C.agent;
  const top = pending
    ? (owner ? `<span class="badge badge--wait"><span class="dot dot--waiting" aria-hidden="true"></span>${lng('مستنيك', 'Waiting on you')}</span>` : `<span class="badge">${icon('clock')}${lng('مستني موافقة عمر', 'Waiting for Omar’s OK')}</span>`)
    : `<span class="badge">${icon(C.status === 'approved' ? 'check' : 'x')}${C.status === 'approved' ? lng('اتوافق عليه', 'Approved') : lng('اترفض', 'Declined')}</span>`;
  const mark = C.kind === 'tool' ? tile(C.tool, true) : tile((MODELS.find((x) => x.n === C.model) || MODELS[0]).logo, true);
  const head = `<div class="hcard__top">${top}</div><div class="card__head">${mark}
    <div class="card__titles"><span class="card__title">${lng('اقتراح تغيير في إعدادات', 'Proposed change to the settings of')} <bdi>${esc(A.name)}</bdi></span>
    <span class="card__sub">${bx(`${self ? `${A.name} ${lng('اقترحه لنفسه', 'proposed it for itself')}` : `${B.name} ${lng('اقترحه لـ', 'proposed it for')} ${A.name}`} · ${lng('مفيش حاجة بتتغيّر قبل موافقة المالك', 'nothing changes before the Owner’s OK')}`)}</span></div></div>`;
  const [from, to] = chgFromTo(C);
  const kv = `<dl class="kv pp-kv">
    <div class="kv__row"><dt>${lng('التغيير', 'Change')}</dt><dd>${bx(chgWhat(C))}${C.kind === 'tool' ? `<span class="pp-sub">${bx(accessT(C.access))} · ${bx(lng('من التطبيقات المتوصلة بالشركة', 'from the company’s connected apps'))}</span>` : ''}</dd></div>
    <div class="kv__row"><dt>${lng('دلوقتي', 'Now')}</dt><dd>${bx(from)}</dd></div>
    <div class="kv__row"><dt>${lng('بعد الموافقة', 'After the OK')}</dt><dd>${bx(to)}</dd></div>
    <div class="kv__row"><dt>${lng('ليه', 'Why')}</dt><dd>${bx(C.why)}</dd></div></dl>`;
  if (pending && owner && C.mode === 'edit') {
    const D = C.draft;
    let fields;
    if (C.kind === 'tool') {
      const cands = APPS.map((x) => x.k).filter((k) => state.conns[k] === 'connected' && (!A.conns.includes(k) || k === C.tool));
      fields = `<div class="set-field"><span class="set-label" id="chg-tool-l-${pid}">${lng('الأداة', 'Tool')}</span>
        <div class="pp-chips" role="radiogroup" aria-labelledby="chg-tool-l-${pid}">${cands.map((k) => `<button type="button" class="chip pp-chip" role="radio" id="chg-tool-${pid}-${k}" aria-checked="${D.tool === k}" data-action="chg-tool" data-pid="${pid}" data-k="${k}">${tile(k)}<bdi>${esc(CONNS[k].name)}</bdi></button>`).join('')}</div></div>
        <div class="set-field"><span class="set-label" id="chg-acc-l-${pid}">${lng('الصلاحية', 'Access')}</span>
        <div class="segmented segmented--field" role="radiogroup" aria-labelledby="chg-acc-l-${pid}">${['read', 'write'].map((k) => `<button type="button" role="radio" id="chg-acc-${pid}-${k}" aria-checked="${D.access === k}" tabindex="${D.access === k ? 0 : -1}" data-action="chg-access" data-pid="${pid}" data-k="${k}">${accessT(k)}</button>`).join('')}</div>
        <span class="set-hint">${bx(lng('حتى مع «قراءة وكتابة»، أي نشر أو صرف أو رسالة لعميل بيتسلّملك.', 'Even with “read and write”, anything that publishes, spends or messages a customer is handed to you.'))}</span></div>`;
    } else {
      fields = `<div class="set-field"><span class="set-label" id="chg-mdl-l-${pid}">${lng('الموديل', 'Model')}</span>
        <div class="segmented segmented--field" role="radiogroup" aria-labelledby="chg-mdl-l-${pid}">${MODELS.map((x, i) => `<button type="button" role="radio" id="chg-mdl-${pid}-${i}" aria-checked="${D.model === x.n}" tabindex="${D.model === x.n ? 0 : -1}" data-action="chg-model" data-pid="${pid}" data-model="${esc(x.n)}"><bdi>${esc(x.n)}</bdi></button>`).join('')}</div></div>`;
    }
    return `<div class="card pp-card chg-card${fresh}" role="group" aria-label="${lng('عدّل الاقتراح', 'Edit the proposal')}">${head}<div class="pp-form">${fields}</div>
      <div class="card__actions"><button type="button" class="btn btn--secondary" data-action="chg-edit-cancel" data-pid="${pid}">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary" data-action="chg-approve" data-pid="${pid}" data-edited="1" id="chg-go-${pid}">${lng('وافق بالتعديلات', 'Approve with changes')}</button></div></div>`;
  }
  let out;
  if (C.status === 'approved') {
    out = `<div class="card__outcome">${icon('check')}<span>${bx(`${C.solo ? lng('وافقت ·', 'You approved ·') : lng('عمر وافق ·', 'Omar approved ·')} ${C.at}. ${C.kind === 'tool' ? `${CONNS[C.tool].name} ${lng('اتضاف لأدوات', 'was added to the tools of')} ${A.name} (${accessT(C.access)}).` : `${A.name} ${lng('بقى بيفكر بـ', 'now thinks with')} ${C.model}.`}`)}</span>
      ${canSee(C.agent) ? `<button type="button" class="link-btn" data-action="sov-agent-open" data-agent="${C.agent}">${lng('افتح إعداداته', 'Open its settings')}</button>` : ''}</div>`;
  } else if (C.status === 'rejected') {
    out = `<div class="card__outcome pp-out">${icon('x')}<span>${bx(`${C.solo ? lng('رفضته ·', 'You declined ·') : lng('عمر رفض ·', 'Omar declined ·')} ${C.at}. ${lng('مفيش حاجة اتغيّرت.', 'Nothing changed.')}${C.reason ? ` ${lng('السبب:', 'Reason:')} «${C.reason}»` : ''}`)}</span></div>`;
  } else if (!owner) {
    out = waitLineHTML(lng('مستني موافقة عمر. لحد ما يرد، إعدادات الوكيل زي ما هي.', 'Waiting for Omar’s OK. Until he answers, the agent’s settings stay as they are.'));
  } else if (C.mode === 'reject') {
    out = `<div class="pp-form"><div class="set-field"><label class="set-label" for="chg-why-${pid}">${solo ? lng('سبب الرفض (اختياري)', 'Reason for declining (optional)') : lng('سبب الرفض', 'Reason for declining')}</label>
        <textarea class="set-input set-textarea" id="chg-why-${pid}" rows="3" data-chg="reason" data-pid="${pid}" placeholder="${lng('مثلاً: خلّيه على Search Console الشهر ده ونشوف.', 'e.g. Keep it on Search Console this month and we’ll see.')}" aria-describedby="chg-why-err-${pid} chg-why-hint-${pid}"${solo ? '' : ' aria-required="true"'}>${esc(C.reasonDraft || '')}</textarea>
        <span class="set-err" id="chg-why-err-${pid}" ${C.reasonErr ? '' : 'hidden'}>${lng('اكتب السبب، عشان الوكيل يعرف ليه.', 'Write the reason, so the agent knows why.')}</span>
        <span class="set-hint" id="chg-why-hint-${pid}">${lng('السبب بيتكتب في السجل وفي المحادثة.', 'The reason goes into the log and this chat.')}</span></div></div>
      <div class="card__actions"><button type="button" class="btn btn--secondary" data-action="chg-reject-cancel" data-pid="${pid}">${lng('إلغاء', 'Cancel')}</button>
        <button type="button" class="btn btn--primary" data-action="chg-reject" data-pid="${pid}">${lng('ارفض', 'Decline')}</button></div>`;
  } else {
    out = `<div class="card__actions">
      <button type="button" class="btn btn--secondary" data-action="chg-reject-open" data-pid="${pid}" id="chg-no-${pid}">${lng('ارفض', 'Decline')}</button>
      <button type="button" class="btn btn--secondary" data-action="chg-edit" data-pid="${pid}" id="chg-edit-${pid}">${lng('عدّل وبعدين وافق', 'Edit, then approve')}</button>
      <button type="button" class="btn btn--primary" data-action="chg-approve" data-pid="${pid}" id="chg-ok-${pid}">${lng('وافق', 'Approve')}</button></div>`;
  }
  return `<div class="card pp-card chg-card${pending ? '' : ' is-resolved'}${fresh}${justCls(C)}" role="group" aria-label="${lng('اقتراح تغيير في إعدادات', 'Proposed change to the settings of')} ${esc(A.name)}">${head}${kv}${out}</div>`;
}
const chgRefresh = (C, focusId) => {
  refreshThread(C.thread); rerenderAll();
  if (focusId) window.requestAnimationFrame(() => { const n = document.getElementById(focusId); if (n) n.focus(); });
};
function approveChg(id, edited) {
  const C = CHG[id]; if (!C || C.status !== 'pending' || !isOwner()) return;
  if (edited && C.draft) { if (C.kind === 'tool') { C.tool = C.draft.tool; C.access = C.draft.access; } else C.model = C.draft.model; }
  const A = AGENTS[C.agent]; const [from, to] = chgFromTo(C); const solo = isSolo();
  if (C.kind === 'tool') { if (!A.conns.includes(C.tool)) A.conns.push(C.tool); A.toolsOn[C.tool] = true; if (state.drafts[C.agent]) state.drafts[C.agent].tools[C.tool] = true; }
  else { A.model = C.model; if (state.drafts[C.agent]) state.drafts[C.agent].model = C.model; }
  Object.assign(C, { status: 'approved', at: nowTime(), mode: null, draft: null, justAt: Date.now(), solo });
  logAuto(ME(), meAct('وافق على تغيير في إعدادات', 'وافقت على تغيير في إعدادات', 'approved a settings change for'), { agent: C.agent, obj: A.name, from, to });
  if (C.card) sysMove(C.card, 'done', { prog: solo ? lng('اتغيّر بموافقتك', 'Changed with your OK') : lng('اتغيّر بموافقة عمر', 'Changed with Omar’s OK'), wait: '' });
  chgRefresh(C);
  toast(C.kind === 'tool' ? `${CONNS[C.tool].name} ${lng('اتضاف لأدوات', 'was added to the tools of')} ${A.name}` : `${A.name} ${lng('بقى بيفكر بـ', 'now thinks with')} ${C.model}`);
  const who = solo ? 'تمام' : 'عمر وافق';
  const text = C.kind === 'tool'
    ? `${who}، و${CONNS[C.tool].name} اتضاف لأدواتي (${accessT(C.access)}).${C.tool === 'sheets' ? '\nهبص على شيت الليدز وأرجعلك هنا بأنهي مقالات جابت تسجيلات الشهر ده.' : '\nهبدأ أستخدمه من الشغلانة الجاية.'}`
    : `${who}. ${A.name} بقى بيفكر بـ ${C.model} من الشغلانة الجاية، وبلّغته يبدأ تقرير الـ 90 يوم من الأول.`;
  agentSays(C.thread, C.by, { text, activity: [lng('بيحدّث الإعدادات', 'Updating the settings')] }, () => rerenderAll());
}
function rejectChg(id) {
  const C = CHG[id]; if (!C || C.status !== 'pending' || !isOwner()) return;
  const why = (C.reasonDraft || '').trim(); const solo = isSolo();
  if (!why && !solo) { C.reasonErr = true; chgRefresh(C, `chg-why-${id}`); const n = $(`#chg-why-${id}`); if (n) n.setAttribute('aria-invalid', 'true'); return; }
  const A = AGENTS[C.agent];
  Object.assign(C, { status: 'rejected', reason: why, at: nowTime(), mode: null, reasonErr: false, justAt: Date.now(), solo });
  logAuto(ME(), meAct('رفض تغيير في إعدادات', 'رفضت تغيير في إعدادات', 'declined a settings change for'), { agent: C.agent, obj: A.name, from: chgWhat(C), to: why || lng('من غير سبب مكتوب', 'No reason written') });
  if (C.card) sysMove(C.card, 'done', { prog: lng('اقتراح اترفض', 'Proposal declined'), wait: '' });
  chgRefresh(C);
  toast(lng('اترفض، ومفيش حاجة اتغيّرت في إعدادات الوكيل', 'Declined. Nothing changed in the agent’s settings'), 'x');
  const text = C.kind === 'tool' ? `تمام، مش هضيف ${CONNS[C.tool].name}.${why ? ` السبب اتكتب في السجل: «${why}»` : ''}\nهقولك الزيارات من Search Console، والتسجيلات محتاجة حد يبصلها من الشيت.`
    : `تمام، ${A.name} هيفضل على ${A.model}.${why ? ` السبب اتكتب في السجل: «${why}»` : ''}`;
  agentSays(C.thread, C.by, { text, activity: [lng('بيقرا الرد', 'Reading the answer')] }, () => rerenderAll());
}

/* ---- live: tell an agent «افتكر إن…» in its chat; it saves the note with your name and writes it in the log ---- */
const LEARN_RE = /^(?:@\S+\s+)?(?:افتكر|خلّي بالك|خلي بالك|من هنا ورايح|من النهارده)/;
const groupGuess = (s) => (/ممنوع|ماتقولش|متقولش|ماتستخدمش|منستخدمش|مانكتبش/.test(s) ? 'banned' : /لهجة|بلهجة|تبغى|نبرة|بنكتب|بتبدأ|بيبدأ/.test(s) ? 'voice' : /جمهور|استهداف|سنة|الرياض|القاهرة|جدة/.test(s) ? 'audience' : 'lessons');
function learnTurn(threadId, a, text) {
  if (!AGENTS[a] || !LEARN_RE.test(text.trim())) return false;
  const t = threads[threadId]; const A = AGENTS[a];
  const body = text.trim().replace(LEARN_RE, '').replace(/^\s*(?:إن|ان|:|،)\s*/, '').trim() || text.trim();
  /* a member teaching an agent something for the whole team: a suggestion for the Owner or a Manager */
  if (!isSolo() && !canManage()) { suggestTurn(threadId, a, body, 'note'); return true; }
  agentSays(threadId, a, { text: `تمام يا ${me().first}، هفتكرها: «${body}».\nحفظتها في ذاكرتي باسمك، واتكتبت في السجل.`, activity: [lng('بيحفظ في ذاكرته', 'Saving to its memory')] }, () => {
    const m = mem(groupGuess(body), 'told', body, `${me().first} · ${lng('النهارده', 'Today')}`); m.by = state.as;
    A.memory.unshift(m);
    const L = lrn({ kind: 'note', agent: a, mem: m, by: state.as, thread: threadId, at: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
    logAuto(WHO.a(a), lng('حفظ ملاحظة في ذاكرته', 'saved a note to its memory'), { agent: a, obj: body, to: `${lng('من', 'From')} ${me().first} ${lng('في المحادثة', 'in the chat')}`, link: { action: 'sov-mem', agent: a, label: lng('شوفها في الذاكرة', 'See it in memory') } });
    state.events.unshift({ agent: a, t: `${lng('حفظ ملاحظة من', 'Saved a note from')} ${me().first}: «${body}»`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
    t.msgs.push({ id: nid('n'), role: 'note', icon: 'bulb', text: `${A.name} ${lng('حفظ ملاحظة في ذاكرته باسمك · اتكتبت في السجل', 'saved a note to its memory under your name · written in the log')}`, link: { action: 'sov-mem', agent: a, label: lng('شوفها', 'See it') }, fresh: true });
    void L; refreshThread(threadId); scrollMounts(threadId); rerenderAll();
  }, lng('بيحفظ', 'Saving'));
  return true;
}

/* ================= the overlay ================= */
const SOV_SECS = [
  { k: 'company', ic: 'building', co: true, t: () => lng('الشركة', 'Company') },
  { k: 'agents', ic: 'bot', t: () => lng('الوكلاء', 'Agents') },
  { k: 'knowledge', ic: 'book', co: true, t: () => lng('معرفة الشركة', 'Company knowledge') },
  { k: 'learning', ic: 'bulb', co: true, t: () => lng('التعلّم', 'Learning') },
  { k: 'models', ic: 'cpu', co: true, t: () => lng('الاشتراك والموديلات', 'Subscription and models') },
  { k: 'apps', ic: 'plug', co: true, t: () => lng('التطبيقات', 'Apps') },
  { k: 'routines', ic: 'repeat', co: true, t: () => lng('المهام المتكررة', 'Recurring tasks') },
  { k: 'usage', ic: 'gauge', co: true, t: () => lng('الاستهلاك', 'Usage') },
  { k: 'backup', ic: 'archive', co: true, t: () => lng('النسخ الاحتياطي', 'Backups') },
  { k: 'account', ic: 'user', mine: true, t: () => lng('حسابك', 'Your account') },
];
/* a viewer doesn't see the company's sections: only their account and the agents they work with */
const sovSecs = () => SOV_SECS.filter((s) => !s.co || me().role !== 'viewer');
const sovHas = (k) => sovSecs().some((s) => s.k === k);
const sovHead = (title, sub, extra) => `<header class="sov-head"><div class="sov-head__t"><h3 class="sov-h" id="sov-h" tabindex="-1">${title}</h3>${sub ? `<p class="sov-sub">${bx(sub)}</p>` : ''}</div>${extra || ''}</header>`;
const sovRO = () => (canManage() ? '' : `<p class="ro-note">${icon('shield')}<span>${bx(`${lng('ده بيغيّره', 'This is changed by')} ${whoManages()} ${lng('بس. انت شايفه قراءة بس.', 'only. You see it read only.')}`)}</span></p>`);
const sovBack = (act, label) => `<button type="button" class="link-btn sov-back" data-action="${act}" id="sov-back">${icon('chevronRight')}<span>${label}</span></button>`;

function sovKey() { const S = state.sov; return [S.sec, S.agent || '', S.agentTab, S.know, S.skill || ''].join(':'); }
function renderSov() {
  const S = state.sov; const box = $('#sov-inner'); if (!S || !box) return;
  if (!sovHas(S.sec)) { S.sec = sovSecs()[0].k; S.agent = null; S.skill = null; }
  const old = $('#sov-main', box); const key = sovKey();
  const keepTop = old && box.dataset.viewKey === key ? old.scrollTop : 0;
  const f = keepFocus(box);
  box.innerHTML = `${sovBarHTML()}<div class="sov__body">${sovNavHTML()}<div class="sov-main" id="sov-main">${sovPageHTML()}</div></div>`;
  box.dataset.viewKey = key;
  if (S.sec === 'apps') renderApps();
  const nm = $('#sov-main', box); if (nm && keepTop) nm.scrollTop = keepTop;
  restoreFocus(f, box);
  syncSaveBar();
}
function sovBarHTML() {
  return `<header class="sov__bar"><span class="ws__mark" aria-hidden="true">${SYS_MARK(28)}</span>
    <h2 class="sov__title" id="sov-title">${lng('الإعدادات', 'Settings')}</h2><span class="sov__co"><bdi>${esc(state.companyName)}</bdi></span><span class="od-fill"></span>
    ${canManage() ? '' : `<span class="badge sov-ro">${icon('eye')}${lng('قراءة بس', 'Read only')}</span>`}
    <button type="button" class="circle-btn" data-action="sov-close" id="sov-close" aria-label="${lng('اقفل الإعدادات وارجع', 'Close settings and go back')}" title="${lng('اقفل (Esc)', 'Close (Esc)')}">${icon('x')}</button></header>`;
}
function sovNavHTML() {
  const S = state.sov; const list = sovSecs();
  const cnt = (k) => {
    if (k === 'learning' && canManage()) return lnPending().length;
    if (k === 'agents' && isOwner()) return Object.values(CHG).filter((C) => C.status === 'pending' && chgVisible(C)).length;
    return 0;
  };
  const item = (s) => { const n = cnt(s.k); return `<button type="button" class="sb-item sov-nav__i" data-action="sov-sec" data-sec="${s.k}" id="sov-nav-${s.k}"${S.sec === s.k ? ' aria-current="page"' : ''}>${icon(s.ic)}<span class="od-fill">${s.t()}</span>${n ? `<span class="sb-count" aria-label="${n} ${lng('مستنيين موافقتك', 'waiting for your OK')}">${n}</span>` : ''}</button>`; };
  return `<nav class="sov-nav" aria-label="${lng('أقسام الإعدادات', 'Settings sections')}">
    <p class="sov-nav__l"><bdi>${esc(state.companyName)}</bdi></p>${list.filter((s) => !s.mine).map(item).join('')}
    <p class="sov-nav__l">${lng('انت', 'You')}</p>${list.filter((s) => s.mine).map(item).join('')}</nav>`;
}
function sovPageHTML() {
  const S = state.sov;
  const fn = { company: sovCompanyHTML, agents: sovAgentsHTML, knowledge: sovKnowHTML, learning: sovLearnHTML, models: sovModelsHTML, apps: sovAppsHTML, routines: sovRoutinesHTML, usage: sovUsageHTML, backup: sovBackupHTML, account: sovAccountHTML }[S.sec] || sovAgentsHTML;
  return `<div class="sov-page sov-page--${S.sec}">${fn()}</div>`;
}

/* ---- الشركة ---- */
function teamTableHTML() {
  const ags = [state.main].concat(AGENT_ORDER.filter((a) => a !== state.main));
  const others = ags.filter((a) => !isMain(a));
  return `<div class="table-wrap"><table class="table ta-table">
      <thead><tr><th scope="col">${lng('العضو', 'Member')}</th>${ags.map((a) => `<th scope="col"><span class="ta-ag">${face(a, 24)}<bdi>${esc(AGENTS[a].name)}</bdi></span></th>`).join('')}</tr></thead>
      <tbody>${roster().map((p) => { const Q = PEOPLE[p]; return `<tr><th scope="row"><span class="ta-who"><span class="me__av pp-av" aria-hidden="true">${Q.av}</span><span class="od-field"><span class="ta-name"><bdi>${esc(Q.name)}</bdi>${p === state.as ? ` <span class="ch-you">${lng('(انت)', '(you)')}</span>` : ''}</span><span class="ta-role">${Q.title}${Q.job ? ` · ${Q.job}` : ''}</span>${Q.pending ? `<span class="badge ta-pending">${icon('clock')}${lng('اتبعتله دعوة', 'Invite sent')}</span>` : ''}</span></span></th>
        <td><span class="ta-all">${lng('ظاهر للكل', 'Shown to all')}</span></td>
        ${Q.role === 'owner' ? `<td colspan="${others.length}"><span class="ta-all">${lng('المالك بيشوف كل الوكلاء', 'The Owner sees every agent')}</span></td>`
          : others.map((a) => { const on = allowedFor(p, a); return `<td><button type="button" class="switch" role="switch" id="ta-${p}-${a}" aria-checked="${on}" aria-label="${esc(Q.name)} · ${esc(AGENTS[a].name)}" data-action="ta-toggle" data-person="${p}" data-agent="${a}"></button></td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>
      <p class="set-hint ta-hint">${bx(lng('التغيير بيبان عند العضو على طول. المساهم بيكتب ويوافق في الوكلاء المسموحله بيهم، والمشاهد بيقرا بس.', 'Changes apply to the member right away. A contributor writes and approves with the agents they’re allowed; a viewer only reads.'))}</p>
      ${isOwner() ? `<section class="inv-sec" aria-labelledby="inv-h">${state.inviting ? `<h3 class="dp-label" id="inv-h"><span>${lng('اعزم عضو', 'Invite a member')}</span><button type="button" class="link-btn" data-action="invite-toggle" id="inv-toggle">${lng('إلغاء', 'Cancel')}</button></h3>${inviteFormHTML()}`
        : `<h3 class="sr-only" id="inv-h">${lng('اعزم عضو', 'Invite a member')}</h3><button type="button" class="btn btn--secondary inv-open" data-action="invite-toggle" id="inv-toggle">${icon('plus')}<span>${lng('اعزم عضو', 'Invite a member')}</span></button>`}</section>` : ''}`;
}
function sovCompanyHTML() {
  const S = state.sov; const mgr = canManage(); const solo = isSolo(); const n = roster().length;
  const draft = S.coDraft != null ? S.coDraft : state.companyName;
  const name = `<section class="dp-sec" aria-labelledby="co-h-name"><h4 class="dp-label" id="co-h-name"><span>${lng('اسم الشركة', 'Company name')}</span></h4>
    <div class="panel-card set-card">${mgr ? `<div class="set-field"><label class="set-label" for="co-name">${lng('بيظهر للأعضاء، وفي الإعدادات، وفي رسايل الوكلاء', 'Shown to members, in settings and in the agents’ messages')}</label>
      <div class="co-name"><input class="set-input" id="co-name" type="text" dir="auto" maxlength="40" autocomplete="off" value="${esc(draft)}" aria-describedby="co-name-err">
      <button type="button" class="btn btn--primary btn--sm" data-action="co-name-save" id="co-name-save"${draft.trim() !== state.companyName ? '' : ' disabled'}>${lng('احفظ', 'Save')}</button></div>
      <span class="set-err" id="co-name-err" hidden>${lng('الشركة محتاجة اسم، ولو كلمة واحدة.', 'The company needs a name, even one word.')}</span></div>`
      : `<p class="ro-text"><bdi>${esc(state.companyName)}</bdi></p>`}</div></section>`;
  const mode = `<section class="dp-sec" aria-labelledby="co-h-mode"><h4 class="dp-label" id="co-h-mode"><span>${lng('لوحدك ولا مع تيم', 'Alone or with a team')}</span></h4>
    <div class="panel-card"><div class="panel-row"><span class="panel-row__icon">${icon(solo ? 'user' : 'team')}</span><span class="panel-row__text">
      <span class="panel-row__t">${solo ? lng('لوحدك · انت والوكلاء بس', 'Alone · just you and the agents') : `${lng('مع تيم ·', 'With a team ·')} <span class="num">${n}</span> ${lng('أعضاء', 'members')}`}</span>
      <span class="panel-row__d">${solo ? lng('أول ما تعزم حد، القنوات والوكلاء لكل عضو بيشتغلوا لوحدهم، و«عام» بتتفتح.', 'As soon as you invite someone, channels and per-member agents turn on by themselves, and “عام” opens.') : lng('القنوات والوكلاء لكل عضو شغالين. مفيش رجوع لـ «لوحدك» طول ما فيه أعضاء تانيين.', 'Channels and per-member agents are on. There’s no going back to “alone” while other members exist.')}</span></span></div></div></section>`;
  let members;
  if (solo) {
    members = isOwner() ? `<section class="inv-sec" aria-labelledby="inv-h"><h4 class="dp-label" id="inv-h"><span>${lng('اعزم عضو', 'Invite a member')}</span></h4>${inviteFormHTML()}</section>` : '';
  } else if (mgr) {
    members = `<section class="dp-sec" aria-labelledby="co-h-mem"><h4 class="dp-label" id="co-h-mem"><span>${lng('الأعضاء والوكلاء اللي بيشتغلوا معاهم', 'Members and the agents they work with')}</span></h4><div class="ta sov-ta">${teamTableHTML()}</div></section>`;
  } else {
    members = `<section class="dp-sec" aria-labelledby="co-h-mem"><h4 class="dp-label" id="co-h-mem"><span>${lng('الأعضاء', 'Members')} <span class="muted num">${n}</span></span></h4>
      <div class="panel-card">${roster().map((p) => { const Q = PEOPLE[p]; return `<div class="panel-row">${personAv(p, 28)}<span class="panel-row__text"><span class="panel-row__t">${esc(Q.name)}${p === state.as ? ` <span class="ch-you">${lng('(انت)', '(you)')}</span>` : ''}</span><span class="panel-row__d">${esc(Q.title)}${Q.job ? ` · ${esc(Q.job)}` : ''}</span></span></div>`; }).join('')}</div></section>`;
  }
  return sovHead(lng('الشركة', 'Company'), lng('اسم الشركة، شغال لوحدك ولا مع تيم، ومين بيشتغل مع أنهي وكلاء.', 'The company name, working alone or with a team, and who works with which agents.')) + sovRO() + name + mode + members;
}

/* ---- الوكلاء: the list, each opening that agent's existing settings and memory ---- */
function sovAgentsHTML() {
  const S = state.sov;
  if (S.agent && AGENTS[S.agent] && canSee(S.agent)) return sovAgentHTML(S.agent);
  S.agent = null;
  const rows = visibleAgents().map((a) => {
    const A = AGENTS[a]; const st = agentStatus(a); const C = chgPendingFor(a);
    return `<button type="button" class="panel-row sov-ag" data-action="sov-agent" data-agent="${a}" id="sov-ag-${a}">${faceDot(a, 36, st)}
      <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(A.name)}</bdi>${isMain(a) ? ` <span class="badge sov-badge">${lng('الرئيسي', 'Main')}</span>` : ''}</span>
      <span class="panel-row__d">${bx([A.role, A.model, `${lng('التعلّم:', 'Learning:')} ${LEARN_T[learnModeOf(a)]}`].filter(Boolean).join(' · '))}</span>${bornText(a) ? `<span class="panel-row__d sov-born">${bx(bornText(a))}</span>` : ''}</span>
      ${C && isOwner() && chgVisible(C) ? `<span class="panel-row__meta panel-row__meta--wait"><span class="dot dot--waiting" aria-hidden="true"></span>${lng('اقتراح مستنيك', 'Proposal waiting')}</span>` : `<span class="panel-row__meta">${STATUS_TXT[st]}</span>`}
      <span class="panel-row__icon sov-chev">${icon('chevron')}</span></button>`;
  }).join('');
  const add = canWrite() ? `<button type="button" class="btn btn--secondary btn--sm" data-action="sov-new-agent">${icon('chat')}<span>${isOwner() ? `${lng('اطلب من', 'Ask')} ${AGENTS[state.main].name} ${lng('وكيل', 'for an agent')}` : lng('اطلب وكيل', 'Ask for an agent')}</span></button>` : '';
  return sovHead(lng('الوكلاء', 'Agents'), lng('هنا تشوف كل وكيل اتعمل إزاي: شغلانته وتطبيقاته وقواعده وذاكرته.', 'Here you see how each agent is set up: its job, apps, rules and memory.'), add)
    + sovRO() + talkTipHTML() + `<div class="panel-card sov-ags">${rows}</div>`;
}
function sovAgentHTML(a) {
  const S = state.sov; const A = AGENTS[a]; const st = agentStatus(a);
  const D = canManage() && S.agentTab === 'settings' ? draftOf(a) : null;
  const shownName = D ? (D.name.trim() || A.name) : A.name; const shownRole = D ? D.role.trim() : A.role;
  const tabs = [['settings', lng('الإعدادات', 'Settings')], ['memory', lng('الذاكرة', 'Memory')]];
  const C = chgPendingFor(a);
  const pend = C && chgVisible(C) ? `<div class="sov-pend" role="note">${icon('clock')}<span>${bx(`${AGENTS[C.by].name} ${lng('اقترح', 'proposed')} ${chgWhat(C)} · ${isOwner() ? lng('مستني موافقتك', 'waiting for your OK') : lng('مستني عمر', 'waiting for Omar')}. ${lng('مفيش حاجة بتتغيّر هنا قبلها.', 'Nothing changes here before that.')}`)}</span>
      <button type="button" class="link-btn" data-action="sov-thread" data-thread="${C.thread}">${lng('افتح الاقتراح', 'Open the proposal')}</button></div>` : '';
  const body = S.agentTab === 'memory' ? `<div class="dp-sections">${memoryHTML(a)}</div>` : `${talkTipHTML(a)}<div class="dp-sections sov-rules">${rulesHTML(a)}</div>${canManage() ? settingsHTML(a) : settingsReadHTML(a)}`;
  const bar = S.agentTab === 'settings' && canManage() ? `<div class="dp-savebar sov-savebar" id="dp-savebar" role="region" aria-label="${lng('حفظ الإعدادات', 'Save settings')}" hidden>
      <span class="dp-savebar__t">${lng('فيه تعديلات مش متحفظة', 'You have unsaved changes')}</span>
      <button type="button" class="btn btn--secondary btn--sm" data-action="discard-settings">${lng('إلغاء', 'Cancel')}</button>
      <button type="button" class="btn btn--primary btn--sm" data-action="save-settings">${lng('احفظ', 'Save')}</button></div>` : '';
  return `${sovBack('sov-agent-back', lng('كل الوكلاء', 'All agents'))}
    <div class="sov-agent-id">${faceDot(a, 48, st, true)}<div class="od-fill"><div class="dp-id__name"><bdi id="dp-id-name">${esc(shownName)}</bdi>${isMain(a) ? `<span class="badge dp-id__badge">${lng('الرئيسي', 'Main')}</span>` : ''}</div>
      <div class="dp-id__role"><span id="dp-id-role">${shownRole ? `${bx(shownRole)} · ` : ''}</span>${STATUS_TXT[st]}</div>${bornHTML(a, 'sov')}</div></div>
    <div class="segmented sov-tabs" role="tablist" aria-label="${esc(A.name)}">${tabs.map(([k, l]) => `<button type="button" role="tab" id="sov-tab-${k}" aria-selected="${S.agentTab === k}" aria-controls="sov-agent-panel" tabindex="${S.agentTab === k ? 0 : -1}" data-action="sov-agent-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    ${pend}<div id="sov-agent-panel" role="tabpanel" aria-labelledby="sov-tab-${S.agentTab}">${body}</div>${bar}`;
}

/* ---- معرفة الشركة ---- */
function sovKnowHTML() {
  const S = state.sov; const P = KNOW.find((x) => x.k === S.know) || KNOW[0]; S.know = P.k;
  const mgr = canManage(); const editing = mgr && S.knowEdit === P.k;
  const memA = visibleAgents().find((a) => !isMain(a)) || state.main;
  const vs = `<div class="know-vs">
    <div class="know-vs__c"><b>${icon('book')}${lng('معرفة الشركة', 'Company knowledge')}</b><p>${bx(`${lng('صفحات واحدة للشركة كلها. كل الوكلاء بيقروها قبل أي شغلانة، وبيعدّلها', 'One set of pages for the whole company. Every agent reads them before any job. Edited by')} ${whoManages()}.`)}</p></div>
    <div class="know-vs__c"><b>${icon('bulb')}${lng('ذاكرة الوكيل', 'An agent’s memory')}</b><p>${bx(lng('خاصة بكل وكيل لوحده: اللي اتقاله واللي اتعلّمه من شغله. بتلاقيها في «الذاكرة» عند كل وكيل.', 'Each agent’s own: what it was told and what it learned from its work. You find it under “Memory” on each agent.'))}</p>
      <button type="button" class="link-btn" data-action="sov-mem" data-agent="${memA}">${bx(`${lng('افتح ذاكرة', 'Open the memory of')} ${AGENTS[memA].name}`)}</button></div></div>`;
  const tabs = `<div class="od-rail know-tabs" role="group" aria-label="${lng('صفحات معرفة الشركة', 'Company knowledge pages')}">${KNOW.map((x) => `<button type="button" class="chip chip--text" id="know-tab-${x.k}" aria-pressed="${x.k === P.k}" data-action="know-page" data-page="${x.k}">${x.t}</button>`).join('')}</div>`;
  const by = knowBy(P);
  const meta = `<p class="know-meta">${personAv(by, 20)}<span>${lng('آخر تعديل:', 'Last edited by')} ${esc(PEOPLE[by].first)} · ${esc(P.at)}</span><span class="lg-dot" aria-hidden="true">·</span>${faceStack(visibleAgents(), 18)}<span>${lng('بيقراها كل الوكلاء', 'Read by every agent')} (<span class="num">${AGENT_ORDER.length}</span>)</span></p>`;
  const page = editing
    ? `<div class="know-page"><div class="set-field"><label class="set-label" for="know-edit">${lng('عدّل', 'Edit')} «${P.t}»</label>
        <textarea class="set-input set-textarea know-ta" id="know-edit" rows="12" dir="rtl" aria-describedby="know-edit-hint know-edit-err">${esc(S.knowDraft != null ? S.knowDraft : P.body)}</textarea>
        <span class="set-err" id="know-edit-err" hidden>${lng('الصفحة مينفعش تبقى فاضية. اكتب حاجة، أو الغي التعديل.', 'The page can’t be empty. Write something, or cancel the edit.')}</span>
        <span class="set-hint" id="know-edit-hint">${bx(lng('كل سطر بيبدأ بـ «•» بيبقى نقطة. كل الوكلاء هيقروا النسخة الجديدة من الشغلانة الجاية، والتعديل بيتكتب في السجل.', 'Each line starting with “•” becomes a bullet. Every agent reads the new version from its next job, and the edit goes into the log.'))}</span></div>
        <div class="panel-form__row panel-form__row--end"><button type="button" class="btn btn--secondary btn--sm" data-action="know-cancel">${lng('إلغاء', 'Cancel')}</button><button type="button" class="btn btn--primary btn--sm" data-action="know-save" id="know-save">${lng('احفظ', 'Save')}</button></div></div>`
    : `<article class="know-page" aria-labelledby="know-h"><div class="know-page__top"><h4 class="know-page__h" id="know-h">${P.t}</h4>
        ${mgr ? `<button type="button" class="btn btn--secondary btn--sm" data-action="know-edit" id="know-edit-btn">${icon('pencil')}<span>${lng('عدّل', 'Edit')}</span></button>` : ''}</div>
        ${meta}<div class="know-body" dir="rtl">${knowBodyHTML(P.body)}</div></article>`;
  return sovHead(lng('معرفة الشركة', 'Company knowledge'), lng('الحاجات اللي كل الوكلاء لازم يعرفوها عن الشركة، في مكان واحد. أي تعديل هنا بيوصل لكلهم.', 'What every agent needs to know about the company, in one place. Any edit here reaches all of them.'))
    + sovRO() + vs + tabs + page;
}
function saveKnow() {
  const S = state.sov; const P = KNOW.find((x) => x.k === S.knowEdit); const ta = $('#know-edit'); if (!P || !ta) return;
  const v = ta.value.trim();
  if (!v) { const er = $('#know-edit-err'); if (er) er.hidden = false; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
  const changed = v !== P.body.trim();
  if (changed) {
    P.body = v; P.by = state.as; P.at = `${lng('النهارده ·', 'Today ·')} ${nowTime()}`;
    logAuto(ME(), meAct('عدّل صفحة في معرفة الشركة', 'عدّلت صفحة في معرفة الشركة', 'edited a company knowledge page'), { obj: P.t, to: lng('كل الوكلاء هيقروا النسخة الجديدة', 'Every agent reads the new version') });
  }
  S.knowEdit = null; S.knowDraft = null; renderSov();
  { const b = $('#know-edit-btn'); if (b) b.focus(); }
  toast(changed ? `«${P.t}» ${lng('اتحفظت. كل الوكلاء هيقروا النسخة الجديدة من الشغلانة الجاية', 'is saved. Every agent reads the new version from its next job')}` : lng('مفيش تغيير', 'Nothing changed'));
}

/* ---- التعلّم ---- */
function lnRowHTML(L) {
  const A = AGENTS[L.agent]; const mgr = canManage();
  const th = L.thread && threads[L.thread] && threadVisible(threads[L.thread]) ? threads[L.thread] : null;
  const isNote = L.kind === 'note' || L.kind === 'rule';
  const text = isNote ? (L.mem ? L.mem.t : L.text) : L.skill.t;
  const kindT = L.kind === 'rule' ? lng('قاعدة للفريق', 'A rule for the team') : isNote ? lng('ملاحظة', 'Note') : L.kind === 'skill' ? lng('مهارة جديدة', 'New skill') : `${lng('مهارة اتحسّنت · نسخة', 'Skill improved · version')} ${L.to}`;
  const how = L.by && PEOPLE[L.by] ? `${lng('قالهاله', 'Told by')} ${esc(PEOPLE[L.by].first)}` : lng('لوحده', 'On its own');
  const st = L.status === 'pending' ? `<span class="badge badge--wait"><span class="dot dot--waiting" aria-hidden="true"></span>${lng('مستني موافقة', 'Waiting for an OK')}</span>`
    : L.status === 'forgotten' ? `<span class="badge">${icon('x')}${lng('اتنسيت', 'Forgotten')}</span>`
    : L.status === 'rejected' ? `<span class="badge">${icon('x')}${lng('اترفضت', 'Declined')}</span>`
    : L.status === 'reverted' ? `<span class="badge">${lng('رجعت لنسخة', 'Back to version')} ${L.from}</span>` : '';
  const acts = [];
  if (L.status === 'pending' && mgr) {
    acts.push(`<button type="button" class="btn btn--secondary btn--sm" data-action="ln-reject" data-learn="${L.id}" id="ln-no-${L.id}">${lng('ارفض', 'Decline')}</button>`);
    acts.push(`<button type="button" class="btn btn--primary btn--sm" data-action="ln-approve" data-learn="${L.id}" id="ln-ok-${L.id}">${L.kind === 'rule' || (isNote && L.by) ? lng('خليها للفريق', 'Make it team-wide') : isNote ? lng('احفظها', 'Save it') : lng('ضيفها', 'Add it')}</button>`);
  }
  if (!isNote) acts.push(`<button type="button" class="link-btn" data-action="sov-learn" data-learn="${L.id}" id="ln-see-${L.id}">${L.kind === 'skillup' ? lng('شوف قبل وبعد', 'See before and after') : lng('شوف المهارة', 'See the skill')}</button>`);
  if (isNote && L.status === 'saved' && L.mem && canWrite()) acts.push(`<button type="button" class="link-btn" data-action="ln-forget" data-learn="${L.id}" id="ln-forget-${L.id}">${lng('انسى ده', 'Forget this')}</button>`);
  if (isNote && L.status === 'forgotten' && canWrite()) acts.push(`<button type="button" class="link-btn" data-action="ln-unforget" data-learn="${L.id}" id="ln-forget-${L.id}">${lng('رجّعها', 'Bring it back')}</button>`);
  if (L.kind === 'skillup' && mgr) acts.push(L.status === 'reverted'
    ? `<button type="button" class="link-btn" data-action="ln-revert" data-learn="${L.id}" id="ln-rev-${L.id}">${lng('رجّع نسخة', 'Restore version')} ${L.to}</button>`
    : `<button type="button" class="link-btn" data-action="ln-revert" data-learn="${L.id}" id="ln-rev-${L.id}">${lng('رجّع النسخة اللي قبلها', 'Go back to the previous version')}</button>`);
  return `<li class="ln-row${L.status === 'forgotten' || L.status === 'rejected' ? ' is-off' : ''}" id="ln-row-${L.id}">
    <span class="ln-ic" aria-hidden="true">${icon(isNote ? 'bulb' : 'spark')}</span>
    <div class="ln-body"><p class="ln-t" dir="rtl">${bx(text)}</p>
      <p class="ln-meta"><span>${kindT}</span><span aria-hidden="true">·</span><span class="ln-who">${face(L.agent, 16)}<bdi>${esc(A.name)}</bdi></span><span aria-hidden="true">·</span><span>${how}</span>
        ${th ? `<span aria-hidden="true">·</span><span>${lng('من محادثة', 'From the chat')}</span><button type="button" class="link-btn ln-conv" data-action="sov-thread" data-thread="${th.id}"><span class="od-truncate">${bx(th.title)}</span></button>` : ''}
        <span aria-hidden="true">·</span><span class="num">${esc(L.at)}</span>${st}</p>
      ${acts.length ? `<div class="ln-acts">${acts.join('')}</div>` : ''}</div></li>`;
}
function sovLearnHTML() {
  const S = state.sov;
  if (S.skill && lnById(S.skill)) return sovSkillHTML(lnById(S.skill));
  S.skill = null;
  const mgr = canManage();
  const modes = [['auto', lng('بيحفظ الملاحظات ويكتب ويحسّن مهاراته من الشغل لوحده. كل حفظة بتتكتب في السجل، وتقدر ترجّع فيها.', 'Saves notes and writes or improves its skills from the work by itself. Every save goes into the log, and you can undo it.')],
    ['ask', lng('كل ملاحظة أو مهارة جديدة بتستنى هنا كاقتراح، لحد ما حد من الفريق يوافق عليها.', 'Every new note or skill waits here as a proposal until someone on the team approves it.')]];
  const co = `<section class="dp-sec" aria-labelledby="ln-h-co"><h4 class="dp-label" id="ln-h-co"><span>${lng('للشركة كلها', 'For the whole company')}</span></h4>
    <div class="cr-kinds" role="radiogroup" aria-labelledby="ln-h-co">${modes.map(([k, d]) => { const on = LEARN.company === k; return `<button type="button" class="cr-kind" role="radio" id="ln-co-${k}" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-action="ln-company" data-mode="${k}"${mgr ? '' : ' aria-disabled="true"'}><span class="cr-kind__t">${LEARN_T[k]}</span><span class="cr-kind__d">${d}</span>${on ? icon('check', 'cr-kind__check') : ''}</button>`; }).join('')}</div>
    <p class="set-hint">${bx(lng('اللي بتقوله للوكيل بنفسك («افتكر إن…») بيتحفظ على طول باسمك في الحالتين.', 'What you tell an agent yourself (“افتكر إن…”) is saved right away under your name either way.'))}</p></section>`;
  const per = `<section class="dp-sec" aria-labelledby="ln-h-per"><h4 class="dp-label" id="ln-h-per"><span>${lng('لكل وكيل', 'Per agent')}</span></h4>
    <div class="panel-card">${visibleAgents().map((a) => { const v = LEARN.per[a] || 'company'; return `<div class="panel-row ln-ag">${face(a, 28)}
      <span class="panel-row__text"><span class="panel-row__t" id="ln-ag-t-${a}"><bdi>${esc(AGENTS[a].name)}</bdi></span><span class="panel-row__d">${v === 'company' ? `${lng('زي الشركة ·', 'Same as the company ·')} ${LEARN_T[LEARN.company]}` : LEARN_T[v]}</span></span>
      ${mgr ? `<div class="segmented segmented--field ln-seg" role="radiogroup" aria-labelledby="ln-ag-t-${a}">${[['company', lng('زي الشركة', 'Company')], ['auto', lng('لوحده', 'On its own')], ['ask', lng('يستأذن', 'Asks')]].map(([k, l]) => `<button type="button" role="radio" id="ln-${a}-${k}" aria-checked="${v === k}" tabindex="${v === k ? 0 : -1}" data-action="ln-agent" data-agent="${a}" data-mode="${k}">${l}</button>`).join('')}</div>` : ''}</div>`; }).join('')}</div></section>`;
  const chg = Object.values(CHG).filter(chgVisible);
  const rules = `<section class="dp-sec" aria-labelledby="ln-h-rules"><h4 class="dp-label" id="ln-h-rules"><span>${lng('الوكيل بيغيّر إيه في نفسه', 'What an agent changes about itself')}</span></h4>
    <div class="ln-rules"><div class="panel-card ln-rule"><b>${icon('bulb')}${lng('من غير إذن، وبيتكتب في السجل', 'Without asking, written in the log')}</b>
        <ul><li>${lng('ملاحظات ذاكرته', 'Its own memory notes')}</li><li>${lng('المهارات اللي اتعلّمها أو حسّنها', 'Skills it learned or improved')}</li></ul>
        <p class="set-hint">${lng('ولو الوكيل على «يستأذن الأول»، حتى دول بيستنوا موافقة هنا.', 'If the agent is on “Asks first”, even these wait for an OK here.')}</p></div>
      <div class="panel-card ln-rule"><b>${icon('shield')}${lng('بموافقة المالك بس', 'Only with the Owner’s OK')}</b>
        <ul><li>${lng('الموديل', 'Its model')}</li><li>${lng('أدواته والتطبيقات المتوصلة', 'Its tools and connected apps')}</li><li>${lng('تعليماته الأساسية', 'Its core instructions')}</li></ul>
        <p class="set-hint">${bx(lng('الوكيل، أو الرئيسي لوكيل تاني، بيقترح التغيير في المحادثة كارت، وبيوصل لعمر في «مستنيك». مفيش حاجة بتتغيّر قبلها.', 'The agent, or the main agent for another agent, proposes the change in the chat as a card, and it reaches Omar in “مستنيك”. Nothing changes before that.'))}</p></div></div>
    ${chg.length ? `<div class="panel-card">${chg.map((C) => `<button type="button" class="panel-row" data-action="sov-thread" data-thread="${C.thread}">${face(C.agent, 28)}
      <span class="panel-row__text"><span class="panel-row__t">${bx(`${AGENTS[C.agent].name} · ${chgWhat(C)}`)}</span><span class="panel-row__d">${bx(C.by === C.agent ? lng('اقترحه لنفسه', 'Proposed it for itself') : `${AGENTS[C.by].name} ${lng('اقترحه', 'proposed it')}`)}</span></span>
      ${C.status === 'pending' ? `<span class="panel-row__meta${isOwner() ? ' panel-row__meta--wait' : ''}">${isOwner() ? `<span class="dot dot--waiting" aria-hidden="true"></span>${lng('مستنيك', 'Waiting on you')}` : lng('مستني عمر', 'Waiting for Omar')}</span>` : `<span class="panel-row__meta">${icon(C.status === 'approved' ? 'check' : 'x')}${C.status === 'approved' ? lng('اتوافق', 'Approved') : lng('اترفض', 'Declined')}</span>`}</button>`).join('')}</div>` : ''}</section>`;
  const F = state.lnFilter;
  const all = LEARNED.filter(lnVisible);
  /* «اقتراحات التعلّم»: what members taught an agent for the team, and what agents propose, waiting for the Owner or a Manager */
  const sugg = all.filter((L) => L.status === 'pending' || (L.by && L.decidedAt)).sort((x, y) => y.ord - x.ord);
  const suggest = `<section class="dp-sec ln-sugg" aria-labelledby="ln-h-sug"><h4 class="dp-label" id="ln-h-sug"><span>${lng('اقتراحات التعلّم', 'Learning suggestions')} <span class="muted num">${all.filter((L) => L.status === 'pending').length}</span></span></h4>
    <p class="set-hint">${bx(isSolo() ? lng('اللي بتقوله للوكيل بيتحفظ على طول. هنا بس اللي الوكلاء اقترحوه لنفسهم وهم على «يستأذن الأول».', 'What you tell an agent is saved at once. Here is only what agents proposed for themselves while on “Asks first”.')
      : mgr ? (isOwner() ? lng('لما عضو يعلّم وكيل حاجة للفريق، بتستنى هنا لحد ما انت أو سارة توافقوا. اللي بتقوله انت أو سارة بيتطبّق على طول.', 'When a member teaches an agent something for the team, it waits here until you or Sara approve it. What you or Sara say applies at once.')
        : lng('لما عضو يعلّم وكيل حاجة للفريق، بتستنى هنا لحد ما انتي أو عمر توافقوا. اللي بتقوليه انتي أو عمر بيتطبّق على طول.', 'When a member teaches an agent something for the team, it waits here until you or Omar approve it. What you or Omar say applies at once.'))
      : lng('لما تعلّم وكيل حاجة للفريق، بتستنى هنا لحد ما عمر أو سارة يوافقوا. في شغلك انت بيمشي بيها من دلوقتي.', 'When you teach an agent something for the team, it waits here until Omar or Sara approve it. In your own work it follows it from now.'))}</p>
    ${sugg.length ? `<ol class="panel-card ln-list">${sugg.map(lnRowHTML).join('')}</ol>` : `<div class="panel-card"><p class="panel-empty">${lng('مفيش اقتراحات مستنية دلوقتي.', 'No suggestions waiting right now.')}</p></div>`}</section>`;
  const rest = all.filter((L) => !sugg.includes(L));
  const fl = [['all', lng('الكل', 'All'), rest.length], ['note', lng('ملاحظات', 'Notes'), rest.filter((L) => L.kind === 'note').length], ['skill', lng('مهارات', 'Skills'), rest.filter((L) => L.kind !== 'note').length]];
  if (!fl.some(([k]) => k === F)) state.lnFilter = 'all';
  const list = rest.filter((L) => state.lnFilter === 'all' || (state.lnFilter === 'note' ? L.kind === 'note' : L.kind !== 'note')).sort((x, y) => y.ord - x.ord);
  const recent = `<section class="dp-sec" aria-labelledby="ln-h-rec"><h4 class="dp-label" id="ln-h-rec"><span>${lng('اتعلّموا إيه مؤخراً', 'What they learned recently')}</span>
      ${canWrite() && visibleAgents().some((a) => !isMain(a)) ? `<button type="button" class="link-btn" data-action="sov-try" data-agent="${canSee('ads') ? 'ads' : visibleAgents().find((a) => !isMain(a))}" data-text="افتكر إن إعلانات الرياض بتبدأ بـ «تبغى» مش «عايز»">${lng('جرّب تعلّم وكيل حاجة', 'Try teaching an agent something')}</button>` : ''}</h4>
    <div class="od-rail tpl-cats" role="group" aria-label="${lng('فلتر', 'Filter')}">${fl.map(([k, l, n]) => `<button type="button" class="chip chip--text" id="ln-f-${k}" data-action="ln-filter" data-mode="${k}" aria-pressed="${state.lnFilter === k}">${l}<span class="chip__n num">${n}</span></button>`).join('')}</div>
    ${list.length ? `<ol class="panel-card ln-list">${list.map(lnRowHTML).join('')}</ol>` : `<div class="panel-card"><p class="panel-empty">${lng('مفيش حاجة هنا دلوقتي. الوكلاء بيتعلّموا من الشغل، وأول ما حد يحفظ أو يقترح حاجة هتلاقيها هنا.', 'Nothing here right now. Agents learn from the work; as soon as one saves or proposes something, you’ll find it here.')}</p></div>`}</section>`;
  return sovHead(lng('التعلّم', 'Learning'), lng('الوكلاء بيتحسّنوا لوحدهم: بيحفظوا ملاحظات، وبيكتبوا ويحسّنوا مهاراتهم من الشغل. انت بتختار يتعلّموا لوحدهم ولا يستأذنوا الأول.', 'Agents get better on their own: they save notes and write or improve their skills from the work. You choose whether they learn on their own or ask first.'))
    + sovRO() + suggest + co + per + recent + rules;
}
function sovSkillHTML(L) {
  const Sk = L.skill; const A = AGENTS[L.agent]; const mgr = canManage();
  const th = L.thread && threads[L.thread] && threadVisible(threads[L.thread]) ? threads[L.thread] : null;
  const v = Sk.vers; const two = v.length > 1 && L.status !== 'pending';
  const cur = Sk.ver || v.length;
  const head2 = (x) => x.split(' ').slice(0, 2).join(' ');
  const stepsHTML = (arr, other, mark) => `<ol>${arr.map((s) => {
    const diff = other && !other.includes(s); const edited = diff && other.some((o) => !arr.includes(o) && head2(o) === head2(s));
    const tag = !diff ? '' : edited ? lng('اتعدّلت', 'Edited') : mark === 'new' ? lng('جديدة', 'New') : lng('اتشالت', 'Removed');
    return `<li class="${diff ? (mark === 'new' ? 'is-new' : 'is-gone') : ''}">${diff ? `<span class="sk-tag${mark === 'new' ? ' sk-tag--new' : ''}">${tag}</span>` : ''}${bx(s)}</li>`; }).join('')}</ol>`;
  const body = two
    ? `<div class="sk-diff"><section class="sk-col${cur === 1 ? ' is-cur' : ''}" aria-labelledby="sk-h-1"><h4 id="sk-h-1">${lng('قبل · نسخة 1', 'Before · version 1')}${cur === 1 ? ` · ${lng('شغالة دلوقتي', 'in use now')}` : ''}</h4>${stepsHTML(v[0], v[1], 'gone')}</section>
        <section class="sk-col${cur === 2 ? ' is-cur' : ''}" aria-labelledby="sk-h-2"><h4 id="sk-h-2">${lng('بعد · نسخة 2', 'After · version 2')}${cur === 2 ? ` · ${lng('شغالة دلوقتي', 'in use now')}` : ''}</h4>${stepsHTML(v[1], v[0], 'new')}</section></div>`
    : `<div class="sk-diff sk-diff--one"><section class="sk-col is-cur" aria-labelledby="sk-h-1"><h4 id="sk-h-1">${lng('الخطوات', 'Steps')}${L.status === 'pending' ? ` · ${lng('مقترحة', 'proposed')}` : ` · ${lng('نسخة', 'version')} ${cur}`}</h4>${stepsHTML(v[cur - 1] || v[0])}</section></div>`;
  const acts = [];
  if (th) acts.push(`<button type="button" class="btn btn--secondary btn--sm" data-action="sov-thread" data-thread="${th.id}">${icon('chat')}<span>${lng('افتح المحادثة', 'Open the chat')}</span></button>`);
  if (L.status === 'pending' && mgr) {
    acts.push(`<button type="button" class="btn btn--secondary btn--sm" data-action="ln-reject" data-learn="${L.id}" id="ln-no-${L.id}">${lng('ارفض', 'Decline')}</button>`);
    acts.push(`<button type="button" class="btn btn--primary btn--sm" data-action="ln-approve" data-learn="${L.id}" id="ln-ok-${L.id}">${lng('ضيفها', 'Add it')}</button>`);
  }
  if (two && mgr) acts.push(`<button type="button" class="btn btn--secondary btn--sm" data-action="ln-revert" data-learn="${(L.kind === 'skillup' ? L : LEARNED.find((x) => x.kind === 'skillup' && x.skill === Sk) || L).id}" id="ln-rev-${L.id}">${icon('repeat')}<span>${cur === 2 ? lng('رجّع النسخة اللي قبلها', 'Go back to the previous version') : lng('رجّع نسخة 2', 'Restore version 2')}</span></button>`);
  const learnedAt = LEARNED.find((x) => x.kind === 'skill' && x.skill === Sk);
  const upAt = LEARNED.find((x) => x.kind === 'skillup' && x.skill === Sk);
  const story = L.status === 'pending' ? `${A.name} ${lng('كتب المهارة دي ومستني موافقة', 'wrote this skill and is waiting for an OK')} · ${L.at}`
    : `${A.name} ${lng('اتعلّمها لوحده', 'learned it on its own')}${learnedAt ? ` ${learnedAt.at}` : ''}${upAt ? ` ${lng('وحسّنها', 'and improved it')} ${upAt.at}` : ''}.`;
  return `${sovBack('sov-skill-back', lng('التعلّم', 'Learning'))}
    ${sovHead(`<bdi>${esc(Sk.t)}</bdi>`, story)}
    <div class="sk-who">${face(L.agent, 24)}<span>${bx(`${lng('مهارة عند', 'A skill of')} ${A.name} · ${LEARN_T[learnModeOf(L.agent)]}`)}</span></div>
    ${body}
    ${(upAt || L).why ? `<div class="sk-why"><b>${lng('ليه', 'Why')}</b><p dir="rtl">${bx((L.kind === 'skill' && L.status !== 'pending' && upAt ? upAt : L).why)}</p></div>` : ''}
    ${acts.length ? `<div class="sk-acts">${acts.join('')}</div>` : ''}
    <p class="set-hint">${lng('أي رجوع لنسخة قبلها بيتكتب في السجل، وتقدر ترجّع النسخة الجديدة تاني في أي وقت.', 'Going back to a version is written in the log, and you can restore the newer one any time.')}</p>`;
}
function lnApprove(L, yes) {
  if (!L || L.status !== 'pending' || !canManage()) return;
  const A = AGENTS[L.agent];
  if (yes) {
    if (L.kind === 'rule') { L.rule = addRule(L.agent, L.text, L.by || state.as); }
    else if (L.kind === 'note') { const m = mem(L.g || 'lessons', L.by ? 'told' : 'learned', L.text, `${L.by && PEOPLE[L.by] ? PEOPLE[L.by].first : `${lng('من', 'From')} ${threads[L.thread] && threadVisible(threads[L.thread]) ? threads[L.thread].title : lng('الشغل', 'the work')}`} · ${lng('النهارده', 'Today')}`); if (L.by) m.by = L.by; A.memory.unshift(m); L.mem = m; }
    else { A.skills.push(L.skill); if (state.drafts[L.agent]) state.drafts[L.agent].skills.push(true); }
    L.status = 'saved'; L.decidedAt = nowTime(); L.decidedBy = state.as;
    const told = L.kind === 'rule' || L.kind === 'note';
    logAuto(ME(), meAct(told ? (L.by ? `وافق على اللي علّمه ${AR_FIRST[L.by] || ''} لـ` : 'وافق على ملاحظة اقترحها') : 'وافق على مهارة اقترحها', told ? (L.by ? `وافقت على اللي علّمه ${AR_FIRST[L.by] || ''} لـ` : 'وافقت على ملاحظة اقترحها') : 'وافقت على مهارة اقترحها', told ? (L.by ? `approved what ${PEOPLE[L.by].first} taught` : 'approved a note proposed by') : 'approved a skill proposed by'), { agent: L.agent, obj: A.name, to: told ? `${L.text} · ${lng('للفريق كله', 'for the whole team')}` : L.skill.t });
    if (L.by && threads[L.thread]) { const t = threads[L.thread]; t.msgs.push({ id: nid('n'), role: 'note', icon: 'check', saved: true, text: `${me().first} ${lng('وافق، وبقت للفريق كله:', 'approved it, now for the whole team:')} «${L.text}»` }); t.unread = t.unread || {}; t.unread[L.by] = (t.unread[L.by] || 0) + 1; }
    toast(L.kind === 'rule' ? `${lng('القاعدة بقت للفريق كله عند', 'The rule now applies team-wide for')} ${A.name}` : L.kind === 'note' ? `${lng('اتحفظت في ذاكرة', 'Saved to the memory of')} ${A.name}` : `${lng('المهارة اتضافت لـ', 'The skill was added to')} ${A.name}`);
  } else {
    L.status = 'rejected'; L.decidedAt = nowTime(); L.decidedBy = state.as;
    logAuto(ME(), meAct('رفض حاجة اقترحها', 'رفضت حاجة اقترحها', 'declined something proposed by'), { agent: L.agent, obj: A.name, to: L.kind === 'note' || L.kind === 'rule' ? L.text : L.skill.t });
    if (L.by && threads[L.thread]) { const t = threads[L.thread]; t.msgs.push({ id: nid('n'), role: 'note', icon: 'x', text: `${me().first} ${lng('مش موافق تبقى للفريق. هتفضل في شغلك انت بس.', 'didn’t approve it for the team. It stays in your own work only.')}` }); t.unread = t.unread || {}; t.unread[L.by] = (t.unread[L.by] || 0) + 1; }
    toast(`${A.name} ${lng('مش هيحفظها', 'won’t save it')}`, 'x');
  }
  renderSov();
}
function lnForget(L, back) {
  if (!L || !L.mem || !canWrite()) return;
  const list = AGENTS[L.agent].memory;
  if (!back) { const i = list.indexOf(L.mem); if (i >= 0) { list.splice(i, 1); L.memAt = i; } L.status = 'forgotten'; }
  else { if (!list.includes(L.mem)) list.splice(Math.min(L.memAt || 0, list.length), 0, L.mem); L.status = 'saved'; }
  logAuto(ME(), back ? meAct('رجّع ملاحظة لذاكرة', 'رجّعت ملاحظة لذاكرة', 'brought back a note to') : meAct('خلّى وكيل ينسى ملاحظة', 'خلّت وكيل ينسى ملاحظة', 'made an agent forget a note'), { agent: L.agent, obj: AGENTS[L.agent].name, to: L.mem.t });
  renderSov();
  toast(back ? lng('الملاحظة رجعت', 'Note restored') : `${AGENTS[L.agent].name} ${lng('نسي الملاحظة دي', 'forgot this note')}`, back ? 'check' : 'x', back ? null : { action: 'ln-unforget-t', label: lng('رجّعها', 'Undo') });
  state.lnLastForget = L.id;
}
function lnRevert(L) {
  if (!L || L.kind !== 'skillup' || !canManage()) return;
  const Sk = L.skill; const back = Sk.ver === L.to;
  Sk.ver = back ? L.from : L.to; L.status = back ? 'reverted' : 'saved';
  logAuto(ME(), back ? meAct('رجّع مهارة لنسخة قبلها', 'رجّعت مهارة لنسخة قبلها', 'reverted a skill to its previous version') : meAct('رجّع النسخة الجديدة من مهارة', 'رجّعت النسخة الجديدة من مهارة', 'restored the newer version of a skill'), { agent: L.agent, obj: Sk.t, from: `${lng('نسخة', 'Version')} ${back ? L.to : L.from}`, to: `${lng('نسخة', 'Version')} ${Sk.ver}` });
  renderSov();
  toast(back ? `${AGENTS[L.agent].name} ${lng('رجع لنسخة', 'is back on version')} ${Sk.ver} ${lng('من', 'of')} «${Sk.t}»` : `${lng('نسخة', 'Version')} ${Sk.ver} ${lng('رجعت تشتغل', 'is back in use')}`, 'repeat');
}

/* ---- الاشتراك والموديلات ---- */
const SUBS = [
  { k: 'claude', name: 'Claude', main: true, by: 'omar', since: lng('من 1 أكتوبر', 'Since Oct 1'), model: 'Opus 5.5' },
  { k: 'openai', name: 'ChatGPT', by: 'omar', since: lng('من 12 أكتوبر', 'Since Oct 12'), model: 'GPT-5' },
  { k: 'gemini', name: 'Gemini', by: 'sara', since: lng('من 3 نوفمبر', 'Since Nov 3'), model: 'Gemini 2.5 Pro' },
];
function sovModelsHTML() {
  const mgr = canManage(); const own = isOwner();
  const subs = `<section class="dp-sec" aria-labelledby="md-h-sub"><h4 class="dp-label" id="md-h-sub"><span>${lng('اشتراكات الذكاء الاصطناعي المتوصلة بالشركة', 'The company’s connected AI subscriptions')}</span></h4>
    <div class="panel-card">${SUBS.map((s) => { const users = AGENT_ORDER.filter((a) => AGENTS[a].model === s.model); const by = inWs(s.by) ? s.by : state.as; return `<div class="panel-row">${tile(s.k)}
      <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(s.name)}</bdi>${s.main ? ` <span class="badge sov-badge">${lng('الأساسي', 'Main')}</span>` : ''}</span>
      <span class="panel-row__d">${bx(`${lng('متوصل باسم', 'Connected by')} ${PEOPLE[by].first} · ${s.since} · ${lng('بيشغّل', 'Runs')} ${s.model}`)}</span></span>
      <span class="panel-row__meta">${users.length ? `${faceStack(users.filter(canSee), 18)}<span><span class="num">${users.length}</span> ${users.length === 1 ? lng('وكيل', 'agent') : lng('وكلاء', 'agents')}</span>` : `<span>${lng('مفيش وكيل عليه دلوقتي', 'No agent on it right now')}</span>`}</span>
      ${own ? `<button type="button" class="link-btn" data-action="sub-manage" data-k="${s.k}">${lng('إدارة', 'Manage')}</button>` : ''}</div>`; }).join('')}</div>
    <p class="set-hint">${bx(lng('الوكلاء بيشتغلوا باشتراكات الشركة دي. بتوصّل الاشتراك مرة واحدة بتسجيل الدخول، ومفيش مفاتيح ولا ملفات تحطّها بنفسك.', 'The agents run on these company subscriptions. You connect a subscription once by signing in; there are no keys or files to set up yourself.'))}</p></section>`;
  const def = `<section class="dp-sec" aria-labelledby="md-h-def"><h4 class="dp-label" id="md-h-def"><span>${lng('الموديل الافتراضي لأي وكيل جديد', 'Default model for any new agent')}</span></h4>
    <div class="panel-card" role="radiogroup" aria-labelledby="md-h-def">${MODELS.map((m) => { const on = m.n === state.defModel; return mgr
      ? `<button type="button" class="panel-row" role="radio" aria-checked="${on}" data-action="mdl-default" data-model="${esc(m.n)}" id="mdl-${m.logo}" style="min-height:44px"><span class="panel-row__icon">${tile(m.logo)}</span><span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(m.n)}</bdi></span><span class="panel-row__d">${esc(m.d)}</span></span>${on ? `<span class="panel-row__meta">${icon('check')}</span>` : ''}</button>`
      : `<div class="panel-row"><span class="panel-row__icon">${tile(m.logo)}</span><span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(m.n)}</bdi></span><span class="panel-row__d">${esc(m.d)}</span></span>${on ? `<span class="panel-row__meta">${icon('check')}${lng('الافتراضي', 'Default')}</span>` : ''}</div>`; }).join('')}</div></section>`;
  const eff = EFFORTS.find((e) => e.k === state.defEffort) || EFFORTS[1];
  const effort = `<section class="dp-sec" aria-labelledby="md-h-eff"><h4 class="dp-label" id="md-h-eff"><span>${lng('قد إيه يفكر قبل ما يرد (الافتراضي)', 'How much it thinks before replying (default)')}</span></h4>
    <div class="panel-card set-card"><div class="set-field">${mgr ? `<div class="segmented segmented--field" role="radiogroup" aria-labelledby="md-h-eff">${EFFORTS.map((e) => `<button type="button" role="radio" id="mdl-eff-${e.k}" aria-checked="${e.k === state.defEffort}" tabindex="${e.k === state.defEffort ? 0 : -1}" data-action="mdl-effort" data-effort="${e.k}">${e.l}</button>`).join('')}</div>` : `<p class="ro-text">${eff.l}</p>`}
      <span class="set-hint" aria-live="polite">${bx(eff.h)}</span></div></div></section>`;
  const each = `<section class="dp-sec" aria-labelledby="md-h-each"><h4 class="dp-label" id="md-h-each"><span>${lng('كل وكيل', 'Each agent')}</span></h4>
    <div class="panel-card">${visibleAgents().map((a) => { const A = AGENTS[a]; const e = EFFORTS.find((x) => x.k === A.effort) || EFFORTS[1]; return `<button type="button" class="panel-row" data-action="sov-agent" data-agent="${a}" id="mdl-ag-${a}">${face(a, 28)}
      <span class="panel-row__text"><span class="panel-row__t"><bdi>${esc(A.name)}</bdi></span><span class="panel-row__d">${bx(`${A.model} · ${e.l}${A.model !== state.defModel ? ` · ${lng('مختلف عن الافتراضي', 'differs from the default')}` : ''}`)}</span></span>
      <span class="panel-row__meta">${mgr ? lng('غيّر', 'Change') : lng('شوف', 'View')}</span><span class="panel-row__icon sov-chev">${icon('chevron')}</span></button>`; }).join('')}</div>
    <p class="set-hint">${bx(lng('الافتراضي بيتطبّق على الوكلاء الجداد. أي وكيل تقدر تغيّر موديله من إعداداته، ولو الوكيل نفسه اللي عايز يغيّره بيستنى موافقة المالك.', 'The default applies to new agents. You can change any agent’s model from its settings; if the agent itself wants to change it, it waits for the Owner’s OK.'))}</p></section>`;
  return sovHead(lng('الاشتراك والموديلات', 'Subscription and models'), lng('الاشتراك اللي الوكلاء بيشتغلوا بيه، والموديل ومستوى التفكير اللي أي وكيل جديد بيبدأ بيهم.', 'The subscription the agents run on, and the model and thinking level every new agent starts with.')) + sovRO() + subs + def + effort + each;
}

/* ---- التطبيقات: the existing catalogue, as it is ---- */
function sovAppsInit() { state.apps = { q: '', cat: 'all', view: null, pick: [], off: false, err: false, opener: null }; $('#apps-inner').innerHTML = ''; }
const sovAppsHTML = () => `<div class="apps-inner sov-apps" id="sov-apps" aria-live="polite"></div>`;

/* ---- المهام المتكررة: every agent's routines in one list ---- */
function sovRoutinesHTML() {
  const ags = visibleAgents().filter((a) => AGENTS[a].routines.length);
  const all = ags.reduce((n, a) => n + AGENTS[a].routines.length, 0);
  const on = ags.reduce((n, a) => n + AGENTS[a].routines.filter((r) => r.on).length, 0);
  const secs = ags.map((a) => `<section class="dp-sec" aria-labelledby="rt-h-${a}"><h4 class="dp-label" id="rt-h-${a}"><span class="sov-ag-l">${face(a, 20)}<bdi>${esc(AGENTS[a].name)}</bdi> <span class="muted num">${AGENTS[a].routines.length}</span></span>
      ${canWrite() ? `<button type="button" class="link-btn" data-action="sov-try" data-agent="${a}" data-text="${esc(routineExample(a))}">${lng('ضيف مهمة', 'Add a task')}</button>` : ''}</h4>
    <ul class="panel-card">${AGENTS[a].routines.map((r, i) => routineRowHTML(a, r, i)).join('')}</ul></section>`).join('');
  const sub = `${on} ${lng('شغالة من', 'on out of')} ${all} · ${lng('عند', 'across')} ${ags.length} ${lng('وكلاء', 'agents')}. ${lng('مهمة جديدة بتتعمل بجملة في الشات مع الوكيل، زي «ملخص الليدز كل يوم 8 الصبح».', 'A new task is made with one sentence in the agent’s chat, like “ملخص الليدز كل يوم 8 الصبح”.')}`;
  return sovHead(lng('المهام المتكررة', 'Recurring tasks'), sub) + (secs || `<div class="panel-card"><p class="panel-empty">${lng('مفيش مهام متكررة لسه. اكتب للوكيل في الشات اللي عايزه يتكرر، وهو يظبطه لوحده.', 'No recurring tasks yet. Write what you want repeated in the agent’s chat, and it sets it up on its own.')}</p></div>`);
}

/* ---- الاستهلاك: tokens per agent (demo numbers) ---- */
const USAGE = { '7': { lead: 0.92, ads: 3.4, seo: 2.7, analyst: 1.9, critic: 1.15 }, '30': { lead: 3.8, ads: 14.1, seo: 11.6, analyst: 7.2, critic: 4.9 } };
const RATE = { 'Opus 5.5': 0.62, 'GPT-5': 0.38, 'Gemini 2.5 Pro': 0.3 }; // demo EGP per 1,000 tokens
const useOf = (a, p) => (USAGE[p][a] != null ? USAGE[p][a] : 0.04 * (p === '30' ? 1 : 0.4));
const tokTxt = (mil) => (mil >= 1 ? `${fmt1(mil)} ${lng('مليون', 'M')}` : `${fmt(Math.round(mil * 1000))} ${lng('ألف', 'K')}`);
function sovUsageHTML() {
  const p = state.useP; const ags = visibleAgents();
  const rows = ags.map((a) => ({ a, mil: useOf(a, p), cost: Math.round(useOf(a, p) * 1000 * (RATE[AGENTS[a].model] || 0.5)) })).sort((x, y) => y.mil - x.mil);
  const tot = rows.reduce((s, r) => s + r.mil, 0); const cost = rows.reduce((s, r) => s + r.cost, 0); const max = Math.max(...rows.map((r) => r.mil), 0.01);
  const top = rows[0];
  const seg = `<div class="segmented use-seg" role="group" aria-label="${lng('الفترة', 'Period')}">${[['7', lng('آخر 7 أيام', 'Last 7 days')], ['30', lng('آخر 30 يوم', 'Last 30 days')]].map(([k, l]) => `<button type="button" aria-pressed="${p === k}" data-action="use-period" data-p="${k}" id="use-p-${k}">${l}</button>`).join('')}</div>`;
  const kpis = `<div class="od-grid kpis use-kpis"><div class="kpi od-stat"><span class="kpi__label">${lng('التوكنز', 'Tokens')}</span><span class="kpi__val num">${tokTxt(tot)}</span></div>
    <div class="kpi od-stat"><span class="kpi__label">${lng('التكلفة التقريبية', 'Estimated cost')}</span><span class="kpi__val num">${kpiMoney(fmt(cost))}</span></div>
    <div class="kpi od-stat"><span class="kpi__label">${lng('أكتر وكيل استهلاك', 'Heaviest agent')}</span><span class="kpi__val"><bdi>${top ? esc(AGENTS[top.a].name) : '—'}</bdi></span></div></div>`;
  const list = `<section class="dp-sec" aria-labelledby="use-h"><h4 class="dp-label" id="use-h"><span>${lng('لكل وكيل', 'Per agent')}</span></h4>
    <ul class="panel-card use-list" role="list">${rows.map((r) => `<li class="use-row"><span class="use-who">${face(r.a, 28)}<span class="od-field"><bdi class="panel-row__t">${esc(AGENTS[r.a].name)}</bdi><span class="panel-row__d"><bdi>${esc(AGENTS[r.a].model)}</bdi></span></span></span>
      <span class="bar use-bar" role="img" aria-label="${esc(AGENTS[r.a].name)}: ${Math.round((r.mil / tot) * 100)}%"><span class="bar__fill" style="transform:scaleX(${(r.mil / max).toFixed(3)})"></span></span>
      <span class="use-num od-field"><span class="num">${tokTxt(r.mil)}</span><span class="num">${egp(fmt(r.cost))} · <bdi dir="ltr">${Math.round((r.mil / tot) * 100)}%</bdi></span></span></li>`).join('')}</ul>
    <p class="demo-note">${lng('أرقام تجريبية للنموذج، مش من فاتورة الاشتراك الحقيقية. التكلفة تقدير بأسعار تجريبية لكل موديل.', 'Sample numbers for this prototype, not from the real subscription bill. Cost is an estimate at sample per-model prices.')}</p></section>`;
  return sovHead(lng('الاستهلاك', 'Usage'), canManage() ? lng('كل وكيل استهلك قد إيه من الاشتراك، وتكلفته التقريبية بالجنيه.', 'How much of the subscription each agent used, and its rough cost in EGP.') : lng('استهلاك الوكلاء اللي بتشتغل معاهم.', 'Usage of the agents you work with.'), seg) + kpis + list;
}

/* ---- النسخ الاحتياطي ---- */
const BACKUPS = [
  { at: lng('النهارده · 3:00 ص', 'Today · 3:00 AM'), kind: 'auto', size: '48 MB' },
  { at: lng('امبارح · 3:00 ص', 'Yesterday · 3:00 AM'), kind: 'auto', size: '47 MB' },
  { at: lng('الاتنين 9 نوفمبر · 3:00 ص', 'Mon Nov 9 · 3:00 AM'), kind: 'auto', size: '46 MB' },
  { at: lng('الأحد 8 نوفمبر · 6:40 م', 'Sun Nov 8 · 6:40 PM'), kind: 'manual', by: 'omar', size: '46 MB' },
];
function sovBackupHTML() {
  const S = state.sov; const mgr = canManage(); const own = isOwner(); const run = state.backupRun;
  const last = BACKUPS[0];
  const now = `<div class="panel-card bk-now"><span class="ln-ic" aria-hidden="true">${icon('archive')}</span><div class="od-fill od-field"><span class="panel-row__t">${lng('آخر نسخة:', 'Last backup:')} ${esc(last.at)}</span>
      <span class="panel-row__d">${last.kind === 'auto' ? lng('تلقائية', 'Automatic') : `${lng('يدوي ·', 'Manual ·')} ${esc(PEOPLE[last.by] ? PEOPLE[last.by].first : '')}`} · <bdi dir="ltr" class="num">${last.size}</bdi> · ${lng('كله سليم', 'All good')}</span></div>
    ${run ? `<div class="bk-run" role="status"><span class="bk-run__t">${lng('بياخد نسخة…', 'Backing up…')} <span class="num">${run.pct}%</span></span><span class="bar" role="progressbar" aria-label="${lng('النسخة', 'Backup')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${run.pct}"><span class="bar__fill" style="transform:scaleX(${run.pct / 100})"></span></span></div>`
      : mgr ? `<button type="button" class="btn btn--primary btn--sm" data-action="bk-now" id="bk-now">${lng('خد نسخة دلوقتي', 'Back up now')}</button>` : ''}</div>`;
  const auto = `<div class="panel-card"><div class="panel-row"><span class="panel-row__text"><span class="panel-row__t" id="bk-auto-t">${lng('نسخة تلقائية كل يوم 3 الفجر', 'Automatic backup every day at 3 AM')}</span><span class="panel-row__d">${lng('بنحتفظ بآخر 30 يوم. النسخة بتتاخد والوكلاء شغالين عادي.', 'We keep the last 30 days. Backups run while the agents keep working.')}</span></span>
    ${mgr ? `<button type="button" class="switch" role="switch" id="bk-auto" aria-checked="${state.backupAuto}" aria-labelledby="bk-auto-t" data-action="bk-auto"></button>` : `<span class="panel-row__meta">${state.backupAuto ? lng('شغالة', 'On') : lng('مقفولة', 'Off')}</span>`}</div></div>`;
  const what = `<section class="dp-sec" aria-labelledby="bk-h-in"><h4 class="dp-label" id="bk-h-in"><span>${lng('النسخة فيها إيه', 'What a backup holds')}</span></h4>
    <div class="ln-rules"><div class="panel-card ln-rule"><b>${icon('check')}${lng('فيها', 'Included')}</b><ul><li>${lng('المحادثات والقنوات', 'Chats and channels')}</li><li>${lng('اللوحة والسجل', 'The board and the log')}</li><li>${lng('ذاكرة الوكلاء ومهاراتهم', 'Agents’ memory and skills')}</li><li>${lng('معرفة الشركة والإعدادات', 'Company knowledge and settings')}</li></ul></div>
      <div class="panel-card ln-rule"><b>${icon('x')}${lng('مش فيها', 'Not included')}</b><ul><li>${lng('تسجيل الدخول للتطبيقات المتوصلة: بتوصّلها تاني بعد الرجوع', 'Sign-ins to connected apps: you reconnect them after a restore')}</li><li>${lng('أي حاجة على حسابات الإعلانات نفسها', 'Anything on the ad accounts themselves')}</li></ul></div></div></section>`;
  const list = `<section class="dp-sec" aria-labelledby="bk-h-list"><h4 class="dp-label" id="bk-h-list"><span>${lng('النسخ', 'Backups')} <span class="muted num">${BACKUPS.length}</span></span></h4>
    <ul class="panel-card">${BACKUPS.map((b, i) => `<li class="panel-row"><span class="panel-row__icon">${icon(b.kind === 'auto' ? 'clock' : 'user')}</span><span class="panel-row__text"><span class="panel-row__t">${esc(b.at)}</span><span class="panel-row__d">${b.kind === 'auto' ? lng('تلقائية', 'Automatic') : `${lng('يدوي ·', 'Manual ·')} ${esc(PEOPLE[b.by] ? PEOPLE[b.by].first : '')}`} · <bdi dir="ltr" class="num">${b.size}</bdi></span></span>
      ${own && i > 0 ? `<button type="button" class="link-btn" data-action="bk-restore" data-idx="${i}" id="bk-rs-${i}" aria-expanded="${S.restore === i}">${lng('رجّع للنسخة دي', 'Restore this')}</button>` : ''}</li>
      ${S.restore === i ? `<li class="danger-confirm" role="group" aria-label="${lng('تأكيد الرجوع', 'Confirm restore')}"><p>${bx(`${lng('المساحة هترجع زي ما كانت', 'The workspace goes back to how it was on')} ${b.at}. ${lng('هناخد نسخة من دلوقتي الأول، عشان لو غيّرت رأيك ترجعلها.', 'We take a backup of now first, so you can come back to it if you change your mind.')}`)}</p>
        <div class="panel-form__row panel-form__row--end"><button type="button" class="btn btn--secondary btn--sm" data-action="bk-restore-cancel" data-idx="${i}">${lng('إلغاء', 'Cancel')}</button><button type="button" class="btn btn--primary btn--sm" data-action="bk-restore-go" data-idx="${i}" id="bk-go-${i}">${lng('رجّع', 'Restore')}</button></div></li>` : ''}`).join('')}</ul>
    ${own ? '' : `<p class="set-hint">${bx(`${lng('الرجوع لنسخة قديمة بيعمله', 'Restoring an older backup is done by')} ${lng('عمر (المالك) بس.', 'Omar (Owner) only.')}`)}</p>`}</section>`;
  return sovHead(lng('النسخ الاحتياطي', 'Backups'), lng('نسخة من كل حاجة في المساحة، عشان لو حاجة اتمسحت أو اتلخبطت ترجعلها.', 'A copy of everything in the workspace, so you can go back if something gets deleted or mixed up.')) + sovRO() + now + auto + list + what;
}
function backupNow() {
  if (state.backupRun || !canManage()) return;
  state.backupRun = { pct: 0 };
  const step = () => {
    if (!state.backupRun) return;
    state.backupRun.pct = Math.min(100, state.backupRun.pct + 17 + Math.floor(Math.random() * 10));
    if (state.backupRun.pct >= 100) {
      state.backupRun = null;
      BACKUPS.unshift({ at: `${lng('النهارده ·', 'Today ·')} ${nowTime()}`, kind: 'manual', by: state.as, size: '48 MB' });
      logAuto(ME(), meAct('خد نسخة احتياطية', 'خدت نسخة احتياطية', 'took a backup'), { to: '48 MB' });
      if (state.sov && state.sov.sec === 'backup') { renderSov(); const b = $('#bk-now'); if (b) b.focus(); }
      toast(lng('النسخة اتاخدت وكلها سليمة', 'Backup done and all good'), 'archive');
      return;
    }
    if (state.sov && state.sov.sec === 'backup') {
      const bar = $('.bk-run [role="progressbar"]'); const t = $('.bk-run__t .num');
      if (bar) { bar.setAttribute('aria-valuenow', state.backupRun.pct); $('.bar__fill', bar).style.transform = `scaleX(${state.backupRun.pct / 100})`; }
      if (t) t.textContent = `${state.backupRun.pct}%`;
    }
    later(380, step);
  };
  if (state.sov && state.sov.sec === 'backup') renderSov();
  later(300, step);
}

/* ---- حسابك ---- */
function sovAccountHTML() {
  const Q = me(); const dark = document.documentElement.dataset.theme === 'dark';
  const roleD = Q.role === 'owner' ? lng('بيشوف كل الوكلاء، وبيوافق على كل حاجة، وهو بس اللي يوافق على تغيير موديل أو أدوات أي وكيل.', 'Sees every agent, approves everything, and is the only one who approves a change to any agent’s model or tools.') : ROLE_D[Q.role];
  return sovHead(lng('حسابك', 'Your account'), lng('اسمك ودورك في الشركة، ولغة الواجهة وشكلها.', 'Your name and role in the company, and the interface language and look.'))
    + `<div class="panel-card"><div class="panel-row">${personAv(state.as, 40)}<span class="panel-row__text"><span class="panel-row__t">${esc(Q.name)}</span><span class="panel-row__d">${esc(Q.title)}${Q.job ? ` · ${esc(Q.job)}` : ''} · <bdi>${esc(state.companyName)}</bdi></span></span></div>
      <div class="panel-row"><span class="panel-row__icon">${icon('shield')}</span><span class="panel-row__text"><span class="panel-row__t">${lng('دورك:', 'Your role:')} ${esc(Q.title)}</span><span class="panel-row__d">${bx(roleD)}</span></span></div></div>
    <section class="dp-sec" aria-labelledby="ac-h-th"><h4 class="dp-label" id="ac-h-th"><span>${lng('الشكل', 'Appearance')}</span></h4>
      <div class="panel-card set-card"><div class="segmented segmented--field" role="radiogroup" aria-labelledby="ac-h-th">${[['light', lng('فاتح', 'Light')], ['dark', lng('غامق', 'Dark')]].map(([k, l]) => { const on = (k === 'dark') === dark; return `<button type="button" role="radio" id="ac-th-${k}" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-action="sov-theme" data-mode="${k}">${icon(k === 'dark' ? 'moon' : 'sun')}<span>${l}</span></button>`; }).join('')}</div></div></section>
    <section class="dp-sec" aria-labelledby="ac-h-lang"><h4 class="dp-label" id="ac-h-lang"><span>${lng('لغة الواجهة', 'Interface language')}</span></h4>
      <div class="panel-card" role="radiogroup" aria-labelledby="ac-h-lang">${LANGS.map((l) => `<button type="button" class="panel-row" role="radio" aria-checked="${l.k === LANG}" data-action="set-lang" data-lang="${l.k}"><span class="panel-row__text"><span class="panel-row__t lang-native" lang="${l.k}" dir="${l.k === 'ar' ? 'rtl' : 'ltr'}">${l.name}</span><span class="panel-row__d">${l.d()}</span></span>${l.k === LANG ? `<span class="panel-row__meta">${icon('check')}</span>` : ''}</button>`).join('')}</div>
      <p class="set-hint">${lng('المحادثات مع الوكلاء بتفضل بالعربي في اللغتين.', 'Chats with your agents stay in Arabic in both.')}</p></section>`;
}

/* ---- open, move, close ---- */
function openSov(sec, opts) {
  opts = opts || {};
  closeMeMenu(false);
  const op = opts.opener || document.activeElement;
  const S = { sec: sec || '', agent: null, agentTab: opts.tab || 'settings', know: opts.know || 'voice', knowEdit: null, knowDraft: null, skill: null, coDraft: null, restore: null, leave: null,
    opener: op, openerSel: op && op.id ? `#${op.id}` : op && op.matches && op.matches('#details [data-action="dp-settings"]') ? '#details [data-action="dp-settings"]' : null };
  if (!sovHas(S.sec)) S.sec = sovHas('company') ? 'company' : sovSecs()[0].k;
  if (opts.agent && AGENTS[opts.agent] && canSee(opts.agent)) { S.sec = 'agents'; S.agent = opts.agent; }
  if (opts.skill && sovHas('learning')) { S.sec = 'learning'; S.skill = opts.skill; }
  state.sov = S; state.dpConfirm = null; state.memEditing = null; state.memAdding = false; state.memQuery = '';
  if (S.sec === 'apps') sovAppsInit();
  $('#details').innerHTML = ''; delete $('#details').dataset.viewKey; // rebuilt on close: no duplicate fields behind the overlay
  showDlg($('#sov'));
  renderSov();
  { const f0 = (opts.focus && document.getElementById(opts.focus)) || (S.agent && $(`#sov-tab-${S.agentTab}`)) || (S.skill && $('#sov-back')) || $(`#sov-nav-${S.sec}`); if (f0) f0.focus({ preventScroll: true }); }
  window.requestAnimationFrame(() => {
    const f = (opts.focus && document.getElementById(opts.focus)) || (S.agent && $(`#sov-tab-${S.agentTab}`)) || (S.skill && $('#sov-back')) || $(`#sov-nav-${S.sec}`);
    if (f) { f.focus({ preventScroll: true }); if (opts.focus) scrollInPanel(f); }
    if (opts.spot) { const r = document.getElementById(opts.spot); if (r) { scrollInPanel(r); r.classList.add('is-spot'); window.setTimeout(() => r.classList.remove('is-spot'), 1600); } }
  });
}
function sovDirty() {
  const S = state.sov; if (!S) return false;
  if (S.sec === 'agents' && S.agent && canManage() && isDirty(S.agent)) { nudgeSaveBar(); return true; }
  if (S.knowEdit && S.knowDraft != null && S.knowDraft.trim() !== ((KNOW.find((x) => x.k === S.knowEdit) || {}).body || '').trim()) {
    toast(lng('احفظ الصفحة أو الغي التعديل الأول', 'Save the page or cancel the edit first')); const b = $('#know-save'); if (b) b.focus(); return true;
  }
  return false;
}
function sovGo(sec, extra) {
  const S = state.sov; if (!S || !sovHas(sec)) return false;
  if (sovDirty()) return false;
  if (S.agent && state.drafts[S.agent] && !isDirty(S.agent)) delete state.drafts[S.agent];
  Object.assign(S, { sec, agent: null, skill: null, knowEdit: null, knowDraft: null, restore: null, coDraft: null }, extra || {});
  state.dpConfirm = null; state.memEditing = null; state.memAdding = false; state.memQuery = '';
  if (sec === 'apps') sovAppsInit(); else if (state.apps && !$('#apps').open) state.apps = null;
  renderSov();
  const m = $('#sov-main'); if (m) m.scrollTop = 0;
  return true;
}
function sovClose(leave) {
  const S = state.sov; if (!S) return;
  if (sovDirty()) return;
  if (leave) S.leave = leave;
  closeDlg($('#sov'));
}
$('#sov').addEventListener('cancel', (e) => { e.preventDefault(); sovClose(); });
$('#sov').addEventListener('close', () => {
  const S = state.sov; state.sov = null;
  if (S && S.agent && state.drafts[S.agent] && !isDirty(S.agent)) delete state.drafts[S.agent];
  if (state.apps && !$('#apps').open) state.apps = null;
  state.dpConfirm = null; state.memEditing = null; state.memAdding = false;
  $('#sov-inner').innerHTML = '';
  rerenderAll(); if (state.view === 'chat' && !$('#details .dp-top')) renderDetailsPanel();
  syncDetailsVisibility();
  if (S && S.leave) { S.leave(); return; }
  const o = (S && S.openerSel && $(S.openerSel)) || (S && S.opener && document.body.contains(S.opener) ? S.opener : null) || $('#btn-me');
  if (o) o.focus();
});
/* leave the overlay for a place in the workspace (a chat, the gallery) */
const sovLeave = (fn) => { if (state.sov) sovClose(fn); else fn(); };

/* ---- events ---- */
/* capture: the gear and «إعدادات صباح الخير» open the overlay instead of flipping the details panel */
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset; const inSov = !!el.closest('#sov');
  if (d.action === 'dp-settings') {
    e.stopPropagation();
    if (inSov) { if (!sovDirty()) { const a = state.sov.agent; delete state.drafts[a]; state.sov.agent = null; renderSov(); const b = $(`#sov-ag-${a}`); if (b) b.focus(); } }
    else openSov('agents', { agent: detailsAgent(), opener: el });
  } else if (d.action === 'checkin-settings') {
    e.stopPropagation(); openSov('agents', { agent: state.main, focus: 'set-ck-time', opener: el });
  } else if (d.action === 'open-apps' && inSov) {
    e.stopPropagation(); sovGo('apps');
  } else if (d.action === 'apps-close' && inSov) {
    e.stopPropagation();
  }
}, true);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset; const S = state.sov;
  const C = d.pid ? CHG[d.pid] : null; const L = d.learn ? lnById(d.learn) : null;
  switch (d.action) {
    case 'sov-open': openSov(d.sec || '', { opener: $('#btn-me') }); break;
    case 'sov-close': sovClose(); break;
    case 'sov-know': if (!sovHas('knowledge')) break; if (S) { if (sovGo('knowledge')) { const b = $(`#know-tab-${S.know}`); if (b) b.focus(); } } else openSov('knowledge', { opener: el }); break;
    case 'sov-sec': if (S && (S.sec !== d.sec || S.agent || S.skill) && sovGo(d.sec)) { const b = $(`#sov-nav-${d.sec}`); if (b) b.focus(); } break;
    case 'sov-agent': if (S) { if (S.sec !== 'agents') { if (sovDirty()) break; S.sec = 'agents'; } S.agent = d.agent; S.agentTab = 'settings'; state.dpConfirm = null; renderSov(); const m = $('#sov-main'); if (m) m.scrollTop = 0; const b = $('#sov-tab-settings'); if (b) b.focus(); } break;
    case 'sov-agent-open': if (S) { S.sec = 'agents'; S.agent = d.agent; S.agentTab = 'settings'; renderSov(); } else openSov('agents', { agent: d.agent, opener: el }); break;
    case 'sov-agent-back': if (S && !sovDirty()) { const a = S.agent; delete state.drafts[a]; S.agent = null; state.dpConfirm = null; renderSov(); const b = $(`#sov-ag-${a}`); if (b) b.focus(); } break;
    case 'sov-agent-tab': if (S && S.agentTab !== d.tab) { if (S.agentTab === 'settings' && sovDirty()) break; if (S.agent && !isDirty(S.agent)) delete state.drafts[S.agent]; S.agentTab = d.tab; state.memEditing = null; state.memAdding = false; state.memQuery = ''; renderSov(); const b = $(`#sov-tab-${d.tab}`); if (b) b.focus(); } break;
    case 'sov-mem': {
      if (!canSee(d.agent)) break;
      if (S) { if (sovDirty()) break; Object.assign(S, { sec: 'agents', agent: d.agent, agentTab: 'memory', skill: null }); renderSov(); const m = $('#sov-main'); if (m) m.scrollTop = 0; const b = $('#sov-tab-memory'); if (b) b.focus(); }
      else openSov('agents', { agent: d.agent, tab: 'memory', opener: el });
      break;
    }
    case 'sov-learn': {
      if (!L || !sovHas('learning')) break;
      if (L.kind === 'note' || L.kind === 'rule') { if (S) { if (!sovGo('learning')) break; const r = $(`#ln-row-${L.id}`); if (r) { scrollInPanel(r); r.classList.add('is-spot'); window.setTimeout(() => r.classList.remove('is-spot'), 1600); const f = $('button', r); if (f) f.focus({ preventScroll: true }); } } else openSov('learning', { opener: el, spot: `ln-row-${L.id}` }); }
      else if (S) { if (sovGo('learning', { skill: L.id })) { const b = $('#sov-back'); if (b) b.focus(); } }
      else openSov('learning', { skill: L.id, opener: el });
      break;
    }
    case 'sov-skill': { const Sk = SKILLS[d.skill]; const L2 = Sk && (LEARNED.find((x) => x.kind === 'skillup' && x.skill === Sk) || LEARNED.find((x) => x.skill === Sk)); if (!L2 || !sovHas('learning')) break; if (S) { if (sovGo('learning', { skill: L2.id })) { const b = $('#sov-back'); if (b) b.focus(); } } else openSov('learning', { skill: L2.id, opener: el }); break; }
    case 'sov-skill-back': if (S) { const id = S.skill; S.skill = null; renderSov(); const b = $(`#ln-see-${id}`) || $('#ln-h-rec'); if (b) b.focus(); } break;
    case 'sov-thread': { const t = threads[d.thread]; if (!t || !threadVisible(t)) break; sovLeave(() => { if ($('#sheet').open) closeSheet(); openThread(d.thread); }); break; }
    case 'sov-try': {
      const a = d.agent && canSee(d.agent) ? d.agent : state.main; const txt = d.text || '';
      sovLeave(() => {
        if ($('#sheet').open) closeSheet();
        state.chatThread = null; state.newChatAgent = a; setView('chat');
        const ta = $('#ta-main'); if (ta) { ta.value = txt; syncComposer('main'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        toast(`${lng('دوس إرسال، و', 'Press send, and ')}${AGENTS[a].name}${lng(' هيحفظها أو يظبطها', ' saves or sets it up')}`, 'compose');
      });
      break;
    }
    case 'sov-new-agent': sovLeave(() => openLeadForAgent()); break;
    case 'co-name-save': {
      const inp = $('#co-name'); if (!inp || !canManage()) break; const v = inp.value.trim();
      if (!v) { const er = $('#co-name-err'); if (er) er.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); break; }
      const old = state.companyName; state.companyName = v; S.coDraft = null;
      logAuto(ME(), meAct('غيّر اسم الشركة', 'غيّرت اسم الشركة', 'renamed the company'), { from: old, to: v });
      renderSov(); { const b = $('#co-name'); if (b) b.focus(); }
      toast(`${lng('اسم الشركة بقى', 'The company is now called')} ${v}`); break;
    }
    case 'know-page': if (S && S.know !== d.page) { if (sovDirty()) break; S.know = d.page; S.knowEdit = null; S.knowDraft = null; renderSov(); const b = $(`#know-tab-${d.page}`); if (b) b.focus(); } break;
    case 'know-edit': if (S && canManage()) { S.knowEdit = S.know; S.knowDraft = null; renderSov(); const t = $('#know-edit'); if (t) { t.focus(); t.setSelectionRange(0, 0); t.scrollTop = 0; } } break;
    case 'know-cancel': if (S) { S.knowEdit = null; S.knowDraft = null; renderSov(); const b = $('#know-edit-btn'); if (b) b.focus(); } break;
    case 'know-save': saveKnow(); break;
    case 'ln-company': {
      if (!canManage() || LEARN.company === d.mode) break; const was = LEARN.company; LEARN.company = d.mode;
      logAuto(ME(), meAct('غيّر طريقة تعلّم الوكلاء', 'غيّرت طريقة تعلّم الوكلاء', 'changed how the agents learn'), { from: LEARN_T[was], to: LEARN_T[d.mode] });
      renderSov(); toast(`${lng('كل الوكلاء اللي على «زي الشركة» بقوا:', 'Every agent on “company” now:')} ${LEARN_T[d.mode]}`); break;
    }
    case 'ln-agent': {
      if (!canManage() || !AGENTS[d.agent]) break; const was = LEARN.per[d.agent] || 'company'; if (was === d.mode) break; LEARN.per[d.agent] = d.mode;
      const lbl = (k) => (k === 'company' ? `${lng('زي الشركة', 'Same as the company')} (${LEARN_T[LEARN.company]})` : LEARN_T[k]);
      logAuto(ME(), meAct('غيّر طريقة تعلّم', 'غيّرت طريقة تعلّم', 'changed how this agent learns:'), { agent: d.agent, obj: AGENTS[d.agent].name, from: lbl(was), to: lbl(d.mode) });
      renderSov(); toast(`${AGENTS[d.agent].name}: ${LEARN_T[learnModeOf(d.agent)]}`); break;
    }
    case 'ln-filter': if (S) { state.lnFilter = d.mode; renderSov(); const b = $(`#ln-f-${d.mode}`); if (b) b.focus(); } break;
    case 'ln-forget': lnForget(L, false); { const b = L && $(`#ln-forget-${L.id}`); if (b) b.focus(); } break;
    case 'ln-unforget': lnForget(L, true); { const b = L && $(`#ln-forget-${L.id}`); if (b) b.focus(); } break;
    case 'ln-unforget-t': { const L2 = lnById(state.lnLastForget); if (L2 && L2.status === 'forgotten') { $('#toast-host').innerHTML = ''; lnForget(L2, true); } break; }
    case 'ln-revert': lnRevert(L); { const b = $(`#ln-rev-${S && S.skill ? S.skill : d.learn}`) || $(`#ln-rev-${d.learn}`); if (b) b.focus(); } break;
    case 'ln-approve': lnApprove(L, true); { const b = $(`#ln-see-${d.learn}`) || $(`#ln-forget-${d.learn}`) || $('#ln-h-rec'); if (b) b.focus(); } break;
    case 'ln-reject': lnApprove(L, false); { const b = $(`#ln-see-${d.learn}`) || $('#ln-h-rec'); if (b) b.focus(); } break;
    case 'mdl-default': {
      if (!canManage() || state.defModel === d.model) break; const was = state.defModel; state.defModel = d.model;
      logAuto(ME(), meAct('غيّر الموديل الافتراضي', 'غيّرت الموديل الافتراضي', 'changed the default model'), { from: was, to: d.model });
      renderSov(); toast(`${lng('أي وكيل جديد هيبدأ بـ', 'Every new agent starts with')} ${d.model}`); break;
    }
    case 'mdl-effort': {
      if (!canManage() || state.defEffort === d.effort) break; const l = (k) => (EFFORTS.find((x) => x.k === k) || {}).l || k; const was = state.defEffort; state.defEffort = d.effort;
      logAuto(ME(), meAct('غيّر مستوى التفكير الافتراضي', 'غيّرت مستوى التفكير الافتراضي', 'changed the default thinking level'), { from: l(was), to: l(d.effort) });
      renderSov(); { const b = $(`#mdl-eff-${d.effort}`); if (b) b.focus(); } break;
    }
    case 'sub-manage': { const s = SUBS.find((x) => x.k === d.k); toast(`${lng('في النسخة الحقيقية دي بتفتح صفحة الاشتراك عند', 'In the real product this opens the subscription page at')} ${s ? s.name : ''}${lng('. تسجيل الدخول بيبقى في نافذتهم، والباسورد مبيعدّيش علينا', '. You sign in in their window; the password never passes through us')}`, 'open'); break; }
    case 'use-period': if (S && state.useP !== d.p) { state.useP = d.p; renderSov(); const b = $(`#use-p-${d.p}`); if (b) b.focus(); } break;
    case 'bk-now': backupNow(); break;
    case 'bk-auto': if (canManage()) { state.backupAuto = !state.backupAuto; logAuto(ME(), meAct('غيّر النسخة التلقائية', 'غيّرت النسخة التلقائية', 'changed automatic backups'), { from: state.backupAuto ? lng('مقفولة', 'Off') : lng('شغالة', 'On'), to: state.backupAuto ? lng('شغالة', 'On') : lng('مقفولة', 'Off') }); renderSov(); const b = $('#bk-auto'); if (b) b.focus(); } break;
    case 'bk-restore': if (S && isOwner()) { const i = Number(d.idx); S.restore = S.restore === i ? null : i; renderSov(); const b = $(S.restore === i ? `#bk-go-${i}` : `#bk-rs-${i}`); if (b) b.focus(); } break;
    case 'bk-restore-cancel': if (S) { const i = S.restore; S.restore = null; renderSov(); const b = $(`#bk-rs-${i}`); if (b) b.focus(); } break;
    case 'bk-restore-go': if (S) { const i = S.restore; S.restore = null; renderSov(); const b = $(`#bk-rs-${i}`); if (b) b.focus(); toast(lng('ده نموذج، الرجوع لنسخة مش شغال فيه. المساحة زي ما هي', 'This is a prototype, so restoring doesn’t work here. The workspace is as it was'), 'x'); } break;
    case 'sov-theme': {
      const dark = d.mode === 'dark'; if ((document.documentElement.dataset.theme === 'dark') === dark) break;
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      try { localStorage.setItem('gtm-theme-v2', dark ? 'dark' : 'light'); } catch (err) { /* in memory only */ }
      renderSidebar(); renderSov(); { const b = $(`#ac-th-${d.mode}`); if (b) b.focus(); } break;
    }
    /* the change-proposal card */
    case 'chg-approve': if (C) approveChg(C.id, d.edited === '1'); break;
    case 'chg-edit': if (C && isOwner()) { C.mode = 'edit'; C.draft = { tool: C.tool, access: C.access, model: C.model }; chgRefresh(C, C.kind === 'tool' ? `chg-tool-${C.id}-${C.tool}` : `chg-mdl-${C.id}-${MODELS.findIndex((x) => x.n === C.model)}`); } break;
    case 'chg-edit-cancel': if (C) { C.mode = null; C.draft = null; chgRefresh(C, `chg-edit-${C.id}`); } break;
    case 'chg-reject-open': if (C && isOwner()) { C.mode = 'reject'; C.reasonErr = false; chgRefresh(C, `chg-why-${C.id}`); } break;
    case 'chg-reject-cancel': if (C) { C.mode = null; C.reasonErr = false; chgRefresh(C, `chg-no-${C.id}`); } break;
    case 'chg-reject': if (C) rejectChg(C.id); break;
    case 'chg-tool': if (C && C.draft) { C.draft.tool = d.k; chgRefresh(C, el.id); } break;
    case 'chg-access': if (C && C.draft) { C.draft.access = d.k; chgRefresh(C, el.id); } break;
    case 'chg-model': if (C && C.draft) { C.draft.model = d.model; chgRefresh(C, el.id); } break;
    default: break;
  }
});
/* after any click inside the overlay: if the control that had focus was re-rendered, focus its new copy */
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('#sov [data-action]'); if (!el) return;
  const keys = ['agent', 'idx', 'conn', 'model', 'effort', 'mode', 'sec', 'page', 'learn', 'tab', 'mem', 'kind', 'speed', 'p'];
  const sel = el.id ? `#${CSS.escape(el.id)}` : `[data-action="${el.dataset.action}"]${keys.filter((k) => el.dataset[k] != null).map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('')}`;
  window.requestAnimationFrame(() => {
    if (!state.sov) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && document.body.contains(ae)) return;
    const n = $(`#sov ${sel}`) || $('#sov-back') || $(`#sov-nav-${state.sov.sec}`);
    if (n) n.focus({ preventScroll: true });
  });
});
document.addEventListener('input', (e) => {
  const t = e.target; const S = state.sov;
  if (t.id === 'know-edit' && S) { S.knowDraft = t.value; if (t.value.trim()) { const er = $('#know-edit-err'); if (er) er.hidden = true; t.removeAttribute('aria-invalid'); } return; }
  if (t.id === 'co-name' && S) { S.coDraft = t.value; const b = $('#co-name-save'); if (b) b.disabled = !t.value.trim() || t.value.trim() === state.companyName; if (t.value.trim()) { const er = $('#co-name-err'); if (er) er.hidden = true; t.removeAttribute('aria-invalid'); } return; }
  const f = t.dataset && t.dataset.chg; if (!f) return;
  const C = CHG[t.dataset.pid]; if (!C) return;
  if (f === 'reason') { C.reasonDraft = t.value; if (t.value.trim() && C.reasonErr) { C.reasonErr = false; const er = $(`#chg-why-err-${C.id}`); if (er) er.hidden = true; t.removeAttribute('aria-invalid'); } }
});
document.addEventListener('keydown', (e) => {
  const t = e.target; const S = state.sov;
  if (t.id === 'know-edit' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (S) { S.knowEdit = null; S.knowDraft = null; renderSov(); const b = $('#know-edit-btn'); if (b) b.focus(); } return; }
  if (t.id === 'know-edit' && e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveKnow(); return; }
  if (t.id === 'co-name' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const b = $('#co-name-save'); if (b && !b.disabled) b.click(); return; }
  /* arrows inside radio groups and tabs drawn in the overlay */
  if (!e.defaultPrevented && S && t.closest && t.closest('#sov') && /^Arrow(Left|Right)$/.test(e.key) && (t.getAttribute('role') === 'radio' || t.getAttribute('role') === 'tab') && t.closest('.segmented, .cr-kinds')) {
    const grp = t.closest('.segmented, .cr-kinds'); const items = $$('[role="radio"], [role="tab"]', grp); const i = items.indexOf(t);
    const dir = (e.key === 'ArrowLeft') === RTL ? 1 : -1; const nx = items[(i + dir + items.length) % items.length];
    if (nx && nx !== t && !(/^(set-effort|set-speed)$/.test(t.dataset.action || ''))) { e.preventDefault(); nx.click(); }
  }
});

/* ================= Coder: the company's site work, as one more agent =================
   Later in the rollout a company can run its software work in gtmworks through a coding agent. It is one more agent,
   not a second product: added from the private gallery (never there by default), shown only to members allowed to
   see it, and its work is a code card on the same marketing board, in the same columns, with a small «كود» mark.
   A code card carries the request (what, why, acceptance points), who builds it, the merge request, and the tests /
   review / merge states. Coder builds, tests, opens a merge request and stops: it never merges or deploys. The merge is
   handed to a person («اتسلّمتلك» + «عملتها»). When it needs the person it asks one plain question on the card, the card
   waits in «مستنيك», and it carries on after the answer. Every step writes the same log as every other card. */
Object.assign(ICONS, {
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>',
  merge: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="12" r="2"/><path d="M7 7.5v9"/><path d="M7 7.5c0 3.5 3 4.5 8 4.5"/>',
});
CONNS.gitlab = { name: 'GitLab', mark: 'GL', d: lng('كود موقع RS Learning', 'RS Learning website code') };
state.conns.gitlab = 'connected';
/* calm stone face; the brackets over the eyes are its own mark */
FACES.coder = { bg: '#E4E4E2', ink: '#262626', parts: '<path d="M12.6 7.2l-2.4 2.3 2.4 2.3M19.4 7.2l2.4 2.3-2.4 2.3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.4" cy="15.4" r="1.8" stroke="none"/><circle cx="19.6" cy="15.4" r="1.8" stroke="none"/><path d="M13 21.2h6" stroke-width="1.8" stroke-linecap="round"/>' };
const CODER_EX = 'صفحة «المحاسب الشامل» محتاجة سطر فوق زرار التسجيل فيه ميعاد الدفعة الجديدة: 1 ديسمبر، عشان الناس بتسأل على واتساب عن الميعاد.';
AGENTS.coder = {
  name: 'Coder', handle: '@Coder', role: lng('وكيل الكود', 'Coding agent'), kind: 'team',
  desc: lng('بيبني أي تغيير في موقع RS Learning من طلب مكتوب، بيشغّل الاختبارات، وبيفتح طلب دمج ويقف. عمره ما بيدمج ولا بينزّل على الموقع لوحده.', 'Builds any change to the RS Learning website from a written request, runs the tests, opens a merge request and stops. It never merges or deploys on its own.'),
  line: lng('بيبني التغيير اللي تكتبه في موقع RS Learning، بيشغّل الاختبارات، وبيفتح طلب دمج ويقف.', 'Builds the change you write down on the RS Learning website, runs the tests, opens a merge request and stops.'),
  handoff: lng('مش بيدمج ولا بينزّل على الموقع لوحده. بيفتح طلب الدمج ويقف، وحد من الفريق يراجع ويدمج.', 'Never merges or deploys on its own. It opens the merge request and stops; someone on the team reviews and merges.'),
  example: CODER_EX,
  conns: ['gitlab'], toolsOn: { gitlab: true },
  routines: [{ t: 'تشغيل اختبارات الموقع كله', d: 'كل يوم 7:00 الصبح', on: true, sched: { kind: 'daily', h: 7, m: 0 } }],
  files: [{ n: 'دليل-كود-الموقع.md', d: lng('12 KB · من كريم', '12 KB · from Karim') }],
  perms: [], model: 'Opus 5.5', effort: 'high', paused: false,
  instr: 'كل طلب على فرع لوحده، وطلب دمج واحد لكل طلب.\nشغّل الاختبارات كلها قبل ما تطلب مراجعة، ولو حاجة وقعت صلّحها الأول.\nأي تغيير بيلمس الدفع أو الأسعار علّم عليه «حساس».\nماتدمجش وماتنزّلش على الموقع أبداً.',
  skills: [
    { t: lng('بناء تغيير من طلب مكتوب', 'Building a change from a written request'), d: lng('بيقرا نقط القبول ويكتب الكود على فرع لوحده', 'Reads the acceptance points and writes the code on its own branch'), on: true },
    { t: lng('الاختبارات', 'Tests'), d: lng('بيشغّلها قبل طلب الدمج، ولو وقعت بيصلّحها', 'Runs them before the merge request, and fixes what fails'), on: true },
    { t: lng('التغييرات الحساسة', 'Sensitive changes'), d: lng('الدفع والأسعار بيستنّوا مراجعة زيادة', 'Payment and prices wait for an extra review'), on: true },
  ],
  memory: [
    mem('lessons', 'learned', 'صفحات الحجز والدفع لازم تتجرّب على مقاس الموبايل الأول، أغلب الزيارات منه.', lng('من طلبات نوفمبر', 'From November requests')),
    mem('banned', 'told', 'ماتلمسش إعدادات بوابة الدفع نفسها. التغيير في صفحات الموقع بس.', lng('عمر · 3 نوفمبر', 'Omar · Nov 3')),
  ],
  voiceLang: 'ar-EG', voice: 'yassin', voiceSpeed: '1',
};
LEARN.per.coder = 'ask';
VOICE_SAMPLE.coder = CODER_EX;
TEMPLATES.push({ id: 'coder', agent: 'coder', cat: 'code', role: lng('وكيل كود للموقع', 'Website coding agent'), name: 'Coder', look: { shape: 'round', color: 'stone' }, kind: 'team', conns: ['gitlab'],
  line: AGENTS.coder.line,
  /* alone, the merge is handed to you; in a team, to someone on the team */
  get handoff() { return isSolo() ? lng('مش بيدمج ولا بينزّل على الموقع لوحده. بيفتح طلب الدمج ويقف، وانت تراجع وتدمج.', 'Never merges or deploys on its own. It opens the merge request and stops; you review and merge.') : AGENTS.coder.handoff; },
  example: CODER_EX, routineEx: 'شغّل اختبارات الموقع كله كل يوم 7 الصبح وقولي لو حاجة وقعت',
  skills: [[lng('من طلب مكتوب لطلب دمج', 'From a written request to a merge request'), lng('إيه وليه ونقط القبول', 'What, why and the acceptance points')], [lng('الاختبارات قبل المراجعة', 'Tests before review'), lng('ولو حاجة وقعت بيصلّحها الأول', 'If something fails, it fixes it first')]],
  reply: 'تمام. ابعتلي الطلب مكتوب: إيه اللي عايزه في الموقع، وليه، وإزاي هنعرف إنه اشتغل. هفتحله كارت على اللوحة وأبدأ.' });

/* which workspaces Coder was added to (RS Learning added it on 3 Nov; a workspace that starts alone hasn't) */
state.coderIn = { team: true, solo: false };
state.boardKind = 'all';
function syncCoder() {
  if (!AGENTS.coder) return;
  const want = !!state.coderIn[state.world]; const i = AGENT_ORDER.indexOf('coder');
  if (want && i < 0) AGENT_ORDER.push('coder');
  if (!want && i >= 0) AGENT_ORDER.splice(i, 1);
  if (!canSee('coder')) state.boardKind = 'all';
}
syncCoder();

/* ---- words, marks and states ---- */
const MR_REPO = 'rs-learning/website';
let mrSeq = 241;
const LRI = (s) => `\u2066${s}\u2069`;          // keeps «!241» and branch names in their order inside Arabic lines
const mrTxt = (n) => LRI(`!${n}`);
const mrHTML = (n) => `<bdi dir="ltr" class="cx-mono">!${n}</bdi>`;
const teamOr = (solo, team) => (isSolo() ? solo : team);
const CST_ICON = { passed: 'check', failed: 'x', waiting: 'clock', notes: 'pencil', ok: 'check', merged: 'merge' };
const testsWord = (T) => ({ running: lng('شغالة', 'Running'), passed: lng('نجحت', 'Passed'), failed: lng('وقعت', 'Failed'), none: lng('لسه', 'Not yet') })[T.st];
const reviewWord = (R) => ({ none: lng('لسه', 'Not yet'), waiting: lng('مستني مراجعة', 'Waiting for review'), notes: lng(`فيه ملاحظات ${R.n}`, `${R.n} notes`), ok: lng('اتراجع', 'Reviewed') })[R.st];
const mergeWord = (M) => ({ waiting: lng('مستني', 'Waiting'), merged: lng('اندمج', 'Merged') })[M.st];
function cstHTML(kind, o) {
  const word = kind === 'tests' ? testsWord(o) : kind === 'review' ? reviewWord(o) : mergeWord(o);
  const ic = o.st === 'running' ? '<span class="dot dot--working" aria-hidden="true"></span>' : CST_ICON[o.st] ? icon(CST_ICON[o.st]) : '';
  return `<span class="cst cst--${o.st}">${ic}<span>${word}</span></span>`;
}
function codeMarksHTML(c, inSheet) {
  const sens = c.code.sensitive ? `<span class="kmark kmark--sens">${icon('shield')}<span>${lng('حساس', 'Sensitive')}</span></span>` : '';
  const html = `<span class="kmark">${icon('code')}<span>${lng('كود', 'Code')}</span></span>${sens}`;
  return inSheet ? html : `<span class="kcard__kind" aria-hidden="true">${html}</span>`;
}
function codeRowsHTML(c) {
  const K = c.code;
  const row = (l, h) => `<span class="kc-st__r"><span class="kc-st__l">${l}</span>${h}</span>`;
  return `<span class="kc-st" aria-hidden="true">${row(lng('الاختبارات', 'Tests'), cstHTML('tests', K.tests))}${row(lng('المراجعة', 'Review'), cstHTML('review', K.review))}${row(lng('الدمج', 'Merge'), cstHTML('merge', K.merge))}</span>`;
}
/* the card is one button: its name carries the kind, «حساس» and the three states */
const codeAria = (c) => { const K = c.code; return `${K.sensitive ? ` · ${lng('حساس', 'Sensitive')}` : ''} · ${lng('الاختبارات:', 'Tests:')} ${testsWord(K.tests)} · ${lng('المراجعة:', 'Review:')} ${reviewWord(K.review)} · ${lng('الدمج:', 'Merge:')} ${mergeWord(K.merge)}`; };
const mkCode = (o) => Object.assign({ what: '', why: '', accept: [], by: 'omar', back: 0, branch: '', mr: null, sensitive: false, sensWhy: '',
  tests: { st: 'none' }, review: { st: 'none' }, merge: { st: 'waiting' }, ask: null, hand: null, notes: [] }, o, { accept: (o.accept || []).map(([t, ok]) => ({ t, ok: !!ok })) });

/* ---- the board filter: الكل / تسويق / كود (only where Coder is shown) ---- */
function kindFilterHTML() {
  if (!canSee('coder')) return '';
  const k = state.boardKind || 'all';
  const n = (kd) => cards.filter((c) => cardVisible(c) && (kd === 'code') === !!c.code).length;
  return `<div class="segmented kind-seg" role="group" aria-label="${lng('نوع الكروت', 'Card type')}">${[['all', lng('الكل', 'All')], ['mkt', lng('تسويق', 'Marketing')], ['code', lng('كود', 'Code')]].map(([v, l]) => `<button type="button" data-action="kind-filter" data-kind="${v}" aria-pressed="${k === v}">${v === 'code' ? icon('code') : ''}<span>${l}</span>${v !== 'all' ? `<span class="num kind-seg__n">${n(v)}</span>` : ''}</button>`).join('')}</div>`;
}

/* ---- Coder's empty chat: what it does, in four steps, and where it stops ---- */
function coderEmptyHTML() {
  const A = AGENTS.coder;
  const steps = [
    [lng('انت بتكتب الطلب', 'You write the request'), lng('إيه اللي عايزه، وليه، ونقط القبول', 'What you want, why, and the acceptance points')],
    [lng('بيبني التغيير', 'It builds the change'), lng('على فرع لوحده، من غير ما يلمس الموقع', 'On its own branch, without touching the live site')],
    [lng('بيشغّل الاختبارات', 'It runs the tests'), lng('ولو حاجة وقعت بيصلّحها الأول', 'If something fails, it fixes it first')],
    [lng('بيفتح طلب دمج ويقف', 'It opens a merge request and stops'), teamOr(lng('المراجعة والدمج عندك انت', 'Review and merge stay with you'), lng('المراجعة والدمج عند حد من الفريق', 'Review and merge stay with someone on the team'))],
  ];
  const nCode = cards.filter((c) => c.code && cardVisible(c)).length;
  return `<div class="transcript__col"><div class="empty-chat empty-chat--agent coder-empty">
    <div class="empty-chat__faces">${face('coder', 64)}</div>
    <h2><bdi>${esc(A.name)}</bdi></h2>
    <p class="empty-chat__role">${bx(A.role)}${isSolo() ? '' : ` · ${KIND_TXT.team}`}</p>
    <p>${bx(lng('بيبني أي تغيير في موقع RS Learning من طلب مكتوب: بيكتب الكود، بيشغّل الاختبارات، بيفتح طلب دمج ويقف.', 'Builds any change to the RS Learning website from a written request: it writes the code, runs the tests, opens a merge request and stops.'))}</p>
    <ol class="coder-steps">${steps.map(([t, d], i) => `<li class="coder-step"><span class="coder-step__n num" aria-hidden="true">${i + 1}</span><span class="coder-step__t"><b>${bx(t)}</b><span>${bx(d)}</span></span></li>`).join('')}</ol>
    <p class="empty-chat__hand">${icon('hand')}<span>${bx(teamOr(lng('عمره ما بيدمج ولا بينزّل على الموقع لوحده. الدمج والنزول بيتسلّموا ليك انت.', 'It never merges or deploys on its own. Merging and deploying are handed to you.'), lng('عمره ما بيدمج ولا بينزّل على الموقع لوحده. الدمج والنزول بيتسلّموا لحد من الفريق.', 'It never merges or deploys on its own. Merging and deploying are handed to someone on the team.')))}</span></p>
    <div class="try-one"${canWrite() ? '' : ' hidden'}><span class="try-one__l">${lng('جرّب تبدأ بالطلب ده', 'Try starting with this request')}</span>
      <button type="button" class="try-one__btn" data-action="suggest" data-text="${esc(CODER_EX)}">${bx(CODER_EX)}</button></div>
    ${nCode ? `<button type="button" class="link-btn coder-empty__board" data-action="coder-board">${icon('board')}<span>${lng('شوف كروت الكود على اللوحة', 'See the code cards on the board')}</span><span class="num">${nCode}</span></button>` : ''}
  </div></div>`;
}

/* ---- the card sheet: «الطلب» ---- */
const QUICK = ['آه، على التقسيط كمان: كل قسط 680 ج', 'لا، على الدفع مرة واحدة بس'];
const firstOf = (p) => (p && PEOPLE[p] && inWs(p) ? esc(PEOPLE[p].first) : '');
function codeReqHTML(c) {
  const K = c.code; const W = canWrite();
  let top = '';
  /* 1) one plain question, when Coder is blocked on the person */
  if (K.ask && K.ask.status === 'pending') {
    const A = K.ask;
    top += `<div class="card cx-card cx-ask" role="group" aria-labelledby="cx-ask-t">
      <div class="hcard__top"><span class="badge badge--wait"><span class="dot dot--waiting" aria-hidden="true"></span>${W ? lng('مستنيك', 'Waiting on you') : lng('مستني الفريق', 'Waiting on the team')}</span></div>
      <div class="card__head">${face('coder', 28)}<div class="card__titles"><span class="card__title" id="cx-ask-t">${bx(lng('Coder وقف وعنده سؤال واحد', 'Coder stopped with one question'))}</span><span class="card__sub">${bx(lng('مش هيكمّل في السعر قبل ما حد يجاوب', 'It won’t go on with the price until someone answers'))} · <span class="num">${esc(A.at)}</span></span></div></div>
      <p class="cx-q" dir="rtl">${bx(A.q)}</p>
      ${W ? `<div class="cx-ans">
        <div class="cx-quick" role="group" aria-label="${lng('إجابات جاهزة', 'Ready answers')}">${QUICK.map((q) => `<button type="button" class="chip chip--text" data-action="cx-fill" data-text="${esc(q)}">${bx(q)}</button>`).join('')}</div>
        <label class="set-label" for="cx-ans">${lng('إجابتك', 'Your answer')}</label>
        <textarea class="set-input set-textarea cx-ans__t" id="cx-ans" rows="2" dir="auto" data-card="${c.id}" placeholder="${lng('مثلاً: آه، على التقسيط كمان', 'e.g. آه، على التقسيط كمان')}" aria-describedby="cx-ans-err">${esc(A.draft || '')}</textarea>
        <span class="set-err" id="cx-ans-err" hidden>${lng('اكتب إجابتك الأول، ولو كلمة واحدة.', 'Write your answer first, even one word.')}</span></div>
      <div class="card__actions"><button type="button" class="btn btn--primary" data-action="cx-answer" data-card="${c.id}">${lng('ابعت الإجابة', 'Send the answer')}</button></div>`
      : waitLineHTML(lng('مستني حد من الفريق يجاوب', 'Waiting for someone on the team to answer'))}
    </div>`;
  }
  /* 2) the merge, handed to a person */
  if (K.hand) {
    const H = K.hand; const pend = H.status === 'pending';
    const title = `${bx(K.sensitive ? lng('راجع التغيير الحساس وادمج', 'Review the sensitive change and merge') : lng('راجع وادمج طلب الدمج', 'Review and merge'))} ${mrHTML(K.mr)}`;
    const rv = K.review.by && K.review.st === 'ok' ? firstOf(K.review.by) : '';
    const sub = K.sensitive
      ? `${rv ? `${rv} ${lng('راجعه والاختبارات نجحت.', 'reviewed it and the tests passed.')}` : lng('الاختبارات نجحت.', 'The tests passed.')} ${lng('ولأنه بيغيّر السعر في صفحة الدفع، فاضل مراجعتك انت قبل الدمج. Coder مش هيدمج لوحده.', 'Because it changes the price on the payment page, your own review is still needed before merging. Coder won’t merge on its own.')}`
      : lng('الاختبارات نجحت وCoder وقف هنا. راجع التغيير وادمجه انت، وبعدها النزول على الموقع عليكم.', 'The tests passed and Coder stopped here. Review the change and merge it; deploying to the site is up to you after that.');
    const doneBy = H.by && H.by !== state.as && firstOf(H.by) ? `${firstOf(H.by)} ${lng(gv(H.by, 'عملها', 'عملتها'), 'did it')}` : lng('عملتها', 'Done it');
    top += `<div class="card hcard cx-card${pend ? '' : ' is-resolved'}${justCls(H)}" role="group" aria-label="${lng('اتسلّمتلك:', 'Handed to you:')} ${esc(lng('الدمج', 'the merge'))} !${K.mr}">
      <div class="hcard__top"><span class="badge ck-badge">${icon('hand')}${lng('اتسلّمتلك', 'Handed to you')}</span></div>
      <div class="card__head">${tile('gitlab', true)}<div class="card__titles"><span class="card__title">${title}</span><span class="card__sub">${bx(sub)}</span></div></div>
      ${pend && !W ? waitLineHTML(lng('مستني حد من الفريق يراجع ويدمج', 'Waiting for someone on the team to review and merge'))
        : pend ? `<div class="card__actions"><button type="button" class="btn btn--secondary" data-action="cx-mr" data-card="${c.id}">${icon('open')}<span>${lng('افتح طلب الدمج', 'Open the merge request')}</span></button><button type="button" class="btn btn--primary" data-action="cx-done" data-card="${c.id}">${lng('عملتها', 'Done it')}</button></div>`
        : `<div class="card__outcome">${icon('check')}<span>${bx(`${doneBy} · ${H.at}. ${lng('اندمج، والنزول على الموقع عليكم وقت ما تحبوا.', 'Merged; deploying to the site is up to you, whenever you like.')}`)}</span></div>`}
    </div>`;
  }
  /* 3) the request: what, why, acceptance points */
  const done = K.accept.filter((a) => a.ok).length;
  const reqRows = [];
  if (K.what) reqRows.push([lng('الطلب', 'Request'), bx(K.what)]);
  if (K.why) reqRows.push([lng('ليه', 'Why'), bx(K.why)]);
  reqRows.push([lng('طلبه', 'Asked by'), `${firstOf(K.by) || lng('انت', 'You')} · ${esc(dayName(K.back || 0))}`]);
  const req = `<section class="cx-sec" aria-labelledby="cx-h-req"><h3 class="dp-label cx-h" id="cx-h-req"><span>${lng('الطلب', 'The request')}</span></h3>
    <div class="panel-card cx-box">
      <dl class="cx-kv">${reqRows.map(([k, v]) => `<div class="cx-kv__r"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="cx-acc"><h4 class="cx-acc__h">${lng('نقط القبول', 'Acceptance points')}<span class="num cx-acc__n">${done} ${lng('من', 'of')} ${K.accept.length}</span></h4>
        <ul class="cx-check">${K.accept.map((a) => `<li class="cx-check__i${a.ok ? ' is-ok' : ''}"><span class="cx-check__b" aria-hidden="true">${a.ok ? icon('check') : ''}</span><span class="cx-check__t">${bx(a.t)}${a.added ? `<span class="cx-new">${lng('اتضافت بعدين', 'Added later')}</span>` : ''}</span><span class="sr-only">${a.ok ? lng('اتعملت', 'Done') : lng('لسه', 'Not yet')}</span></li>`).join('')}</ul></div>
    </div></section>`;
  /* 4) the state: who builds it, merge request, tests, review, merge */
  const T = K.tests; const R = K.review; const M = K.merge;
  const builder = `<span class="cx-who">${face('coder', 20)}<bdi>Coder</bdi></span>${K.branch ? `<bdi dir="ltr" class="cx-mono cx-branch">${esc(K.branch)}</bdi>` : ''}`;
  const mr = K.mr ? `<button type="button" class="link-btn cx-mr" data-action="cx-mr" data-card="${c.id}" aria-label="${lng('افتح طلب الدمج', 'Open merge request')} !${K.mr}">${icon('open')}${mrHTML(K.mr)}<bdi dir="ltr" class="cx-repo">${MR_REPO}</bdi></button>`
    : `<span class="cx-none">${lng('لسه متفتحش', 'Not opened yet')}</span>`;
  const tests = `${cstHTML('tests', T)}${T.total ? `<span class="cx-meta num">${T.pass} ${lng('من', 'of')} ${T.total}</span>` : ''}${T.st === 'failed' ? `<span class="cx-fail"><span class="cx-fail__l">${lng('الاختبار اللي وقع', 'The test that failed')}</span><code class="cx-mono cx-fail__n" dir="ltr">${esc(T.fail)}</code>${T.failWhy ? `<span class="cx-fail__w">${bx(T.failWhy)}</span>` : ''}</span>` : ''}`;
  const review = `${cstHTML('review', R)}${R.by && firstOf(R.by) ? `<span class="cx-meta">${firstOf(R.by)}</span>` : ''}${R.extra ? `<span class="cx-extra">${icon('shield')}<span>${R.extra === 'done' ? lng('والمراجعة الزيادة خلصت', 'And the extra review is done') : lng('حساس: فاضل مراجعة زيادة قبل الدمج', 'Sensitive: an extra review is still needed before the merge')}</span></span>` : ''}`;
  const merge = `${cstHTML('merge', M)}${M.st === 'merged' ? `<span class="cx-meta">${esc(M.at)}${firstOf(M.by) ? ` · ${firstOf(M.by)}` : ''}</span>` : `<span class="cx-meta">${teamOr(lng('الدمج بتعمله انت، مش Coder', 'You merge, never Coder'), lng('الدمج بيعمله حد من الفريق، مش Coder', 'Someone on the team merges, never Coder'))}</span>`}`;
  const rows = [[lng('بيبنيه', 'Built by'), builder], [lng('طلب الدمج', 'Merge request'), mr], [lng('الاختبارات', 'Tests'), tests], [lng('المراجعة', 'Review'), review], [lng('الدمج', 'Merge'), merge]];
  const live = c.col === 'progress' ? `<p class="cx-live"><span class="dot dot--working" aria-hidden="true"></span><span>${bx(`${lng('Coder دلوقتي:', 'Coder now:')} ${c.ticks[c.tick % c.ticks.length]}`)}</span></p>` : '';
  const sens = K.sensitive ? `<p class="cx-sens">${icon('shield')}<span><b>${lng('حساس', 'Sensitive')}</b> · ${bx(`${K.sensWhy}. ${teamOr(lng('بعد ما الاختبارات تنجح، بيستنى مراجعتك انت قبل الدمج.', 'Once the tests pass, it waits for your own review before the merge.'), lng('بعد ما الاختبارات تنجح ومراجعة كريم، بيستنى مراجعة زيادة من عمر أو سارة قبل الدمج.', 'Once the tests pass and Karim has reviewed it, it waits for an extra review from Omar or Sara before the merge.'))}`)}</span></p>` : '';
  const status = `<section class="cx-sec" aria-labelledby="cx-h-st"><h3 class="dp-label cx-h" id="cx-h-st"><span>${lng('الحالة', 'Status')}</span><span class="badge">${esc(c.col === 'waiting' && !W ? lng('مستني الفريق', 'Waiting on the team') : colName(c.col))}</span></h3>
    ${live}${sens}<div class="panel-card"><dl class="cx-st">${rows.map(([k, v]) => `<div class="cx-st__r"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></div></section>`;
  const notes = K.notes.length ? `<section class="cx-sec" aria-labelledby="cx-h-notes"><h3 class="dp-label cx-h" id="cx-h-notes"><span>${lng('ملاحظات المراجعة', 'Review notes')} <span class="muted num">${K.notes.length}</span></span></h3>
    <ul class="panel-card cx-notes">${K.notes.map((x) => `<li class="cx-note">${inWs(x.by) ? personAv(x.by, 24) : ''}<span class="cx-note__t"><b>${firstOf(x.by)}</b><span>${bx(x.t)}</span></span><span class="cx-note__st">${x.fixed ? `${icon('check')}${lng('اتعدّلت', 'Fixed')}` : lng('بيتعدّل', 'Being fixed')}</span></li>`).join('')}</ul></section>` : '';
  /* an answered question stays on the card as a record */
  const asked = K.ask && K.ask.status === 'answered' ? `<section class="cx-sec" aria-labelledby="cx-h-ask"><h3 class="dp-label cx-h" id="cx-h-ask"><span>${lng('سؤال Coder', 'Coder’s question')}</span></h3>
    <div class="card cx-card is-resolved${justCls(K.ask)}"><p class="cx-q cx-q--done" dir="rtl">${bx(K.ask.q)}</p>
      <div class="card__outcome">${icon('check')}<span>${bx(`${firstOf(K.ask.by) || lng('انت', 'You')} ${lng(gv(K.ask.by || 'omar', 'جاوب', 'جاوبت'), 'answered')}: «${K.ask.answer}» · ${K.ask.at}`)}</span></div></div></section>` : '';
  const rule = `<p class="cx-rule">${icon('hand')}<span>${bx(teamOr(lng('Coder بيبني ويختبر ويفتح طلب الدمج ويقف. الدمج والنزول على الموقع بتعملهم انت.', 'Coder builds, tests, opens the merge request and stops. You merge and deploy.'), lng('Coder بيبني ويختبر ويفتح طلب الدمج ويقف. الدمج والنزول على الموقع بيعملهم حد من الفريق.', 'Coder builds, tests, opens the merge request and stops. Someone on the team merges and deploys.')))}</span></p>`;
  return `<div class="cx">${top}${status}${req}${notes}${asked}${rule}</div>`;
}
function renderCodePane() {
  const box = $('#sheet-req'); const c = cardById(state.sheetCard); if (!box || !c || !c.code) return;
  const keep = box.scrollTop; const f = keepFocus(box);
  box.innerHTML = codeReqHTML(c); box.scrollTop = keep; restoreFocus(f, box);
}
function mrToast(c) {
  if (!c || !c.code || !c.code.mr) return;
  toast(lng(`في النسخة الحقيقية ده بيفتح طلب الدمج ${mrTxt(c.code.mr)} على GitLab`, `In the real product this opens merge request ${mrTxt(c.code.mr)} on GitLab`), 'open');
}

/* ---- the one question: answer it on the card, and Coder carries on ---- */
function answerAsk(cid) {
  const c = cardById(cid); const K = c && c.code;
  if (!K || !K.ask || K.ask.status !== 'pending' || !canWrite()) return;
  const ta = $('#cx-ans'); const v = ta ? ta.value.trim() : '';
  if (!v) { const er = $('#cx-ans-err'); if (er) er.hidden = false; if (ta) { ta.setAttribute('aria-invalid', 'true'); ta.focus(); } return; }
  const no = /^(لا|لأ)|مرة واحدة|مش على التقسيط|من غير التقسيط|كاش/.test(v);
  Object.assign(K.ask, { status: 'answered', answer: v, by: state.as, at: nowTime(), justAt: Date.now(), draft: '' });
  logAuto(ME(), meAct('جاوب Coder', 'جاوبت Coder', 'answered Coder'), { card: cid, agent: 'coder', obj: lng('الخصم على التقسيط كمان؟', 'Discount on instalments too?'), to: v });
  sysMove(cid, 'progress', { wait: '', pct: 18, tick: 0, ticks: [lng('بيكمّل على إجابتك', 'Carrying on with your answer'), lng('بيحسب السعر بعد الخصم', 'Working out the price after the discount'), lng('بيشغّل الاختبارات', 'Running the tests')] });
  rerenderAll();
  { const box = $('#sheet-req'); if (box) { box.scrollTop = 0; box.focus({ preventScroll: true }); } }
  toast(lng('Coder كمّل على إجابتك، والكارت رجع «شغالين عليه»', 'Coder carried on with your answer; the card is back in “In progress”'), 'check');
  const rv = inWs('karim') && !isSolo() ? 'karim' : null;
  const step = (ms, fn) => later(ms, () => { if (!cardById(cid)) return; fn(); rerenderAll(); });
  step(1800, () => {
    K.accept.push({ t: no ? 'التقسيط يفضل بالسعر الكامل: 3 أقساط × 800 ج' : 'كل قسط من التلاتة يبقى 680 ج بدل 800 ج', ok: false, added: true });
    logAuto(WHO.a('coder'), lng('كمّل على الإجابة', 'carried on with the answer'), { card: cid, to: no ? lng('الخصم على الدفع مرة واحدة بس', 'Discount on one-off payment only') : lng('الخصم على التقسيط كمان · 680 ج للقسط', 'Discount on instalments too · EGP 680 each') });
  });
  step(4200, () => {
    K.mr = 241; K.tests = { st: 'running', pass: 12, total: 47 }; c.pct = 55; c.tick = 2;
    logAuto(WHO.a('coder'), lng('فتح طلب دمج', 'opened a merge request'), { card: cid, to: mrTxt(241) });
  });
  step(7200, () => {
    K.tests = { st: 'passed', pass: 47, total: 47 }; K.accept.forEach((a) => { a.ok = true; });
    K.review = { st: 'waiting', by: rv, extra: 'pending' }; c.pct = 88; c.tick = 0;
    c.ticks = [rv ? lng('مستني مراجعة كريم', 'Waiting for Karim’s review') : lng('مستني مراجعتك', 'Waiting for your review'), lng('وبعدها مراجعة زيادة لأنه حساس', 'Then an extra review, because it is sensitive')];
    logAuto(WHO.a('coder'), lng('شغّل الاختبارات', 'ran the tests'), { card: cid, from: lng('شغالة', 'Running'), to: `${lng('نجحت', 'Passed')} · 47 ${lng('من', 'of')} 47` });
    logAuto(WHO.a('coder'), rv ? lng('طلب مراجعة من كريم', 'asked Karim for a review') : lng('طلب مراجعة', 'asked for a review'), { card: cid, to: lng('مستني مراجعة · حساس: ومراجعة زيادة', 'Waiting for review · sensitive: plus an extra review') });
  });
  step(10500, () => {
    K.review = { st: 'ok', by: rv, extra: 'pending' }; K.hand = { status: 'pending' };
    if (rv) logAuto(WHO.p('karim'), lng('راجع طلب الدمج', 'reviewed the merge request'), { card: cid, obj: mrTxt(241), from: lng('مستني مراجعة', 'Waiting for review'), to: lng('اتراجع · فاضل المراجعة الزيادة', 'Reviewed · the extra review is left') });
    sysMove(cid, 'waiting', { wait: lng('اتسلّمتلك: المراجعة الزيادة والدمج', 'Handed to you: the extra review and the merge') });
    logAuto(WHO.a('coder'), lng('وقف عند طلب الدمج وسلّمه', 'stopped at the merge request and handed it over'), { card: cid, obj: mrTxt(241), to: lng('اتسلّمتلك: المراجعة الزيادة والدمج', 'Handed to you: the extra review and the merge') });
  });
}

/* ---- «عملتها» on a merge: the person merged it; Coder never does ---- */
function codeMerge(cid) {
  const c = cardById(cid); const K = c && c.code;
  if (!K || !K.hand || K.hand.status !== 'pending' || !canWrite()) return;
  Object.assign(K.hand, { status: 'done', at: nowTime(), by: state.as, justAt: Date.now() });
  if (K.review.st !== 'ok') K.review = { st: 'ok', by: state.as };
  if (K.review.extra) K.review.extra = 'done';
  K.merge = { st: 'merged', at: `${lng('النهارده', 'Today')} · ${nowTime()}`, by: state.as };
  K.accept.forEach((a) => { a.ok = true; });
  logAuto(ME(), meAct('دمج طلب الدمج', 'دمجت طلب الدمج', 'merged the merge request'), { card: cid, obj: mrTxt(K.mr), from: lng('مستني', 'Waiting'), to: lng('اندمج', 'Merged') });
  sysMove(cid, 'done', { wait: '', prog: '' });
  state.events.unshift({ agent: 'coder', ws: state.world, t: `${me().first} ${lng(gv(state.as, 'دمج', 'دمجت'), 'merged')} «${c.title}» ${lng('بعد الاختبارات والمراجعة', 'after the tests and the review')}`, m: `${lng('النهارده ·', 'Today ·')} ${nowTime()}` });
  const t = c.thread && threads[c.thread];
  if (t) {
    const m = t.msgs.find((x) => x.card && x.card.code === cid && x.card.status === 'pending');
    if (m) Object.assign(m.card, { status: 'done', at: nowTime(), justAt: Date.now() });
    bump(t); refreshThread(t.id);
    agentSays(t.id, 'coder', { text: `شفته اندمج في ${mrTxt(K.mr)}. مش هنزّله على الموقع؛ النزول عليكم وقت ما تحبوا، وأنا جاهز للطلب الجاي.`, activity: [lng('بيتأكد إن طلب الدمج اندمج', 'Checking the merge request was merged')] }, () => rerenderAll());
  }
  rerenderAll();
  if (state.sheetCard === cid) { const box = $('#sheet-req'); if (box) { box.scrollTop = 0; box.focus({ preventScroll: true }); } }
  toast(lng('اتسجّل إنه اندمج. النزول على الموقع عليكم وقت ما تحبوا', 'Marked as merged. Deploying to the site is up to you, whenever you like'), 'merge');
}

/* ---- a written request in Coder's chat becomes a code card, built, tested and handed over ---- */
function codeFromChat(c, text) {
  if (!c) return;
  const ex = text.trim() === CODER_EX;
  const sens = /الدفع(?!ة)|ادفع|سعر|أسعار|خصم|فلوس|فاتورة|payment|checkout|price/i.test(text); // «الدفعة» (a cohort) is not a payment
  const cut = text.split(/\s+عشان\s+/);
  const first = text.split(/[،,.\n؟?]/)[0].trim();
  const title = ex ? 'ميعاد الدفعة الجديدة فوق زرار التسجيل' : (first.length <= 60 ? first : `${first.slice(0, first.lastIndexOf(' ', 56))}…`);
  Object.assign(c, { title, chan: lng('الموقع', 'Website'), ws: state.world, pct: 8, tick: 0,
    ticks: [lng('بيقرا كود الصفحة', 'Reading the page code'), lng('بيبني التغيير على فرع لوحده', 'Building the change on its own branch'), lng('بيشغّل الاختبارات', 'Running the tests')] });
  c.code = mkCode({ fresh: true, by: state.as, back: 0, sensitive: sens, sensWhy: sens ? lng('بيلمس صفحة الدفع أو الأسعار', 'It touches the payment page or prices') : '',
    branch: ex ? 'feat/cohort-date-above-signup' : `feat/request-${mrSeq + 1}`,
    what: cut.length > 1 ? cut[0].trim() : text, why: cut.length > 1 ? cut.slice(1).join(' عشان ').trim() : '',
    accept: (ex ? ['سطر «الدفعة الجديدة بتبدأ 1 ديسمبر» فوق زرار التسجيل في صفحة المحاسب الشامل', 'يظهر صح على الموبايل والكمبيوتر', 'مفيش حاجة تانية في الصفحة تتغيّر']
      : ['التغيير يشتغل زي ما مكتوب في الطلب', 'يظهر صح على الموبايل والكمبيوتر', 'مفيش حاجة تانية في الموقع تتغيّر']).map((t) => [t, false]) });
  logAuto(ME(), meAct('كتب طلب لـ Coder', 'كتبت طلب لـ Coder', 'wrote a request for Coder'), { card: c.id, agent: 'coder', to: `${c.code.accept.length} ${lng('نقط قبول', 'acceptance points')}${sens ? ` · ${lng('حساس', 'Sensitive')}` : ''}` });
}
function codeRunNew(cid, threadId) {
  const c = cardById(cid); const K = c && c.code; if (!K) return;
  K.fresh = false; const mr = ++mrSeq;
  const step = (ms, fn) => later(ms, () => { if (!cardById(cid)) return; fn(); rerenderAll(); });
  logAuto(WHO.a('coder'), lng('بدأ يبني التغيير', 'started building the change'), { card: cid, to: `${lng('فرع', 'Branch')} ${LRI(K.branch)}` });
  step(2600, () => {
    K.mr = mr; K.tests = { st: 'running', pass: 9, total: 44 }; c.pct = 52; c.tick = 2;
    logAuto(WHO.a('coder'), lng('فتح طلب دمج', 'opened a merge request'), { card: cid, to: mrTxt(mr) });
  });
  step(5400, () => {
    K.tests = { st: 'passed', pass: 44, total: 44 }; K.accept.forEach((a) => { a.ok = true; }); c.pct = 90;
    logAuto(WHO.a('coder'), lng('شغّل الاختبارات', 'ran the tests'), { card: cid, from: lng('شغالة', 'Running'), to: `${lng('نجحت', 'Passed')} · 44 ${lng('من', 'of')} 44` });
  });
  step(6800, () => {
    K.review = { st: 'waiting', by: null }; K.hand = { status: 'pending' };
    const w = K.sensitive ? lng('اتسلّمتلك: راجع التغيير الحساس وادمجه', 'Handed to you: review the sensitive change and merge it') : lng('اتسلّمتلك: راجع طلب الدمج وادمجه', 'Handed to you: review the merge request and merge it');
    sysMove(cid, 'waiting', { wait: w });
    logAuto(WHO.a('coder'), lng('وقف عند طلب الدمج وسلّمه', 'stopped at the merge request and handed it over'), { card: cid, obj: mrTxt(mr), to: w });
    if (!threads[threadId]) return;
    agentSays(threadId, 'coder', {
      text: `فتحت طلب الدمج ${mrTxt(mr)} والاختبارات كلها نجحت (44 من 44). وقفت هنا: ${teamOr('المراجعة والدمج عليك انت', 'المراجعة والدمج عند حد من الفريق')}، وأنا مش هدمج ولا هنزّل على الموقع.`,
      activity: [lng('بيفتح طلب الدمج', 'Opening the merge request'), lng('بيشغّل الاختبارات', 'Running the tests'), lng('بيجهّز التسليم', 'Preparing the hand-over')],
      steps: [{ tool: 'gitlab', label: lng('فتح طلب دمج', 'Opened a merge request'), state: 'done' }, { tool: 'gitlab', label: lng('شغّل 44 اختبار', 'Ran 44 tests'), state: 'done' }], stepsDur: lng('3 دقايق', '3 min'),
      card: { type: 'hand', status: 'pending', tool: 'gitlab', code: cid, title: `${lng('راجع وادمج طلب الدمج', 'Review and merge merge request')} ${mrTxt(mr)}`,
        sub: lng('Coder وقف هنا. المراجعة والدمج عليك، والنزول على الموقع بعدها.', 'Coder stopped here. Review and merge are yours, then deploying to the site.'),
        rows: [[lng('الاختبارات', 'Tests'), `${lng('نجحت', 'Passed')} · 44 ${lng('من', 'of')} 44`], [lng('نقط القبول', 'Acceptance points'), `${K.accept.length} ${lng('من', 'of')} ${K.accept.length}`]],
        doneNote: lng('اندمج. النزول على الموقع عليكم وقت ما تحبوا.', 'Merged. Deploying to the site is up to you, whenever you like.') },
    }, () => rerenderAll());
  });
}
function coderReply(text) {
  const sc = state.sheetCard && $('#sheet').open ? cardById(state.sheetCard) : null;
  const t = threads[state.chatThread]; const tc = t && t.card ? cardById(t.card) : null;
  const c = sc && sc.code ? sc : tc && tc.code ? tc : null;
  if (c && c.code.fresh) {
    return { agent: 'coder', payload: {
      text: `تمام. كتبت طلبك على كارت في لوحة التسويق («شغالين عليه») بنقط القبول دي:\n${c.code.accept.map((a) => `• ${a.t}`).join('\n')}\n\nهبنيه على فرع لوحده وأشغّل الاختبارات، وبعدها أفتح طلب دمج وأقف. ${teamOr('المراجعة والدمج عليك.', 'المراجعة والدمج عليكم.')}${c.code.sensitive ? '\nوعلّمت عليه «حساس» عشان بيلمس الدفع، فهيستنى مراجعة زيادة قبل الدمج.' : ''}`,
      activity: [lng('بيقرا كود الصفحة', 'Reading the page code'), lng('بيكتب نقط القبول', 'Writing the acceptance points')],
      steps: [{ tool: 'gitlab', label: lng('قرا كود الصفحة', 'Read the page code'), state: 'done' }, { tool: 'gitlab', label: lng('فتح فرع جديد', 'Opened a new branch'), state: 'done' }], stepsDur: lng('19 ثانية', '19 sec') } };
  }
  if (c) {
    if (c.col === 'done') return { agent: 'coder', payload: { text: 'التغيير ده اندمج خلاص. لو عايز تعديل عليه اكتبهولي في محادثة جديدة، وهفتحله كارت وطلب دمج جديد.' } };
    const pt = text.replace(/\s+/g, ' ').trim().slice(0, 110);
    c.code.accept.push({ t: pt, ok: false, added: true });
    logAuto(WHO.a('coder'), lng('ضاف نقطة قبول من المحادثة', 'added an acceptance point from the chat'), { card: c.id, to: pt });
    return { agent: 'coder', payload: { text: `تمام، ضفته لنقط القبول في «الطلب». هعدّل عليه وأشغّل الاختبارات تاني، وبرضه هقف عند طلب الدمج${c.code.mr ? ` ${mrTxt(c.code.mr)}` : ''}، والدمج ${teamOr('عليك', 'عليكم')}.`,
      activity: [lng('بيقرا طلبك', 'Reading your request'), lng('بيضيفه لنقط القبول', 'Adding it to the acceptance points')] } };
  }
  return { agent: 'coder', payload: { text: 'ابعتلي الطلب مكتوب: إيه اللي عايزه في الموقع، وليه، وإزاي هنعرف إنه اشتغل. هفتحله كارت على اللوحة وأبدأ، وهقف عند طلب الدمج.' } };
}
function installCoder() {
  if (!isOwner() || !AGENTS.coder) return;
  state.coderIn[state.world] = true; syncCoder();
  logAuto(ME(), meAct('ضاف وكيل من المعرض الخاص', 'ضافت وكيل من المعرض الخاص', 'added an agent from the private gallery'), { agent: 'coder', obj: 'Coder', to: isSolo() ? lng('شغال معاك انت', 'Works with you') : KIND_TXT.team });
  closeModal();
  later(210, () => {
    if ($('#sheet').open) closeSheet();
    Object.assign(state, { chatThread: null, newChatAgent: 'coder', dpSettings: false, dpTab: 'activity' });
    setView('chat', { focusComposer: true });
    const tl = $('[data-action="open-agent"][data-agent="coder"]'); if (tl) { tl.classList.add('is-flash'); window.setTimeout(() => tl.classList.remove('is-flash'), 1500); }
    toast(`Coder ${lng('اتضاف ·', 'was added ·')} ${isSolo() ? lng('شغال معاك انت', 'works with you') : KIND_TXT.team}`);
  });
}
function openAgentChat(a) {
  if (!canSee(a)) return;
  const th = sortedThreads().find((t) => t.agent === a && !t.checkin && !t.team && threadVisible(t));
  if (th) openThread(th.id); else { state.chatThread = null; state.newChatAgent = a; setView('chat', { focusComposer: true }); }
}

/* ---- seed: RS Learning added Coder on 3 Nov; five code cards across the board's own columns ---- */
{
  const T = (ar, en) => lng(ar, en);
  const site = T('الموقع', 'Website');
  cards.push(
    { id: 'c-code-pay', col: 'progress', title: 'زرار الدفع في صفحة الحجز على الموبايل', agent: 'coder', chan: site, due: T('13 نوفمبر', 'Nov 13'), thread: null, ws: 'team', pct: 46, tick: 0,
      ticks: [T('بيثبّت زرار «ادفع» تحت الشاشة', 'Pinning the “ادفع” button to the bottom of the screen'), T('بيشغّل الاختبارات على مقاس الموبايل', 'Running the tests at phone size'), T('بيجرّب الصفحة على iPhone وAndroid', 'Trying the page on iPhone and Android')],
      code: mkCode({ by: 'sara', back: 1, branch: 'fix/checkout-pay-button-mobile', mr: 238,
        what: 'زرار «ادفع» في صفحة الحجز يفضل ظاهر على الموبايل وهو بيكتب بياناته.',
        why: 'الكيبورد بيغطي الزرار، فناس كتير بتقفل الصفحة قبل ما تدفع. وأغلب زيارات صفحة الحجز من الموبايل.',
        accept: [['زرار «ادفع» يفضل ظاهر تحت الشاشة والكيبورد مفتوح', true], ['يشتغل على iPhone وAndroid، في Safari وChrome', false], ['شكل الصفحة على الكمبيوتر ميتغيّرش', false]],
        tests: { st: 'running', pass: 18, total: 43 } }) },
    { id: 'c-code-ksa', col: 'progress', title: `فورم التسجيل يقبل أرقام سعودية ${LRI('+966')}`, agent: 'coder', chan: site, due: T('12 نوفمبر', 'Nov 12'), thread: null, ws: 'team', pct: 72, tick: 0,
      ticks: [T('بيصلّح الاختبار اللي وقع', 'Fixing the test that failed'), T('بيوحّد صيغة الرقم قبل ما يتحفظ', 'Normalising the number before it is saved'), T('هيشغّل الاختبارات تاني', 'Will run the tests again')],
      code: mkCode({ by: 'sara', back: 1, branch: 'fix/signup-saudi-phone', mr: 236,
        what: 'فورم التسجيل في صفحة الكورس يقبل الأرقام السعودية.',
        why: `ليدز الرياض وجدة من حملة Meta بيكتبوا أرقامهم بـ ${LRI('+966')} أو 05، والفورم بيرفضها، فبيضيعوا قبل ما حد يكلّمهم.`,
        accept: [[`يقبل الرقم السعودي بـ ${LRI('+966')} وبـ 05`, true], ['الأرقام المصرية تفضل شغالة زي ما هي', true], [`الرقم يتحفظ في شيت الليدز بصيغة واحدة: ${LRI('+9665…')}`, false]],
        tests: { st: 'failed', pass: 42, total: 43, fail: 'signup › phone › saves +9665 in one format', failWhy: `الرقم اللي بيبدأ بـ 05 بيتحفظ في الشيت من غير ${LRI('+966')}.` } }) },
    { id: 'c-code-disc', col: 'waiting', title: 'كود خصم الدفعة الجديدة في صفحة الدفع', agent: 'coder', chan: site, due: T('15 نوفمبر', 'Nov 15'), thread: null, ws: 'team',
      wait: T('Coder سأل: الخصم على التقسيط كمان؟', 'Coder asked: discount on instalments too?'),
      code: mkCode({ by: 'omar', back: 1, branch: 'feat/early15-discount', sensitive: true, sensWhy: T('بيغيّر السعر في صفحة الدفع', 'It changes the price on the payment page'),
        what: 'كود الخصم EARLY15 يشتغل في صفحة الدفع لكورس «المحاسب الشامل».',
        why: 'عرض الدفعة الجديدة: خصم 15% لأي حد يسجّل قبل 20 نوفمبر، يعني 2,040 ج بدل 2,400 ج.',
        accept: [['الكود EARLY15 ينزّل السعر لـ 2,040 ج', false], ['الكود يقف لوحده بعد 20 نوفمبر الساعة 11:59 بالليل', false], ['إيميل التأكيد فيه السعر بعد الخصم', false]],
        ask: { q: 'قبل ما أكمّل في السعر: الخصم 15% يتطبّق على التقسيط كمان، ولا على الدفع مرة واحدة بس؟ لو على التقسيط، كل قسط من التلاتة هيبقى 680 ج بدل 800 ج.', status: 'pending', at: T('8:15 ص', '8:15 AM'), draft: '' } }) },
    { id: 'c-code-utm', col: 'progress', title: 'مصدر الإعلان (UTM) يتحفظ مع كل ليد في الشيت', agent: 'coder', chan: site, due: T('14 نوفمبر', 'Nov 14'), thread: null, ws: 'team', pct: 84, tick: 0,
      ticks: [T('بيعدّل على ملاحظتين من كريم', 'Working on Karim’s 2 notes'), T('بيغيّر اسم العمود لـ «الحملة»', 'Renaming the column to «الحملة»'), T('هيطلب مراجعة تانية من كريم', 'Will ask Karim to review again')],
      code: mkCode({ by: 'omar', back: 2, branch: 'feat/lead-utm-columns', mr: 233,
        what: 'كل ليد جديد يتحفظ في شيت الليدز ومعاه الحملة اللي جه منها.',
        why: 'عشان نحسب تكلفة الليد لكل حملة Meta وGoogle من الشيت على طول، من غير ما حد يطابق بإيده.',
        accept: [['utm_source وutm_campaign يتحفظوا مع كل ليد جديد', true], ['الليد اللي جه من غير UTM يتكتب «مباشر»', false], ['الأعمدة الجديدة تتضاف في آخر الشيت من غير ما تحرّك القديمة', true]],
        tests: { st: 'passed', pass: 39, total: 39 }, review: { st: 'notes', n: 2, by: 'karim' },
        notes: [{ by: 'karim', t: 'اسم العمود يبقى «الحملة» بالعربي زي باقي أعمدة الشيت، مش campaign.' }, { by: 'karim', t: 'الليد اللي من غير UTM يتكتب «مباشر»، متسبهوش فاضي عشان الفلتر.' }] }) },
    { id: 'c-code-pixel', col: 'done', title: 'تتبّع تسجيل الكورس في Meta Pixel', agent: 'coder', chan: site, due: '', thread: null, ws: 'team', touched: ['coder', 'ads'],
      code: mkCode({ by: 'sara', back: 3, branch: 'feat/meta-pixel-purchase', mr: 229,
        what: 'حدث Purchase يتبعت لـ Meta Pixel لما الطالب يدفع ويسجّل في الكورس.',
        why: 'عشان Ads يحسب تكلفة التسجيل الفعلي مش الليد بس، ويوجّه حملات Meta للناس اللي بتدفع.',
        accept: [['حدث Purchase يتبعت مرة واحدة بعد الدفع', true], ['القيمة تتبعت بالجنيه (EGP) بسعر الكورس الفعلي', true], ['مفيش حدث بيتبعت لو الدفع فشل', true]],
        tests: { st: 'passed', pass: 41, total: 41 }, review: { st: 'ok', by: 'karim' }, merge: { st: 'merged', by: 'karim', at: `${dayName(2)} · ${T('4:20 م', '4:20 PM')}` },
        notes: [{ by: 'karim', t: 'القيمة لازم تتبعت بالجنيه EGP، مش بالدولار.', fixed: true }] }) },
  );
  state.events.push(
    { agent: 'coder', ws: 'team', t: T(`فتح طلب الدمج ${mrTxt(238)} لزرار الدفع في صفحة الحجز، والاختبارات شغالة`, `Opened merge request ${mrTxt(238)} for the pay button on the booking page; tests are running`), m: T('النهارده · 10:20 ص', 'Today · 10:20 AM') },
    { agent: 'coder', ws: 'team', t: T('وقف وسأل عمر: الخصم 15% على التقسيط كمان؟', 'Stopped and asked Omar: does the 15% discount apply to instalments too?'), m: T('النهارده · 8:15 ص', 'Today · 8:15 AM') },
    { agent: 'coder', ws: 'team', t: T('اختبار رقم سعودي في فورم التسجيل وقع، وبيصلّحه', 'A Saudi-number test in the signup form failed; fixing it'), m: T('النهارده · 8:50 ص', 'Today · 8:50 AM') },
  );

  const S = (day, time, e) => logAdd(Object.assign({ day, time }, e));
  const C = WHO.a('coder'); const now = Date.now();
  const asked = (p) => (p === 'sara' ? T('كتبت طلب لـ Coder', 'wrote a request for Coder') : T('كتب طلب لـ Coder', 'wrote a request for Coder'));
  const three = T('3 نقط قبول', '3 acceptance points');
  /* الثلاثاء 3 نوفمبر: Coder joins from the gallery */
  S(8, T('9:30 ص', '9:30 AM'), { who: WHO.p('omar'), act: T('ضاف وكيل من المعرض الخاص', 'added an agent from the private gallery'), obj: 'Coder', agent: 'coder', to: T('شغال مع الفريق كله', 'Works with the whole team') });
  S(8, T('9:32 ص', '9:32 AM'), { who: WHO.p('omar'), act: T('غيّر الوكلاء اللي كريم بيشتغل معاهم', 'changed which agents Karim works with'), obj: 'Coder', agent: 'coder', from: T('مقفول', 'Off'), to: T('مسموح', 'Allowed'), only: ['karim'], mgr: true });
  /* Meta Pixel: the whole way, from request to merged */
  S(3, T('10:05 ص', '10:05 AM'), { who: WHO.p('sara'), act: asked('sara'), card: 'c-code-pixel', agent: 'coder', to: three });
  S(3, T('10:06 ص', '10:06 AM'), { who: C, act: T('بدأ يبني التغيير', 'started building the change'), card: 'c-code-pixel', to: `${T('فرع', 'Branch')} ${LRI('feat/meta-pixel-purchase')}` });
  S(3, T('11:40 ص', '11:40 AM'), { who: C, act: T('فتح طلب دمج', 'opened a merge request'), card: 'c-code-pixel', to: mrTxt(229) });
  S(3, T('11:52 ص', '11:52 AM'), { who: C, act: T('شغّل الاختبارات', 'ran the tests'), card: 'c-code-pixel', from: T('شغالة', 'Running'), to: `${T('وقعت', 'Failed')} · ${LRI('checkout › pixel › sends Purchase once')}` });
  S(3, T('12:30 م', '12:30 PM'), { who: C, act: T('صلّح الاختبار اللي وقع', 'fixed the failing test'), card: 'c-code-pixel', from: T('وقعت', 'Failed'), to: `${T('نجحت', 'Passed')} · 41 ${T('من', 'of')} 41` });
  S(3, T('12:31 م', '12:31 PM'), { who: C, act: T('طلب مراجعة من كريم', 'asked Karim for a review'), card: 'c-code-pixel', to: T('مستني مراجعة', 'Waiting for review') });
  S(2, T('10:15 ص', '10:15 AM'), { who: WHO.p('karim'), act: T('كتب ملاحظات على طلب الدمج', 'left notes on the merge request'), card: 'c-code-pixel', from: T('مستني مراجعة', 'Waiting for review'), to: T('فيه ملاحظات 1', '1 note') });
  S(2, T('10:16 ص', '10:16 AM'), { kind: 'note', who: WHO.p('karim'), card: 'c-code-pixel', at: now - 2 * 86400000, agents: ['coder'], text: '@Coder القيمة لازم تتبعت بالجنيه EGP، مش بالدولار. غير كده تمام.' });
  S(2, T('11:02 ص', '11:02 AM'), { who: C, act: T('عدّل على الملاحظة وشغّل الاختبارات', 'fixed the note and ran the tests'), card: 'c-code-pixel', from: 'USD', to: `EGP · ${T('نجحت', 'Passed')}` });
  S(2, T('3:50 م', '3:50 PM'), { who: WHO.p('karim'), act: T('راجع طلب الدمج', 'reviewed the merge request'), card: 'c-code-pixel', from: T('فيه ملاحظات 1', '1 note'), to: T('اتراجع', 'Reviewed') });
  S(2, T('4:20 م', '4:20 PM'), { who: WHO.p('karim'), act: T('دمج طلب الدمج', 'merged the merge request'), card: 'c-code-pixel', obj: mrTxt(229), from: T('مستني', 'Waiting'), to: T('اندمج', 'Merged') });
  S(2, T('4:20 م', '4:20 PM'), { who: WHO.sys(), act: T('نقل الكارت', 'moved the card'), card: 'c-code-pixel', from: colName('progress'), to: colName('done') });
  /* UTM: review notes */
  S(2, T('9:10 ص', '9:10 AM'), { who: WHO.p('omar'), act: asked('omar'), card: 'c-code-utm', agent: 'coder', to: three });
  S(2, T('9:12 ص', '9:12 AM'), { who: C, act: T('بدأ يبني التغيير', 'started building the change'), card: 'c-code-utm', to: `${T('فرع', 'Branch')} ${LRI('feat/lead-utm-columns')}` });
  S(1, T('1:05 م', '1:05 PM'), { who: C, act: T('فتح طلب دمج', 'opened a merge request'), card: 'c-code-utm', to: mrTxt(233) });
  S(1, T('1:14 م', '1:14 PM'), { who: C, act: T('شغّل الاختبارات', 'ran the tests'), card: 'c-code-utm', from: T('شغالة', 'Running'), to: `${T('نجحت', 'Passed')} · 39 ${T('من', 'of')} 39` });
  S(1, T('1:15 م', '1:15 PM'), { who: C, act: T('طلب مراجعة من كريم', 'asked Karim for a review'), card: 'c-code-utm', to: T('مستني مراجعة', 'Waiting for review') });
  S(0, T('9:45 ص', '9:45 AM'), { who: WHO.p('karim'), act: T('كتب ملاحظات على طلب الدمج', 'left notes on the merge request'), card: 'c-code-utm', from: T('مستني مراجعة', 'Waiting for review'), to: T('فيه ملاحظات 2', '2 notes') });
  const kn = S(0, T('9:46 ص', '9:46 AM'), { kind: 'note', who: WHO.p('karim'), card: 'c-code-utm', at: now - 95 * 60000, agents: ['coder'], text: '@Coder اسم العمود يبقى «الحملة» بالعربي، واللي من غير UTM يتكتب «مباشر». بعدها ابعتهولي تاني.' });
  S(0, T('9:47 ص', '9:47 AM'), { kind: 'note', who: C, reply: true, card: 'c-code-utm', agent: 'coder', replyTo: kn.id, text: 'تمام يا كريم. هغيّر اسم العمود لـ «الحملة» وأكتب «مباشر» للّي من غير UTM، وأشغّل الاختبارات وأطلب مراجعتك تاني.' });
  /* Saudi numbers: tests failed */
  S(1, T('2:40 م', '2:40 PM'), { who: WHO.p('sara'), act: asked('sara'), card: 'c-code-ksa', agent: 'coder', to: three });
  S(1, T('2:42 م', '2:42 PM'), { who: C, act: T('بدأ يبني التغيير', 'started building the change'), card: 'c-code-ksa', to: `${T('فرع', 'Branch')} ${LRI('fix/signup-saudi-phone')}` });
  S(1, T('5:10 م', '5:10 PM'), { who: C, act: T('فتح طلب دمج', 'opened a merge request'), card: 'c-code-ksa', to: mrTxt(236) });
  S(0, T('8:50 ص', '8:50 AM'), { who: C, act: T('شغّل الاختبارات', 'ran the tests'), card: 'c-code-ksa', from: T('شغالة', 'Running'), to: `${T('وقعت', 'Failed')} · ${LRI('signup › phone › saves +9665 in one format')}` });
  S(0, T('8:51 ص', '8:51 AM'), { who: C, act: T('بدأ يصلّح الاختبار اللي وقع', 'started fixing the failing test'), card: 'c-code-ksa', to: T('الرقم اللي بيبدأ بـ 05', 'Numbers starting with 05') });
  /* discount code: sensitive, blocked on one question */
  S(1, T('6:30 م', '6:30 PM'), { who: WHO.p('omar'), act: asked('omar'), card: 'c-code-disc', agent: 'coder', to: `${three} · ${T('حساس', 'Sensitive')}` });
  S(1, T('6:31 م', '6:31 PM'), { who: C, act: T('بدأ يبني التغيير', 'started building the change'), card: 'c-code-disc', to: `${T('فرع', 'Branch')} ${LRI('feat/early15-discount')}` });
  S(1, T('6:31 م', '6:31 PM'), { who: WHO.sys(), act: T('علّم على الكارت «حساس»', 'marked the card “Sensitive”'), card: 'c-code-disc', to: T('بيغيّر السعر · مستني مراجعة زيادة قبل الدمج', 'Changes the price · waits for an extra review before merging') });
  S(0, T('8:15 ص', '8:15 AM'), { who: C, act: T('وقف وسأل سؤال قبل ما يكمّل', 'stopped and asked one question'), card: 'c-code-disc', obj: T('الخصم على التقسيط كمان؟', 'Discount on instalments too?'), to: T('مستني إجابة', 'Waiting for an answer') });
  S(0, T('8:15 ص', '8:15 AM'), { who: WHO.sys(), act: T('نقل الكارت', 'moved the card'), card: 'c-code-disc', from: colName('progress'), to: colName('waiting') });
  /* pay button: building */
  S(1, T('4:05 م', '4:05 PM'), { who: WHO.p('sara'), act: asked('sara'), card: 'c-code-pay', agent: 'coder', to: three });
  S(0, T('9:10 ص', '9:10 AM'), { who: C, act: T('بدأ يبني التغيير', 'started building the change'), card: 'c-code-pay', to: `${T('فرع', 'Branch')} ${LRI('fix/checkout-pay-button-mobile')}` });
  S(0, T('10:20 ص', '10:20 AM'), { who: C, act: T('فتح طلب دمج', 'opened a merge request'), card: 'c-code-pay', to: mrTxt(238) });
  S(0, T('10:48 ص', '10:48 AM'), { who: C, act: T('شغّل الاختبارات', 'ran the tests'), card: 'c-code-pay', to: `${T('شغالة', 'Running')} · 18 ${T('من', 'of')} 43` });
  /* the seeded log reads by its clock: re-number each day's lines by time, keeping the same numbers */
  const mins = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})\s*(ص|م|AM|PM)/); if (!m) return 0; let h = Number(m[1]) % 12; if (m[3] === 'م' || m[3] === 'PM') h += 12; return h * 60 + Number(m[2]); };
  const ords = LOG.map((e) => e.ord).sort((a, b) => a - b);
  LOG.slice().sort((x, y) => (y.day - x.day) || (mins(x.time) - mins(y.time)) || (x.ord - y.ord)).forEach((e, i) => { e.ord = ords[i]; });
}

/* ---- events ---- */
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset;
  /* Coder from the gallery: the Owner adds it straight into this workspace */
  if (d.action === 'tpl-add' && d.tpl === 'coder') { e.stopPropagation(); installCoder(); return; }
  /* a merge handed over in Coder's chat is the same step as on the card */
  if ((d.action === 'hand-done' || d.action === 'hand-open') && d.thread && d.msg) {
    const t = threads[d.thread]; const m = t && t.msgs.find((x) => x.id === d.msg);
    if (m && m.card && m.card.code) { e.stopPropagation(); if (d.action === 'hand-done') codeMerge(m.card.code); else mrToast(cardById(m.card.code)); }
  }
}, true);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'kind-filter': {
      state.boardKind = d.kind; renderBoard();
      const b = $(`[data-action="kind-filter"][data-kind="${d.kind}"]`); if (b) b.focus();
      break;
    }
    case 'cx-fill': {
      const ta = $('#cx-ans'); if (!ta) break;
      ta.value = d.text; const c = cardById(state.sheetCard); if (c && c.code && c.code.ask) c.code.ask.draft = d.text;
      const er = $('#cx-ans-err'); if (er) er.hidden = true; ta.removeAttribute('aria-invalid'); ta.focus();
      break;
    }
    case 'cx-answer': answerAsk(d.card); break;
    case 'cx-done': codeMerge(d.card); break;
    case 'cx-mr': mrToast(cardById(d.card)); break;
    case 'tpl-open': closeModal(); later(210, () => openAgentChat(d.agent)); break;
    case 'coder-board': state.boardKind = 'code'; state.boardFilter = 'all'; setView('board'); { const b = $('[data-action="kind-filter"][data-kind="code"]'); if (b) b.focus(); } break;
    default: break;
  }
});
document.addEventListener('input', (e) => {
  const t = e.target; if (t.id !== 'cx-ans') return;
  const c = cardById(t.dataset.card); if (c && c.code && c.code.ask) c.code.ask.draft = t.value;
  if (t.value.trim()) { const er = $('#cx-ans-err'); if (er) er.hidden = true; t.removeAttribute('aria-invalid'); }
});
document.addEventListener('keydown', (e) => {
  const t = e.target; if (t.id !== 'cx-ans' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault(); e.stopPropagation(); answerAsk(t.dataset.card);
}, true);

/* ================= boot ================= */
/* dark is the default; only a choice made with the moon (new key) can switch it to light */
try { const th = localStorage.getItem('gtm-theme-v2'); if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th; } catch (err) { /* in-memory only */ }
/* the static shell in index.html, in the interface language */
function localizeStatic() {
  document.title = lng('gtmworks · مساحة التسويق', 'gtmworks · Marketing workspace');
  const set = (sel, attr, ar, en) => { const n = $(sel); if (!n) return; if (attr) n.setAttribute(attr, lng(ar, en)); else n.textContent = lng(ar, en); };
  set('#mobile-menu', 'aria-label', 'افتح القايمة', 'Open menu');
  set('#sidebar', 'aria-label', 'القايمة الرئيسية', 'Main menu');
  set('.ws__mark', 'aria-label', 'شعار gtmworks', 'gtmworks logo');
  set('#btn-search', 'aria-label', 'دوّر في المحادثات', 'Search chats');
  set('#btn-newchat', 'aria-label', 'محادثة جديدة', 'New chat');
  set('#btn-newchat', 'title', 'محادثة جديدة (N)', 'New chat (N)');
  set('label[for="sb-q"]', '', 'دوّر في المحادثات', 'Search chats');
  set('#sb-q', 'placeholder', 'دوّر في المحادثات', 'Search chats');
  set('.sb-scroll', 'aria-label', 'التنقل', 'Navigation');
  set('#lbl-agents', '', 'الوكلاء', 'Agents');
  set('#sb-recent', 'aria-label', 'آخر المحادثات', 'Recent chats');
  set('.me__av', '', 'س', 'S');
  set('.me__name', '', 'سارة منصور', 'Sara Mansour');
  set('.me__role', '', 'مديرة التسويق', 'Marketing manager');
  set('#btn-me', 'aria-label', 'سارة منصور · إعدادات المساحة واللغة', 'Sara Mansour · Workspace settings and language');
  set('#btn-me', 'title', 'إعدادات المساحة', 'Workspace settings');
  set('#me-menu', 'aria-label', 'إعدادات المساحة', 'Workspace settings');
  set('#view-chat', 'aria-label', 'المحادثة', 'Chat');
  set('#view-board', 'aria-label', 'لوحة التسويق', 'Marketing board');
  set('#view-dashboard', 'aria-label', 'الأرقام', 'Numbers');
  set('#view-log', 'aria-label', 'سجل النشاط', 'Activity log');
  set('#details', 'aria-label', 'تفاصيل الوكيل', 'Agent details');
}
localizeStatic();
syncMorning();
setView('chat');
})();
