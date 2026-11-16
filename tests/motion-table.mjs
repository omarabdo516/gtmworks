// Every part whose motion is the approved reference's, as reference rule against built rule (#127). Each later motion
// ticket adds the parts it ports. tests/motion-reference.test.mjs compares the two rules in the files, tokens resolved;
// tests/motion.spec.ts reads the part's computed motion on its screen.

/**
 * The screen a part shows on (tests/motion.spec.ts opens each one).
 * @typedef {'conversation' | 'lead-welcome' | 'gallery' | 'gallery-closing' | 'request' | 'board' | 'settings' | 'log' | 'first-run'} Screen
 */
/**
 * `ref` is the reference's selector (design-reference/index.html), `built` the product's in `file`. `element` names the
 * part on its screen when the built selector's first match is not the part a person sees.
 * @typedef {{ ref: string, built: string, file: string, screen: Screen, element?: string }} MotionRow
 */

/** @type {MotionRow[]} */
export const motionTable = [
  // The Conversation: message times show on hover; the drawer and the details panel slide.
  { ref: '.sender__time', built: '.gw .sender__time', file: 'app/shell.css', screen: 'conversation' },
  { ref: '.bubble__time', built: '.gw .bubble__time', file: 'app/shell.css', screen: 'conversation' },
  { ref: '.sidebar', built: '.gw .sidebar', file: 'app/shell.css', screen: 'conversation' },
  { ref: '.details', built: '.gw .details', file: 'app/shell.css', screen: 'conversation' },
  { ref: '.try-one__btn', built: '.gw .try-one__btn', file: 'app/shell.css', screen: 'lead-welcome' },
  // The dialog (the ready-made gallery): its entrance, its leave and its search field.
  { ref: '.modal[open]', built: '.gw.modal', file: 'app/shell.css', screen: 'gallery' },
  { ref: '.modal.is-closing', built: '.gw.modal[data-state="closed"]', file: 'app/shell.css', screen: 'gallery-closing' },
  { ref: '.tpl-search input', built: '.gw .tpl-search input', file: 'app/shell.css', screen: 'gallery' },
  // Fields: the reason an Owner gives for a no, the settings fields and the Activity log's filters.
  { ref: '.set-input', built: '.gw .ac-card .set-input', file: 'app/shell.css', screen: 'request' },
  { ref: '.set-input', built: '.gw .sov .set-input', file: 'app/settings.css', screen: 'settings' },
  { ref: '.set-input', built: '.gw :is(.log-page, .numbers-page) .set-input', file: 'app/log.css', screen: 'log' },
  // The board: a column lights up under a carried card; an item waiting on the reader.
  { ref: '.col', built: '.gw .board-view .col', file: 'app/board.css', screen: 'board' },
  { ref: '.mcard', built: '.gw .board-view .mcard', file: 'app/board.css', screen: 'board' },
  // The settings overlay fades in; a Member × Agent switch.
  { ref: '.sov[open]', built: '.gw .sov', file: 'app/settings.css', screen: 'settings' },
  { ref: '.switch', built: '.gw .sov .switch', file: 'app/settings.css', screen: 'settings' },
  // First run fades in, its column rises, its choices answer the pointer.
  { ref: '.fr[open]', built: '.gw .fr', file: 'app/first-run-choice.css', screen: 'first-run' },
  { ref: '.fr__col > *', built: '.gw .fr__col > *', file: 'app/first-run-choice.css', screen: 'first-run', element: '.gw .fr__col > .fr__head' },
  { ref: '.cr-kind', built: '.gw .cr-kind', file: 'app/first-run-choice.css', screen: 'first-run' },
];

// The reference's six motion tokens; the product's carry the gw- prefix (`--dur` is `--gw-dur`).
export const motionTokens = ['--dur-fast', '--dur', '--dur-slow', '--ease-out', '--ease-in', '--ease-spring'];

// The reference's keyframes the product shares, each written once in app/shell.css under its gw- name.
export const sharedKeyframes = { fadeIn: 'gw-fade-in', rise: 'gw-rise', breathe: 'gw-breathe', modalOut: 'gw-modal-out' };

/** @param {string} token */
export const builtToken = token => `--gw-${token.slice(2)}`;
