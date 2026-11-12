// Pure helpers for scripts/design-compare.mjs (#285): argument checks, the screen table, output names and a
// static server over design-reference/ that never answers outside it.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

// A named screen says how to reach it in the reference and which built page it is compared with (null: none yet).
// The prototype has no URL routes: its sidebar switches views by `data-view` (chat, board, dashboard, log) and the
// account menu opens the settings overlay (`#sov`) with its sections. Each step is one `click`, `waitFor` or
// `scrollTo` with a CSS selector; a click on a sidebar item hidden behind the narrow-screen menu opens the menu first.
// Every screen starts from the prototype's default state: the "viewing as" switcher and its demo worlds are never touched.
const settings = [{ click: '#btn-me' }, { click: '[data-action="sov-open"]' }, { waitFor: '#sov[open] #sov-nav-company' }];
const settingsSection = section => [...settings, { click: `#sov-nav-${section}` }, { waitFor: `#sov-nav-${section}[aria-current]` }];
export const screens = {
  // The prototype's main screen: the Conversation with the main Agent, Lead, which it opens on.
  home: { reference: { steps: [] }, builtPath: '/c/rs-learning/home' },
  board: { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }] }, builtPath: '/c/rs-learning/work/board' },
  // "Waiting on you" is the board's first column in the prototype; the product gathers it on Approvals.
  waiting: { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }, { scrollTo: '#col-waiting' }] }, builtPath: '/c/rs-learning/approvals' },
  // The dashboard loads for 650 ms before its figures appear.
  numbers: { reference: { steps: [{ click: '#sb-nav [data-view="dashboard"]' }, { waitFor: '#view-dashboard .kpis' }] }, builtPath: null },
  log: { reference: { steps: [{ click: '#sb-nav [data-view="log"]' }, { waitFor: '#view-log:not([hidden])' }] }, builtPath: null },
  // A Conversation with an Agent other than Lead, opened from its tile in the sidebar.
  'agent-chat': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }] }, builtPath: null },
  // The settings overlay opens on its Company section.
  settings: { reference: { steps: settings }, builtPath: '/c/rs-learning/settings' },
  agents: { reference: { steps: settingsSection('agents') }, builtPath: '/c/rs-learning/agents' },
  // One Agent's page: Lead's settings inside the overlay.
  agent: { reference: { steps: [...settingsSection('agents'), { click: '#sov-ag-lead' }, { waitFor: '#sov-tab-settings' }] }, builtPath: null },
  account: { reference: { steps: settingsSection('account') }, builtPath: null },
};

export const languages = ['ar', 'en'];
export const themes = ['light', 'dark'];
export const defaultBuiltUrl = 'http://127.0.0.1:3000';
// The agency owner the seeded database and tests/visual.spec.ts sign in with.
export const defaultSignIn = 'omar@example.com';

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

const valued = { '--screen': 'screen', '--width': 'width', '--lang': 'lang', '--theme': 'theme', '--built-path': 'builtPath', '--built-url': 'builtUrl', '--sign-in': 'signIn', '--out': 'out' };

export function parseArgs(argv) {
  const raw = {};
  let referenceOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--reference-only') { referenceOnly = true; continue; }
    if (!(flag in valued)) throw new UsageError(`Unknown option ${flag}.`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value.`);
    raw[valued[flag]] = value;
  }
  for (const name of ['screen', 'width', 'lang', 'theme']) if (raw[name] === undefined) throw new UsageError(`--${name} is required.`);
  if (!Object.hasOwn(screens, raw.screen)) throw new UsageError(`Unknown screen "${raw.screen}". Valid screens: ${Object.keys(screens).join(', ')}.`);
  if (!/^[1-9]\d{1,4}$/.test(raw.width)) throw new UsageError('--width must be a whole number of pixels between 10 and 99999.');
  if (!languages.includes(raw.lang)) throw new UsageError('--lang must be ar or en.');
  if (!themes.includes(raw.theme)) throw new UsageError('--theme must be light or dark.');
  const builtPath = raw.builtPath ?? screens[raw.screen].builtPath;
  if (builtPath === null && !referenceOnly) throw new UsageError(`Screen "${raw.screen}" has no built equivalent yet; pass --built-path PATH or --reference-only.`);
  return {
    screen: raw.screen,
    width: Number(raw.width),
    lang: raw.lang,
    theme: raw.theme,
    builtPath,
    builtUrl: (raw.builtUrl ?? defaultBuiltUrl).replace(/\/+$/, ''),
    signIn: raw.signIn,
    out: raw.out,
    referenceOnly,
  };
}

export function outputPaths({ screen, lang, theme, width, out }) {
  const sideBySide = out ?? `test-results/design-compare/${screen}-${lang}-${theme}-${width}.png`;
  const stem = sideBySide.replace(/\.png$/i, '');
  return { sideBySide, reference: `${stem}-reference.png`, built: `${stem}-built.png` };
}

// The page to capture for a visitor who is not signed in. Language is an account setting, so a visitor cannot change
// it for later pages; the sign-in page alone takes it as `?language=ar` (app/sign-in/page.tsx) and is English
// without it. Any other page is captured where it is.
export function anonymousCaptureUrl(landedUrl, lang) {
  const url = new URL(landedUrl);
  if (url.pathname !== '/sign-in') return landedUrl;
  if (lang === 'ar') url.searchParams.set('language', 'ar');
  else url.searchParams.delete('language');
  return url.toString();
}

// Maps a request path to a file inside root, or null when it is malformed or would leave root.
export function resolveStaticPath(root, requestPath) {
  let path;
  try {
    path = decodeURIComponent(requestPath.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  const base = resolve(root);
  const file = resolve(base, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  return file.startsWith(base + sep) ? file : null;
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };

// Serves root on 127.0.0.1 at a free port. Resolves with the listening server.
export function startStaticServer(root) {
  const server = createServer((request, response) => {
    const file = resolveStaticPath(root, request.url ?? '/');
    let found = false;
    try { found = file !== null && statSync(file).isFile(); } catch { found = false; }
    if (!found) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

export const referenceRoot = join(import.meta.dirname, '..', 'design-reference');
