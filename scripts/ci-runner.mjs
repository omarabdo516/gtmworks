import { pathToFileURL } from 'node:url';
import { reservedPorts } from '../tests/lane.mjs';

// What a CI job needs from its GitHub-hosted runner (#225).
//   reserved-ports   the range every lane's stack binds, for net.ipv4.ip_local_reserved_ports
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 if (process.argv.slice(2).join(' ') === 'reserved-ports') console.log(reservedPorts);
 else {
  console.error('usage: node scripts/ci-runner.mjs reserved-ports');
  process.exitCode = 2;
 }
}
