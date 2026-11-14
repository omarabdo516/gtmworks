// CI runs the browser suite in two integration jobs, each on a standard runner with lanes of its own (#74).
// GTMWORKS_BROWSER_JOB=1 runs the screens, every functional file not listed here, the navigation budgets and first
// run, in that order (playwright.config.ts). GTMWORKS_BROWSER_JOB=2 runs only the functional files listed here. Unset,
// as on a local run, one run has the whole suite.
//
// The list is chosen by time, not by count: the first job also builds the image, checks the database, runs the proxy
// suite and the screens before its functional files start, so the second job takes the long functional files and both
// jobs end at about the same time. Times are one file's seconds on a four-lane CI runner (run 43642299138, #71).
// A new spec file runs in the first job until it is listed here.
export const secondJobFiles = [
  'conversations.spec.ts', // 355 s
  'app.spec.ts', // 312 s
  'frame.spec.ts', // 200 s
  'hermes-connections.spec.ts', // 156 s
  'hermes-agents.spec.ts', // 135 s
  'board.spec.ts', // 113 s
  'language.spec.ts', // 111 s
  'team-work.spec.ts', // 99 s
  'engine-conversation.spec.ts', // 81 s
  'skill-lessons.spec.ts', // 65 s
  'settings-overlay.spec.ts', // 64 s
];

export const browserJob = process.env.GTMWORKS_BROWSER_JOB ?? '';
if (!['', '1', '2'].includes(browserJob)) throw new Error(`GTMWORKS_BROWSER_JOB must be 1, 2 or unset, not ${JSON.stringify(browserJob)}`);
