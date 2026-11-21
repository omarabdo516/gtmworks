// What Chromium in the work sandbox image actually drew for a line of Arabic (#392): the platform font it used, the width
// of the drawn line, whether the letters were joined, and a screenshot of the page. Run inside the image by
// scripts/check-work-sandbox.mjs, which compares the answer with the expected values. Prints one JSON line.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [page = 'file:///tmp/check/arabic.html', shot = '/tmp/check/arabic.png'] = process.argv.slice(2);
const profile = '/tmp/check/profile';
const text = 'مرحبا بالعالم';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const chromium = spawn('chromium', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, page], { stdio: 'ignore' });

async function devtools() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const [port] = readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n');
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = pages.find(candidate => candidate.type === 'page' && candidate.url.startsWith('file:'));
      if (target) return target.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('chromium answered no page over devtools');
}

const url = await devtools();
const socket = new WebSocket(url);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('chromium refused devtools')); });
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  waiting.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await send('DOM.enable');
await send('CSS.enable');
await send('Page.enable');
const drawn = await send('Runtime.evaluate', {
  expression: `(async () => {
    await document.fonts.ready;
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');
    context.font = '48px "Noto Naskh Arabic"';
    context.fillStyle = '#000';
    const text = ${JSON.stringify(text)};
    const width = context.measureText(text).width;
    // The same line with its letters kept apart: joined Arabic is narrower than its letters drawn one by one.
    const unjoined = [...text].reduce((sum, letter) => sum + context.measureText(letter).width, 0);
    context.fillText(text, 24, 96);
    const line = document.getElementById('line');
    return { width, unjoined, drawn: line.getBoundingClientRect().width, loaded: document.fonts.check('48px "Noto Naskh Arabic"', text) };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
const documentNode = await send('DOM.getDocument', { depth: 1 });
const lineNode = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#line' });
const platforms = await send('CSS.getPlatformFontsForNode', { nodeId: lineNode.nodeId });
const screenshot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(shot, Buffer.from(screenshot.data, 'base64'));
socket.close();
chromium.kill();

process.stdout.write(`${JSON.stringify({ text, ...drawn.result.value, fonts: platforms.fonts })}\n`);
