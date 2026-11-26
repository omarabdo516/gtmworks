// The Engine a local app reaches when `npm run cloud:up` starts it (#485): the browser suite's fake Hermes
// (tests/fake-hermes.mjs) at the address and key scripts/web.sh gives lane 0's app and worker, so a message to an Agent
// gets a reply ("Reply to: …") with no model, no key and no outside call. It runs until it is stopped.
// Its Kanban board holds one Card being worked (spec #831): every seeded Company's board is this Engine's, and the
// journey (scripts/cloud-verify.mjs, step 5) finds that Card in In progress.
import { fakeHermes } from '../tests/fake-hermes.mjs';
import { hermesHostOf } from '../tests/lane.mjs';

const host=hermesHostOf(0);
const fake=await fakeHermes({host,port:8642,managementPort:9119});
// It opens in the Card window (#835) with a description, a comment and its Run, as the Engine keeps them.
const card=fake.settings.kanban.task({title:'Weekly report for the team',status:'running',body:'## Steps\n- [x] Read the week’s numbers\n- [ ] Write the report\n- [ ] Send it to the team'}).id;
fake.settings.kanban.comment(card,'Omar Abdo','Cover 29 Oct to 4 Nov, please.');
fake.settings.kanban.run(card,{});
console.log(`fake Hermes listening on http://${host}:8642 (management ${host}:9119), key ${fake.settings.key}`);
const stop=async()=>{ await fake.close(); process.exit(0); };
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
