#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { workSandboxBase } from '../lib/work-sandbox-image.mjs';

// The work sandbox image's own acceptance check (#392). Given a built image, it proves in a container of that image what
// an install owner and an Agent will see:
//   - ffmpeg, Chromium, Node and Python run as the ordinary user and report a version;
//   - a page with a line of Arabic, drawn by the image's Chromium, uses an installed Arabic font, joins its letters, has
//     no empty box, and its width is the expected one; the page is captured as a PNG;
//   - ffmpeg writes a short video with Arabic burned in, and its duration reads back as the expected one;
//   - the base image is the pinned one (the built image's layers start with the base's);
//   - no private key, no authorized key and no token is in the image's files or its environment;
//   - the only service that listens is the sshd the Engine's `ssh` backend needs, and it takes a key and no password;
//   - a login the way the Engine opens one starts in the profile's own folder in the work folder, made before the
//     Engine's command needs it (#393);
//   - the image's size on disk is printed, for the README's Install section.
// The install job calls this after it builds the image. Nothing of the image's is left behind, unless --keep is given.
//   node scripts/check-work-sandbox.mjs --image <name:tag>

const { values } = parseArgs({ options: { image: { type: 'string', short: 'i' }, keep: { type: 'boolean', default: false } } });
const image = values.image;
if (!image) {
  console.error('usage: node scripts/check-work-sandbox.mjs --image <image:tag>');
  process.exit(2);
}

// The work user the base image ships and this build keeps, and the port its sshd listens on (the Engine's backend is
// pinned to it). The expected drawing was measured on fonts-noto-core at 48px; a font update may move it a little.
const user = 'pn';
const sshPort = 2222;
const expected = { font: 'Noto Naskh Arabic', width: 211.63, widthTolerance: 0.03, seconds: 2 };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const name = `gtmworks-work-sandbox-check-${process.pid}`;
const temp = mkdtempSync(join(tmpdir(), 'gtmworks-work-sandbox-'));
let running = false;

/** Runs docker and fails with its answer, as an install owner would see it. */
function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args.slice(0, 3).join(' ')}: ${(result.stderr || result.stdout || '').trim()}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Runs one shell command inside the running container, as the ordinary user unless another is named. */
const inside = (script, { as = user, allowFailure = false, input } = {}) => docker(['exec', '--user', as, '--interactive', name, 'sh', '-c', script], { input, allowFailure });

function say(label, value) {
  console.log(`${label}: ${value}`);
}

/** The sentence a failed check ends on, so a person reads what is wrong, not a stack trace. */
class Failed extends Error {}

