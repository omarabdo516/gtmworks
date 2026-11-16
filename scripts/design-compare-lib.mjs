// Pure helpers for scripts/design-compare.mjs (#285): argument checks, the screen table, output names and a
// static server over design-reference/ that never answers outside it.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

// A named screen says how to reach it in the reference and which built page it is compared with (null: none yet).
// The prototype has no URL routes: its sidebar switches views by `data-view` (chat, board, dashboard, log) and the
// account menu opens the settings overlay (`#sov`) with its sections. Each step is one `click`, `waitFor` or
// `scrollTo` with a CSS selector; a click on a sidebar item hidden behind the narrow-screen menu opens the menu first.
// Every screen starts from the prototype's default state. Only the alone screens and a Member's request screens touch
// the "viewing as" switcher: the alone ones show the workspace of an Owner working alone (#10); built, that is seeded
// R&S Consultations, its one Member Omar, with work_mode set to 'alone' (tests/visual.spec.ts, state `alone`). The
// request ones show Youssef, a Contributor in the team (#17); built, that is the first Contributor, signed in with
// --sign-in reviewer@example.com, over the visual state `agent-request` (or `-made`).
const settings = [{ click: '#btn-me' }, { click: '[data-action="sov-open"]' }, { waitFor: '#sov[open] #sov-nav-company' }];
const alone = [{ click: '#btn-me' }, { click: '[data-action="set-as"][data-person="omar"][data-world="solo"]' }, { waitFor: '#sb-recent' }];
const asYoussef = [{ click: '#btn-me' }, { click: '[data-action="set-as"][data-person="youssef"][data-world="team"]' }, { waitFor: '#sb-recent' }];
const youssefRequest = [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-wa"]' }, { waitFor: '.ac-card' }];
const settingsSection = section => [...settings, { click: `#sov-nav-${section}` }, { waitFor: `#sov-nav-${section}[aria-current]` }];
// The ids of the optional comparison fixture (design/COMPARE.md, "Representative captures"). The tool never applies
// it: a person loads it by hand into a throwaway local database, then passes these ids with --built-path.
export const fixture = {
  file: 'scripts/design-compare-fixture.sql',
  mainAgent: '61000000-0000-0000-0000-000000000001',
  agent: '61000000-0000-0000-0000-000000000002',
  conversation: '62000000-0000-0000-0000-000000000001',
  // Omar's Conversation in which Lead made Ads (#13), as the reference's thread th-made-ads.
  madeConversation: '62000000-0000-0000-0000-000000000002',
  channel: '69000000-0000-0000-0000-000000000001',
  // Omar's Conversation in which he told Ads a lasting rule (#18), as the reference's thread th-rule-ads.
  ruleConversation: '62000000-0000-0000-0000-000000000003',
  // The first Contributor's Conversation in which they told Ads a rule for the team (#25), as the reference's th-yo-ads;
  // the rule waits on Omar and the Manager as a learning suggestion.
  suggestionConversation: '62000000-0000-0000-0000-000000000004',
};
export const screens = {
  // The prototype's main screen: the Conversation with the main Agent, Lead, which it opens on.
  home: { reference: { steps: [] }, builtPath: '/c/rs-learning/chat' },
  board: { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }] }, builtPath: '/c/rs-learning/work/board' },
  // "Waiting on you" is the board's first column in the prototype; the product gathers it on Approvals.
  waiting: { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }, { scrollTo: '#col-waiting' }] }, builtPath: '/c/rs-learning/approvals' },
  // The dashboard loads for 650 ms before its figures appear.
  numbers: { reference: { steps: [{ click: '#sb-nav [data-view="dashboard"]' }, { waitFor: '#view-dashboard .kpis' }] }, builtPath: '/c/rs-learning/numbers' },
  log: { reference: { steps: [{ click: '#sb-nav [data-view="log"]' }, { waitFor: '#view-log:not([hidden])' }] }, builtPath: '/c/rs-learning/log' },
  // A Card's log with its note field (#22): the reference's card sheet on its Log tab, beside the built Card.
  'card-log': { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }, { click: '.kcard[data-action="open-card"]' }, { click: '#sh-tab-log' }, { waitFor: '#ta-note' }] }, builtPath: '/c/rs-learning/work/board/1' },
  // A Conversation with an Agent other than Lead, opened from its tile in the sidebar. In a team it starts with the
  // private line (#25).
  'agent-chat': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }] }, builtPath: null },
  // #21. The details beside that chat: the Files tab of Ads; and the Activity tab of SEO, whose screen is asleep, the
  // empty frame the product always shows. Built: the fixture's Ads, with the files of its Cards and of Omar's own
  // Conversations with it.
  'agent-files': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }, { click: '#dp-tab-files' }, { waitFor: '#dp-tab-files[aria-selected="true"]' }] }, builtPath: `/c/rs-learning/chat/${fixture.agent}?tab=files` },
  'agent-screen': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="seo"]' }, { waitFor: '.scr-card' }] }, builtPath: `/c/rs-learning/chat/${fixture.agent}` },
  // The settings overlay opens on its Company section. The built overlay is route-backed (app/settings-overlay.tsx):
  // ?section= opens a section and ?agent=<id> one Agent's page.
  settings: { reference: { steps: settings }, builtPath: '/c/rs-learning/settings' },
  agents: { reference: { steps: settingsSection('agents') }, builtPath: '/c/rs-learning/settings?section=agents' },
  // One Agent's page: Lead's settings inside the overlay. Built: the comparison fixture's main Agent, Lead (the seed
  // alone has no Agent with that id, so without the fixture the overlay shows the Agents list).
  agent: { reference: { steps: [...settingsSection('agents'), { click: '#sov-ag-lead' }, { waitFor: '#sov-tab-settings' }] }, builtPath: `/c/rs-learning/settings?agent=${fixture.mainAgent}` },
  // #30. Settings, Apps: the reference draws its app catalogue there; built, the apps the Engine offers the Company.
  apps: { reference: { steps: [...settingsSection('apps'), { waitFor: '#sov-apps .app-card' }] }, builtPath: '/c/rs-learning/settings?section=apps' },
  account: { reference: { steps: settingsSection('account') }, builtPath: '/c/rs-learning/settings?section=account' },
  knowledge: { reference: { steps: settingsSection('knowledge') }, builtPath: '/c/rs-learning/settings?section=knowledge' },
  'home-alone': { reference: { steps: alone }, builtPath: '/c/rs-consultations/chat' },
  'settings-alone': { reference: { steps: [...alone, ...settings] }, builtPath: '/c/rs-consultations/settings' },
  // #13. "New agent" opens Lead's chat ready to type, with one hint line.
  'new-agent': { reference: { steps: [{ click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }] }, builtPath: '/c/rs-learning/chat?new=agent' },
  // #14. The ready-made gallery, opened from that hint line's link. Built, it has its own address and needs a main
  // Agent: the comparison fixture's Lead (the seed alone has none, so it shows the plain chat).
  'ready-roles': { reference: { steps: [{ click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }, { click: '[data-action="open-gallery-alt"]' }, { waitFor: '#modal[open] .tpl' }] }, builtPath: '/c/rs-learning/chat?new=ready' },
  // The Conversation in which Lead made Ads, with its card. Built: the fixture's madeConversation (pass --built-path).
  'made-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-made-ads"]' }, { waitFor: '.ac-card' }] }, builtPath: null },
  // #18. The Conversation in which Omar told Ads a lasting rule, with the saved line under Ads's reply. Built: the
  // fixture's ruleConversation (pass --built-path).
  'rule-saved': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-rule-ads"]' }, { waitFor: '.note--saved' }] }, builtPath: null },
  // #25. The reference decides a learning suggestion in Settings, Learning ("Learning suggestions": Youssef's rule for
  // Ads, with Decline and Make it team-wide); the product decides it where it waits, in "Waiting on you". Built: the
  // fixture's suggestion.
  learning: { reference: { steps: [...settingsSection('learning'), { waitFor: '.ln-sugg .ln-row' }] }, builtPath: '/c/rs-learning/approvals' },
  // Ads's page in Settings, saying when it was made and at whose request, and listing the rule it was told (#18).
  // Built: the fixture's Ads, which Lead made and Omar told the rule.
  'made-agent': { reference: { steps: [...settingsSection('agents'), { click: '#sov-ag-ads' }, { waitFor: '#sov-tab-settings' }] }, builtPath: `/c/rs-learning/settings?agent=${fixture.agent}` },
  channel: { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="ch-general"]' }, { waitFor: '.ch-intro' }] }, builtPath: `/c/rs-learning/channels/${fixture.channel}` },
  // The reference shows the request Omar answers in his chat with Lead; the product, where it waits.
  'ask-agent': { reference: { steps: [...asYoussef, { click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }] }, builtPath: '/c/rs-learning/chat?new=agent' },
  'request-sent': { reference: { steps: [...asYoussef, ...youssefRequest] }, builtPath: '/c/rs-learning/conversations/6b000000-0000-0000-0000-000000000003' },
  'request-waiting': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-wa-req"]' }, { waitFor: '.ac-card--req' }] }, builtPath: '/c/rs-learning/approvals' },
  'request-made': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-wa-req"]' }, { click: '#ac-yes-rq-seed' }, { waitFor: '.ac-card:not(.ac-card--req)' }, ...asYoussef, ...youssefRequest] }, builtPath: '/c/rs-learning/conversations/6b000000-0000-0000-0000-000000000003' },
};

export const languages = ['ar', 'en'];
export const themes = ['light', 'dark'];
export const defaultBuiltUrl = 'http://127.0.0.1:3000';
// The seeded Owner of every company, the person tests/visual.spec.ts signs in as.
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
