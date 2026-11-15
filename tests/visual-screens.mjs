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
  { name: 'numbers', path: '/c/rs-learning/numbers' },
  { name: 'log', path: '/c/rs-learning/log' },
  // First run's one question (#9), over RS Learning made unanswered for the picture, and Lead's first words in the
  // Owner's new, empty Conversation with Lead (tests/visual.spec.ts sets both states up and puts the seed back).
  { name: 'first-run-question', path: '/c/rs-learning/home', state: 'unanswered' },
  { name: 'lead-welcome', path: '/c/rs-learning/conversations/64000000-0000-0000-0000-000000000009', state: 'lead-welcome' },
  // A Company worked alone (#10): RS Consultations, where Omar is the only Member, set to alone for the picture. The
  // chat page shows the sidebar with no channels; settings shows the Company with the invitation form and no members.
  { name: 'alone-chat', path: '/c/rs-consultations/chat', state: 'alone' },
  { name: 'alone-settings', path: '/c/rs-consultations/settings', state: 'alone' },
  // Lead makes an Agent (#13), over Lead and the Meta Ads Lead made for Omar on June 10, not opened yet: the
  // Conversation with its card (the sidebar marks Meta Ads new), Lead's chat opened by "New agent", and Meta Ads's page
  // in Settings saying when and at whose request.
  { name: 'made-card', path: '/c/rs-learning/conversations/65000000-0000-0000-0000-000000000005', state: 'lead-made' },
  { name: 'new-agent', path: '/c/rs-learning/chat?new=agent', state: 'lead-made' },
  // The ready-made gallery (#14) over that chat, where the link in its hint line leads.
  { name: 'ready-roles', path: '/c/rs-learning/chat?new=ready', state: 'lead-made' },
  { name: 'made-agent', path: '/c/rs-learning/settings?agent=65000000-0000-0000-0000-000000000004', state: 'lead-made' },
  // Which Agents each Member sees (#15): Company settings over Lead, Meta Ads and SEO, with Meta Ads shown to the Manager
  // and to the first Contributor, and SEO to the Manager.
  { name: 'agent-visibility', path: '/c/rs-learning/settings', state: 'visibility' },
  // A lasting rule told to an Agent (#18), over Ads and the rule Omar told it on June 10: the Conversation with Ads's
  // reply and the saved line, and Ads's page in Settings listing the rule, who said it and when, with the Owner's Remove.
  { name: 'rule-saved', path: '/c/rs-learning/conversations/68000000-0000-0000-0000-000000000003', state: 'rule-told' },
  { name: 'agent-rules', path: '/c/rs-learning/settings?agent=68000000-0000-0000-0000-000000000002', state: 'rule-told' },
  // The settings overlay (#26), over Lead and Meta Ads as in made-agent: the Agents section and the main Agent's page.
  // Its Company section of a team is agent-visibility above.
  { name: 'settings-agents', path: '/c/rs-learning/settings?section=agents', state: 'lead-made' },
  { name: 'settings-main-agent', path: '/c/rs-learning/settings?agent=65000000-0000-0000-0000-000000000003', state: 'lead-made' },
  { name: 'agent-details', path: '/c/rs-learning/chat/69100000-0000-0000-0000-000000000005', state: 'agent-details' },
];

export const screens = [
  { name: 'first-run', path: '/first-run', anonymous: true, dark: false },
  ...lightScreens.map(screen => ({ ...screen, dark: false })),
  ...lightScreens.filter(screen => ['sign-in', 'home', 'chat', 'board', 'card', 'alone-chat', 'alone-settings', 'made-card', 'new-agent', 'made-agent', 'agent-visibility', 'ready-roles', 'rule-saved', 'agent-rules', 'settings-agents', 'settings-main-agent', 'agent-details'].includes(screen.name))
    .map(screen => ({ ...screen, name: `${screen.name}-dark`, dark: true })),
];

export const snapshotName = (screen, language, width) => `${screen.name}-${language}-${width}`;

// Playwright names a baseline `<name>-<project>-<platform>.png`. CI renders on Linux, so only Linux baselines count.
export const baselineFolder = 'tests/visual.spec.ts-snapshots';
export const baselineFile = (screen, language, width) => `${snapshotName(screen, language, width)}-visual-linux.png`;