try {
  say('work sandbox image', image);

  // The pin: the build file names one base image by tag and digest, and the built image's layers start with the base's.
  const base = workSandboxBase();
  if (docker(['image', 'inspect', base], { allowFailure: true }).status !== 0) {
    say('base', `${base} (pulling it to compare the bytes)`);
    docker(['pull', base]);
  }
  const layers = reference => JSON.parse(docker(['image', 'inspect', '--format', '{{json .RootFS.Layers}}', reference]).stdout);
  const baseLayers = layers(base);
  const imageLayers = layers(image);
  if (imageLayers.length < baseLayers.length || baseLayers.some((layer, at) => imageLayers[at] !== layer)) {
    throw new Failed(`the image's layers do not start with the pinned base's: build it from ${base}`);
  }
  say('base', base);

  // A throwaway keypair only to start the container and try the login; it never enters the image.
  const key = join(temp, 'id');
  const keygen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'work-sandbox-check', '-f', key], { encoding: 'utf8' });
  if (keygen.error || keygen.status !== 0) throw new Failed(`ssh-keygen is needed to start the container and try the login: ${keygen.error?.message ?? keygen.stderr}`);
  docker(['run', '--detach', '--name', name, '--env', `SSH_AUTHORIZED_KEY=${readFileSync(`${key}.pub`, 'utf8').trim()}`, image]);
  running = true;
  let listening = false;
  for (let attempt = 0; attempt < 150 && !listening; attempt++) {
    const probe = inside('ss -ltn', { allowFailure: true });
    if (probe.status === 0) listening = probe.stdout.includes(`:${sshPort}`);
    else if (/is not running/.test(probe.stderr)) throw new Failed(`the container stopped: ${docker(['logs', name], { allowFailure: true }).stderr.trim() || 'it logged nothing'}`);
    else throw new Failed(`the container cannot run \`ss -ltn\`: ${probe.stderr.trim()}`);
    if (!listening) await sleep(200);
  }
  if (!listening) throw new Failed(`sshd did not listen on ${sshPort} within 30 s; its log says: ${docker(['logs', name], { allowFailure: true }).stderr.trim()}`);

  // Criterion: the ordinary user, and the four tools each running and reporting a version.
  const who = inside('id -un; id -u').stdout.trim().split('\n');
  if (who[0] !== user || who[1] === '0') throw new Failed(`the container runs as ${who[0]} (uid ${who[1]}), not the ordinary user ${user}`);
  const versions = inside([
    "ffmpeg -version | head -n 1",
    'chromium --version',
    'node --version',
    'python3 --version',
  ].join('\n')).stdout.trim().split('\n');
  const [ffmpeg, chromium, node, python] = versions;
  if (!/^ffmpeg version \d+\.\d+/.test(ffmpeg)) throw new Failed(`ffmpeg did not report a version: ${ffmpeg}`);
  if (!/^\S.* \d+(\.\d+){2,}/.test(chromium)) throw new Failed(`Chromium did not report a version: ${chromium}`);
  if (!/^v\d+\.\d+\.\d+/.test(node)) throw new Failed(`Node did not report a version: ${node}`);
  if (!/^Python \d+\.\d+\.\d+/.test(python)) throw new Failed(`Python did not report a version: ${python}`);
  say('user', `${who[0]} (uid ${who[1]})`);
  say('ffmpeg', ffmpeg);
  say('chromium', chromium);
  say('node', node);
  say('python', python);

  // Criterion: an Arabic line, drawn by this Chromium in an installed Arabic font, joined, with the expected width and
  // captured as an image.
  inside('mkdir -p /tmp/check');
  for (const fixture of ['arabic.html', 'arabic.mjs']) inside(`cat > /tmp/check/${fixture}`, { input: readFileSync(`sandbox/check/${fixture}`, 'utf8') });
  const drawing = inside('node /tmp/check/arabic.mjs').stdout.trim().split('\n').pop();
  let arabic;
  try {
    arabic = JSON.parse(drawing);
  } catch {
    throw new Failed(`Chromium drew no answer for the Arabic page: ${drawing}`);
  }
  const [drawn] = arabic.fonts ?? [];
  const letters = [...arabic.text].filter(letter => letter !== ' ').length;
  if (arabic.fonts?.length !== 1 || drawn.familyName !== expected.font) {
    throw new Failed(`the Arabic line is drawn in ${(arabic.fonts ?? []).map(font => font.familyName).join(', ') || 'no font'}, not ${expected.font}: Arabic fonts are missing from the image`);
  }
  if (drawn.glyphCount < letters) throw new Failed(`only ${drawn.glyphCount} glyphs drew for ${letters} letters, so some are empty boxes`);
  const allowed = expected.width * expected.widthTolerance;
  if (Math.abs(arabic.width - expected.width) > allowed) {
    throw new Failed(`the Arabic line is ${arabic.width.toFixed(2)} px wide, not ${expected.width} ± ${(expected.widthTolerance * 100).toFixed(0)}%: the font or its shaping changed`);
  }
  if (arabic.width >= arabic.unjoined * 0.85) {
    throw new Failed(`the Arabic line is ${arabic.width.toFixed(2)} px wide beside ${arabic.unjoined.toFixed(2)} px for its letters apart: the letters are not joined`);
  }
  const screenshot = join(temp, 'arabic.png');
  docker(['cp', `${name}:/tmp/check/arabic.png`, screenshot]);
  const png = readFileSync(screenshot);
  if (png.subarray(1, 4).toString() !== 'PNG' || statSync(screenshot).size < 5000) throw new Failed(`the Arabic page was not captured: ${screenshot}`);
  say('arabic', `${drawn.familyName} (${drawn.postScriptName}), ${drawn.glyphCount} glyphs, ${arabic.width.toFixed(2)} px wide (expected ${expected.width} ± ${(expected.widthTolerance * 100).toFixed(0)}%), joined`);
  say('arabic screenshot', `PNG, ${statSync(screenshot).size} bytes`);

  // Criterion: a short video with Arabic burned in, and its duration read back.
  const video = inside([
    "font=$(fc-match -f '%{file}' 'Noto Naskh Arabic')",
    '[ -f "$font" ] || { echo "no Arabic font file" >&2; exit 1; }',
    "ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i color=c=white:s=480x160:d=2 -vf \"drawtext=fontfile=$font:text='مرحبا بالعالم':fontsize=44:fontcolor=black:x=24:y=55\" -c:v libx264 -pix_fmt yuv420p -y /tmp/check/arabic.mp4",
    'ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i color=c=white:s=480x160:d=2 -c:v libx264 -pix_fmt yuv420p -y /tmp/check/plain.mp4',
    'ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 /tmp/check/arabic.mp4',
    'stat -c %s /tmp/check/arabic.mp4 /tmp/check/plain.mp4',
    "fc-match -f '%{family}\\n' 'Noto Naskh Arabic'",
  ].join('\n')).stdout.trim().split('\n');
  const seconds = Number(video[0]);
  const [arabicBytes, plainBytes] = video.slice(1, 3).map(Number);
  if (!(Math.abs(seconds - expected.seconds) < 0.2)) throw new Failed(`the video is ${video[0]} s long, not ${expected.seconds} s`);
  if (!(arabicBytes > plainBytes && arabicBytes > 1000)) throw new Failed(`the video with Arabic is ${arabicBytes} bytes beside ${plainBytes} with no text: nothing was drawn`);
  say('ffmpeg video', `${seconds.toFixed(3)} s, ${arabicBytes} bytes with Arabic burned in (${plainBytes} bytes with no text), font ${video[3]}`);

  // Criterion: the image's files and environment hold no secret and no key. A file is a key only when ssh-keygen can read
  // it, so a document that shows the words of a header is not one.
  const environment = JSON.parse(docker(['image', 'inspect', '--format', '{{json .Config.Env}}', image]).stdout);
  const tokenShapes = /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-|sk-ant-|-----BEGIN [A-Z ]*PRIVATE KEY-----|service_role/;
  const leaked = environment.filter(entry => tokenShapes.test(entry.split('=').slice(1).join('=')));
  if (leaked.length) throw new Failed(`the image's environment holds a credential: ${leaked.map(entry => entry.split('=')[0]).join(', ')}`);
  const scan = String.raw`
found=0
for file in $(grep -rIl --binary-files=without-match -E '-----BEGIN ([A-Z]+ )*PRIVATE KEY-----' / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev --exclude-dir=run 2>/dev/null); do
  if ssh-keygen -y -f "$file" > /dev/null 2>&1; then echo "private key: $file"; found=1; fi
done
for file in $(find /etc /root /home /work /opt/cua-driver /usr/local/bin /usr/local/sbin -xdev -type f \( -name authorized_keys -o -name 'id_*' -o -name 'ssh_host_*' \) 2>/dev/null); do
  echo "key file: $file"; found=1
done
for file in $(find /etc /root /home /work /opt/cua-driver /usr/local/bin /usr/local/sbin -xdev -type f \( -name '*.pem' -o -name '*.key' \) 2>/dev/null); do
  if ssh-keygen -y -f "$file" > /dev/null 2>&1; then echo "private key: $file"; found=1; fi
done
for file in $(grep -rIl --binary-files=without-match -E 'AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-ant-[A-Za-z0-9_-]{20,}' /etc /root /home /work /opt/cua-driver /usr/local/bin /usr/local/sbin 2>/dev/null); do
  echo "token: $file"; found=1
done
echo "secrets=$found"
`;
  const found = docker(['run', '--rm', '--user', '0', '--entrypoint', 'sh', image, '-c', scan]).stdout.trim().split('\n');
  const secrets = found.filter(line => /^(private key|key file|token):/.test(line));
  if (secrets.length || found.at(-1) !== 'secrets=0') throw new Failed(`the image holds a secret or a key: ${secrets.join(', ') || found.at(-1)}`);
  say('secrets', 'none in the image\'s files or environment (the host key is made at start, the public key arrives at run time)');

  // Criterion: nothing listens but the sshd the Engine's `ssh` backend needs, and it takes a key and no password.
  const listeningPorts = [...new Set(inside('ss -ltn').stdout.split('\n').map(line => line.match(/\s(?:\S*):(\d+)\s+\S*:\*/)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  if (listeningPorts.length !== 1 || listeningPorts[0] !== sshPort) throw new Failed(`the image listens on ${listeningPorts.join(', ') || 'no port'}; only the Engine's sshd (${sshPort}) should listen`);
  const config = inside('/usr/sbin/sshd -T').stdout;
  for (const setting of ['passwordauthentication no', 'kbdinteractiveauthentication no', 'pubkeyauthentication yes', 'permitrootlogin no']) {
    if (!config.split('\n').includes(setting)) throw new Failed(`sshd's effective configuration does not hold "${setting}"`);
  }
  inside('cat > /tmp/check/id && chmod 600 /tmp/check/id', { input: readFileSync(key) });
  const login = inside(`ssh -i /tmp/check/id -p ${sshPort} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR ${user}@127.0.0.1 'id -un'`, { allowFailure: true });
  if (login.status !== 0 || login.stdout.trim() !== user) throw new Failed(`the key that arrived at run time does not log in: ${(login.stderr || login.stdout).trim()}`);
  const password = inside(`ssh -p ${sshPort} -o PreferredAuthentications=password -o PubkeyAuthentication=no -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${user}@127.0.0.1 true`, { allowFailure: true });
  if (password.status === 0 || !/Permission denied/.test(`${password.stderr}${password.stdout}`)) throw new Failed('sshd accepted something other than the key');
  say('ports', `${sshPort} (the Engine's sshd), key login works, password refused`);

  // Criterion: an Agent's start folder is there before the Engine's first command needs it (#393). The Engine's ssh
  // backend opens every command with `builtin cd -- <folder> || exit 126`, and a folder it does not have exits 126, so
  // the login shell makes the profile's own folder in the work folder (sandbox/work-shell).
  inside('cat > /tmp/check/start.sh', { input: `#!/bin/sh\nssh -i /tmp/check/id -p ${sshPort} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR ${user}@127.0.0.1 "bash -c 'builtin cd -- /work/ag-check-profile || exit 126; pwd'"\n` });
  const start = inside('sh /tmp/check/start.sh', { allowFailure: true });
  if (start.status !== 0 || start.stdout.trim() !== '/work/ag-check-profile') {
    throw new Failed(`an Agent's first command does not start in its own folder: ${(start.stderr || start.stdout).trim()}`);
  }
  say('start folder', '/work/ag-check-profile, made before the Engine\'s first command');

  // Criterion: the size on disk, printed for the README.
  const bytes = Number(docker(['image', 'inspect', '--format', '{{.Size}}', image]).stdout.trim());
  say('image size', `${(bytes / 1e9).toFixed(2)} GB (${bytes} bytes)`);

  console.log('work sandbox: ok');
} catch (error) {
  console.error(`work sandbox: FAILED — ${error instanceof Failed ? error.message : error.stack}`);
  process.exitCode = 1;
} finally {
  if (running && !values.keep) docker(['rm', '--force', name], { allowFailure: true });
  if (running && values.keep) say('container', `kept as ${name}`);
  rmSync(temp, { recursive: true, force: true });
}
