// The Engine a local app reaches when `npm run cloud:up` starts it (#485): the browser suite's fake Hermes
// (tests/fake-hermes.mjs) at the address and key scripts/web.sh gives lane 0's app and worker, so a message to an Agent
// gets a reply ("Reply to: …") with no model, no key and no outside call. It runs until it is stopped.
import { fakeHermes } from '../tests/fake-hermes.mjs';
import { hermesHostOf } from '../tests/lane.mjs';

const host=hermesHostOf(0);
const fake=await fakeHermes({host,port:8642,managementPort:9119});
console.log(`fake Hermes listening on http://${host}:8642 (management ${host}:9119), key ${fake.settings.key}`);
const stop=async()=>{ await fake.close(); process.exit(0); };
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
