import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The two files a release install needs (#49): the install compose file with every image pinned by digest and the
// app image set to the released one, and the source installer with that image named, which turns on its release mode.
// Upstream images keep the digests reviewed in the source compose file: a release never turns a tag into a digest,
// since whoever controls an upstream tag at release time would choose the image.
// A registry host, optionally with a port (CI's local registry is localhost:5000), then the repository path.
const appPattern = /^[a-z0-9][a-z0-9._-]*(:\d+)?(\/[a-z0-9._-]+)+(:[\w.-]+)?@sha256:[a-f0-9]{64}$/;
const pinnedPattern = /^[a-z0-9][\w./-]*:[\w.-]+@sha256:[a-f0-9]{64}$/;
const localApp = /^gtmworks-local:/;
const imageLine = /^(\s*image:\s*)(\S+)\s*$/;

function checkApp(app) {
 if (!appPattern.test(app || '')) throw new Error(`The app image must be a reference with a sha256 digest: ${app}`);
}

export function releaseCompose(text, app) {
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
  if (!pinnedPattern.test(image)) throw new Error(`${image} is not pinned to a reviewed tag@sha256 digest in docker-compose.install.yml`);
  return [line];
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

export function writeReleaseAssets(app, directory) {
 const compose = releaseCompose(readFileSync('docker-compose.install.yml', 'utf8'), app);
 const installer = releaseInstaller(readFileSync('scripts/install.sh', 'utf8'), app);
 mkdirSync(directory, { recursive: true });
 writeFileSync(join(directory, 'docker-compose.install.yml'), compose);
 writeFileSync(join(directory, 'install.sh'), installer);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
 const [app, directory, ...rest] = process.argv.slice(2);
 if (!app || !directory || rest.length) {
  console.error('usage: node scripts/release-assets.mjs <image>:<tag>@sha256:<digest> <directory>');
  process.exit(2);
 }
 writeReleaseAssets(app, directory);
}
