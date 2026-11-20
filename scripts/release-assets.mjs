import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The two files a release install needs (#49): the install compose file with every image pinned by digest and the
// app image set to the released one, and the source installer with that image and the work sandbox image every
// Company's sandbox runs (#392, ADR 0020) named, which turns on its release mode.
// Upstream images keep the digests reviewed in the source compose file: a release never turns a tag into a digest,
// since whoever controls an upstream tag at release time would choose the image.
// A registry host, optionally with a port (CI's local registry is localhost:5000), then the repository path.
const appPattern = /^[a-z0-9][a-z0-9._-]*(:\d+)?(\/[a-z0-9._-]+)+(:[\w.-]+)?@sha256:[a-f0-9]{64}$/;
const pinnedPattern = /^[a-z0-9][\w./-]*:[\w.-]+@sha256:[a-f0-9]{64}$/;
const localApp = /^gtmworks-local:/;
const imageLine = /^(\s*image:\s*)(\S+)\s*$/;

function checkApp(app, what = 'app') {
 if (!appPattern.test(app || '')) throw new Error(`The ${what} image must be a reference with a sha256 digest: ${app}`);
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

export function releaseInstaller(text, app, sandbox) {
 checkApp(app);
 checkApp(sandbox, 'work sandbox');
 const lines = text.split('\n');
 const found = lines.filter(line => line === 'release_image=').length;
 if (found !== 1) throw new Error(`The installer must hold exactly one empty release_image= line (found ${found}).`);
 const sandboxFound = lines.filter(line => line === 'sandbox_image=').length;
 if (sandboxFound !== 1) throw new Error(`The installer must hold exactly one empty sandbox_image= line (found ${sandboxFound}).`);
 return lines.map(line => line === 'release_image=' ? `release_image=${app}` : line === 'sandbox_image=' ? `sandbox_image=${sandbox}` : line).join('\n');
}

// Every Company's Engine is made from the template shipped with the release (#381, ADR 0018), so its one image is
// checked here too: a release never turns its tag into a digest, and an unpinned Engine image stops the release.
export function releaseEngineTemplate(text) {
 const image = /^\s*image:\s*(\S+)\s*$/m.exec(text)?.[1];
 if (!image || !pinnedPattern.test(image)) throw new Error(`${image} is not pinned to a reviewed tag@sha256 digest in scripts/engine-template.yml`);
 return text;
}

export function writeReleaseAssets(app, directory, sandbox) {
 const compose = releaseCompose(readFileSync('docker-compose.install.yml', 'utf8'), app);
 const installer = releaseInstaller(readFileSync('scripts/install.sh', 'utf8'), app, sandbox);
 releaseEngineTemplate(readFileSync('scripts/engine-template.yml', 'utf8'));
 mkdirSync(directory, { recursive: true });
 writeFileSync(join(directory, 'docker-compose.install.yml'), compose);
 writeFileSync(join(directory, 'install.sh'), installer);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
 const [app, directory, sandbox, ...rest] = process.argv.slice(2);
 if (!app || !directory || !sandbox || rest.length) {
  console.error('usage: node scripts/release-assets.mjs <image>:<tag>@sha256:<digest> <directory> <sandbox-image>:<tag>@sha256:<digest>');
  process.exit(2);
 }
 writeReleaseAssets(app, directory, sandbox);
}
