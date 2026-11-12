/* PROTOTYPE (throwaway, #185). One function per screen; each HTML file calls PROTO.screen(name). Fake data only. */
(function () {
  'use strict';
  var P = window.PROTO, T = P.T, ic = P.ic, $ = P.$, $$ = P.$$;
  var S = {};
  var q = function (k, d) { return P.param(k, d); };

  /* ---------- index ---------- */
  var TILES = [
    ['Start work', 'ابدأ العمل', [
      ['composer.html', 'New composer', 'مربع «جديد»', 'The overlay that opens over any page: agent, project, mode, attachments, model and effort, send.', 'يفتح فوق أي صفحة: الوكيل والمشروع والوضع والمرفقات والنموذج والجهد والإرسال.'],
      ['composer.html?open=mention', 'Composer: @ list', 'المربع: قائمة @', 'Typing @ attaches a card, project, offering or library file.', 'كتابة @ تضيف بطاقة أو مشروعًا أو عرضًا أو ملفًا من المكتبة.'],
      ['composer.html?open=command', 'Composer: / commands', 'المربع: أوامر /', 'Typing / lists the commands; agent-changing ones are marked Agency only.', 'كتابة / تعرض الأوامر، وما يغيّر الوكيل نفسه مكتوب عليه «للوكالة فقط».'],
      ['composer.html?open=agent', 'Composer: choose the agent', 'المربع: اختيار الوكيل', 'The account manager is the default; any agent can be chosen.', 'مدير الحساب هو الافتراضي ويمكن اختيار أي وكيل.'],
      ['composer.html?open=voice', 'Composer: dictating', 'المربع: إملاء بالصوت', 'Voice dictation with the browser\u2019s own recognition (simulated here).', 'إملاء بالصوت بتعرّف المتصفح نفسه (محاكاة هنا).']
    ]],
    ['The conversation', 'المحادثة', [
      ['conversation.html', 'Conversation, live', 'المحادثة مباشرة', 'The reply streams, steps show, a choice card asks, a card opens, Hermes tasks and a handoff appear.', 'يتدفق الرد وتظهر الخطوات وتسأل بطاقة اختيار وتُفتح بطاقة وتظهر مهام Hermes وملخص التسليم.'],
      ['conversation.html?t=6600&freeze=1', 'Conversation, mid-reply', 'المحادثة في منتصف الرد', 'A still of the live conversation while the reply is half written.', 'لقطة ثابتة من المحادثة والرد نصف مكتوب.'],
      ['conversation.html?t=end&freeze=1', 'Conversation, finished', 'المحادثة بعد الانتهاء', 'Everything shown: choice card, card row, agent work, handoff summary.', 'كل شيء ظاهر: بطاقة الاختيار وصف البطاقة وعمل الوكلاء وملخص التسليم.'],
      ['conversation-reopened.html', 'Reopened while working', 'أُعيد فتحها والوكيل يعمل', 'What the person sees when they return and the agent is still working.', 'ما يراه الشخص عند عودته والوكيل لا يزال يعمل.'],
      ['conversation-unreachable.html', 'Hermes unreachable', 'تعذّر الوصول إلى Hermes', 'Last known rows with an as-of time; the typed text is kept; the rest of the product works.', 'آخر الصفوف المعروفة مع وقتها، والنص المكتوب محفوظ، وباقي المنتج يعمل.']
    ]],
    ['Cards and agent work', 'البطاقات وعمل الوكلاء', [
      ['card.html', 'Card with Agent work', 'بطاقة وفيها عمل الوكلاء', 'Hermes tasks inside a card, a link to the conversation it came from.', 'مهام Hermes داخل البطاقة ورابط للمحادثة التي جاءت منها.'],
      ['card.html?origin=private', 'Card from a private conversation', 'بطاقة من محادثة خاصة', 'A private parent shows only who opened it.', 'المحادثة الخاصة تظهر باسم من فتحها فقط.'],
      ['card-unreachable.html', 'Card, Hermes unreachable', 'البطاقة وHermes لا يصل', 'Agent work shows the last known rows with an as-of time.', 'عمل الوكلاء يعرض آخر الصفوف المعروفة مع الوقت.'],
      ['board.html', 'Marketing board', 'لوحة التسويق', 'The nine stages, unchanged. Agent work is not a second board.', 'المراحل التسع كما هي. عمل الوكلاء ليس لوحة ثانية.']
    ]],
    ['Agents', 'الوكلاء', [
      ['agents.html', 'Agents list', 'قائمة الوكلاء', 'Every agent with its face, role and state.', 'كل وكيل بوجهه ودوره وحالته.'],
      ['agent.html', 'Agent page: overview', 'صفحة الوكيل: نظرة عامة', 'Large face whose eyes follow the pointer, Paperclip\u2019s section column, overview.', 'وجه كبير تتبع عيناه المؤشر، وعمود الأقسام كما في Paperclip، ونظرة عامة.'],
      ['agent.html?s=work', 'Agent page: agent work', 'صفحة الوكيل: عمل الوكيل', 'Hermes\u2019s own states as a list, no second board.', 'حالات Hermes نفسها في قائمة بلا لوحة ثانية.'],
      ['agent.html?s=skills', 'Agent page: skills', 'صفحة الوكيل: المهارات', 'Skills enabled for this company.', 'المهارات المفعّلة لهذه الشركة.'],
      ['agent.html?s=settings', 'Agent page: Hermes settings (Agency)', 'صفحة الوكيل: إعدادات Hermes (الوكالة)', 'Real Hermes settings; the key is write-only.', 'إعدادات Hermes الحقيقية، والمفتاح للكتابة فقط.'],
      ['agent.html?s=settings&as=owner', 'Agent page: settings (Owner)', 'صفحة الوكيل: الإعدادات (المالك)', 'The same settings, read only.', 'الإعدادات نفسها للقراءة فقط.']
    ]],
    ['Shell', 'الإطار', [
      ['home.html', 'Home and the sidebar', 'الرئيسية والشريط الجانبي', 'Recent conversations in the sidebar, recent-activity rows.', 'آخر المحادثات في الشريط الجانبي وصفوف النشاط الأخير.'],
      ['menu-account.html', 'Account menu', 'قائمة الحساب', 'Settings, invite, theme, language, sign out.', 'الإعدادات والدعوة والمظهر واللغة وتسجيل الخروج.'],
      ['menu-company.html', 'Company switcher', 'مبدّل الشركات', 'Companies the person belongs to; All companies for the Agency.', 'الشركات التي ينتمي إليها الشخص، و«كل الشركات» للوكالة.']
    ]]
  ];
  S.index = function () {
    var h = '<div class="index"><h1>' + T('Conversation, agents and dark mode: prototype', 'المحادثة والوكلاء والوضع الداكن: نموذج أولي') + '</h1><p class="lede">' +
      T('A click-through look at the screens in issue #184, built from the copied Paperclip tokens with sample data only. Every screen follows the language and theme switches above. Nothing is sent to a server; only your language, theme and motion choices and the message you send from New are kept in this browser.',
        'نظرة تفاعلية على شاشات التذكرة 184 مبنية على قيم Paperclip المنسوخة وببيانات تجريبية فقط. كل شاشة تتبع مفتاحَي اللغة والمظهر بالأعلى. لا يُرسل شيء إلى أي خادم، ويُحفظ في هذا المتصفح فقط اختيارك للغة والمظهر والحركة والرسالة التي ترسلها من «جديد».') + '</p>';
    TILES.forEach(function (g) {
      h += '<h2>' + T(g[0], g[1]) + '</h2><div class="grid">' + g[2].map(function (t) {
        var f = t[0].split('?'), qs = f[1] ? Object.fromEntries(new URLSearchParams(f[1])) : {};
        return '<a class="tile" href="' + P.link(f[0], qs) + '"><b>' + T(t[1], t[2]) + '</b><span class="d">' + T(t[3], t[4]) + '</span><span class="f">' + t[0] + '</span></a>';
      }).join('') + '</div>';
    });
    return h + '</div>';
  };

  /* ---------- board and composer ---------- */
  function pageHead(en, ar, extra) { return '<div class="page-head"><h1 class="page-title">' + T(en, ar) + '</h1>' + (extra || '') + '</div>'; }
  var tabs = '<span class="seg" role="group" style="border-color:var(--border)"><button aria-pressed="true" style="color:var(--fg)">' + T('Board', 'لوحة') + '</button><button' + P.dead() + '>' + T('Calendar', 'تقويم') + '</button><button' + P.dead() + '>' + T('List', 'قائمة') + '</button></span>';
  S.board = function (o) {
    o = o || {};
    return { shell: { active: 'work', hermes: o.hermes, crumbs: [{ en: 'Work', ar: 'العمل' }], body: pageHead('Work', 'العمل', tabs) + P.boardHTML() }, strip: { title: 'Board' } };
  };
  S.composer = function () {
    var open = q('open', '');
    return { shell: { active: 'work', crumbs: [{ en: 'Work', ar: 'العمل' }], body: pageHead('Work', 'العمل', tabs) + P.boardHTML(), open: 'composer', composerAgent: 'am' },
      strip: { title: 'New composer' },
      after: function () {
        var ta = $('#msg'), ctl = { ta: ta };
        function fire() { ta.dispatchEvent(new Event('input')); }
        if (open === 'mention') { ta.value = 'Draft three caption options for the teaser. Use the brand voice in @IF'; if (P.lang() === 'ar') ta.value = 'اكتب ثلاثة خيارات لتعليق التشويق بنبرة الهوية في @دورة'; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; fire(); }
        if (open === 'command') { ta.value = '/s'; ta.focus(); ta.selectionStart = ta.selectionEnd = 2; fire(); }
        if (open === 'agent') $('[data-pop-trigger="agent"]').click();
        if (open === 'voice') $('#mic').click();
        return ctl;
      } };
  };

  /* ---------- home, agents ---------- */
  S.home = function (o) {
    o = o || {};
    var stats = [['Waiting for approval', 'تنتظر الموافقة', '3'], ['Cards in progress', 'بطاقات قيد العمل', '12'], ['Delivered this month', 'سُلّمت هذا الشهر', '9'], ['Agent work running', 'عمل وكلاء جارٍ', '2']];
    var body = pageHead('Home', 'الرئيسية') + '<div class="stats">' + stats.map(function (s) { return '<div class="stat"><div class="fig">' + s[2] + '</div><div class="muted">' + T(s[0], s[1]) + '</div></div>'; }).join('') + '</div>' +
      '<div class="two"><section class="panel"><h2 class="section-title">' + T('Recent activity', 'النشاط الأخير') + '</h2>' + P.activity(5) + '</section>' +
      '<section class="panel"><h2 class="section-title" style="margin-bottom:8px">' + T('Agents', 'الوكلاء') + '</h2>' + P.agentOrder.map(function (id) {
        var a = P.agents[id], n = P.tasks.filter(function (t) { return t.agent === id && t.state === 'running'; }).length;
        return '<div class="agent-row" style="padding-inline:0">' + P.face(a, 32) + '<div class="grow"><b style="font-weight:500">' + P.name(a) + '</b><div class="sub">' + (n ? T('Working on ' + n + ' task', 'يعمل على ' + n + ' مهمة') : T('Idle', 'متفرغ')) + '</div></div></div>';
      }).join('') + '</section></div>';
    return { shell: { active: o.active || 'home', crumbs: [{ en: 'Home', ar: 'الرئيسية' }], body: body, open: o.open, sheet: o.sheet }, strip: { title: o.title || 'Home' } };
  };
  S.agents = function () {
    var rows = P.agentOrder.map(function (id) {
      var a = P.agents[id], run = P.tasks.filter(function (t) { return t.agent === id && t.state === 'running'; }).length, blk = P.tasks.filter(function (t) { return t.agent === id && t.state === 'blocked'; }).length;
      var st = blk ? P.chipState('blocked') : (run ? P.chipState('running') : '<span class="chip"><span class="dot"></span>' + T('Idle', 'متفرغ') + '</span>');
      return '<div class="agent-row"><a href="' + P.link('agent.html', { a: id }) + '" style="display:flex;gap:12px;align-items:center;flex:1;min-width:0">' + P.face(a, 44) + '<span class="grow"><b style="font-weight:500">' + P.name(a) + '</b><span class="sub" style="display:block">' + T(a.blurb.en, a.blurb.ar) + '</span></span></a>' + st +
        '<button class="btn sm" data-new="' + id + '">' + ic('message-square', 'sm') + T('Talk', 'تحدّث') + '</button></div>';
    }).join('');
    var body = pageHead('Agents', 'الوكلاء الأتمتة'.replace('الأتمتة', '')) + '<p class="muted" style="max-width:62ch;margin:-8px 0 16px">' + T('One agent per role. Each agent serves several companies; RS Learning has an active grant for all four.', 'وكيل واحد لكل دور. يخدم كل وكيل عدة شركات، ولدى RS Learning إتاحة فعّالة للأربعة.') + '</p><div class="rows" style="background:var(--card)">' + rows + '</div>';
    return { shell: { active: 'team', crumbs: [{ en: 'Team', ar: 'الفريق' }, { en: 'Agents', ar: 'الوكلاء' }], body: body }, strip: { title: 'Agents' } };
  };

  /* ---------- the agent page ---------- */
  S.agent = function () {
    var id = q('a', 'am'), a = P.agents[id], sec = q('s', 'overview'), asOwner = q('as') === 'owner';
    var mine = P.tasks.filter(function (t) { return t.agent === id; });
    var ids = function (arr) { return arr.map(function (t) { return t.id; }); };
    var sections = [['overview', 'house', 'Overview', 'نظرة عامة'], ['work', 'list-checks', 'Agent work', 'عمل الوكيل', mine.length], ['skills', 'sparkles', 'Skills', 'المهارات', 6], ['settings', 'settings', 'Settings', 'الإعدادات']];
    var col = '<nav class="sections" aria-label="Agent sections">' + sections.map(function (s) {
      return '<a href="' + P.link('agent.html', Object.assign({ a: id, s: s[0] }, asOwner ? { as: 'owner' } : {})) + '"' + (sec === s[0] ? ' aria-current="page"' : '') + '>' + ic(s[1]) + T(s[2], s[3]) + (s[4] ? '<span class="count">' + s[4] + '</span>' : '') + '</a>';
    }).join('') + '</nav>';
    var running = mine.filter(function (t) { return t.state === 'running'; }).length;
    var head = '<section class="panel agent-head" data-follow><div id="big-face">' + P.face(a, 104, { eyes: true }) + '</div><div class="info"><h1 class="page-title">' + P.name(a) + '</h1><p class="muted">' + T(a.blurb.en, a.blurb.ar) + '</p><div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">' +
      (running ? P.chipState('running') : '<span class="chip"><span class="dot"></span>' + T('Idle', 'متفرغ') + '</span>') + '<span class="chip">' + ic('plug', 'sm') + T('Hermes agent', 'وكيل Hermes') + '</span></div></div><div class="actions"><button class="btn primary" data-new="' + id + '">' + ic('message-square', 'sm') + T('Start a conversation', 'ابدأ محادثة') + '</button>' +
      '<button class="btn" id="face-btn" data-pop-trigger="face" aria-haspopup="menu" aria-expanded="false">' + ic('sparkles', 'sm') + T('Change face', 'غيّر الوجه') + '</button></div></section>';
    var body;
    if (sec === 'work') {
      var groups = [['running', 'Running', 'قيد التنفيذ'], ['blocked', 'Blocked, waiting for a person', 'متوقفة وتنتظر شخصًا'], ['todo', 'Waiting to start', 'تنتظر البدء', ['todo', 'scheduled', 'ready']], ['review', 'In review', 'قيد المراجعة'], ['triage', 'Triage', 'للفرز'], ['done', 'Done', 'تمّت']];
      body = '<div class="agent-body single"><div class="stack">' + groups.map(function (g) {
        var set = g[3] || [g[0]], list = P.tasks.filter(function (t) { return set.indexOf(t.state) >= 0 && (t.agent === id || id === 'am' && false); });
        if (!list.length) return '';
        return '<section><div class="rows-head"><h2>' + T(g[1], g[2]) + '</h2><span class="muted">' + list.length + '</span></div><div class="rows">' + list.map(function (t) { return P.taskRow(t); }).join('') + '</div></section>';
      }).join('') + '</div></div>';
      if (!mine.length) body = '<div class="panel muted">' + T('No agent work yet.', 'لا يوجد عمل بعد.') + '</div>';
    } else if (sec === 'skills') {
      var sk = [['Caption writing', 'كتابة التعليقات', 'Writes captions in the company voice', 'تكتب التعليقات بصوت الشركة', true], ['Brand voice check', 'مراجعة صوت الهوية', 'Compares a draft with the brand voice file', 'تقارن المسودة بملف صوت الهوية', true], ['Arabic copy edit', 'تحرير النص العربي', 'Fixes grammar and register in Modern Standard Arabic', 'تصحح القواعد والمستوى اللغوي بالعربية الفصحى', true], ['Meta ads reading', 'قراءة إعلانات ميتا', 'Reads campaign results, never edits them', 'تقرأ نتائج الحملات ولا تعدّلها', true], ['Odoo sales read', 'قراءة مبيعات Odoo', 'Reads orders and registrations', 'تقرأ الطلبات والتسجيلات', true], ['Image brief', 'بريف الصور', 'Turns a card into a brief for the designer', 'تحوّل البطاقة إلى بريف للمصمم', false]];
      body = '<div class="agent-body single"><section class="panel flush"><div style="padding:16px 16px 4px"><h2 class="section-title">' + T('Skills enabled for RS Learning', 'المهارات المفعّلة لـ RS Learning') + '</h2></div>' + sk.map(function (s) {
        return '<div class="agent-row"><div class="grow"><b style="font-weight:500">' + T(s[0], s[1]) + '</b><div class="sub">' + T(s[2], s[3]) + '</div></div><button class="toggle" role="switch" aria-checked="' + s[4] + '" aria-label="' + s[0] + '"></button></div>';
      }).join('') + '</section></div>';
    } else if (sec === 'settings') {
      var ro = asOwner;
      var field = function (label, val, extra) { return '<div style="display:flex;flex-direction:column;gap:6px"><label class="muted" style="font-size:13px">' + label + '</label>' + (extra || '<input class="field" value="' + val + '"' + (ro ? ' disabled' : '') + '>') + '</div>'; };
      body = '<div class="agent-body single"><div class="stack"><section class="panel"><h2 class="section-title">' + T('Hermes settings', 'إعدادات Hermes') + '</h2><div class="lock-note" style="margin-top:6px">' + ic(ro ? 'lock' : 'key-round', 'sm') + (ro ? T('These are the settings Hermes holds for this agent. Only the Agency edits them, because one agent serves several companies.', 'هذه هي الإعدادات التي يحتفظ بها Hermes لهذا الوكيل. الوكالة وحدها تعدّلها لأن وكيلًا واحدًا يخدم عدة شركات.') : T('You are editing as the Agency. Changes go to Hermes and apply in every company this agent serves.', 'أنت تعدّل بصفتك الوكالة. تُرسل التغييرات إلى Hermes وتسري في كل شركة يخدمها هذا الوكيل.')) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">' + field(T('Model', 'النموذج'), 'Sonnet 5.5') + field(T('Reasoning effort', 'جهد التفكير'), 'Medium') + field(T('Toolsets', 'مجموعات الأدوات'), 'kanban, web, files') + field(T('Hermes agent id', 'معرّف وكيل Hermes'), a.id === 'am' ? 'account-manager' : a.en.toLowerCase()) + '</div>' +
        '<div class="group-title">' + T('Key', 'المفتاح') + '</div><div class="keybox"><div class="grow"><div><b style="font-weight:500">' + T('A key is set', 'المفتاح مضبوط') + '</b> <bdi dir="ltr" class="mono muted">••••a91f</bdi></div><div class="muted" style="font-size:12px">' + T('Replaced 3 Nov by Omar. The value is never shown again.', 'استُبدل في 3 نوفمبر بواسطة عمر. لا تُعرض قيمته مرة أخرى.') + '</div></div>' + (ro ? '' : '<button class="btn" id="key-btn">' + ic('key-round', 'sm') + T('Replace key', 'استبدال المفتاح') + '</button>') + '</div>' +
        '<div id="key-form" hidden style="margin-top:12px;display:none;flex-direction:column;gap:8px"><input class="field" type="password" placeholder="Paste the new key" aria-label="New key"><div class="muted" style="font-size:12px">' + T('Goes straight to Hermes. gtmworks keeps only the last 4 characters.', 'يذهب مباشرة إلى Hermes. تحتفظ gtmworks بآخر 4 أحرف فقط.') + '</div><div style="display:flex;gap:8px"><button class="btn primary sm" id="key-save">' + T('Save key', 'حفظ المفتاح') + '</button><button class="btn sm" id="key-cancel">' + T('Cancel', 'إلغاء') + '</button></div></div></section>' +
        '<section class="panel"><h2 class="section-title">' + T('This company only', 'لهذه الشركة فقط') + '</h2><p class="muted" style="margin:4px 0 8px">' + T('An Owner controls what belongs to the company.', 'يتحكم المالك فيما يخص الشركة.') + '</p><div class="props"><div class="prop"><span class="k">' + T('Company grant', 'إتاحة الشركة') + '</span><span class="v">' + P.chipState('done').replace(/Done|تمّت/g, function (m) { return m === 'Done' ? 'Active' : 'فعّالة'; }) + '</span></div><div class="prop"><span class="k">' + T('Skills enabled', 'المهارات المفعّلة') + '</span><span class="v"><bdi dir="ltr">5 / 6</bdi></span></div><div class="prop"><span class="k">' + T('Face', 'الوجه') + '</span><span class="v">' + P.face(a, 24) + T('Generated', 'مولَّد') + '</span></div></div></section></div></div>';
    } else {
      var firstIds = ids(mine);
      var side = '<aside class="stack"><section class="panel tight"><h2 class="section-title" style="margin-bottom:4px">' + T('Properties', 'الخصائص') + '</h2><div class="props">' +
        '<div class="prop"><span class="k">' + T('Role', 'الدور') + '</span><span class="v">' + P.name(a) + '</span></div>' +
        '<div class="prop"><span class="k">' + T('Connection', 'الربط') + '</span><span class="v"><span class="logo-mark" aria-hidden="true">H</span>Hermes</span></div>' +
        '<div class="prop"><span class="k">' + T('Model', 'النموذج') + '</span><span class="v">Sonnet 5.5</span></div>' +
        '<div class="prop"><span class="k">' + T('Effort', 'الجهد') + '</span><span class="v">' + T('Medium', 'متوسط') + '</span></div>' +
        '<div class="prop"><span class="k">' + T('Company grant', 'إتاحة الشركة') + '</span><span class="v"><span class="chip stage t-green"><span class="dot"></span>' + T('Active', 'فعّالة') + '</span></span></div>' +
        '<div class="prop"><span class="k">' + T('Skills', 'المهارات') + '</span><span class="v"><bdi dir="ltr">5 / 6</bdi></span></div></div></section></aside>';
      body = '<div class="agent-body"><div class="stack">' + (firstIds.length ? P.agentWork(firstIds) : '') + '<section class="panel"><h2 class="section-title">' + T('Recent activity', 'النشاط الأخير') + '</h2>' + P.activity(4) + '</section></div>' + side + '</div>';
    }
    return { shell: { active: 'agent-' + id, crumbs: [{ en: 'Agents', ar: 'الوكلاء', href: 'agents.html' }, { en: a.en, ar: a.ar }], body: head + '<div class="agent-layout">' + col + '<div>' + body + '</div></div>' },
      strip: { title: 'Agent', states: sec === 'settings' ? [{ href: 'agent.html', q: { a: id, s: 'settings' }, label: 'As Agency', current: !asOwner }, { href: 'agent.html', q: { a: id, s: 'settings', as: 'owner' }, label: 'As Owner', current: asOwner }] : [] },
      after: function () {
        var kb = $('#key-btn'); if (kb) kb.addEventListener('click', function () { $('#key-form').style.display = 'flex'; $('#key-form input').focus(); });
        var kc = $('#key-cancel'); if (kc) kc.addEventListener('click', function () { $('#key-form').style.display = 'none'; });
        var ks = $('#key-save'); if (ks) ks.addEventListener('click', function () { var f = $('#key-form'); $('input', f).value = ''; f.style.display = 'none'; });
        $$('.toggle').forEach(function (t) { t.addEventListener('click', function () { t.setAttribute('aria-checked', t.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); }); });
        var fb = $('#face-btn'), seed = 0;
        fb.addEventListener('click', function () {
          if (fb.getAttribute('aria-expanded') === 'true') { P.closePop(); return; }
          var host = fb.closest('.actions');
          var m = P.popover(host, fb, '<div class="label">' + T('Choose a face for ' + a.en, 'اختر وجهًا لـ' + a.ar) + '</div><div class="picker">' + [0, 1, 2, 3, 4, 5].map(function (n) { return '<button data-n="' + n + '" aria-pressed="' + (n === seed) + '" aria-label="Face ' + (n + 1) + '">' + P.face(a, 44, { seed: n ? a.id + '-v' + n : undefined }) + '</button>'; }).join('') + '</div><div class="label">' + T('Only an Owner can change it. Other companies keep the generated face.', 'المالك وحده يغيّره. باقي الشركات تحتفظ بالوجه المولَّد.') + '</div>', { width: 244 });
          $$('.picker button', m).forEach(function (b) { b.addEventListener('click', function () { seed = +b.dataset.n; $('#big-face').innerHTML = P.face(a, 104, { eyes: true, seed: seed ? a.id + '-v' + seed : undefined }); $$('.picker button', m).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }); });
        });
      } };
  };

  /* ---------- the card ---------- */
  S.card = function (o) {
    o = o || {};
    var c = P.cards[0], origin = q('origin', 'shared'), down = o.hermes === 'down';
    var ids = ['t_2d90b4e1', 't_9c41a7e2', 't_5e08c3f7', 't_7a13d2b6', 't_c3b57d18'];
    var st = P.stages[c.stage];
    var from = origin === 'private' ? '<div class="origin">' + ic('lock', 'sm') + T('Opened by Omar in a private conversation', 'فتحها عمر في محادثة خاصة') + '</div>' : '<div class="origin">' + ic('message-square', 'sm') + T('From the conversation', 'من المحادثة') + ' <a href="' + P.link('conversation.html', { t: 'end' }) + '">' + T('November launch plan', 'خطة إطلاق نوفمبر') + '</a></div>';
    var main = '<div class="stack">' + '<div style="display:flex;flex-direction:column;gap:10px">' + from + '<h1 class="page-title">' + T(c.en, c.ar) + '</h1><div style="display:flex;gap:8px;flex-wrap:wrap"><span class="chip stage t-' + st.tone + '"><span class="dot"></span>' + T(st.en, st.ar) + '</span><span class="chip">' + T('Facebook', 'فيسبوك') + '</span><span class="chip">' + T('Publishes 21 Nov', 'يُنشر 21 نوفمبر') + '</span></div></div>' +
      '<section class="panel"><h2 class="section-title" style="margin-bottom:8px">' + T('Caption', 'التعليق') + '</h2><p class="caption-text">' + T('Registrations for IFRS Fundamentals open on 24 November. Three questions we hear every week: how long is the course, what does the exam cost, and can I study after work? Answers in the thread below.', 'يفتح التسجيل في دورة أساسيات IFRS يوم 24 نوفمبر. ثلاثة أسئلة نسمعها كل أسبوع: كم مدة الدورة، وكم تكلفة الاختبار، وهل أستطيع الدراسة بعد العمل؟ الإجابات في التعليقات.') + '</p></section>' +
      P.agentWork(ids, { stale: down }) +
      '<section class="panel"><h2 class="section-title">' + T('Activity', 'النشاط') + '</h2>' + P.activity(3) + '</section></div>';
    var side = '<aside class="stack"><section class="panel tight"><h2 class="section-title" style="margin-bottom:4px">' + T('Properties', 'الخصائص') + '</h2><div class="props">' +
      '<div class="prop"><span class="k">' + T('Stage', 'المرحلة') + '</span><span class="v"><span class="chip stage t-' + st.tone + '"><span class="dot"></span>' + T(st.en, st.ar) + '</span></span></div>' +
      '<div class="prop"><span class="k">' + T('Mode', 'الوضع') + '</span><span class="v"><span class="chip"><span class="dot" style="background:var(--pastel-am)"></span>' + T('Plan first', 'خطّط أولًا') + '</span></span></div>' +
      '<div class="prop"><span class="k">' + T('Offering', 'العرض') + '</span><span class="v">' + T('IFRS Fundamentals course', 'دورة أساسيات IFRS') + '</span></div>' +
      '<div class="prop"><span class="k">' + T('Assignees', 'المكلّفون') + '</span><span class="v">' + P.face(P.agents.wr, 24) + P.face(P.agents.ds, 24) + '</span></div>' +
      '<div class="prop"><span class="k">' + T('Approval', 'الموافقة') + '</span><span class="v">' + T('Needs a Manager', 'تحتاج مديرًا') + '</span></div></div></section></aside>';
    return { shell: { active: 'work', hermes: o.hermes, crumbs: [{ en: 'Work', ar: 'العمل', href: 'board.html' }, { en: c.en, ar: c.ar }], body: '<div class="card-layout">' + main + side + '</div>' },
      strip: { title: 'Card', states: [{ href: 'card.html', q: {}, label: 'Shared origin', current: !down && origin === 'shared' }, { href: 'card.html', q: { origin: 'private' }, label: 'Private origin', current: !down && origin === 'private' }, { href: 'card-unreachable.html', q: {}, label: 'Hermes unreachable', current: down }] } };
  };

  /* ---------- the conversation: a timeline that streams, then waits for the person ---------- */
  var END = 14000, CHOICE_AT = 11200;
  var REPLY = {
    en: ['I read the course brief and the calendar for 17 to 30 November. The teaser should go out this week, the webinar reminder next week, and the early-bird price closes the day before the launch.', 'I opened a card for the teaser post and asked the writer, designer and critic to start. Before I fix the order of the channels, I need one decision from you.'],
    ar: ['قرأت بريف الدورة وتقويم المحتوى من 17 إلى 30 نوفمبر. يخرج منشور التشويق هذا الأسبوع وتذكير الويبينار الأسبوع القادم، وينتهي سعر الحجز المبكر قبل الإطلاق بيوم.', 'فتحت بطاقة لمنشور التشويق وطلبت من الكاتب والمصمم والناقد أن يبدؤوا. قبل أن أحدد ترتيب القنوات أحتاج منك قرارًا واحدًا.']
  };
  var STEPS = [
    [600, 1800, 'Read the course brief: IFRS Fundamentals', 'قرأ بريف الدورة: أساسيات IFRS', 'file-text'],
    [1800, 3000, 'Checked the calendar for 17 to 30 November', 'راجع التقويم من 17 إلى 30 نوفمبر', 'calendar'],
    [5200, 7400, 'Opening a card: Launch teaser post', 'يفتح بطاقة: منشور التشويق للإطلاق', 'plus'],
    [7400, 10200, 'Asking the writer, designer and critic to start', 'يطلب من الكاتب والمصمم والناقد البدء', 'users']
  ];
  /* The agent chosen in the New composer (?a=) runs the scene. The scripted plan belongs to the account manager; any other agent
     reads the brief and calendar and asks the same question, without claiming to open cards or ask other agents. */
  var STEPS_OTHER = STEPS.slice(0, 2).concat([[5200, 7400, 'Drafting an answer from the brief', 'يكتب ردًا من البريف', 'file-text'], [7400, 10200, 'Preparing one question for you', 'يجهّز سؤالًا واحدًا لك', 'circle-alert']]);
  var REPLY_OTHER = {
    en: ['I read the course brief and the calendar for 17 to 30 November. The teaser should go out this week, the webinar reminder next week, and the early-bird price closes the day before the launch.', 'Before I fix the order of the channels, I need one decision from you.'],
    ar: ['قرأت بريف الدورة وتقويم المحتوى من 17 إلى 30 نوفمبر. يخرج منشور التشويق هذا الأسبوع وتذكير الويبينار الأسبوع القادم، وينتهي سعر الحجز المبكر قبل الإطلاق بيوم.', 'قبل أن أحدد ترتيب القنوات أحتاج منك قرارًا واحدًا.']
  };
  function sentText() { try { return sessionStorage.getItem('proto.sent') || ''; } catch (e) { return ''; } }
  S.conversation = function (o) {
    o = o || {};
    var state = o.state || 'live', down = state === 'down';
    var startT = o.start != null ? o.start : 0;
    var title = T('November launch plan', 'خطة إطلاق نوفمبر'), am = P.agents[q('a', 'am')] || P.agents.am, isAm = am.id === 'am';
    var STEPS_NOW = isAm ? STEPS : STEPS_OTHER, REPLY_NOW = isAm ? REPLY : REPLY_OTHER, sent = q('sent') ? sentText() : '';
    var agentIds = ['t_9c41a7e2', 't_5e08c3f7', 't_7a13d2b6'];
    var banner = '';
    if (state === 'reopened') banner = '<div class="notice info" id="banner">' + ic('refresh-cw', 'sm') + '<div class="grow"><b>' + T('You are back in a conversation that is still running.', 'عدت إلى محادثة لا تزال جارية.') + '</b><br>' + T('You were away for 3 minutes. Hermes kept working; what happened meanwhile is shown below and the rest streams in.', 'غبت 3 دقائق. واصل Hermes عمله، وما حدث أثناء غيابك ظاهر أدناه وما تبقى يصل تباعًا.') + '</div></div>';
    if (down) banner = '<div class="notice" id="banner">' + ic('cloud-off', 'sm') + '<div class="grow"><b>' + T('Hermes can\u2019t be reached.', 'تعذّر الوصول إلى Hermes.') + '</b><br>' + T('You can read the conversation as it was at 10:44. Your message stays in the box until it is sent.', 'يمكنك قراءة المحادثة كما كانت عند 10:44. تبقى رسالتك في المربع حتى تُرسل.') + '</div><button class="btn sm" id="retry">' + ic('refresh-cw', 'sm') + T('Try again', 'حاول مرة أخرى') + '</button></div>';
    var steps = '<div class="steps" aria-label="Agent steps">' + STEPS_NOW.map(function (s, i) { return '<div class="step reveal" data-i="' + i + '"><span class="state"></span><span>' + T(s[2], s[3]) + '</span></div>'; }).join('') + '</div>';
    var share = '<div style="position:relative"><button class="btn sm" id="share" data-pop-trigger="share" aria-haspopup="menu" aria-expanded="false">' + ic('lock', 'sm') + '<span id="share-label">' + T('Private', 'خاصة') + '</span>' + ic('chevron-down', 'sm') + '</button></div>';
    var statusChip = '<span id="status"></span>';
    var head = '<div class="convo-head">' + P.face(am, 40, { eyes: true }) + '<div class="grow"><h1>' + title + '</h1><div class="sub">' + T('with', 'مع') + ' ' + P.name(am) + ' · RS Learning</div></div>' + statusChip + share + '</div>';
    var me = '<div class="msg me"><div class="byline"><span class="when">10:41</span><b>' + T('Omar', 'عمر') + '</b>' + P.avatar(P.me) + '</div><div class="bubble"' + (sent ? ' dir="auto" id="first-msg"></div></div>' : '>' + T('We launch the IFRS Fundamentals course on 24 November. I need a two-week content plan for Facebook and Instagram, and a teaser post for this week.', 'نطلق دورة أساسيات IFRS يوم 24 نوفمبر. أحتاج خطة محتوى لأسبوعين لفيسبوك وإنستجرام، ومنشور تشويق لهذا الأسبوع.') + '</div></div>');
    var choice = '<div class="choice reveal" id="choice" role="group" aria-label="Question from the agent"><div class="kicker">' + ic('circle-alert', 'sm') + T('Needs your decision', 'تحتاج قرارك') + '</div><div class="q">' + T('Which channel should lead the teaser?', 'أي قناة تبدأ بها حملة التشويق؟') + '</div><div class="opts" role="radiogroup">' +
      [['Facebook first', 'فيسبوك أولًا', 'Most of the last webinar\u2019s registrations came from Facebook', 'أغلب تسجيلات الويبينار السابق جاءت من فيسبوك'], ['Instagram first', 'إنستجرام أولًا', 'Better for the cover carousel', 'أفضل لكاروسيل الغلاف'], ['Both on the same day', 'الاثنتان في اليوم نفسه', 'One caption, two images', 'تعليق واحد وصورتان']].map(function (o2) {
        return '<button class="opt" role="radio" aria-checked="false"><span class="radio"></span><span><b style="font-weight:500">' + T(o2[0], o2[1]) + '</b><small>' + T(o2[2], o2[3]) + '</small></span></button>';
      }).join('') + '</div><div class="actions"><button class="btn primary sm" id="answer-btn" disabled>' + T('Send answer', 'أرسل الإجابة') + '</button><span class="muted" id="answered" hidden></span></div></div>';
    var agentMsg = '<div class="msg" id="agent-msg"><div class="byline">' + P.face(am, 24) + P.name(am) + '<span class="when">10:42</span></div>' + steps +
      '<div class="text" id="text"><p><span lang="en"></span><span lang="ar"></span></p><p><span lang="en"></span><span lang="ar"></span></p></div>' +
      '<div class="reveal" id="cardrow" data-at="10600"><div class="rows-head" style="margin-top:6px"><h3>' + T('Card opened in this conversation', 'بطاقة فُتحت في هذه المحادثة') + '</h3></div><div class="rows">' + P.cardRow(P.cards[0], { live: !down, by: am.id }) + '</div></div>' + choice + '</div>';
    var work = '<div class="reveal" id="work" data-at="12200">' + P.agentWork(agentIds, { stale: down }) + '</div>';
    var t1 = P.tasks[0];
    var handoff = '<div class="msg reveal" id="handoff" data-at="13200"><div class="byline">' + P.face(am, 24) + P.name(am) + '<span class="when">' + T('Handed off a finished task', 'سلّم مهمة مكتملة') + '</span></div><div class="rows">' + P.taskRow(t1) + '</div></div>';
    var body = '<div class="convo-scroll" data-follow id="scroll"><div class="convo">' + head + banner + me + agentMsg + work + handoff + '</div></div><div class="dock" id="dock"></div>';
    var crumbs = [{ en: 'Conversations', ar: 'المحادثات' }, { en: 'November launch plan', ar: 'خطة إطلاق نوفمبر' }];
    var qs = { live: 'conversation.html', reopened: 'conversation-reopened.html', down: 'conversation-unreachable.html' };
    return { shell: { active: 'c-launch', hermes: down ? 'down' : undefined, crumbs: crumbs, body: body, contentClass: 'convo-page' },
      strip: { title: 'Conversation', states: [{ href: 'conversation.html', q: {}, label: 'Live', current: state === 'live' && !q('freeze') }, { href: 'conversation.html', q: { t: '6600', freeze: '1' }, label: 'Mid-reply' }, { href: 'conversation.html', q: { t: 'end', freeze: '1' }, label: 'Finished' }, { href: 'conversation-reopened.html', q: {}, label: 'Reopened', current: state === 'reopened' }, { href: 'conversation-unreachable.html', q: {}, label: 'Unreachable', current: down }] },
      after: function () { var fm = $('#first-msg'); if (fm) fm.textContent = sent; conversationEngine({ state: state, start: startT, down: down, steps: STEPS_NOW, reply: REPLY_NOW, agent: am }); } };
  };
  function conversationEngine(o) {
    var scroll = $('#scroll'), dock = $('#dock'), textEls = $$('#text p'), stopped = false, mode = '', t = 0, raf = 0, t0 = 0, ctl = null, kept = '';
    var end = q('t') === 'end' || o.down ? END : (q('t') ? +q('t') : o.start);
    var frozen = !!q('freeze') || o.down || P.reduced();
    var shared = false, answered = false;
    function setStatus(kind) {
      var s = $('#status'); if (!s) return;
      if (o.down) s.innerHTML = '<span class="chip"><span class="dot"></span>' + T('Last known state', 'آخر حالة معروفة') + '</span>';
      else if (kind === 'work') s.innerHTML = '<span class="chip stage t-blue live"><span class="dot"></span>' + T('Working', 'يعمل') + '</span>';
      else if (kind === 'wait') s.innerHTML = '<span class="chip stage t-amber"><span class="dot"></span>' + T('Waiting for your answer', 'ينتظر إجابتك') + '</span>';
      else if (kind === 'stop') s.innerHTML = '<span class="chip"><span class="dot"></span>' + T('Stopped by you', 'أوقفته أنت') + '</span>';
      else s.innerHTML = '';
    }
    /* The composer is built once. When the conversation changes state only the placeholder and the Stop button change, in place, so the
       draft, its direction, Send, the chosen model and effort, attachments and focus all stay as they are. */
    function wireStop() { var st = $('#stop', dock); if (st) st.addEventListener('click', function () { stopped = true; cancelAnimationFrame(raf); render(t, true); drawDock('idle'); setStatus('stop'); }); }
    function drawDock(m) {
      if (m === mode) return;
      var first = !ctl; mode = m;
      var html = P.composer({ variant: 'dock', agent: o.agent.id, working: m === 'work', down: o.down, sample: o.down ? ['Also add an Arabic version of the captions, please.', 'أضف أيضًا نسخة عربية للتعليقات من فضلك.'] : null });
      if (first) {
        dock.innerHTML = html + '<p class="hint">' + (o.down ? T('The agent can\u2019t be reached. Your text is kept; send it when Hermes is back.', 'لا يمكن الوصول إلى الوكيل. نصك محفوظ، أرسله عندما يعود Hermes.') : T('Agents prepare the work. Approving, publishing and spending stay with people.', 'الوكلاء يجهّزون العمل. الموافقة والنشر والصرف تبقى بيد الأشخاص.')) + '</p>';
        ctl = P.wireComposer(dock, { variant: 'dock', onSend: sendMsg });
        wireStop();
        var rt = $('#retry'); if (rt) rt.onclick = function () { var sp = rt.querySelector('svg'); rt.disabled = true; sp.classList.add('spin'); setTimeout(function () { rt.disabled = false; sp.classList.remove('spin'); }, 1200); };
        return;
      }
      var next = document.createElement('div'); next.innerHTML = html;
      var nta = $('#msg', next), ta = ctl.ta;
      ta.setAttribute('placeholder', nta.getAttribute('placeholder')); ta.dataset.en = nta.dataset.en; ta.dataset.ar = nta.dataset.ar;
      var stop = $('#stop', dock), want = $('#stop', next);
      if (stop && !want) stop.remove();
      if (!stop && want) { $('.bar', dock).insertBefore(want, $('#send', dock)); wireStop(); }
    }
    function sendMsg(text) {
      text = (text || '').trim(); if (!text) return;
      var d = document.createElement('div'); d.className = 'msg me';
      d.innerHTML = '<div class="byline"><span class="when">' + (mode === 'work' ? T('Sent while the agent was working', 'أُرسلت والوكيل يعمل') : '10:46') + '</span><b>' + T('Omar', 'عمر') + '</b>' + P.avatar(P.me) + '</div><div class="bubble" dir="auto"></div>';
      $('.bubble', d).textContent = text; $('.convo').appendChild(d); ctl.ta.value = ''; scroll.scrollTop = scroll.scrollHeight;
    }
    function render(now, instant) {
      t = now;
      o.steps.forEach(function (s, i) {
        var el = $('.step[data-i="' + i + '"]'), on = now >= s[0], done = now >= s[1];
        el.classList.toggle('on', on); el.classList.toggle('done', done); el.classList.toggle('run', on && !done);
        el.querySelector('.state').innerHTML = done ? ic('circle-check', 'state') : ic('loader', 'spin');
      });
      var from = 3200, to = 10400, f = Math.max(0, Math.min(1, (now - from) / (to - from)));
      ['en', 'ar'].forEach(function (L) {
        var full = o.reply[L], total = full[0].length + full[1].length, n = Math.round(f * total);
        var a = full[0].slice(0, n), b = full[1].slice(0, Math.max(0, n - full[0].length));
        textEls[0].querySelector('[lang=' + L + ']').textContent = a; textEls[1].querySelector('[lang=' + L + ']').textContent = b;
      });
      $$('#text .caret').forEach(function (c) { c.remove(); });
      if (f > 0 && f < 1 && !stopped) { var p = textEls[f * (o.reply.en[0].length + o.reply.en[1].length) <= o.reply.en[0].length ? 0 : 1]; var c = document.createElement('i'); c.className = 'caret'; p.appendChild(c); }
      textEls[0].parentNode.style.display = f > 0 ? '' : 'none';
      [['#cardrow', 10600], ['#choice', CHOICE_AT], ['#work', 12200], ['#handoff', 13200]].forEach(function (r) { $(r[0]).classList.toggle('on', now >= r[1]); });
      var working = (now < CHOICE_AT || answered) && !stopped && !o.down;
      setStatus(o.down ? '' : stopped ? 'stop' : working ? 'work' : 'wait');
      drawDock(working ? 'work' : 'idle');
      if (!o.down) scroll.scrollTop = scroll.scrollHeight;
    }
    var picked = null;
    $$('.opt').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        picked = b; $$('.opt').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
        $('#answer-btn').disabled = false;
      });
    });
    $('#answer-btn').addEventListener('click', function () {
      if (!picked) return;
      $$('.opt').forEach(function (x) { x.disabled = true; });
      $('#answer-btn').hidden = true;
      var a = $('#answered'); a.hidden = false; a.innerHTML = T('You answered:', 'أجبت:') + ' <b>' + picked.querySelector('b').innerHTML + '</b>. ' + T('The ' + o.agent.en.toLowerCase() + ' continues.', 'يواصل ' + o.agent.ar + ' العمل.');
      answered = true; render(t, true);
    });
    var shareBtn = $('#share');
    shareBtn.addEventListener('click', function () {
      if (shareBtn.getAttribute('aria-expanded') === 'true') { P.closePop(); return; }
      var m = P.popover(shareBtn.parentNode, shareBtn, P.item({ label: T('Private', 'خاصة'), sub: T('Only you can read it', 'أنت وحدك تقرؤها'), lead: ic('lock'), role: 'menuitemradio', checked: !shared, checkable: true, data: 'p' }) + P.item({ label: T('Shared with the team', 'مشاركة مع الفريق'), sub: T('Everyone in RS Learning can read it', 'كل أعضاء RS Learning يقرؤونها'), lead: ic('users'), role: 'menuitemradio', checked: shared, checkable: true, data: 's' }), { width: 280 });
      m.style.insetInlineEnd = '0'; m.style.left = m.style.right = '';
      var mr = m.getBoundingClientRect(); /* keep the menu on screen when the button sits near either edge (phones) */
      if (mr.left < 8) m.style.transform = 'translateX(' + (8 - mr.left) + 'px)'; else if (mr.right > innerWidth - 8) m.style.transform = 'translateX(' + (innerWidth - 8 - mr.right) + 'px)';
      $$('.item', m).forEach(function (b) { b.addEventListener('click', function () { shared = b.dataset.v === 's'; $('#share-label').innerHTML = shared ? T('Shared with the team', 'مشاركة مع الفريق') : T('Private', 'خاصة'); shareBtn.querySelector('svg').outerHTML = ic(shared ? 'users' : 'lock', 'sm'); P.closePop(); }); });
    });
    document.addEventListener('protomotion', function () { if (P.reduced()) { cancelAnimationFrame(raf); render(END, true); } });
    if (frozen || P.reduced()) { render(P.reduced() && !q('freeze') && !o.down ? END : end, true); return; }
    render(end, true);
    t0 = performance.now() - end;
    (function loop() { var now = Math.min(END, performance.now() - t0); render(now); if (now < END && !stopped) raf = requestAnimationFrame(loop); })();
    window.PROTO.replay = function () { cancelAnimationFrame(raf); stopped = false; t0 = performance.now(); (function loop() { var now = Math.min(END, performance.now() - t0); render(now); if (now < END && !stopped) raf = requestAnimationFrame(loop); })(); };
  }

  /* ---------- screens that are the shell with a menu open ---------- */
  S['menu-account'] = function () { return S.home({ open: 'account', sheet: 'narrow', active: 'home', title: 'Account menu' }); };
  S['menu-company'] = function () { return S.home({ open: 'company', sheet: 'narrow', active: 'home', title: 'Company switcher' }); };
  S['conversation-reopened'] = function () { return S.conversation({ state: 'reopened', start: 7000 }); };
  S['conversation-unreachable'] = function () { return S.conversation({ state: 'down' }); };
  S['card-unreachable'] = function () { return S.card({ hermes: 'down' }); };

  P.screen = function (name) {
    if (name === 'index') {
      document.body.classList.add('index-body');
      P.mount(S.index(), null, { title: 'Index' });
      return;
    }
    var def = S[name]();
    P.mount(P.shell(def.shell), function () { P.wireShell(def.shell); if (def.after) def.after(); }, def.strip);
  };
})();
