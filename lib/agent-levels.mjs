// Agent levels (Omar, 2026-11-13; ADR 0014). A Company's level decides which Hermes toolsets its own profile in the
// bundled Engine offers to a Run. It is enforced by that profile's tool configuration and by gtmworks approvals, never
// by prompt text:
//  1 reads and drafts only; 2 may act, and what it delivers still waits for a person's approval in gtmworks;
//  3 may also schedule its own work (Hermes cron jobs) within what was approved.
// A new Company starts at 1. This table is the one place the levels are written; the worker writes it into each
// company profile's config.yaml through the driver (lib/hermes.mjs) and reads back what Hermes then enables.
//
// Toolset names are the pinned release's (Hermes v0.23.0, toolsets.py and hermes_cli/tools_config.py).

export const agentLevels = [1, 2, 3];

// Marketing tools that read and draft: web search and extraction, image analysis and generation, the profile's own
// skills, a task list, the company's memory and its past sessions.
const readAndDraft = ['web', 'vision', 'image_gen', 'skills', 'todo', 'memory', 'session_search'];
// Hermes's connectors: running an action in a connected account (posting, sending) and authorizing accounts.
const acting = ['connections'];
// Scheduled work the Agent creates and runs on its own.
const scheduled = ['cronjob'];

/** @type {Record<number,string[]>} */
export const levelToolsets = {
 1: readAndDraft,
 2: [...readAndDraft, ...acting],
 3: [...readAndDraft, ...acting, ...scheduled],
};

// Never offered to a company profile, at any level: a shell and its processes, files on the Engine's disk, running
// code, the desktop, a real browser, sub-agents, desktop panes and projects, plugin installs and the Hermes board's
// tools (they attach files from disk). agent.disabled_toolsets is applied by Hermes after everything else
// (tools_config.py, _get_platform_tools), so a later edit of the platform list cannot bring these back.
// The composites `debugging` and `safe` are deliberately not listed: Hermes strips every tool of a disabled composite,
// so they would also strip web search; their dangerous tools are covered by terminal and file. `coding` is a posture,
// which Hermes subtracts only by its non-core tools (none), so listing it would change nothing.
export const alwaysOff = ['terminal', 'file', 'code_execution', 'computer_use', 'browser', 'delegation', 'project', 'desktop_ui', 'catalog', 'onboarding', 'kanban'];

// The tools whose presence in a company with more than one member raises the Owner's warning (rule f).
export const riskyToolsets = ['terminal', 'code_execution', 'file'];

export const isAgentLevel = level => agentLevels.includes(level);

// The config.yaml fragment for one level, deep-merged by Hermes into the profile's config (PUT /api/config).
// Lists replace lists in that merge, so each write states the whole list.
/** @param {number} level */
export function levelConfig(level) {
 if (!isAgentLevel(level)) throw new Error('agentLevelInvalid');
 const enabled = levelToolsets[level];
 const above = levelToolsets[3].filter(name => !enabled.includes(name));
 return { platform_toolsets: { api_server: [...enabled] }, agent: { disabled_toolsets: [...alwaysOff, ...above] } };
}

// Of the toolsets Hermes reports enabled for a profile's Runs, the ones that must never be on for a company profile.
/** @param {string[]} enabled */
export const forbiddenOf = enabled => enabled.filter(name => alwaysOff.includes(name));
/** @param {string[]} enabled */
export const riskyOf = enabled => riskyToolsets.filter(name => enabled.includes(name));

// The Hermes profile of one Company in the bundled Engine: stable, derived from the Company's id, and a valid profile
// name (^[a-z0-9][a-z0-9_-]{0,63}$). The database derives the same name (company_engine_profile) and refuses any other.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @param {string} company */
export function companyProfile(company) {
 if (typeof company !== 'string' || !uuid.test(company)) throw new Error('companyInvalid');
 return `co-${company.toLowerCase().replaceAll('-', '')}`;
}
