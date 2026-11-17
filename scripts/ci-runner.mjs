import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { maxLanes, projectOf, reservedPorts, stackPortsOf } from '../tests/lane.mjs';

// What a CI job needs from the machine it runs on (#224, #225). A GitHub-hosted runner is fresh for every job. The
// self-hosted runner (Omar's PC) keeps its state between jobs and shares one Docker daemon with other repositories' CI,
// so there the stack's ports move to a block of their own and a job removes exactly what this repository's runs start.
//   reserved-ports                     the range every lane's stack binds, for net.ipv4.ip_local_reserved_ports
//   move-ports <block>                 moves lane 0's ports in supabase/config.toml to <block>00 and up
//   lanes <github-hosted|self-hosted>  GTMWORKS_TEST_LANES=<n>, for $GITHUB_ENV
//   cleanup                            removes this repository's containers, volumes, networks and workspace processes
const misuse = () => {
 console.error('usage: node scripts/ci-runner.mjs reserved-ports | move-ports <block> | lanes <github-hosted|self-hosted> | cleanup');
 return 2;
};

const portLine = /^((?:port|shadow_port) = )(\d+)$/gm;
// Above Linux's default range for outgoing connections (32768 to 60999), so no connection can take a moved port.
const lowestMovedPort = 61000;

/** supabase/config.toml with lane 0's ports moved from their block to `block` (64021 for the API with block 640). */
export function movePorts(config, block) {
 const ports = [...config.matchAll(portLine)].map(match => Number(match[2]));
 if (!ports.length) throw new Error('supabase/config.toml sets no port');
 const by = 100 * (block - Math.floor(Math.min(...ports) / 100));
 const low = Math.min(...ports) + by;
 const high = Math.max(...ports) + by + 100 * (maxLanes - 1);
 if (!Number.isInteger(block) || low < lowestMovedPort || high > 65535) {
  throw new RangeError(`block ${block} would put the lanes' ports at ${low}-${high}, outside ${lowestMovedPort}-65535`);
 }
 return config.replace(portLine, (_, key, port) => `${key}${Number(port) + by}`);
}

// A standard GitHub-hosted runner ran four lanes before #224. Elsewhere a lane is a Supabase stack, an app server with
// its worker and a Chromium; what one needs is an estimate, not a measurement.
const hostedLanes = 4;
const laneNeeds = { cpus: 2, bytes: 2.5 * 2 ** 30 };

/** How many browser test lanes a runner can carry. */
export function lanesFor({ environment, cpus, availableBytes }) {
 if (environment === 'github-hosted') return hostedLanes;
 return Math.max(1, Math.min(maxLanes, Math.floor(cpus / laneNeeds.cpus), Math.floor(availableBytes / laneNeeds.bytes)));
}

function memory() {
 const free = 1024 * Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m)[1]);
 // A cgroup v2 limit on this process's group, or on any group above it, can leave less than the machine has free.
 const group = readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(\/.*)$/m)?.[1];
 const headroom = [];
 for (let dir = group; dir; dir = dir === '/' ? undefined : dirname(dir)) {
  const read = file => readFileSync(join('/sys/fs/cgroup', dir, file), 'utf8').trim();
  try {
   const max = read('memory.max');
   if (max !== 'max') headroom.push(Number(max) - Number(read('memory.current')));
  } catch {
   // No memory controller at this level.
  }
 }
 return { free, headroom: headroom.length ? Math.min(...headroom) : Infinity };
}

// Everything this repository's CI runs start on the runner's Docker, in the order it can be removed. The self-hosted
// runner's daemon also runs other repositories' CI, so an object is ours only by one of these exact names or by a
// Supabase project id of our own lanes (scripts/local-db.sh).
const projects = new Set(Array.from({ length: maxLanes }, (_, n) => projectOf(n)));
const project = '{{.Label "com.supabase.cli.project"}}';
const dockerObjects = [
 {
  kind: 'container', list: ['container', 'ls', '--all', '--format', `{{.Names}}\t${project}\t{{.Status}}`],
  remove: ['container', 'rm', '--force', '--volumes'],
  names: new Set(['gtmworks-ci', 'gtmworks-worker-ci', 'gtmworks-proxy-app', 'gtmworks-proxy-caddy', 'gtmworks-lane-renderer']),
 },
 { kind: 'volume', list: ['volume', 'ls', '--format', `{{.Name}}\t${project}`], remove: ['volume', 'rm', '--force'], names: new Set(['gtmworks-proxy-caddy-data']) },
 { kind: 'network', list: ['network', 'ls', '--format', `{{.Name}}\t${project}`], remove: ['network', 'rm'], names: new Set([...projects].map(id => `supabase_network_${id}`)) },
];
const ours = objects => execFileSync('docker', objects.list, { encoding: 'utf8' }).split('\n').filter(Boolean)
 .map(line => line.split('\t')).filter(([name, id]) => objects.names.has(name) || projects.has(id));

