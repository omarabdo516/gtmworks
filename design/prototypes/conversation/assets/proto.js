/* PROTOTYPE (throwaway, #185). Shared pieces: language and theme switch, icons, the agent face, the app shell,
   the composer, and the rows that show cards and Hermes tasks. Fake data only; nothing is sent anywhere. Kept in the browser: the language, theme and motion choices, and the last sent New message. */
(function () {
  'use strict';
  var P = (window.PROTO = {});
  var root = document.documentElement;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  P.$ = $; P.$$ = $$;
  var lang = function () { return root.lang === 'ar' ? 'ar' : 'en'; };
  P.lang = lang;

  /* ---------- strings in both languages ---------- */
  P.T = function (en, ar) { return '<span lang="en">' + en + '</span><span lang="ar">' + ar + '</span>'; };
  P.A = function (attr, en, ar) { return ' ' + attr + '="' + (lang() === 'ar' ? ar : en) + '" data-la="' + attr + '" data-en="' + en + '" data-ar="' + ar + '"'; };
  P.pick = function (o) { return o[lang()]; };
  var T = P.T, A = P.A;
  /* Anything that leads nowhere in this prototype carries both a tooltip in the current language and aria-disabled. */
  P.dead = function () { return ' aria-disabled="true"' + A('title', 'Not part of this prototype', 'ليس جزءًا من هذا النموذج الأولي'); };
  function applyLang() {
    $$('[data-la]').forEach(function (el) { el.setAttribute(el.dataset.la, el.dataset[lang()]); });
    $$('[data-sample-en]').forEach(function (el) {
      var other = lang() === 'ar' ? 'en' : 'ar';
      if (el.value === '' || el.value === el.dataset['sample' + (other === 'en' ? 'En' : 'Ar')]) el.value = el.dataset['sample' + (lang() === 'ar' ? 'Ar' : 'En')];
    });
    document.dispatchEvent(new Event('protolang'));
  }
  function save(k, v) { try { localStorage.setItem('proto.' + k, v); } catch (e) { /* private mode */ } }
  /* Choices are saved on every switch and picked up by the next screen from storage. Only when storage is blocked do links and the
     address carry them (boot.js), and then syncAddress keeps those current. */
  var STORE = (function () { try { localStorage.setItem('proto.probe', '1'); localStorage.removeItem('proto.probe'); return true; } catch (e) { return false; } })();
  function choices() { return { lang: lang(), theme: root.dataset.themeChoice || 'device', motion: 'reduceMotion' in root.dataset ? 'reduce' : 'full' }; }
  function withChoices(qs) { var c = choices(); Object.keys(c).forEach(function (k) { qs.set(k, c[k]); }); return qs; }
  function syncAddress() {
    if (STORE) return;
    $$('a[href]').forEach(function (a) {
      var h = a.getAttribute('href'); if (/^(#|[a-z][a-z0-9+.-]*:)/i.test(h)) return;
      var i = h.indexOf('?'); a.setAttribute('href', (i < 0 ? h : h.slice(0, i)) + '?' + withChoices(new URLSearchParams(i < 0 ? '' : h.slice(i + 1))));
    });
    try { history.replaceState(null, '', location.pathname + '?' + withChoices(new URLSearchParams(location.search)) + location.hash); } catch (e) { /* keep the address */ }
  }
  P.setLang = function (l) { root.lang = l; root.dir = l === 'ar' ? 'rtl' : 'ltr'; save('lang', l); applyLang(); syncStrip(); syncAddress(); };
  P.setTheme = function (c) {
    root.dataset.themeChoice = c;
    root.dataset.theme = c === 'device' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : c;
    save('theme', c); syncStrip(); syncAddress();
  };
  P.reduced = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches || 'reduceMotion' in root.dataset; };
  P.setMotion = function (on) { if (on) root.dataset.reduceMotion = ''; else delete root.dataset.reduceMotion; save('motion', on ? 'reduce' : 'full'); resetEyes(); syncStrip(); syncAddress(); document.dispatchEvent(new Event('protomotion')); };
  var params = new URLSearchParams(location.search);
  P.param = function (k, d) { return params.get(k) || d; };
  P.link = function (file, extra) {
    var q = new URLSearchParams();
    if (params.get('bare')) q.set('bare', params.get('bare'));
    if (!STORE) withChoices(q);
    Object.keys(extra || {}).forEach(function (k) { q.set(k, extra[k]); });
    var s = q.toString();
    return file + (s ? '?' + s : '');
  };

  /* A screen restored from the back/forward cache, or another tab, may hold an older choice: the saved one wins. */
  function saved(k) { try { return localStorage.getItem('proto.' + k); } catch (e) { return null; } }
  function restore() {
    var l = saved('lang'), t = saved('theme'), m = saved('motion');
    if (l && l !== lang()) P.setLang(l);
    if (t && t !== root.dataset.themeChoice) P.setTheme(t);
    if (m && (m === 'reduce') !== ('reduceMotion' in root.dataset)) P.setMotion(m === 'reduce');
  }
  addEventListener('pageshow', function (e) { if (e.persisted && STORE) restore(); });
  addEventListener('storage', function () { if (STORE) restore(); });

  /* ---------- icons ---------- */
  P.ic = function (name, cls) { return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (window.PROTO_ICONS[name] || '') + '</svg>'; };
  var ic = P.ic;

  /* ---------- agents and their faces ---------- */
  P.agents = {
    am: { id: 'am', en: 'Account manager', ar: 'مدير الحساب', color: 'var(--pastel-am)', blurb: { en: 'Takes the request, plans the work and reports back', ar: 'يستلم الطلب ويخطط للعمل ويرجع بالنتيجة' } },
    wr: { id: 'wr', en: 'Writer', ar: 'الكاتب', color: 'var(--pastel-wr)', blurb: { en: 'Captions, scripts and long copy', ar: 'التعليقات والنصوص والمحتوى الطويل' } },
    ds: { id: 'ds', en: 'Designer', ar: 'المصمم', color: 'var(--pastel-ds)', blurb: { en: 'Post images, carousels and covers', ar: 'صور المنشورات والكاروسيل والأغلفة' } },
    cr: { id: 'cr', en: 'Critic', ar: 'الناقد', color: 'var(--pastel-cr)', blurb: { en: 'Checks tone, facts and brand fit before a person sees it', ar: 'يراجع النبرة والمعلومات وتوافق الهوية قبل أن يراها شخص' } }
  };
  P.agentOrder = ['am', 'wr', 'ds', 'cr'];
  P.name = function (a) { return T(a.en, a.ar); };
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  /* The face is generated from the agent's identity (seed), so it is the same everywhere. Role colour fills the head. */
  P.face = function (a, size, o) {
    o = o || {};
    var seed = o.seed || a.id + '-' + a.en, h = hash(seed);
    var shape = h % 3, gap = (h >>> 3) % 3, pup = (h >>> 6) % 3, mouth = (h >>> 9) % 4, acc = (h >>> 12) % 4;
    var ex = [21, 22, 23][gap], er = [8, 8.8, 9.4][gap], pr = [3.6, 4.2, 4.8][pup];
    var head = [
      '<circle cx="32" cy="36" r="27"/>',
      '<rect x="5" y="9" width="54" height="54" rx="19"/>',
      '<rect x="3" y="13" width="58" height="50" rx="25"/>'
    ][shape];
    var accs = ['', '<path d="M32 9V3" stroke="var(--face-ink)" stroke-width="2.4" stroke-linecap="round" fill="none"/><circle cx="32" cy="3" r="2.6" fill="var(--face-ink)"/>',
      '<rect x="0" y="31" width="4" height="12" rx="2" fill="var(--face-ink)" opacity=".7"/><rect x="60" y="31" width="4" height="12" rx="2" fill="var(--face-ink)" opacity=".7"/>',
      '<path d="M25 10c2-7 12-7 14 0" stroke="var(--face-ink)" stroke-width="2.4" stroke-linecap="round" fill="none"/>'][acc];
    var mouths = ['<path d="M25 52q7 5 14 0" fill="none"/>', '<path d="M26 52h12" fill="none"/>', '<ellipse cx="32" cy="52" rx="2.6" ry="2.2"/>', '<path d="M25 51q8 6 15-1" fill="none"/>'][mouth];
    var blink = ((h >>> 15) % 40) / 10;
    function eye(cx) { return '<circle cx="' + cx + '" cy="35" r="' + er + '" fill="#fff"/><g class="pupil"><circle cx="' + cx + '" cy="35" r="' + pr + '" fill="var(--face-ink)"/><circle cx="' + (cx + 1.3) + '" cy="33.4" r="1.2" fill="#fff"/></g>'; }
    return '<svg class="face" style="--face-ink:#1f1f1f;--blink:-' + blink + 's" width="' + size + '" height="' + size + '" viewBox="0 0 64 64" aria-hidden="true" ' + (o.eyes ? 'data-eyes="1"' : '') + '>' +
      '<g fill="' + a.color + '">' + head + '</g>' + accs +
      '<g class="eyes">' + eye(ex) + eye(64 - ex) + '</g>' +
      '<g stroke="var(--face-ink)" stroke-width="2.4" stroke-linecap="round" fill="var(--face-ink)">' + mouths + '</g></svg>';
  };
  /* Eyes follow the pointer only inside a [data-follow] zone, and never when motion is reduced. */
  function setEyes(svg, x, y) { svg.style.setProperty('--ex', x.toFixed(2) + 'px'); svg.style.setProperty('--ey', y.toFixed(2) + 'px'); }
  function resetEyes() { $$('svg.face').forEach(function (s) { setEyes(s, 0, 0); }); }
  document.addEventListener('pointermove', function (e) {
    var zone = e.target.closest && e.target.closest('[data-follow]');
    $$('svg.face[data-eyes]').forEach(function (s) {
      if (!zone || P.reduced() || !zone.contains(s)) { if (!zone || P.reduced()) setEyes(s, 0, 0); return; }
      var b = s.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160) * 3.4;
      setEyes(s, dx / d * k, dy / d * k);
    });
  });
  document.addEventListener('pointerleave', resetEyes, true);

  /* ---------- the people ---------- */
  P.me = { en: 'Omar', ar: 'عمر' };
  P.avatar = function (name) { return '<span class="avatar" aria-hidden="true">' + T(name.en.slice(0, 1), name.ar.slice(0, 1)) + '</span>'; };

  /* ---------- Hermes tasks (agent work) ---------- */
  var STATES = {
    triage: { icon: 'circle-dashed', tone: 'neutral', en: 'Triage', ar: 'للفرز' },
    todo: { icon: 'circle-dashed', tone: 'neutral', en: 'To do', ar: 'بانتظار البدء' },
    scheduled: { icon: 'clock', tone: 'neutral', en: 'Scheduled', ar: 'مجدولة' },
    ready: { icon: 'circle-check', tone: 'neutral', en: 'Ready', ar: 'جاهزة' },
    running: { icon: 'loader', tone: 'blue', en: 'Running', ar: 'قيد التنفيذ', live: true },
    blocked: { icon: 'circle-alert', tone: 'amber', en: 'Blocked', ar: 'متوقفة' },
    review: { icon: 'eye', tone: 'violet', en: 'In review', ar: 'قيد المراجعة' },
    done: { icon: 'circle-check', tone: 'green', en: 'Done', ar: 'تمّت' }
  };
  P.states = STATES;
  P.tasks = [
    { id: 't_2d90b4e1', agent: 'am', state: 'done', card: 1, en: 'Collect the last webinar results', ar: 'جمع نتائج الويبينار السابق',
      handoff: { en: 'The last webinar had 412 registrations and 31% joined live. Most questions were about the exam fees, so the teaser should answer that first.', ar: 'الويبينار السابق سجّل فيه 412 شخصًا وحضر 31% منهم مباشرة. أغلب الأسئلة كانت عن رسوم الاختبار، فيجب أن يجيب منشور التشويق عنها أولًا.' } },
    { id: 't_9c41a7e2', agent: 'wr', state: 'running', card: 1, en: 'Draft the teaser captions', ar: 'كتابة تعليقات التشويق' },
    { id: 't_5e08c3f7', agent: 'cr', state: 'todo', card: 1, wait: 't_9c41a7e2', en: 'Check the caption tone', ar: 'مراجعة نبرة التعليقات' },
    { id: 't_7a13d2b6', agent: 'ds', state: 'blocked', card: 1, en: 'Design the teaser image', ar: 'تصميم صورة التشويق',
      q: { en: 'Which picture should lead: the trainer portrait or the course cover?', ar: 'أي صورة تتصدر المنشور: صورة المدرب أم غلاف الدورة؟' } },
    { id: 't_41f6e9a0', agent: 'wr', state: 'review', card: 2, en: 'Arabic version of the webinar reminder', ar: 'النسخة العربية من تذكير الويبينار' },
    { id: 't_c3b57d18', agent: 'am', state: 'scheduled', card: 1, wait: 't_5e08c3f7', when: { en: 'Fri 21 Nov, 19:00', ar: 'الجمعة 21 نوفمبر، 19:00' }, en: 'Schedule the teaser post', ar: 'جدولة منشور التشويق' },
    { id: 't_68d2a15c', agent: 'am', state: 'ready', card: 3, en: 'Prepare the weekly numbers note', ar: 'تجهيز ملاحظة أرقام الأسبوع' },
    { id: 't_e90f4b72', agent: 'am', state: 'triage', en: 'Sort the new comments on last week\u2019s post', ar: 'فرز التعليقات الجديدة على منشور الأسبوع الماضي' }
  ];
  var taskById = function (id) { return P.tasks.filter(function (t) { return t.id === id; })[0]; };
  P.chipState = function (s) {
    var d = STATES[s];
    return '<span class="chip stage t-' + d.tone + (d.live ? ' live' : '') + '"><span class="dot"></span>' + T(d.en, d.ar) + '</span>';
  };
  P.taskRow = function (t, o) {
    o = o || {};
    var a = P.agents[t.agent], w = t.wait ? taskById(t.wait) : null;
    var sub = '<span>' + P.name(a) + '</span>';
    if (w) sub += '<span>' + ic('link', 'sm') + ' ' + T('Waits for', 'تنتظر') + ' <b>' + T(w.en, w.ar) + '</b></span>';
    if (t.when) sub += '<span>' + ic('clock', 'sm') + ' ' + T(t.when.en, t.when.ar) + '</span>';
    var extra = '';
    if (t.q) extra += '<div class="q-box">' + ic('circle-alert', 'sm') + '<div><b>' + T('Question for you', 'سؤال لك') + '</b><br>' + T(t.q.en, t.q.ar) + '</div></div>';
    if (t.handoff && !o.noHandoff) extra += '<div class="handoff"><b>' + T('Handoff summary', 'ملخص التسليم') + '</b>' + T(t.handoff.en, t.handoff.ar) + '</div>';
    return '<div class="row" data-task="' + t.id + '">' + P.face(a, 32) +
      '<div class="main"><div class="title">' + T(t.en, t.ar) + '</div><div class="sub">' + sub + '</div>' + extra + '</div>' +
      '<div class="end"><span class="mono muted">' + t.id + '</span>' + P.chipState(t.state) + '</div></div>';
  };
  P.agentWork = function (ids, o) {
    o = o || {};
    var rows = ids.map(function (id) { return P.taskRow(taskById(id), o); }).join('');
    var asof = o.stale ? '<span class="asof">' + ic('cloud-off', 'sm') + ' ' + T('As of', 'حتى') + ' <bdi>10:44</bdi> · ' + T('Hermes can\u2019t be reached', 'تعذّر الوصول إلى Hermes') + '</span>' : '<span class="asof">' + ic('refresh-cw', 'sm') + ' ' + T('Live from Hermes', 'مباشر من Hermes') + '</span>';
    return '<section' + (o.id ? ' id="' + o.id + '"' : '') + '><div class="rows-head"><h2>' + T('Agent work', 'عمل الوكلاء') + '</h2><span class="muted">' + ids.length + '</span>' + asof + '</div><div class="rows' + (o.stale ? ' stale' : '') + '">' + rows + '</div></section>';
  };
  P.taskIds = function (pred) { return P.tasks.filter(pred).map(function (t) { return t.id; }); };

  /* ---------- cards on the marketing board ---------- */
  P.stages = [
    { en: 'Ideas', ar: 'أفكار', tone: 'neutral' }, { en: 'Brief ready', ar: 'بريف جاهز', tone: 'amber' }, { en: 'Writing', ar: 'كتابة', tone: 'blue' },
    { en: 'Design and editing', ar: 'تصميم ومونتاج', tone: 'violet' }, { en: 'Review', ar: 'مراجعة', tone: 'violet' }, { en: 'Approved', ar: 'معتمد', tone: 'green' },
    { en: 'Scheduled to publish', ar: 'مجدول للنشر', tone: 'blue' }, { en: 'Published', ar: 'منشور', tone: 'green' }, { en: 'Ads running', ar: 'إعلانات شغالة', tone: 'neutral' }
  ];
  P.cards = [
    { n: 1, stage: 2, en: 'Launch teaser post', ar: 'منشور التشويق للإطلاق', ch: { en: 'Facebook', ar: 'فيسبوك' }, date: { en: '21 Nov', ar: '21 نوفمبر' }, who: ['wr', 'ds'] },
    { n: 2, stage: 4, en: 'Webinar reminder', ar: 'تذكير الويبينار', ch: { en: 'Instagram', ar: 'إنستجرام' }, date: { en: '23 Nov', ar: '23 نوفمبر' }, who: ['wr'] },
    { n: 3, stage: 0, en: 'Weekly numbers note', ar: 'ملاحظة أرقام الأسبوع', ch: { en: 'Internal', ar: 'داخلي' }, date: { en: '24 Nov', ar: '24 نوفمبر' }, who: ['am'] },
    { n: 4, stage: 1, en: 'Exam fees explainer', ar: 'شرح رسوم الاختبار', ch: { en: 'Facebook', ar: 'فيسبوك' }, date: { en: '25 Nov', ar: '25 نوفمبر' }, who: ['wr'] },
    { n: 5, stage: 3, en: 'Course cover carousel', ar: 'كاروسيل غلاف الدورة', ch: { en: 'Instagram', ar: 'إنستجرام' }, date: { en: '22 Nov', ar: '22 نوفمبر' }, who: ['ds'] },
    { n: 6, stage: 5, en: 'Student story: Mona', ar: 'قصة طالبة: منى', ch: { en: 'Facebook', ar: 'فيسبوك' }, date: { en: '20 Nov', ar: '20 نوفمبر' }, who: ['wr', 'ds'] },
    { n: 7, stage: 6, en: 'Early-bird countdown', ar: 'العد التنازلي للحجز المبكر', ch: { en: 'Instagram', ar: 'إنستجرام' }, date: { en: '19 Nov', ar: '19 نوفمبر' }, who: ['ds'] },
    { n: 8, stage: 7, en: 'Trainer introduction', ar: 'تعريف بالمدرب', ch: { en: 'Facebook', ar: 'فيسبوك' }, date: { en: '15 Nov', ar: '15 نوفمبر' }, who: ['wr'] },
    { n: 9, stage: 8, en: 'Registration ad, set A', ar: 'إعلان التسجيل، المجموعة أ', ch: { en: 'Meta ads', ar: 'إعلانات ميتا' }, date: { en: '12 Nov', ar: '12 نوفمبر' }, who: ['am'] }
  ];
  P.cardRow = function (c, o) {
    o = o || {};
    var st = P.stages[c.stage];
    return '<a class="row" href="' + P.link(o.href || 'card.html') + '" data-card="' + c.n + '"><div class="main"><div class="title">' + T(c.en, c.ar) + '</div><div class="sub"><span class="mono">#' + (100 + c.n) + '</span><span>' + T(c.ch.en, c.ch.ar) + '</span><span>' + T(c.date.en, c.date.ar) + '</span>' + (o.by ? '<span>' + T('Opened by', 'فتحها') + ' ' + P.name(P.agents[o.by]) + '</span>' : '') + '</div></div>' +
      '<div class="end"><span class="chip stage t-' + st.tone + (o.live ? ' live' : '') + '"><span class="dot"></span>' + T(st.en, st.ar) + '</span></div></a>';
  };
  P.boardHTML = function () {
    return '<div class="board">' + P.stages.map(function (st, i) {
      var cs = P.cards.filter(function (c) { return c.stage === i; });
      return '<div class="col t-' + st.tone + '"><h3><span>' + T(st.en, st.ar) + '</span><span>' + cs.length + '</span></h3><div class="body">' + cs.map(function (c) {
        return '<div class="bcard"><div class="bar"><i></i></div><div class="title">' + T(c.en, c.ar) + '</div><div class="meta"><span class="mono">#' + (100 + c.n) + '</span><span>' + T(c.ch.en, c.ch.ar) + '</span><span class="end">' + c.who.map(function (w) { return P.face(P.agents[w], 20); }).join('') + '</span></div></div>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  };

  /* ---------- recent activity rows ---------- */
  P.activity = function (n) {
    var rows = [
      ['wr', 'Writer', 'الكاتب', 'added version 2 to', 'أضاف النسخة 2 إلى', 1, '12 min', '12 د'],
      ['me', 'Omar', 'عمر', 'approved the version on', 'وافق على النسخة في', 2, '1 h', 'ساعة'],
      ['ds', 'Designer', 'المصمم', 'stopped with a question on', 'توقف بسؤال في', 1, '2 h', 'ساعتان'],
      ['cr', 'Critic', 'الناقد', 'flagged the tone in version 1 of', 'نبّه إلى النبرة في النسخة 1 من', 4, '3 h', '3 س'],
      ['am', 'Account manager', 'مدير الحساب', 'opened a card from a conversation:', 'فتح بطاقة من محادثة:', 5, 'Yesterday', 'أمس']
    ].slice(0, n || 5);
    return '<div class="activity">' + rows.map(function (r) {
      var c = P.cards.filter(function (x) { return x.n === r[5]; })[0];
      var who = r[0] === 'me' ? P.avatar(P.me) : P.face(P.agents[r[0]], 28);
      return '<div class="act">' + who + '<div class="text"><b>' + T(r[1], r[2]) + '</b> <span class="what">' + T(r[3], r[4]) + '</span> <a href="' + P.link('card.html') + '"><b>' + T(c.en, c.ar) + '</b></a></div><time>' + T(r[6], r[7]) + '</time></div>';
    }).join('') + '</div>';
  };

  /* ---------- conversations ---------- */
  P.convos = [
    { id: 'launch', en: 'November launch plan', ar: 'خطة إطلاق نوفمبر', priv: true, agent: 'am' },
    { id: 'faq', en: 'Questions about exam fees', ar: 'أسئلة عن رسوم الاختبار', priv: false, agent: 'wr' },
    { id: 'ramadan', en: 'Offer wording for the early-bird price', ar: 'صياغة عرض الحجز المبكر', priv: true, agent: 'am' },
    { id: 'carousel', en: 'Carousel layout ideas', ar: 'أفكار لتصميم الكاروسيل', priv: false, agent: 'ds' },
    { id: 'tone', en: 'Is the teaser tone too formal?', ar: 'هل نبرة التشويق رسمية أكثر من اللازم؟', priv: true, agent: 'cr' }
  ];

  /* ---------- menus and popovers ---------- */
  var openPop = null;
  P.closePop = function () { if (openPop) { openPop.remove(); openPop = null; $$('[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); } };
  /* The @ and / toolbar buttons open their own menus, so the click that opens one must not also dismiss it. */
  document.addEventListener('click', function (e) { if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-pop-trigger],[data-ins]')) P.closePop(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') P.closePop(); });
  /* place a menu next to a trigger, inside `host` (a position:relative ancestor). */
  P.popover = function (host, trigger, html, o) {
    o = o || {};
    P.closePop();
    var m = document.createElement('div');
    m.className = 'menu'; m.setAttribute('role', 'menu'); m.innerHTML = html;
    if (o.width) m.style.width = o.width + 'px';
    host.appendChild(m);
    var h = host.getBoundingClientRect(), t = trigger.getBoundingClientRect();
    var rtl = root.dir === 'rtl';
    if (rtl) m.style.right = Math.max(0, h.right - t.right) + 'px'; else m.style.left = Math.max(0, t.left - h.left) + 'px';
    if (o.up) m.style.bottom = (h.bottom - t.top + 6) + 'px'; else m.style.top = (t.bottom - h.top + 6) + 'px';
    var mb = m.getBoundingClientRect();
    if (mb.right > innerWidth - 8) { m.style.left = Math.max(0, parseFloat(m.style.left || 0) - (mb.right - innerWidth + 8)) + 'px'; }
    if (mb.left < 8 && !rtl) { m.style.left = (parseFloat(m.style.left || 0) + 8 - mb.left) + 'px'; }
    if (mb.left < 8 && rtl) { m.style.right = (parseFloat(m.style.right || 0) - 8 + mb.left) + 'px'; }
    /* items that go nowhere in this prototype (no data-v) are marked by P.item; they close the menu rather than doing nothing */
    $$('.item[aria-disabled]', m).forEach(function (b) { b.addEventListener('click', function () { P.closePop(); }); });
    trigger.setAttribute('aria-expanded', 'true');
    openPop = m;
    return m;
  };
  P.item = function (o) {
    return '<button class="item" role="' + (o.role || 'menuitem') + '"' + (o.checked ? ' aria-checked="true"' : (o.role ? ' aria-checked="false"' : '')) + (o.data ? ' data-v="' + o.data + '"' : '') + (o.disabled ? ' aria-disabled="true" style="opacity:.55"' : (o.data ? '' : P.dead())) + '>' +
      (o.lead || '') + '<span class="grow">' + o.label + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</span>' + (o.tag ? '<span class="tag">' + o.tag + '</span>' : '') + (o.checkable ? ic('check', 'tick') : '') + '</button>';
  };

  /* ---------- the shell ---------- */
  var NAV = {
    primary: [['search', 'search', 'Search', 'بحث', ''], ['home', 'house', 'Home', 'الرئيسية', 'home.html'], ['inbox', 'inbox', 'Inbox', 'الوارد', '', 3]],
    groups: [
      ['Work', 'الشغل', [['work', 'briefcase', 'Work', 'العمل', 'board.html'], ['projects', 'folder-kanban', 'Projects', 'المشاريع', ''], ['routines', 'repeat', 'Routines', 'المهام المتكررة', ''], ['campaigns', 'megaphone', 'Campaigns', 'الحملات', ''], ['library', 'library', 'Library', 'المكتبة', ''], ['publishing', 'send', 'Publishing', 'النشر', '']]],
      ['Results', 'النتائج', [['sales', 'chart-column', 'Sales and customers', 'المبيعات والعملاء', ''], ['performance', 'sparkles', 'Performance', 'الأداء', ''], ['strategy', 'brain', 'Strategy and learning', 'الاستراتيجية والتعلّم', '']]],
      ['Team', 'الفريق', [['team', 'users', 'Agents', 'الوكلاء والأتمتة', 'agents.html'], ['skills', 'list-checks', 'Skills', 'المهارات', ''], ['connections', 'plug', 'Connections', 'الربط', ''], ['history', 'clock', 'Activity log', 'السجل', '']]]
    ]
  };
  function navItem(k, icon, en, ar, href, count, active) {
    return '<a class="nav-item" href="' + (href ? P.link(href) : '#') + '"' + (href ? '' : ' data-dead="1"' + P.dead()) + (active === k ? ' aria-current="page"' : '') + '>' + ic(icon) + '<span class="grow">' + T(en, ar) + '</span>' + (count ? '<span class="count">' + count + '</span>' : '') + '</a>';
  }
  function sidebar(o) {
    var s = '<aside class="sidebar" aria-label="Main navigation"><div class="sidebar-top">' +
      '<button class="company-btn" data-pop-trigger="company" aria-expanded="false" aria-haspopup="menu"><span class="mark">R</span><bdi>RS Learning</bdi>' + ic('chevrons-up-down', 'sm') + '</button>' +
      '<button class="btn toolbar new-btn" data-new="am">' + ic('plus') + T('New', 'جديد') + '</button></div><div class="sidebar-scroll">';
    s += '<div class="nav-group">' + NAV.primary.map(function (n) { return navItem(n[0], n[1], n[2], n[3], n[4], n[5], o.active); }).join('') + '</div>';
    NAV.groups.forEach(function (g) {
      s += '<div class="nav-group"><h2>' + T(g[0], g[1]) + '</h2>' + g[2].map(function (n) { return navItem(n[0], n[1], n[2], n[3], n[4], n[5], o.active); }).join('') + '</div>';
    });
    s += '<div class="nav-group"><h2>' + T('Agents', 'الوكلاء') + '</h2>' + P.agentOrder.map(function (id) {
      var a = P.agents[id];
      return '<a class="nav-item" href="' + P.link('agent.html', { a: id }) + '"' + (o.active === 'agent-' + id ? ' aria-current="page"' : '') + '>' + P.face(a, 20) + '<span class="grow">' + P.name(a) + '</span></a>';
    }).join('') + '</div>';
    s += '<div class="nav-group"><h2>' + T('Recent', 'آخر المحادثات') + '</h2>' + P.convos.map(function (c) {
      return '<a class="nav-item" href="' + P.link('conversation.html', { t: 'end' }) + '"' + (o.active === 'c-' + c.id ? ' aria-current="page"' : '') + '>' + ic(c.priv ? 'lock' : 'users', 'sm') + '<span class="grow">' + T(c.en, c.ar) + '</span></a>';
    }).join('') + '</div></div>';
    s += '<div class="account"><button class="who" data-pop-trigger="account" aria-expanded="false" aria-haspopup="menu">' + P.avatar(P.me) + '<span class="grow"><b>' + T('Omar', 'عمر') + '</b><small>' + T('Agency', 'وكالة') + '</small></span>' + ic('chevrons-up-down', 'sm') + '</button></div></aside>';
    return s;
  }
  function mobileNav(o) {
    var it = [['home', 'house', 'Home', 'الرئيسية', 'home.html'], ['work', 'briefcase', 'Work', 'العمل', 'board.html'], ['new', 'plus', 'New', 'جديد', ''], ['team', 'users', 'Agents', 'الوكلاء', 'agents.html'], ['inbox', 'inbox', 'Inbox', 'الوارد', '']];
    return '<nav class="mobile-nav" aria-label="Quick">' + it.map(function (n) {
      return '<a href="' + (n[4] ? P.link(n[4]) : '#') + '"' + (n[0] === 'new' ? ' data-new="am"' : (n[4] ? '' : ' data-dead="1"' + P.dead())) + (o.active === n[0] ? ' aria-current="page"' : '') + '>' + ic(n[1], 'lg') + T(n[2], n[3]) + '</a>';
    }).join('') + '</nav>';
  }
  /* o: {active, crumbs:[{en,ar,href}], body, hermes:'down', actions, open:'composer'|'account'|'company', composerAgent} */
  P.shell = function (o) {
    var crumbs = (o.crumbs || []).map(function (c, i, all) {
      var last = i === all.length - 1;
      return (i ? '<span class="sep">' + ic('chevron-down', 'sm crumb') + '</span>' : '') + (last ? '<span class="last">' + T(c.en, c.ar) + '</span>' : (c.href ? '<a href="' + P.link(c.href) + '">' : '<a href="#" data-dead="1"' + P.dead() + '>') + T(c.en, c.ar) + '</a>');
    }).join('');
    var chip = o.hermes === 'down' ? '<span class="chip" role="status" aria-label="Hermes can\u2019t be reached" style="border-color:color-mix(in oklab,var(--destructive) 40%,transparent);color:var(--destructive)">' + ic('cloud-off', 'sm') + '<span class="hide-sm">' + T('Hermes can\u2019t be reached', 'تعذّر الوصول إلى Hermes') + '</span></span>' : '';
    var html = '<div class="app' + (o.sheet ? ' sheet-open' : '') + '" id="app">' + sidebar(o) + '<div class="sheet-scrim" data-act="sheet"></div><div class="shell"><header class="topbar"><button class="btn ghost icon menu-btn" data-act="sheet" aria-label="Open the menu">' + ic('menu', 'lg') + '</button><nav class="crumbs" aria-label="Breadcrumb">' + crumbs + '</nav><span class="grow"></span>' + chip + (o.actions || '') + '</header><main class="content' + (o.contentClass ? ' ' + o.contentClass : '') + '" id="main">' + o.body + '</main></div>' + mobileNav(o) + '<div class="scrim" id="composer-scrim" hidden></div></div>';
    return html;
  };
  P.wireShell = function (o) {
    var app = $('#app');
    $$('[data-act="sheet"]').forEach(function (b) { b.addEventListener('click', function () { app.classList.toggle('sheet-open'); }); });
    $$('[data-dead]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); }); });
    $$('[data-new]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); P.openComposer(b.dataset.new); app.classList.remove('sheet-open'); }); });
    $$('[data-pop-trigger="company"], [data-pop-trigger="account"]').forEach(function (b) { /* other triggers (share, face, composer menus) are wired by their own screens */
      b.addEventListener('click', function () {
        if (b.getAttribute('aria-expanded') === 'true') { P.closePop(); return; }
        if (b.dataset.popTrigger === 'company') P.companyMenu(b); else if (b.dataset.popTrigger === 'account') P.accountMenu(b);
      });
    });
    if (o.open === 'account') P.accountMenu($('[data-pop-trigger="account"]'));
    if (o.open === 'company') P.companyMenu($('[data-pop-trigger="company"]'));
    if (o.open === 'composer') P.openComposer(o.composerAgent || 'am');
    if (o.sheet === 'narrow' && matchMedia('(max-width:767px)').matches) app.classList.add('sheet-open');
  };
  P.companyMenu = function (trigger) {
    var host = trigger.closest('.sidebar');
    var cos = [['RS Learning', 'RS Learning', true], ['Aleem', 'عليم', false], ['R&amp;S Consultations', 'آر آند إس للاستشارات', false]];
    var m = P.popover(host, trigger, '<div class="label">' + T('Companies', 'الشركات') + '</div>' + cos.map(function (c) { return P.item({ label: '<bdi>' + (lang() === 'ar' ? c[1] : c[0]) + '</bdi>', lead: '<span class="avatar" style="border-radius:6px">' + c[0].slice(0, 1) + '</span>', checked: c[2], role: 'menuitemradio', checkable: true }); }).join('') + '<hr>' + P.item({ label: T('All companies', 'كل الشركات'), lead: ic('layout-grid') }) + P.item({ label: T('Company settings', 'إعدادات الشركة'), lead: ic('settings') }), { width: 224 });
    m.style.left = m.style.right = ''; m.style.insetInlineStart = '12px'; m.style.top = trigger.offsetTop + trigger.offsetHeight + 6 + 'px';
  };
  P.accountMenu = function (trigger) {
    var host = trigger.closest('.sidebar');
    var th = root.dataset.themeChoice;
    var m = P.popover(host, trigger, '<div class="label"><b style="color:var(--p-fg)">' + T('Omar', 'عمر') + '</b><br><bdi>omar@example.com</bdi></div><hr>' +
      P.item({ label: T('Settings', 'الإعدادات'), lead: ic('settings') }) + P.item({ label: T('Invite people', 'دعوة أشخاص'), lead: ic('user-plus') }) + '<hr><div class="label">' + T('Theme', 'المظهر') + '</div>' +
      [['light', 'sun', 'Light', 'فاتح'], ['dark', 'moon', 'Dark', 'داكن'], ['device', 'monitor', 'Device', 'حسب الجهاز']].map(function (t) { return P.item({ label: T(t[2], t[3]), lead: ic(t[1]), role: 'menuitemradio', checked: th === t[0], checkable: true, data: 'theme:' + t[0] }); }).join('') +
      '<hr><div class="label">' + T('Language', 'اللغة') + '</div>' +
      P.item({ label: 'English', lead: ic('languages'), role: 'menuitemradio', checked: lang() === 'en', checkable: true, data: 'lang:en' }) + P.item({ label: 'العربية', lead: ic('languages'), role: 'menuitemradio', checked: lang() === 'ar', checkable: true, data: 'lang:ar' }) +
      '<hr>' + P.item({ label: T('Sign out', 'تسجيل الخروج'), lead: ic('log-out') }), { up: true, width: 224 });
    m.style.left = m.style.right = ''; m.style.insetInlineStart = '12px'; m.style.bottom = host.clientHeight - trigger.closest('.account').offsetTop + 6 + 'px'; m.style.top = '';
    $$('[data-v]', m).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.dataset.v.split(':'); if (v[0] === 'theme') P.setTheme(v[1]); else P.setLang(v[1]);
        /* the menu stays open so theme and language can both be set; only the ticks move */
        $$('[data-v^="' + v[0] + ':"]', m).forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      });
    });
  };

  /* ---------- the composer (overlay "New" and the dock inside a conversation) ---------- */
  var MENTIONS = [
    ['Cards', 'البطاقات', 'file-text', [['Launch teaser post', 'منشور التشويق للإطلاق'], ['Webinar reminder', 'تذكير الويبينار']]],
    ['Projects', 'المشاريع', 'folder-kanban', [['IFRS launch', 'إطلاق دورة IFRS']]],
    ['Offerings', 'العروض', 'megaphone', [['IFRS Fundamentals course', 'دورة أساسيات IFRS']]],
    ['Library', 'المكتبة', 'image', [['trainer-portrait.jpg', 'trainer-portrait.jpg'], ['brand-voice.pdf', 'brand-voice.pdf']]]
  ];
  var COMMANDS = [
    ['plan', 'Plan first, then wait for my approval', 'خطّط أولًا ثم انتظر موافقتي', false], ['answer', 'Only answer, do not open cards', 'أجب فقط ولا تفتح بطاقات', false],
    ['skill', 'Run one of the agent\u2019s skills', 'شغّل إحدى مهارات الوكيل', false], ['model', 'Change the model for this conversation', 'غيّر النموذج لهذه المحادثة', false],
    ['share', 'Share this conversation with the team', 'شارك هذه المحادثة مع الفريق', false], ['settings', 'Change the agent\u2019s own settings', 'غيّر إعدادات الوكيل نفسه', true]
  ];
  var MODELS = [['default', 'Agent default', 'الوكيل الافتراضي'], ['sonnet', 'Sonnet 5.5', 'Sonnet 5.5'], ['opus', 'Opus 5.5', 'Opus 5.5'], ['sol', 'GPT-6.1 Sol', 'GPT-6.1 Sol']];
  var EFFORTS = [['low', 'Low', 'منخفض'], ['medium', 'Medium', 'متوسط'], ['high', 'High', 'مرتفع']];
  var PROJECTS = [['none', 'No project', 'بدون مشروع'], ['ifrs', 'IFRS launch', 'إطلاق دورة IFRS'], ['ramadan', 'Ramadan offers', 'عروض رمضان']];
  var MODES = [['plan', 'Plan first', 'خطّط أولًا'], ['now', 'Do it now', 'نفّذ الآن'], ['answer', 'Just answer', 'أجب فقط']];

  P.composer = function (o) {
    var overlay = o.variant === 'new', ag = P.agents[o.agent || 'am'];
    var s = '<div class="composer' + (o.down ? ' is-down' : '') + '" id="composer" data-variant="' + o.variant + '" data-agent="' + ag.id + '">';
    if (overlay) {
      s += '<div class="dlg-title">' + T('New conversation', 'محادثة جديدة') + '</div><div class="dlg-head">' +
        '<button class="pill" data-pop-trigger="agent" data-slot="agent" aria-haspopup="menu" aria-expanded="false" aria-label="Agent">' + P.face(ag, 20) + '<b style="color:var(--fg);font-weight:500" data-agent-name>' + P.name(ag) + '</b>' + ic('chevron-down', 'sm') + '</button>' +
        '<button class="pill" data-pop-trigger="project" aria-haspopup="menu" aria-expanded="false">' + ic('folder-kanban', 'sm') + '<span data-project-name>' + T('IFRS launch', 'إطلاق دورة IFRS') + '</span>' + ic('chevron-down', 'sm') + '</button>' +
        '<span class="seg" role="group" aria-label="Mode">' + MODES.map(function (m, i) { return '<button aria-pressed="' + (i === 0) + '" data-mode="' + m[0] + '">' + T(m[1], m[2]) + '</button>'; }).join('') + '</span></div>';
    }
    var ph = o.variant === 'new' ? ['Ask the agent, or describe the work\u2026', 'اسأل الوكيل أو صف العمل\u2026'] : (o.working ? ['Steer the agent while it works\u2026', 'وجّه الوكيل أثناء عمله\u2026'] : ['Reply to the ' + ag.en.toLowerCase() + '\u2026', 'رد على ' + ag.ar + '\u2026']);
    var sample = o.sample ? ' data-sample-en="' + o.sample[0] + '" data-sample-ar="' + o.sample[1] + '"' : '';
    s += '<textarea id="msg" rows="' + (overlay ? 5 : 2) + '"' + A('placeholder', ph[0], ph[1]) + A('aria-label', 'Message', 'الرسالة') + sample + '>' + (o.sample ? o.sample[lang() === 'ar' ? 1 : 0] : '') + '</textarea>';
    s += '<div class="attachments" id="files"></div><div class="listening">' + '<span class="wave"><i></i><i></i><i></i><i></i></span>' + T('Listening\u2026 speak now', 'جارٍ الاستماع\u2026 تحدّث الآن') + '</div>';
    s += '<div class="bar"><button class="pill" id="attach" aria-label="Attach a file">' + ic('paperclip') + '</button>' +
      '<button class="pill" data-ins="@" aria-label="Mention a card or file">' + ic('at-sign') + '</button><button class="pill" data-ins="/" aria-label="Commands">' + ic('slash') + '</button>' +
      '<button class="pill" id="mic" aria-label="Dictate by voice">' + ic('mic') + '</button><span class="grow"></span>' +
      '<button class="pill" data-pop-trigger="model" aria-haspopup="menu" aria-expanded="false"' + A('aria-label', 'Model', 'النموذج') + '>' + ic('brain', 'sm') + '<span data-model-name>' + T('Agent default', 'الوكيل الافتراضي') + '</span>' + ic('chevron-down', 'sm') + '</button>' +
      '<button class="pill" data-pop-trigger="effort" aria-haspopup="menu" aria-expanded="false"' + A('aria-label', 'Reasoning effort', 'جهد التفكير') + '>' + ic('sliders-horizontal', 'sm') + '<span data-effort-name>' + T('Medium', 'متوسط') + '</span>' + ic('chevron-down', 'sm') + '</button>' +
      (o.working ? '<button class="send stop" id="stop" aria-label="Stop the agent">' + ic('square', 'sm') + '</button>' : '') +
      '<button class="send" id="send"' + (o.down ? ' disabled aria-disabled="true"' + A('title', 'Not available while Hermes can\u2019t be reached', 'غير متاح أثناء تعذّر الوصول إلى Hermes') : '') + ' aria-label="Send">' + ic('arrow-up', 'lg') + '</button></div></div>';
    if (overlay) s += '<div class="dlg-foot-note">' + ic('lock', 'sm') + T('Private to you until you share it.', 'خاصة بك حتى تشاركها.') + '<span style="margin-inline-start:auto">' + T('Enter to send, Shift+Enter for a new line', 'Enter للإرسال، Shift+Enter لسطر جديد') + '</span></div>';
    return s;
  };
  P.wireComposer = function (host, o) {
    var c = $('#composer', host), ta = $('#msg', host);
    var anchor = c.closest('.dialog') || c;
    var up = o.variant !== 'new';
    var cur = { project: 'ifrs', model: 'default', effort: 'medium' };
    function menu(trigger, html, opt) { return P.popover(anchor, trigger, html, opt); }
    function bindPick(m, fn) { $$('.item', m).forEach(function (b) { b.addEventListener('click', function () { if (b.getAttribute('aria-disabled')) return; fn(b); P.closePop(); ta.focus(); }); }); }
    $$('[data-pop-trigger]', c).forEach(function (t) {
      t.addEventListener('click', function () {
        if (t.getAttribute('aria-expanded') === 'true') { P.closePop(); return; }
        var k = t.dataset.popTrigger, m;
        if (k === 'agent') {
          m = menu(t, '<div class="label">' + T('Talk to', 'تحدّث مع') + '</div>' + P.agentOrder.map(function (id) { var a = P.agents[id]; return P.item({ label: P.name(a), sub: T(a.blurb.en, a.blurb.ar), lead: P.face(a, 24), checked: id === c.dataset.agent, role: 'menuitemradio', checkable: true, data: id }); }).join(''), { width: 300 });
          bindPick(m, function (b) { var a = P.agents[b.dataset.v]; c.dataset.agent = a.id; t.innerHTML = P.face(a, 20) + '<b style="color:var(--fg);font-weight:500">' + P.name(a) + '</b>' + ic('chevron-down', 'sm'); });
        } else if (k === 'project') {
          m = menu(t, PROJECTS.map(function (p) { return P.item({ label: T(p[1], p[2]), role: 'menuitemradio', checked: p[0] === cur.project, checkable: true, data: p[0] }); }).join(''), { width: 220 });
          bindPick(m, function (b) { var p = PROJECTS.filter(function (x) { return x[0] === b.dataset.v; })[0]; cur.project = p[0]; $('[data-project-name]', c).innerHTML = T(p[1], p[2]); });
        } else if (k === 'model') {
          m = menu(t, '<div class="label">' + T('Models this agent offers', 'النماذج التي يتيحها هذا الوكيل') + '</div>' + MODELS.map(function (p) { return P.item({ label: T(p[1], p[2]), role: 'menuitemradio', checked: p[0] === cur.model, checkable: true, data: p[0] }); }).join(''), { up: up, width: 240 });
          bindPick(m, function (b) { var p = MODELS.filter(function (x) { return x[0] === b.dataset.v; })[0]; cur.model = p[0]; $('[data-model-name]', c).innerHTML = T(p[1], p[2]); });
        } else if (k === 'effort') {
          m = menu(t, '<div class="label">' + T('Reasoning effort', 'جهد التفكير') + '</div>' + EFFORTS.map(function (p) { return P.item({ label: T(p[1], p[2]), role: 'menuitemradio', checked: p[0] === cur.effort, checkable: true, data: p[0] }); }).join(''), { up: up, width: 200 });
          bindPick(m, function (b) { var p = EFFORTS.filter(function (x) { return x[0] === b.dataset.v; })[0]; cur.effort = p[0]; $('[data-effort-name]', c).innerHTML = T(p[1], p[2]); });
        }
      });
    });
    function insert(text, from) {
      var v = ta.value, end = ta.selectionStart;
      ta.value = v.slice(0, from) + text + ' ' + v.slice(end);
      ta.focus(); ta.selectionStart = ta.selectionEnd = from + text.length + 1; syncSend();
    }
    /* In the New dialog the list opens under the toolbar, so the @ and / buttons stay clickable (a second click closes it); a short window scrolls it. */
    function fitBelow(m) {
      var r = m.getBoundingClientRect();
      if (r.bottom > innerHeight - 8) m.style.maxHeight = Math.max(120, innerHeight - 8 - r.top) + 'px';
    }
    function mentionMenu(q, from) {
      var items = '';
      MENTIONS.forEach(function (g) {
        var rows = g[3].filter(function (r) { return !q || r[0].toLowerCase().indexOf(q.toLowerCase()) >= 0 || r[1].indexOf(q) >= 0; });
        if (rows.length) items += '<div class="label">' + T(g[0], g[1]) + '</div>' + rows.map(function (r) { return P.item({ label: T(r[0], r[1]), lead: ic(g[2]), data: (lang() === 'ar' ? r[1] : r[0]) }); }).join('');
      });
      if (!items) items = '<div class="label">' + T('Nothing matches in this company', 'لا شيء مطابق في هذه الشركة') + '</div>';
      var m = P.popover(anchor, $('.bar', c), items, { up: up, width: 300 });
      m.dataset.auto = '@'; m.style.insetInlineStart = '16px'; m.style.left = m.style.right = '';
      if (!up) fitBelow(m);
      bindPick(m, function (b) { insert('@' + b.dataset.v, from); });
    }
    function commandMenu(q, from) {
      var rows = COMMANDS.filter(function (r) { return !q || r[0].indexOf(q) === 0; });
      var m = P.popover(anchor, $('.bar', c), '<div class="label">' + T('Commands', 'الأوامر') + '</div>' + rows.map(function (r) { return P.item({ label: '<span class="mono" dir="ltr">/' + r[0] + '</span>', sub: T(r[1], r[2]), tag: r[3] ? T('Agency only', 'للوكالة فقط') : '', data: r[0], disabled: false }); }).join(''), { up: up, width: 340 });
      m.dataset.auto = '/'; m.style.insetInlineStart = '16px'; m.style.left = m.style.right = '';
      if (!up) fitBelow(m);
      bindPick(m, function (b) { insert($('.mono', b).textContent, from); });
    }
    function detect() {
      var v = ta.value.slice(0, ta.selectionStart), mm = v.match(/(^|\s)@([^\s@]*)$/), cm = v.match(/(^|\n)\/([a-z]*)$/);
      if (mm) mentionMenu(mm[2], v.length - mm[2].length - 1); else if (cm) commandMenu(cm[2], v.length - cm[2].length - 1); else if (openPop && openPop.dataset.auto) P.closePop();
    }
    function syncDir() { if (ta.value.trim() === '') ta.removeAttribute('dir'); else ta.setAttribute('dir', 'auto'); }
    document.addEventListener('protolang', function () { if (c.isConnected) syncDir(); });
    function syncSend() { syncDir(); if (!c.classList.contains('is-down')) $('#send', c).disabled = ta.value.trim() === '' && !$$('.file', c).length; }
    ta.addEventListener('input', function () { detect(); syncSend(); });
    /* The @ and / buttons type the character and open its list; pressing the same button again closes the list. A command starts a line. */
    $$('[data-ins]', c).forEach(function (b) {
      b.addEventListener('click', function () {
        ta.focus();
        if (openPop && openPop.dataset.auto === b.dataset.ins) { P.closePop(); return; }
        var v = ta.value, sep = v && !/\s$/.test(v) ? ' ' : '';
        if (b.dataset.ins === '/' && v && !/\n$/.test(v)) sep = '\n';
        ta.value = v + sep + b.dataset.ins; ta.selectionStart = ta.selectionEnd = ta.value.length; detect(); syncSend();
      });
    });
    $('#attach', c).addEventListener('click', function () {
      var f = document.createElement('span'); f.className = 'file';
      f.innerHTML = ic('file-text', 'sm') + '<bdi>ifrs-launch-brief.pdf</bdi><span class="muted">240 KB</span><button aria-label="Remove">' + ic('x', 'sm') + '</button>';
      $('button', f).addEventListener('click', function () { f.remove(); syncSend(); });
      $('#files', c).appendChild(f); syncSend();
    });
    var voiceTimer;
    $('#mic', c).addEventListener('click', function () {
      var on = c.classList.toggle('voice'); clearTimeout(voiceTimer);
      if (on && !P.param('freeze')) voiceTimer = setTimeout(function () { c.classList.remove('voice'); ta.value += (ta.value ? ' ' : '') + (lang() === 'ar' ? 'اكتب ثلاثة خيارات لتعليق منشور التشويق.' : 'Write three caption options for the teaser post.'); syncSend(); }, 2400);
    });
    $$('.seg button', c).forEach(function (b) { b.addEventListener('click', function () { $$('.seg button', c).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); }); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !openPop) { e.preventDefault(); $('#send', c).click(); } });
    $('#send', c).addEventListener('click', function () { if (o.onSend) o.onSend(ta.value, c); syncSend(); });
    if (o.autoOpen) { setTimeout(function () { ta.focus(); }, 0); }
    syncSend();
    return { ta: ta, detect: detect, openMenu: function (kind) { var t = $('[data-pop-trigger="' + kind + '"]', c); if (t) t.click(); } };
  };
  P.openComposer = function (agent, auto) {
    var scrim = $('#composer-scrim');
    scrim.hidden = false;
    scrim.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-label="New conversation"><button class="btn ghost icon close" aria-label="Close">' + ic('x') + '</button>' + P.composer({ variant: 'new', agent: agent }) + '</div>';
    $('.close', scrim).addEventListener('click', function () { P.closePop(); scrim.hidden = true; scrim.innerHTML = ''; });
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) { P.closePop(); scrim.hidden = true; scrim.innerHTML = ''; } });
    return P.wireComposer(scrim, { variant: 'new', onSend: function (text, c) {
      try { sessionStorage.setItem('proto.sent', text.trim()); } catch (e) { /* the scene then shows its own first message */ }
      location.href = P.link('conversation.html', { a: c.dataset.agent, sent: '1' });
    } });
  };

  /* ---------- the prototype strip: index link, language, theme, motion, per-screen states ---------- */
  var stripCfg = {};
  function syncStrip() {
    var s = $('.strip'); if (!s) return;
    $$('[data-set]', s).forEach(function (b) {
      var k = b.dataset.set.split(':'), v = false;
      if (k[0] === 'lang') v = lang() === k[1]; else if (k[0] === 'theme') v = root.dataset.themeChoice === k[1]; else if (k[0] === 'motion') v = ('reduceMotion' in root.dataset) === (k[1] === 'reduce');
      b.setAttribute('aria-pressed', v);
    });
  }
  P.strip = function (cfg) {
    stripCfg = cfg || {};
    var s = document.createElement('div'); s.className = 'strip'; s.setAttribute('role', 'toolbar'); s.setAttribute('aria-label', 'Prototype controls');
    var h = '<span class="tag">Prototype</span><a href="' + P.link('index.html') + '">' + ic('layout-grid', 'sm') + ' Index</a><span class="sep"></span>' +
      '<button data-set="lang:en" aria-pressed="false">EN</button><button data-set="lang:ar" aria-pressed="false">AR</button><span class="sep"></span>' +
      ['light', 'dark', 'device'].map(function (t) { return '<button data-set="theme:' + t + '" aria-pressed="false">' + t[0].toUpperCase() + t.slice(1) + '</button>'; }).join('') + '<span class="sep"></span>' +
      '<button data-set="motion:reduce" aria-pressed="false" title="Same as prefers-reduced-motion: reduce">Reduce motion</button>';
    (cfg.states || []).forEach(function (st, i) { h += (i === 0 ? '<span class="sep"></span>' : '') + '<a href="' + P.link(st.href, st.q) + '"' + (st.current ? ' aria-current="true"' : '') + '>' + st.label + '</a>'; });
    if (cfg.extra) h += '<span class="sep"></span>' + cfg.extra;
    s.innerHTML = h;
    s.addEventListener('click', function (e) {
      var b = e.target.closest('[data-set]'); if (!b) return;
      var k = b.dataset.set.split(':');
      if (k[0] === 'lang') P.setLang(k[1]); else if (k[0] === 'theme') P.setTheme(k[1]); else if (k[0] === 'motion') P.setMotion(!('reduceMotion' in root.dataset));
    });
    return s;
  };
  P.mount = function (html, wire, strip) {
    var host = document.getElementById('root');
    host.innerHTML = '';
    host.appendChild(P.strip(strip || {}));
    var wrap = document.createElement('div'); wrap.innerHTML = html;
    while (wrap.firstChild) host.appendChild(wrap.firstChild);
    applyLang(); syncStrip();
    if (wire) wire();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (root.dataset.themeChoice === 'device') P.setTheme('device'); });
    document.title = 'Prototype: ' + (strip && strip.title ? strip.title : 'conversation');
  };
})();
