import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// gtmworks's web server (#713, ADR 0029): Next.js serves every page and route through its own custom-server API, and
// this server takes the one WebSocket gtmworks carries itself, the live stream of an Agent's Screen
// (lib/screen-stream.mjs), on its own address. Every other upgrade (the development server's hot reload) is Next's,
// which attaches its own handler on the first request and leaves a path it has no route for alone.
//   node scripts/web-server.mjs [--dev]      PORT (default 3000) names the port.
// In the release image the app is Next's standalone build at the folder above this file, with no next.config.mjs: the
// build's own resolved config is read from .next/required-server-files.json, as Next's generated server.js embeds it,
// and the server listens on HOSTNAME as that one does.
const dev = process.argv.includes('--dev');
const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = !dev && !existsSync(join(dir, 'next.config.mjs'));
if (standalone) {
  process.env.NODE_ENV = 'production';
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(JSON.parse(readFileSync(join(dir, '.next/required-server-files.json'), 'utf8')).config);
}
const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;
const host = standalone ? process.env.HOSTNAME || '0.0.0.0' : undefined;
const { default: next } = await import('next');
const { screenStreams, screenStreamPath } = await import('../lib/screen-stream.mjs');

const app = next({ dev, dir, port, hostname: host ?? 'localhost' });
await app.prepare();
const handle = app.getRequestHandler();
const screen = screenStreams();
const server = createServer((request, response) => { void handle(request, response); });
server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url ?? '/', 'http://gtmworks').pathname === screenStreamPath) void screen(request, socket, head);
});
const keepAlive = Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT ?? '', 10);
if (Number.isFinite(keepAlive) && keepAlive >= 0) server.keepAliveTimeout = keepAlive;
server.listen(port, host, () => console.log(`gtmworks is listening on ${host ?? '*'}:${port}${dev ? ' (development)' : ''}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(); server.closeAllConnections(); process.exit(0); });
