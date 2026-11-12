import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The two files a release install needs (#49): the install compose file with every image pinned by digest and the
// app image set to the released one, and the source installer with that image named, which turns on its release mode.
const digestPattern = /^sha256:[a-f0-9]{64}$/;
// A registry host, optionally with a port (CI's local registry is localhost:5000), then the repository path.
const appPattern = /^[a-z0-9][a-z0-9._-]*(:\d+)?(\/[a-z0-9._-]+)+(:[\w.-]+)?@sha256:[a-f0-9]{64}$/;
const localApp = /^gtmworks-local:/;
const imageLine = /^(\s*image:\s*)(\S+)\s*$/;

function checkApp(app) {
 if (!appPattern.test(app || '')) throw new Error(`The app image must be a reference with a sha256 digest: ${app}`);
}

export function releaseCompose(text, app, digests) {
 checkApp(app);
 let apps = 0;
 const lines = text.split('\n').flatMap(line => {
  if (/^\s*build:/.test(line)) {
   if (!/^\s*build: \.\s*$/.test(line)) throw new Error(`Unexpected build line in the install compose file: ${line.trim()}`);
   return [];
  }
  const match = imageLine.exec(line);
  if (!match) return [line];
  const [, prefix, image] = match;
  if (localApp.test(image)) { apps++; return [`${prefix}${app}`]; }
  if (image.includes('@')) {
   if (!digestPattern.test(image.split('@')[1])) throw new Error(`${image} has no sha256 digest`);
   return [line];
  }
  const digest = digests[image];
  if (digest === undefined) throw new Error(`No digest was resolved for ${image}`);
  if (!digestPattern.test(digest)) throw new Error(`${image}: ${digest} is not a sha256 digest`);
  return [`${prefix}${image}@${digest}`];
 });
 if (apps === 0) throw new Error('The install compose file names no gtmworks app image.');
 return lines.join('\n');
}

export function releaseInstaller(text, app) {
 checkApp(app);
 const lines = text.split('\n');
 const found = lines.filter(line => line === 'release_image=').length;
 if (found !== 1) throw new Error(`The installer must hold exactly one empty release_image= line (found ${found}).`);
 return lines.map(line => line === 'release_image=' ? `release_image=${app}` : line).join('\n');
}

// The digest of the multi-platform index a tag points to now, so every platform pulls the same release.
function resolveDigest(image) {
 const manifest = JSON.parse(execFileSync('docker', ['buildx', 'imagetools', 'inspect', image, '--format', '{{json .Manifest}}'], { encoding: 'utf8' }));
 return manifest.digest;
}

// The digest an image was pulled by on this machine, from its RepoDigests: CI's install test pins the images its own
// install already pulled, with no registry query.
export function localDigest(image, repoDigests) {
 const name = image.replace(/:[^/:]+$/, '');
 const found = [...new Set((repoDigests || []).filter(entry => entry.startsWith(`${name}@`)).map(entry => entry.slice(name.length + 1)))];
 if (found.length !== 1 || !digestPattern.test(found[0])) throw new Error(`${image} has no single pulled digest: ${found.join(', ')}`);
 return found[0];
}

function resolveLocalDigest(image) {
 return localDigest(image, JSON.parse(execFileSync('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', image], { encoding: 'utf8' })));
}

export function writeReleaseAssets(app, directory, resolve = resolveDigest) {
 const compose = readFileSync('docker-compose.install.yml', 'utf8');
 const unpinned = [...new Set(compose.split('\n').map(line => imageLine.exec(line)?.[2])
  .filter(image => image && !image.includes('@') && !localApp.test(image)))];
 const digests = Object.fromEntries(unpinned.map(image => [image, resolve(image)]));
 mkdirSync(directory, { recursive: true });
 writeFileSync(join(directory, 'docker-compose.install.yml'), releaseCompose(compose, app, digests));
 writeFileSync(join(directory, 'install.sh'), releaseInstaller(readFileSync('scripts/install.sh', 'utf8'), app));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
 const [app, directory, option] = process.argv.slice(2);
 if (!app || !directory || (option && option !== '--local-digests')) {
  console.error('usage: node scripts/release-assets.mjs <image>:<tag>@sha256:<digest> <directory> [--local-digests]');
  process.exit(2);
 }
 writeReleaseAssets(app, directory, option ? resolveLocalDigest : resolveDigest);
}
