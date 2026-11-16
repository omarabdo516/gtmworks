// Every part whose motion is the approved reference's, as reference rule against built rule (#127). Each later motion
// ticket adds the parts it ports. tests/motion-reference.test.mjs compares the two rules in the files, tokens resolved;
// tests/components/motion.test.tsx reads the part's computed motion in the browser.

/**
 * `ref` is the reference's selector (design-reference/index.html), `built` the product's in `file`. `html` is the part
 * as the product draws it (its tag and the attributes rules read) inside the ancestors `built` names, so the part is
 * the one element `built` matches.
 * @typedef {{ ref: string, built: string, file: string, html: string }} MotionRow
 */

/** @type {MotionRow[]} */
export const motionTable = [
  // The Conversation: message times show on hover; the drawer and the details panel slide.
  { ref: '.sender__time', built: '.gw .sender__time', file: 'app/shell.css', html: '<div class="gw"><time class="sender__time"></time></div>' },
  { ref: '.bubble__time', built: '.gw .bubble__time', file: 'app/shell.css', html: '<div class="gw"><time class="bubble__time"></time></div>' },
  { ref: '.sidebar', built: '.gw .sidebar', file: 'app/shell.css', html: '<div class="gw"><aside class="sidebar"></aside></div>' },
  { ref: '.details', built: '.gw .details', file: 'app/shell.css', html: '<div class="gw"><aside class="details"></aside></div>' },
  { ref: '.try-one__btn', built: '.gw .try-one__btn', file: 'app/shell.css', html: '<div class="gw"><button type="button" class="try-one__btn"></button></div>' },
  // The dialog (the ready-made gallery): its entrance, its leave and its search field.
  { ref: '.modal[open]', built: '.gw.modal', file: 'app/shell.css', html: '<div role="dialog" class="gw modal" data-state="open"></div>' },
  { ref: '.modal.is-closing', built: '.gw.modal[data-state="closed"]', file: 'app/shell.css', html: '<div role="dialog" class="gw modal" data-state="closed"></div>' },
  { ref: '.tpl-search input', built: '.gw .tpl-search input', file: 'app/shell.css', html: '<div class="gw"><label class="tpl-search"><input type="search"></label></div>' },
  // Fields: the reason an Owner gives for a no, the settings fields and the Activity log's filters.
  { ref: '.set-input', built: '.gw .ac-card .set-input', file: 'app/shell.css', html: '<div class="gw"><div class="ac-card"><textarea class="set-input set-textarea"></textarea></div></div>' },
  { ref: '.set-input', built: '.gw .sov .set-input', file: 'app/settings.css', html: '<div class="gw"><div class="sov" role="dialog"><input class="set-input" type="text"></div></div>' },
  { ref: '.set-input', built: '.gw :is(.log-page, .numbers-page, .sheet) .set-input', file: 'app/log.css', html: '<div class="gw"><main class="log-page"><select class="set-input"></select></main></div>' },
  // The board: a column lights up under a carried card; an item waiting on the reader.
  { ref: '.col', built: '.gw .board-view .col', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><section class="col"></section></div></div>' },
  { ref: '.mcard', built: '.gw .board-view .mcard', file: 'app/board.css', html: '<div class="gw"><div class="board-view"><a class="mcard" href="#"></a></div></div>' },
  // A chat's Card on the board (#144): the corner pill eases its colours and gives under a press.
  { ref: '.corner-pill', built: '.gw .corner-pill', file: 'app/shell.css', html: '<div class="gw"><div class="chat__corner"><a class="corner-pill" href="#"></a></div></div>' },
  // The settings overlay fades in; a Member × Agent switch.
  { ref: '.sov[open]', built: '.gw .sov', file: 'app/settings.css', html: '<div class="gw"><div class="sov" role="dialog"></div></div>' },
  { ref: '.switch', built: '.gw .sov .switch', file: 'app/settings.css', html: '<div class="gw"><div class="sov" role="dialog"><button type="button" class="switch" role="switch" aria-checked="false"></button></div></div>' },
  // First run fades in, its column rises, its choices answer the pointer.
  { ref: '.fr[open]', built: '.gw .fr', file: 'app/first-run-choice.css', html: '<div class="gw"><div class="fr" role="dialog"></div></div>' },
  { ref: '.fr__col > *', built: '.gw .fr__col > *', file: 'app/first-run-choice.css', html: '<div class="gw"><form class="fr__col"><div class="fr__head"></div></form></div>' },
  { ref: '.cr-kind', built: '.gw .cr-kind', file: 'app/first-run-choice.css', html: '<div class="gw"><label class="cr-kind fr-choice"></label></div>' },
];

// The reference's six motion tokens; the product's carry the gw- prefix (`--dur` is `--gw-dur`).
export const motionTokens = ['--dur-fast', '--dur', '--dur-slow', '--ease-out', '--ease-in', '--ease-spring'];

// The reference's keyframes the product shares, each written once in app/shell.css under its gw- name.
export const sharedKeyframes = { fadeIn: 'gw-fade-in', rise: 'gw-rise', breathe: 'gw-breathe', modalOut: 'gw-modal-out' };

/** @param {string} token */
export const builtToken = token => `--gw-${token.slice(2)}`;
