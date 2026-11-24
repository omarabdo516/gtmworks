// One Agent's Screen awake with a page open in a Company's work sandbox, the work the install's default sandbox memory is
// measured on (#711). The Screen is started as the pinned Engine starts one inside its sandbox
// (tools/bot_desktop/sandbox_host.py start()): the Engine's own launcher.sh, handed in by the proof, runs Xvnc and Xfce in
// a session of its own on display :20 at the Engine's 1440x900; then Chromium, the sandbox image's own, opens one page on
// it with the flags of the Screen's Browser icon (tools/bot_desktop/browser.py dock_argv), and the driver computer_use
// runs there (`cua-driver mcp --no-overlay`) is started beside it. Run inside a running sandbox as its ordinary user by the
// install proof's sizes area (scripts/ci-install-check.sh), its source on stdin and the launcher in the environment:
//   docker exec -i -e SCREEN_LAUNCHER=<base64 of launcher.sh> <sandbox> node --input-type=module - [url] < sandbox/check/screen.mjs
// While it runs it reads the sandbox's own memory cgroup every 100 ms, as sandbox/check/render.mjs does, so the numbers
// it prints are the whole container's working set (usage less the page cache the kernel can drop). It prints one line
// for a person and one `screen=` JSON line for the proof, stops everything it started, and exits non-zero when the Screen
// or the page does not come up.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const page = process.argv[2] || 'https://business.google.com/en-all/google-ads/';
const settle = 25000;
const folder = mkdtempSync(join(tmpdir(), 'screen-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mib = bytes => Math.round(bytes / 1048576);

const v2 = existsSync('/sys/fs/cgroup/memory.current');
const read = file => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const stat = key => Number(read(v2 ? '/sys/fs/cgroup/memory.stat' : '/sys/fs/cgroup/memory/memory.stat').match(new RegExp(`^${key} (\\d+)$`, 'm'))?.[1] ?? 0);
const usage = () => Number(read(v2 ? '/sys/fs/cgroup/memory.current' : '/sys/fs/cgroup/memory/memory.usage_in_bytes')) || 0;
const workingSet = () => Math.max(0, usage() - stat(v2 ? 'inactive_file' : 'total_inactive_file'));
const asleep = workingSet();
let peak = asleep;
const sampler = setInterval(() => { peak = Math.max(peak, workingSet()); }, 100);
const deadline = setTimeout(() => { console.error('screen: did not finish within 180 s'); stopAll(); process.exit(1); }, 180000);

const launcher = Buffer.from(process.env.SCREEN_LAUNCHER || '', 'base64');
const started = [];
// Each child leads a session of its own, as the Engine's launcher does, so one kill takes everything it started.
const start = (command, args, env = {}) => {
  const child = spawn(command, args, { cwd: folder, detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, ...env } });
  child.on('error', () => {});
  started.push(child);
  return child;
};
// Each group is also killed member by member (`pkill -g`), as a group signal does not reach every member on every kernel.
function stopAll() {
  for (const child of started) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    spawnSync('pkill', ['-KILL', '-g', String(child.pid)]);
  }
}

try {
  if (!launcher.length) throw new Error('no launcher.sh was handed in (SCREEN_LAUNCHER)');
  writeFileSync(join(folder, 'launcher.sh'), launcher, { mode: 0o700 });
  const display = {
    HERMES_BD_PROFILE: 'ag-screen-check', HERMES_BD_DISPLAY_NUM: '20', HERMES_BD_SOCKET: join(folder, 'rfb.sock'),
    HERMES_BD_XAUTH: join(folder, 'Xauthority'), HERMES_BD_ENV_FILE: join(folder, 'env'), HERMES_BD_CONFIG_HOME: join(folder, 'xdg'),
    HERMES_BD_GEOMETRY: '1440x900', HERMES_BD_WALLPAPER: join(folder, 'wallpaper.png'),
  };
  start('bash', [join(folder, 'launcher.sh')], display);
  let published = null;
  for (let attempt = 0; attempt < 200 && !published; attempt++) {
    const text = read(display.HERMES_BD_ENV_FILE);
    if (text.includes('DISPLAY=') && existsSync(display.HERMES_BD_SOCKET)) published = Object.fromEntries(text.trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
    else await sleep(100);
  }
  if (!published) throw new Error(`the Screen did not publish its display within 20 s: ${read(join(folder, 'launcher.log')).slice(-400)}`);
  await sleep(3000);
  const desktop = workingSet();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const profile = join(folder, 'browser-profile');
  start('chromium', [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--test-type',
    `--disk-cache-size=${256 * 1024 * 1024}`, ...(proxy ? [`--proxy-server=${proxy}`] : []), page], published);
  start('cua-driver', ['mcp', '--no-overlay'], { ...published, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' });
  // The page is open once Chromium's devtools list it at an http(s) address with a title.
  let opened = null;
  for (let attempt = 0; attempt < 600 && !opened; attempt++) {
    try {
      const [port] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      opened = pages.find(candidate => candidate.type === 'page' && /^https?:/.test(candidate.url) && candidate.title && !candidate.url.includes(candidate.title));
    } catch {}
    if (!opened) await sleep(100);
  }
  if (!opened) throw new Error(`Chromium opened no page at ${page} within 60 s`);
  await sleep(settle);
  const awake = workingSet();
  clearInterval(sampler);
  peak = Math.max(peak, awake);
  const result = { page, title: opened.title, asleepMiB: mib(asleep), desktopMiB: mib(desktop), awakeMiB: mib(awake), peakMiB: mib(peak) };
  console.log(`screen: asleep the sandbox held ${result.asleepMiB} MiB; one Screen awake held ${result.desktopMiB} MiB, and ${result.awakeMiB} MiB with "${result.title}" open (${page}), peaking at ${result.peakMiB} MiB working set`);
  console.log(`screen=${JSON.stringify(result)}`);
} catch (error) {
  console.error(`screen: ${error.message}`);
  process.exitCode = 1;
} finally {
  clearInterval(sampler);
  clearTimeout(deadline);
  stopAll();
  await sleep(500);
  rmSync(folder, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
