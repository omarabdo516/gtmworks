import { assertNothingRefused } from './offline.mjs';

// The Playwright configs' global teardown (#266): the run fails naming each outside host any of its processes tried.
export default () => assertNothingRefused();
