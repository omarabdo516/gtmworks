// Every part whose motion is the approved reference's, as reference rule against built rule (#127). Each later motion
// ticket adds the parts it ports. tests/motion-reference.test.mjs compares the two rules in the files, tokens resolved;
// tests/components/motion.test.tsx reads the part's computed motion in the browser.

/**
 * `ref` is the reference's selector (design-reference/index.html), `built` the product's in `file`. `html` is the part
 * as the product draws it (its tag and the attributes rules read) inside the ancestors `built` names, so the part is
 * the one element `built` matches. `held` is the part's scale while a person holds it down, 1 for a part that does not
 * move (#128); a row without it is not pressed.
 * @typedef {{ ref: string, built: string, file: string, html: string, held?: 0.96 | 0.985 | 0.94 | 1 }} MotionRow
 */

// The widths and languages each part's motion is compared at, in the reference and in the product.
export const languages = ['en', 'ar'];
export const widths = [1440, 390];

/** @type {MotionRow[]} */
export const motionTable = [
  // The Conversation: message times show on hover; the drawer and the details panel slide.
  { ref: '.sender__time', built: '.gw .sender__time', file: 'app/shell.css', html: '<div class="gw"><time class="sender__time"></time></div>' },
  { ref: '.bubble__time', built: '.gw .bubble__time', file: 'app/shell.css', html: '<div class="gw"><time class="bubble__time"></time></div>' },
  { ref: '.sidebar', built: '.gw .sidebar', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"></aside></div>' },
  { ref: '.details', built: '.gw .details', file: 'app/shell.css', html: '<div class="gw"><aside class="details"></aside></div>' },
  { ref: '.try-one__btn', built: '.gw .try-one__btn', file: 'app/shell.css', html: '<div class="gw"><button type="button" class="try-one__btn"></button></div>' },
  { ref: '.suggest button', built: '.gw .suggest button', file: 'app/shell.css', html: '<div class="gw"><div class="suggest"><button type="button"></button></div></div>' },
  // A card an Agent's reply carries rises in when it arrives while the Conversation is open (#136).
  { ref: '.card-in', built: '.gw .reply-card.card-in', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card card-in" role="group"></div></div>' },
  // A question's choice gives under a press and its letter lights up under the pointer; once answered on the open page,
  // the card settles and the check draws (#138). The chosen letter's pop also carries the letter's own colour change, so
  // tests/components/question-card.test.tsx reads it on the answered card.
  { ref: '.opt', built: '.gw .opt', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--question" role="group"><div class="qcard__opts"><button type="button" class="opt">Students</button></div></div></div>', held: 0.985 },
  { ref: '.opt__key', built: '.gw .opt__key', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--question" role="group"><div class="qcard__opts"><button type="button" class="opt"><span class="opt__key">A</span></button></div></div></div>' },
  { ref: '.card.is-just', built: '.gw .reply-card.is-just', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--question is-resolved is-just" role="group"></div></div>' },
  { ref: '.card.is-just .opt__check path', built: '.gw .reply-card.is-just .opt__check path', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--question is-resolved is-just" role="group"><div class="qcard__opts"><div class="opt is-chosen"><svg class="gw-icon opt__check"><path></path></svg></div></div></div></div>' },
  // A step handed to the person (#139): its buttons give under a press; once done on the open page, the card settles and
  // the outcome's check draws.
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="reply-card reply-card--hand" role="group"><div class="card__actions"><a class="btn btn--secondary" href="#">Open the draft</a></div></div></div></div>', held: 0.96 },
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="reply-card reply-card--hand" role="group"><div class="card__actions"><button type="button" class="btn btn--primary">Done it</button></div></div></div></div>', held: 0.96 },
  { ref: '.card.is-just', built: '.gw .reply-card.is-just', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--hand is-resolved is-just" role="group"></div></div>' },
  { ref: '.card.is-just .card__outcome .od-icon path', built: '.gw .reply-card.is-just .card__outcome .gw-icon path', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--hand is-resolved is-just" role="group"><div class="card__outcome"><svg class="gw-icon"><path></path></svg></div></div></div>' },
  // A request to allow an action (#163): it rises in when it arrives while the chat is open, its buttons give under a
  // press, and once decided on the open page the card settles and the outcome's check draws.
  { ref: '.card-in', built: '.gw .reply-card.card-in', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--permission card-in" role="group"></div></div>' },
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="reply-card reply-card--permission" role="group"><div class="card__actions"><button type="button" class="btn btn--secondary">Don’t allow</button></div></div></div></div>', held: 0.96 },
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="reply-card reply-card--permission" role="group"><div class="card__actions"><button type="button" class="btn btn--primary">Allow once</button></div></div></div></div>', held: 0.96 },
  { ref: '.card.is-just', built: '.gw .reply-card.is-just', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--permission is-resolved is-just" role="group"></div></div>' },
  { ref: '.card.is-just .card__outcome .od-icon path', built: '.gw .reply-card.is-just .card__outcome .gw-icon path', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--permission is-resolved is-just" role="group"><div class="card__outcome"><svg class="gw-icon"><path></path></svg></div></div></div>' },
  // An app the Agent asked for (#203): the card rises in when it arrives while the Conversation is open, and Later and
  // Connect give under a press.
  { ref: '.card-in', built: '.gw .reply-card.card-in', file: 'app/shell.css', html: '<div class="gw"><div class="reply-card reply-card--connect card-in" role="group"></div></div>' },
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="reply-card reply-card--connect" role="group"><div class="card__actions"><button type="button" class="btn btn--secondary">Later</button></div></div></div></div>', held: 0.96 },
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="reply-card reply-card--connect" role="group"><div class="card__actions"><button type="button" class="btn btn--primary">Connect</button></div></div></div></div>', held: 0.96 },
  // A reply's steps (#141): the toggle gives under a press and its chevron turns; opened, the steps rise one after another
  // and each check draws itself.
  { ref: '.steps__toggle', built: '.gw .steps__toggle', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="steps"><button type="button" class="steps__toggle" aria-expanded="false">Used 4 tools</button></div></div></div>', held: 0.985 },
  { ref: '.steps__toggle .chev', built: '.gw .steps__toggle .chev', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="steps"><button type="button" class="steps__toggle" aria-expanded="true"><svg class="gw-icon chev"></svg></button></div></div></div>' },
  { ref: '.steps__list.is-just .step', built: '.gw .steps__list.is-just .step', file: 'app/shell.css', html: '<div class="gw"><div class="steps"><ol class="steps__list is-just"><li class="step step--done" style="--i:2"></li></ol></div></div>' },
  { ref: '.steps__list.is-just .step__ck path', built: '.gw .steps__list.is-just .step__ck path', file: 'app/shell.css', html: '<div class="gw"><div class="steps"><ol class="steps__list is-just"><li class="step step--done" style="--i:2"><span class="step__state"><svg class="gw-icon step__ck"><path></path></svg></span></li></ol></div></div>' },
  // The dialog (the ready-made gallery): its entrance, its leave and its search field.
  { ref: '.modal[open]', built: '.gw.modal', file: 'app/shell.css', html: '<div role="dialog" class="gw modal" data-state="open"></div>' },
  { ref: '.modal.is-closing', built: '.gw.modal[data-state="closed"]', file: 'app/shell.css', html: '<div role="dialog" class="gw modal" data-state="closed"></div>' },
  // The gallery keeps its scrim and waits for its leave before the page moves (#130).
  { ref: '.modal.is-closing', built: '.gw.modal.is-closing', file: 'app/shell.css', html: '<div role="dialog" class="gw modal is-closing" data-state="open"></div>' },
  { ref: '.tpl-search input', built: '.gw .tpl-search input', file: 'app/shell.css', html: '<div class="gw"><label class="tpl-search"><input type="search"></label></div>' },
  // Fields: the reason an Owner gives for a no, the settings fields and the Activity log's filters.
  { ref: '.set-input', built: '.gw .ac-card .set-input', file: 'app/shell.css', html: '<div class="gw"><div class="ac-card"><textarea class="set-input set-textarea"></textarea></div></div>' },
  { ref: '.set-input', built: '.gw .sov .set-input', file: 'app/settings.css', html: '<div class="gw"><div class="sov" role="dialog"><input class="set-input" type="text"></div></div>' },
  { ref: '.set-input', built: '.gw :is(.log-page, .numbers-page, .sheet) .set-input', file: 'app/log.css', html: '<div class="gw"><main class="log-page"><select class="set-input"></select></main></div>' },
  // The board: a column lights up under a carried card; an item waiting on the reader.
  { ref: '.col', built: '.gw .board-view .col', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><section class="col"></section></div></div>' },
  { ref: '.mcard', built: '.gw .board-view .mcard', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><a class="mcard" href="#"></a></div></div>' },
  // A chat's Card on the board (#144): the corner pill eases its colours and gives under a press.
  { ref: '.corner-pill', built: '.gw .corner-pill', file: 'app/shell.css', html: '<div class="gw"><div class="chat__corner"><a class="corner-pill" href="#"></a></div></div>', held: 0.96 },
  // A Card that just started waiting on the reader shakes its badge once (#146). Its chat's pill shakes with the same
  // rule, which also carries the pill's own colours and press: tests/components/conversation-card.test.tsx reads it.
  { ref: '.badge--wait.is-new', built: '.gw .kcard .badge--wait.is-new', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><div class="kcard"><span class="badge badge--wait is-new">Waiting on you</span></div></div></div>' },
  // Everything a person can press fades and gives under the finger (#128), wherever it is drawn. The sidebar:
  { ref: '.circle-btn', built: '.gw .circle-btn', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><div class="sb-icons"><a class="circle-btn" href="#" aria-label="New chat"></a></div></aside></div>', held: 0.96 },
  { ref: '.sb-item', built: '.gw .sb-item', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><div class="sb-row"><a class="sb-item" href="#">Board</a></div></aside></div>', held: 0.985 },
  { ref: '.sb-item', built: '.gw .sb-item', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><div class="sb-foot"><button type="button" class="sb-item sb-apps" aria-disabled="true">Connect apps</button></div></aside></div>', held: 1 },
  { ref: '.agent-tile', built: '.gw .agent-tile', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><ul class="agent-grid"><li><a class="agent-tile" href="#">Lead</a></li></ul></aside></div>', held: 0.96 },
  // A tile that arrives in the grid during a visit flashes a ring once (#134). The reference's rule is read alone, without
  // the tile's press above it, so the flash is held to it in tests/components/agent-grid.test.tsx (its computed animation)
  // and by sharedKeyframes below (its frames, tileFlash's).
  { ref: '.sb-add', built: '.gw .sb-add', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><div class="sb-label-row"><button type="button" class="sb-add" aria-label="New channel"></button></div></aside></div>' },
  { ref: '.me', built: '.gw .me', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><div class="sb-foot"><button type="button" class="me" aria-expanded="false">Omar</button></div></aside></div>' },
  { ref: '.menu__item', built: '.gw .menu__item', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><nav class="sb-scroll"></nav><div class="sb-foot"><div class="menu" role="menu"><button type="button" class="menu__item" role="menuitemradio" aria-checked="false">Dark</button></div></div></aside></div>', held: 0.985 },
  { ref: '.menu__item', built: '.gw .menu__item', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><nav class="sb-scroll"></nav><div class="sb-foot"><div class="menu" role="menu"><button type="button" class="menu__item" role="menuitemradio" aria-checked="false" disabled>Dark</button></div></div></aside></div>', held: 1 },
  { ref: '.menu__item', built: '.gw .menu__item', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><nav class="sb-scroll"></nav><div class="sb-foot"><div class="menu" role="menu"><button type="button" class="menu__item" role="menuitem" aria-disabled="true">Connect apps</button></div></div></aside></div>', held: 1 },
  // The chat: its title pill, the composer's buttons (the microphone drawn "Soon" today), the send arrow, a reply's buttons and links.
  { ref: '.head-pill', built: '.gw .head-pill', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="chat__top"><button type="button" class="head-pill">Lead</button></div></div></div>', held: 0.96 },
  { ref: '.composer__btn', built: '.gw .composer__btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="composer"><button type="button" class="composer__btn" aria-label="More"></button></div></div></div>', held: 0.96 },
  { ref: '.composer__btn', built: '.gw .composer__btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="composer"><button type="button" class="composer__btn" aria-disabled="true" aria-label="More · Soon"></button></div></div></div>', held: 1 },
  // The "+" menu rises over the composer, and the "+" turns to a cross while it is open (#153).
  { ref: '.menu', built: '.gw .menu', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="composer"><div class="menu" role="menu" aria-label="More"></div></div></div></div>' },
  // The account menu rises as every menu does; drawn again for the page it was kept open for, it has risen already (#129).
  { ref: '.menu', built: '.gw .menu', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"><div class="sb-foot"><div class="menu me-menu" id="me-menu" role="menu"></div></div></aside></div>' },
  // The composer's border darkens as its field takes the focus (#129).
  { ref: '.composer', built: '.gw .composer', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="composer-area"><div class="composer"></div></div></div></div>' },
  { ref: '.composer__btn .od-icon', built: '.gw .composer__btn .gw-icon', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="composer"><button type="button" class="composer__btn" aria-expanded="true" aria-label="More"><svg class="gw-icon"></svg></button></div></div></div>' },
  { ref: '.composer__send', built: '.gw .composer__send', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="composer"><button type="button" class="composer__send" aria-label="Send"></button></div></div></div>', held: 0.94 },
  { ref: '.composer__send', built: '.gw .composer__send', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="composer"><button type="button" class="composer__send" aria-label="Send" disabled></button></div></div></div>', held: 1 },
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="ac-card"><div class="ac-actions"><button type="button" class="btn btn--primary">Yes</button></div></div></div></div>', held: 0.96 },
  { ref: '.link-btn', built: '.gw .link-btn', file: 'app/shell.css', html: '<div class="gw"><div class="chat"><div class="new-hint"><a class="link-btn new-hint__alt" href="#">Ready-made</a></div></div></div>', held: 0.985 },
  // The details panel: its round buttons, a row that opens a Card, a plain row, a text button; a channel's.
  { ref: '.circle-btn', built: '.gw .circle-btn', file: 'app/shell.css', html: '<div class="gw"><aside class="details"><div class="dp-top"><button type="button" class="circle-btn" aria-label="Close"></button></div></aside></div>', held: 0.96 },
  { ref: '.panel-row', built: '.gw .panel-row', file: 'app/shell.css', html: '<div class="gw"><aside class="details"><ul class="panel-card"><a class="panel-row" href="#">A task</a></ul></aside></div>', held: 0.985 },
  { ref: '.panel-row', built: '.gw .panel-row', file: 'app/shell.css', html: '<div class="gw"><aside class="details"><ul class="panel-card"><li class="panel-row">A file</li></ul></aside></div>', held: 1 },
  { ref: '.link-btn', built: '.gw .link-btn', file: 'app/shell.css', html: '<div class="gw"><aside class="details"><div class="dp-label"><a class="link-btn" href="#">All</a></div></aside></div>', held: 0.985 },
  { ref: '.panel-row', built: '.gw .panel-row', file: 'app/channel.css', html: '<div class="gw"><aside class="details"><ul class="panel-card"><button type="button" class="panel-row tm-add">Add a Member</button></ul></aside></div>', held: 0.985 },
  { ref: '.btn', built: '.gw .btn', file: 'app/channel.css', html: '<div class="gw"><aside class="details"><ul class="panel-card"><li class="panel-row tm-cand"><button type="button" class="btn btn--secondary btn--sm">Add</button></li></ul></aside></div>', held: 0.96 },
  { ref: '.link-btn', built: '.gw .link-btn', file: 'app/channel.css', html: '<div class="gw"><aside class="details"><div class="dp-label"><button type="button" class="link-btn">Done</button></div></aside></div>', held: 0.985 },
  // The ready-made gallery.
  { ref: '.circle-btn', built: '.gw .circle-btn', file: 'app/shell.css', html: '<div role="dialog" class="gw modal" data-state="open"><div class="modal__head"><button type="button" class="circle-btn" aria-label="Close"></button></div></div>', held: 0.96 },
  { ref: '.chip', built: '.gw .chip', file: 'app/shell.css', html: '<div role="dialog" class="gw modal" data-state="open"><div class="tpl-cats"><button type="button" class="chip" aria-pressed="false">Posts</button></div></div>', held: 0.96 },
  { ref: '.btn', built: '.gw .btn', file: 'app/shell.css', html: '<div role="dialog" class="gw modal" data-state="open"><div class="modal__foot"><button type="button" class="btn btn--secondary">Describe it</button></div></div>', held: 0.96 },
  // The board: its buttons, chips, the column pager (disabled at the first column) and the card detail's buttons.
  { ref: '.btn', built: '.gw .btn', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><button class="btn btn--primary btn--sm">New card</button></div></div>', held: 0.96 },
  { ref: '.chip', built: '.gw .chip', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><div class="od-rail"><button type="button" class="chip chip--plain" aria-pressed="true">All</button></div></div></div>', held: 0.96 },
  { ref: '.circle-btn', built: '.gw .circle-btn', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><div class="board-nav"><button type="button" class="circle-btn" aria-label="Next columns"></button></div></div></div>', held: 0.96 },
  { ref: '.circle-btn', built: '.gw .circle-btn', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><div class="board-nav"><button type="button" class="circle-btn" aria-label="Previous columns" disabled></button></div></div></div>', held: 1 },
  { ref: '.link-btn', built: '.gw .link-btn', file: 'app/board.css', html: '<div class="gw"><div class="card-detail"><div class="lg-meta"><button type="button" class="link-btn">Edit</button></div></div></div>', held: 0.985 },
  { ref: '.btn', built: '.gw .btn', file: 'app/board.css', html: '<div class="gw"><div class="card-detail"><div class="lg-edit"><button type="button" class="btn btn--primary">Save</button></div></div></div>', held: 0.96 },
  // The settings overlay.
  { ref: '.sb-item', built: '.gw .sb-item', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><nav class="sov-nav"><a class="sb-item sov-nav__i" href="#">Members</a></nav></div></div>', held: 0.985 },
  { ref: '.circle-btn', built: '.gw .circle-btn', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><header class="sov__bar"><button type="button" class="circle-btn" aria-label="Close"></button></header></div></div>', held: 0.96 },
  { ref: '.btn', built: '.gw .btn', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><button type="button" class="btn btn--secondary btn--sm">Change</button></div></div>', held: 0.96 },
  { ref: '.btn', built: '.gw .btn', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><button type="submit" class="btn btn--primary btn--sm" disabled>Save</button></div></div>', held: 1 },
  { ref: '.chip', built: '.gw .chip', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><div class="od-rail"><a class="chip" href="#">Voice</a></div></div></div>', held: 0.96 },
  { ref: '.link-btn', built: '.gw .link-btn', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><button type="button" class="link-btn rl-remove">Remove</button></div></div>', held: 0.985 },
  { ref: '.panel-row', built: '.gw .panel-row', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><ul class="panel-card"><a class="panel-row sov-ag" href="#">Lead</a></ul></div></div>', held: 0.985 },
  { ref: '.panel-row', built: '.gw .panel-row', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><ul class="panel-card"><button type="button" class="panel-row">Arabic</button></ul></div></div>', held: 0.985 },
  { ref: '.panel-row', built: '.gw .panel-row', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><ul class="panel-card"><li class="panel-row">Owner</li></ul></div></div>', held: 1 },
  // An Agent page's save bar rises in when the draft starts to differ, and flashes when a way out is tried (#161).
  { ref: '.dp-savebar', built: '.gw .sov .dp-savebar', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><div class="dp-savebar sov-savebar" role="region"></div></div></div>' },
  { ref: '.dp-savebar.is-flash', built: '.gw .sov .dp-savebar.is-flash', file: 'app/settings.css', html: '<div class="gw sov-root"><div class="sov" role="dialog"><div class="dp-savebar sov-savebar is-flash" role="region"></div></div></div>' },
  // First run.
  { ref: '.btn', built: '.gw .btn', file: 'app/first-run-choice.css', html: '<div class="gw"><div class="fr" role="dialog"><div class="fr__actions"><button type="submit" class="btn btn--primary">Open</button></div></div></div>', held: 0.96 },
  { ref: '.btn', built: '.gw .btn', file: 'app/first-run-choice.css', html: '<div class="gw"><div class="fr" role="dialog"><div class="fr__actions"><button type="submit" class="btn btn--primary" disabled>Open</button></div></div></div>', held: 1 },
  // The Activity log and Numbers (whose buttons are app/log.css's).
  { ref: '.btn', built: '.gw .btn', file: 'app/log.css', html: '<div class="gw"><main class="log-page"><a class="btn btn--secondary btn--sm" href="#">Older</a></main></div>', held: 0.96 },
  { ref: '.link-btn', built: '.gw .link-btn', file: 'app/log.css', html: '<div class="gw"><main class="log-page"><a class="link-btn lg-card" href="#">A card</a></main></div>', held: 0.985 },
  { ref: '.btn', built: '.gw .btn', file: 'app/log.css', html: '<div class="gw"><main class="numbers-page"><a class="btn btn--secondary btn--sm" href="#">Activity log</a></main></div>', held: 0.96 },
  { ref: '.panel-row', built: '.gw .panel-row', file: 'app/numbers.css', html: '<div class="gw"><main class="numbers-page"><div class="panel-card"><a class="panel-row" href="#">Lead</a></div></main></div>', held: 0.985 },
  // The toast rises in and leaves upward (#157).
  { ref: '.toast', built: '.gw .toast', file: 'app/toast.css', html: '<div class="gw toast-host" role="status"><div class="toast"></div></div>' },
  { ref: '.toast.is-leaving', built: '.gw .toast.is-leaving', file: 'app/toast.css', html: '<div class="gw toast-host" role="status"><div class="toast is-leaving"></div></div>' },
  // The settings overlay fades in and leaves (#130); a Member × Agent switch.
  { ref: '.sov[open]', built: '.gw .sov', file: 'app/settings.css', html: '<div class="gw"><div class="sov" role="dialog"></div></div>' },
  { ref: '.sov.is-closing', built: '.gw .sov.is-closing', file: 'app/settings.css', html: '<div class="gw"><div class="sov is-closing" role="dialog"></div></div>' },
  { ref: '.switch', built: '.gw .sov .switch', file: 'app/settings.css', html: '<div class="gw"><div class="sov" role="dialog"><button type="button" class="switch" role="switch" aria-checked="false"></button></div></div>' },
  // Its thumb travels on the spring and fades its colour, in the settings overlay and the Team dialog (#129). A row may
  // name a part's ::before or ::after; tests/components/motion.test.tsx reads that pseudo-element of the part.
  { ref: '.switch::after', built: '.gw .sov .switch::after', file: 'app/settings.css', html: '<div class="gw"><div class="sov" role="dialog"><button type="button" class="switch" role="switch" aria-checked="true"></button></div></div>' },
  { ref: '.switch::after', built: '.gw .modal.team-dlg .switch::after', file: 'app/settings.css', html: '<div class="gw"><dialog class="gw modal team-dlg" open><button type="button" class="switch" role="switch" aria-checked="false"></button></dialog></div>' },
  // First run fades in and leaves once answered (#130), its column rises, its choices answer the pointer.
  { ref: '.fr[open]', built: '.gw .fr', file: 'app/first-run-choice.css', html: '<div class="gw"><div class="fr" role="dialog"></div></div>' },
  { ref: '.fr.is-closing', built: '.gw .fr.is-closing', file: 'app/first-run-choice.css', html: '<div class="gw"><div class="fr is-closing" role="dialog"></div></div>' },
  { ref: '.fr__col > *', built: '.gw .fr__col > *', file: 'app/first-run-choice.css', html: '<div class="gw"><form class="fr__col"><div class="fr__head"></div></form></div>' },
  { ref: '.cr-kind', built: '.gw .cr-kind', file: 'app/first-run-choice.css', html: '<div class="gw"><label class="cr-kind fr-choice"></label></div>' },
  // An Agent at work on its sidebar tile (#184): its eyes scan, three dots think; when the Run ends, a check pops and draws.
  // The dot's ping is a ::after, which a row cannot name: tests/components/agent-face-dot.test.tsx reads it.
  { ref: '.face.is-thinking .face__f', built: '.gw .face-wrap.is-thinking .face__f', file: 'app/shell.css', html: '<div class="gw"><span class="face-wrap is-thinking"><svg><g class="face__f"></g></svg></span></div>' },
  { ref: '.face-wrap .think', built: '.gw .face-wrap .think', file: 'app/shell.css', html: '<div class="gw"><span class="face-wrap"><span class="think"></span></span></div>' },
  { ref: '.face-wrap .think i', built: '.gw .face-wrap .think i', file: 'app/shell.css', html: '<div class="gw"><span class="face-wrap"><span class="think"><i></i></span></span></div>' },
  { ref: '.face-wrap .done-ck', built: '.gw .face-wrap .done-ck', file: 'app/shell.css', html: '<div class="gw"><span class="face-wrap"><span class="done-ck"></span></span></div>' },
  { ref: '.face-wrap .done-ck .od-icon path', built: '.gw .face-wrap .done-ck .gw-icon path', file: 'app/shell.css', html: '<div class="gw"><span class="face-wrap"><span class="done-ck"><svg class="gw-icon"><path></path></svg></span></span></div>' },
];

// The reference's six motion tokens; the product's carry the gw- prefix (`--dur` is `--gw-dur`).
export const motionTokens = ['--dur-fast', '--dur', '--dur-slow', '--ease-out', '--ease-in', '--ease-spring'];

// The reference's keyframes the product shares, each written once in app/shell.css under its gw- name.
export const sharedKeyframes = { fadeIn: 'gw-fade-in', rise: 'gw-rise', breathe: 'gw-breathe', modalOut: 'gw-modal-out', settle: 'gw-settle', ckPop: 'gw-ck-pop', drawCheck: 'gw-draw-check', nudge: 'gw-nudge', barFlash: 'gw-ring-flash', tileFlash: 'gw-ring-flash' };

/** @param {string} token */
export const builtToken = token => `--gw-${token.slice(2)}`;
