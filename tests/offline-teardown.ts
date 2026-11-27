import { assertNothingRefused } from './offline.mjs';
import { assertNoCardDeleted } from './engine-routes.mjs';

// The Playwright configs' global teardown: the run fails naming each outside host any of its processes tried (#266), and
// naming each delete of a Card any fake Engine of the run was asked for (#842: a Card is archived, never deleted).
export default () => { try { assertNothingRefused(); } finally { assertNoCardDeleted(); } };
