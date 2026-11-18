import { fakeHermes } from './fake-hermes.mjs';
import { hermesHostOf } from './lane.mjs';

// The fake Hermes at the address the lane's app and worker are given (scripts/web.sh): the one Hermes they reach (#342).
// One spec file runs on a lane at a time, so each starts its own and closes it when done.
export const laneHermes = () => fakeHermes({ host: hermesHostOf(), port: 8642, managementPort: 9119 });
