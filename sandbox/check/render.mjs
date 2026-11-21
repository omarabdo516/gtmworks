// One short render in a Company's work sandbox, the work the install's default limits are measured on (#400): Chromium
// draws 60 frames of a 1280x720 page with an Arabic headline (two seconds at 30 a second), and ffmpeg joins them into an
// H.264 video, both the sandbox image's own (sandbox/Dockerfile). Run inside a running sandbox as its ordinary user by
// the install proof's sizes area (scripts/ci-install-check.sh), its source on stdin:
//   docker exec -i <sandbox> node --input-type=module - < sandbox/check/render.mjs
// While it runs it reads the sandbox's own memory cgroup every 100 ms, so the peak it prints is the whole container's:
// the working set as `docker stats` counts it (usage less the page cache the kernel can drop), and the cgroup's own
// peak, which counts that cache too. It prints one line for a person and one `render=` JSON line for the proof, and
// exits non-zero when the render does not finish, which is what a render stopped at its Company's limit does.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const frames = 60;
const fps = 30;
const width = 1280;
const height = 720;
const started = Date.now();
const folder = mkdtempSync(join(tmpdir(), 'render-'));
const profile = join(folder, 'profile');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mib = bytes => Math.round(bytes / 1048576);

// The container's own cgroup (cgroup v2, or v1's memory controller): its usage, the page cache it may drop, its peak.
const v2 = existsSync('/sys/fs/cgroup/memory.current');
const read = file => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const stat = key => Number(read(v2 ? '/sys/fs/cgroup/memory.stat' : '/sys/fs/cgroup/memory/memory.stat').match(new RegExp(`^${key} (\\d+)$`, 'm'))?.[1] ?? 0);
const usage = () => Number(read(v2 ? '/sys/fs/cgroup/memory.current' : '/sys/fs/cgroup/memory/memory.usage_in_bytes')) || 0;
const workingSet = () => Math.max(0, usage() - stat(v2 ? 'inactive_file' : 'total_inactive_file'));
let peak = workingSet();
const sampler = setInterval(() => { peak = Math.max(peak, workingSet()); }, 100);

// A render that cannot finish (Chromium or ffmpeg killed at the limit) must end, not wait: four minutes is many times
// the render's own time at the defaults.
const deadline = setTimeout(() => { console.error('render: did not finish within 240 s'); process.exit(1); }, 240000);

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { out += chunk; });
  child.on('error', reject);
  child.on('close', (code, signal) => (code === 0 ? resolve(out) : reject(new Error(`${command} ended with ${signal ?? code}: ${out.trim().slice(-400)}`))));
});

writeFileSync(join(folder, 'page.html'), `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:linear-gradient(135deg,#0f3d3e,#e2b04a);font-family:"Noto Naskh Arabic",serif}
h1{position:absolute;top:220px;right:80px;margin:0;font-size:96px;color:#fff;transform:translateX(calc(var(--t,0)*-480px))}
p{position:absolute;top:420px;right:80px;margin:0;font-size:48px;color:#fff;opacity:calc(var(--t,0))}
</style><h1>عرض الأسبوع</h1><p>خصم ٢٠٪ على كل الباقات</p><script>window.frame=n=>document.documentElement.style.setProperty('--t',n/${frames - 1});</script></html>`);

const chromium = spawn('chromium', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--window-size=${width},${height}`, `--user-data-dir=${profile}`, `file://${folder}/page.html`], { stdio: 'ignore' });
let chromiumEnded = null;
chromium.on('exit', (code, signal) => { chromiumEnded = signal ?? code; });

try {
  let url;
  for (let attempt = 0; attempt < 300 && !url; attempt++) {
    if (chromiumEnded !== null) throw new Error(`Chromium ended with ${chromiumEnded} before it served a page`);
    try {
      const [port] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      url = pages.find(candidate => candidate.type === 'page' && candidate.url.startsWith('file:'))?.webSocketDebuggerUrl;
    } catch {}
    if (!url) await sleep(100);
  }
  if (!url) throw new Error('Chromium answered no page over devtools within 30 s');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('Chromium refused devtools')); });
  let next = 0;
  const waiting = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  };
  // Chromium killed mid-render closes the socket: every waiting call fails at once instead of waiting for the deadline.
  socket.onclose = () => { for (const pending of waiting.values()) pending.reject(new Error(`Chromium closed devtools (ended with ${chromiumEnded ?? 'no exit yet'})`)); waiting.clear(); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // A script that throws reports it in exceptionDetails, not as a protocol error, so each evaluation checks it.
  const evaluate = async (params) => {
    const result = await send('Runtime.evaluate', params);
    if (result.exceptionDetails) throw new Error(`The page failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result;
  };
  await evaluate({ expression: 'document.fonts.ready.then(() => typeof frame === "function" || Promise.reject(new Error("the page defines no frame()")))', awaitPromise: true });
  for (let frame = 0; frame < frames; frame++) {
    await evaluate({ expression: `frame(${frame})` });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(folder, `frame-${String(frame).padStart(3, '0')}.png`), Buffer.from(shot.data, 'base64'));
  }
  socket.close();
  chromium.kill();
  const video = join(folder, 'render.mp4');
  await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', join(folder, 'frame-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video]);
  const duration = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video])).trim());
  if (!(Math.abs(duration - frames / fps) < 0.2)) throw new Error(`the video is ${duration} s long, not ${frames / fps} s`);
  const seconds = (Date.now() - started) / 1000;
  clearInterval(sampler);
  peak = Math.max(peak, workingSet());
  const cgroupPeak = Number(read(v2 ? '/sys/fs/cgroup/memory.peak' : '/sys/fs/cgroup/memory/memory.max_usage_in_bytes')) || 0;
  const result = { frames, width, height, seconds: Number(seconds.toFixed(1)), videoSeconds: duration, videoBytes: statSync(video).size, peakMiB: mib(peak), cgroupPeakMiB: mib(cgroupPeak) };
  console.log(`render: ${frames} frames of ${width}x${height} drawn by Chromium and joined by ffmpeg into a ${duration.toFixed(2)} s video (${result.videoBytes} bytes) in ${result.seconds} s; the sandbox's peak memory was ${result.peakMiB} MiB working set (${result.cgroupPeakMiB} MiB with page cache, its cgroup's peak since it started)`);
  console.log(`render=${JSON.stringify(result)}`);
} catch (error) {
  console.error(`render: did not finish: ${error.message}`);
  process.exitCode = 1;
} finally {
  clearInterval(sampler);
  clearTimeout(deadline);
  if (chromiumEnded === null) chromium.kill('SIGKILL');
  rmSync(folder, { recursive: true, force: true });
  // An open devtools socket after a failed render must not keep the process waiting.
  process.exit(process.exitCode ?? 0);
}
