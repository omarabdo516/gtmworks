// The two files of the latest stable release, as GitHub Releases publishes them (#483): `node scripts/latest-release.mjs
// <dir>` writes docker-compose.install.yml and install.sh into <dir> and prints the release's tag. The release is the one
// Update ready offers and `gtmworks update` installs (lib/updates.mjs latestStableRelease), read from the releases list
// on every run, so the install proof's release-update area moves with each release. The files are checked against each
// other as scripts/get.sh checks a download: install.sh names one image by digest and the compose file runs it.
// GH_TOKEN, when set (CI), only reaches the GitHub API's list, so a shared runner is not held to the anonymous rate limit.
// It exits non-zero when no stable release is published or its files cannot be read.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { latestStableRelease } from '../lib/updates.mjs';

const files = ['docker-compose.install.yml', 'install.sh'];

export async function downloadLatestRelease(dir, { fetch = globalThis.fetch, token = process.env.GH_TOKEN, source } = {}) {
 const headers = token ? { authorization: `Bearer ${token}` } : {};
 const release = await latestStableRelease({ source, fetch, headers });
 if (!release) throw new Error('no stable gtmworks release is published yet');
 const text = {};
 for (const name of files) {
  const url = release.assets?.find(asset => asset?.name === name)?.browser_download_url;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error(`${release.tag_name} publishes no ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  text[name] = await response.text();
 }
 const images = [...text['install.sh'].matchAll(/^release_image=(.*)$/gm)].map(match => match[1]);
 if (images.length !== 1 || !/@sha256:[a-f0-9]{64}$/.test(images[0])) throw new Error(`${release.tag_name}'s install.sh names no one image by digest`);
 if (!text['docker-compose.install.yml'].split('\n').some(line => line.trim() === `image: ${images[0]}`)) {
  throw new Error(`${release.tag_name}'s docker-compose.install.yml does not run ${images[0]}`);
 }
 await mkdir(dir, { recursive: true });
 for (const name of files) await writeFile(join(dir, name), text[name]);
 return release.tag_name;
}

if (import.meta.url === `file://${process.argv[1]}`) {
 const dir = process.argv[2];
 if (!dir) { console.error('usage: node scripts/latest-release.mjs <dir>'); process.exit(2); }
 try { console.log(await downloadLatestRelease(dir)); } catch (error) { console.error(`the latest release: ${error.message}`); process.exit(1); }
}
