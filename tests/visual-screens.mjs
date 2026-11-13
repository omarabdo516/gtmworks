// The screens that are compared with approved images, shared by the browser tests and the baseline-folder check.
// Each screen is compared once per language and width, so it owns languages x widths approved images.
export const languages = ['en', 'ar'];
export const widths = [1440, 390];

// `anonymous` screens are shown to a visitor who has not signed in; every other screen is the view of the
// seeded Owner of every company.
const lightScreens = [
  { name: 'sign-in', path: '/sign-in', anonymous: true },
  { name: 'home', path: '/c/rs-learning/home' },
  { name: 'chat', path: '/c/rs-learning/chat' },
  { name: 'board', path: '/c/rs-learning/work/board' },
  { name: 'card', path: '/c/rs-learning/work/board/1' },
  { name: 'calendar', path: '/c/rs-learning/work/calendar' },
  { name: 'approvals', path: '/c/rs-learning/approvals' },
  { name: 'members', path: '/c/rs-learning/settings/members' },
  { name: 'agents', path: '/c/rs-learning/settings/agents' },
  { name: 'work-settings', path: '/c/rs-learning/settings/work' },
];

export const screens = [
  { name: 'first-run', path: '/first-run', anonymous: true, dark: false },
  ...lightScreens.map(screen => ({ ...screen, dark: false })),
  ...lightScreens.filter(screen => ['sign-in', 'home', 'chat', 'board', 'card'].includes(screen.name))
    .map(screen => ({ ...screen, name: `${screen.name}-dark`, dark: true })),
];

export const snapshotName = (screen, language, width) => `${screen.name}-${language}-${width}`;

// Playwright names a baseline `<name>-<project>-<platform>.png`. CI renders on Linux, so only Linux baselines count.
export const baselineFolder = 'tests/visual.spec.ts-snapshots';
export const baselineFile = (screen, language, width) => `${snapshotName(screen, language, width)}-visual-linux.png`;