const parentOf = pid => {
 const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
 return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
};
// The app servers, workers and lane scripts a run started work in its checkout; a cancelled run can leave them running.
function workspaceProcesses(workspace) {
 const spared = new Set();
 for (let pid = process.pid; pid > 1; pid = parentOf(pid)) spared.add(pid);
 return readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(Number).filter(pid => !spared.has(pid)).flatMap(pid => {
  try {
   const cwd = readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, '');
   return cwd === workspace || cwd.startsWith(`${workspace}/`) ? [{ pid, name: readFileSync(`/proc/${pid}/comm`, 'utf8').trim() }] : [];
  } catch {
   // Gone already, or another user's.
   return [];
  }
 });
}

function cleanup() {
 const left = [];
 if (process.env.GITHUB_WORKSPACE) {
  for (const { pid, name } of workspaceProcesses(realpathSync(process.env.GITHUB_WORKSPACE))) {
   try {
    process.kill(pid, 'SIGKILL');
    console.log(`stopped process ${pid} ${name}`);
   } catch (error) {
    if (error.code !== 'ESRCH') left.push(`process ${pid} ${name} (${error.code})`);
   }
  }
 }
 // A removal that fails is judged by the listing below, so an object another job removed first is not an error.
 for (const objects of dockerObjects) {
  const names = ours(objects).map(([name]) => name);
  if (names.length) spawnSync('docker', [...objects.remove, ...names], { stdio: 'inherit' });
 }
 for (const objects of dockerObjects) left.push(...ours(objects).map(([name, , status]) => [objects.kind, name, status].filter(Boolean).join(' ')));
 console.log(['gtmworks containers left on this runner:', ...(left.length ? left : ['none'])].join('\n'));
 return left.length ? 1 : 0;
}

const commands = {
 'reserved-ports': () => console.log(reservedPorts),
 'move-ports': block => {
  if (!/^\d+$/.test(block ?? '')) return misuse();
  const path = 'supabase/config.toml';
  let moved;
  try {
   moved = movePorts(readFileSync(path, 'utf8'), Number(block));
  } catch (error) {
   if (!(error instanceof RangeError)) throw error;
   console.error(error.message);
   return 2;
  }
  writeFileSync(path, moved);
  const ports = Object.entries(stackPortsOf(moved)).map(([role, port]) => `${role} ${port}`).join(', ');
  const outgoing = readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().replace(/\s+/, '-');
  console.error(`${path}: lane 0 on ${ports}, each lane 100 above the last; this machine's outgoing connections use ${outgoing}`);
 },
 lanes: environment => {
  if (!['github-hosted', 'self-hosted'].includes(environment)) return misuse();
  const cpus = availableParallelism();
  const { free, headroom } = memory();
  const lanes = lanesFor({ environment, cpus, availableBytes: Math.min(free, headroom) });
  const gib = bytes => (bytes / 2 ** 30).toFixed(1);
  console.error(`${environment}: ${cpus} CPUs, ${gib(free)} GiB available, cgroup headroom ${headroom === Infinity ? 'unlimited' : `${gib(headroom)} GiB`};`
   + ` a lane needs about ${laneNeeds.cpus} CPUs and ${gib(laneNeeds.bytes)} GiB -> ${lanes} lane(s)`);
  console.log(`GTMWORKS_TEST_LANES=${lanes}`);
 },
 cleanup,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const [command, ...args] = process.argv.slice(2);
 process.exitCode = Object.hasOwn(commands, command) ? commands[command](...args) ?? 0 : misuse();
}
