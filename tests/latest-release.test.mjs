import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadLatestRelease } from '../scripts/latest-release.mjs';

// #483: the install proof's release-update area installs the latest stable release from its own two published files.
const source = { api: 'https://api.test' };
const image = `ghcr.io/omarabdo516/gtmworks:1.3.0@sha256:${'a'.repeat(64)}`;
const asset = (tag, name) => ({ name, browser_download_url: `https://download.test/${tag}/${name}` });
const release = (tag, extra = {}) => ({ tag_name: tag, published_at: '2026-11-18T00:00:00Z', assets: [asset(tag, 'docker-compose.install.yml'), asset(tag, 'install.sh')], ...extra });
const served = (list, files) => {
 const asked = [];
 const fetch = async (url, init) => {
  asked.push([url, init?.headers?.authorization]);
  if (url.startsWith('https://api.test/releases?')) return new Response(JSON.stringify(list), { status: 200 });
  return url in files ? new Response(files[url], { status: 200 }) : new Response('not found', { status: 404 });
 };
 return { fetch, asked };
};
const good = {
 'https://download.test/v1.3.0/docker-compose.install.yml': `services:\n  web:\n    image: ${image}\n`,
 'https://download.test/v1.3.0/install.sh': `#!/bin/sh\nrelease_image=${image}\n`,
};

test('the latest stable release\'s two files are written to the folder, and its tag is the answer', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'latest-release-'));
 const { fetch, asked } = served([release('v1.2.1'), release('v1.3.0'), release('v1.4.0', { prerelease: true })], good);
 assert.equal(await downloadLatestRelease(dir, { fetch, source, token: 't' }), 'v1.3.0');
 assert.equal(readFileSync(join(dir, 'install.sh'), 'utf8'), good['https://download.test/v1.3.0/install.sh']);
 assert.equal(readFileSync(join(dir, 'docker-compose.install.yml'), 'utf8'), good['https://download.test/v1.3.0/docker-compose.install.yml']);
 // The token reaches the API's list only, never a download.
 assert.deepEqual(asked, [['https://api.test/releases?per_page=100&page=1', 'Bearer t'], ['https://download.test/v1.3.0/docker-compose.install.yml', undefined], ['https://download.test/v1.3.0/install.sh', undefined]]);
});

test('no release, a missing file, or two files of different releases write nothing', async () => {
 const cases = [
  [[], good, /no stable gtmworks release/],
  [[release('v1.3.0', { assets: [asset('v1.3.0', 'install.sh')] })], good, /publishes no docker-compose\.install\.yml/],
  [[release('v1.3.0')], { ...good, 'https://download.test/v1.3.0/install.sh': '#!/bin/sh\nrelease_image=ghcr.io/omarabdo516/gtmworks:1.3.0\n' }, /names no one image by digest/],
  [[release('v1.3.0')], { ...good, 'https://download.test/v1.3.0/docker-compose.install.yml': `services:\n  web:\n    image: ghcr.io/omarabdo516/gtmworks:1.2.0@sha256:${'b'.repeat(64)}\n` }, /does not run/],
  [[release('v1.3.0')], { 'https://download.test/v1.3.0/install.sh': good['https://download.test/v1.3.0/install.sh'] }, /answered 404/],
 ];
 for (const [list, files, error] of cases) {
  const dir = join(mkdtempSync(join(tmpdir(), 'latest-release-')), 'out');
  await assert.rejects(downloadLatestRelease(dir, { fetch: served(list, files).fetch, source, token: '' }), error);
  assert.equal(existsSync(dir), false, `nothing written: ${error}`);
 }
});
