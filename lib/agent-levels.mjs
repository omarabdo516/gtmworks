// Agent levels (Omar, 2026-11-13; ADR 0014). A Company's level decides which Hermes toolsets its own profile in the
// bundled Engine offers to a Run. It is enforced by that profile's tool configuration and by gtmworks approvals, never
// by prompt text:
//  1 reads and drafts only; 2 acts on approval, and since gtmworks has no approval-gated action path yet it gets no
//  tool beyond level 1 (the level is recorded and shown, "no action tools yet"); 3 may also schedule its own work
//  (Hermes cron jobs) within what was approved.
// A new Company starts at 1. This table is the one place the levels are written; the worker writes it into each
// company profile's config.yaml through the driver (lib/hermes.mjs) and reads back what Hermes then enables.
//
// Toolset names are the pinned release's (Hermes v0.23.0, toolsets.py and hermes_cli/tools_config.py).

export const agentLevels = [1, 2, 3];

// The version of the table below. Every change to what a level gets is a new policy: bump this together with a
// migration that redefines public.engine_tool_policy(). Each company profile records the policy its tools were applied
// under, and the worker applies the current one to every profile that has another (tests/company-profiles.test.mjs
// pins each policy's table). 1 was the first table, whose level 2 had Hermes's connectors; 2 is this one.
export const toolPolicy = 2;

// Marketing tools that read and draft: web search and extraction, image analysis and generation, the profile's own
// skills, a task list, the company's memory and its past sessions.
const readAndDraft = ['web', 'vision', 'image_gen', 'skills', 'todo', 'memory', 'session_search'];
// Scheduled work the Agent creates and runs on its own.
const scheduled = ['cronjob'];

/** @type {Record<number,string[]>} */
export const levelToolsets = {
 1: readAndDraft,
 // Acting on approval needs gtmworks to hold each action until a person approves it; until that path exists, level 2
 // gets nothing that acts.
 2: readAndDraft,
 3: [...readAndDraft, ...scheduled],
};

// Never offered to a company profile, at any level: a shell and its processes, files on the Engine's disk, running
// code, the desktop, a real browser, sub-agents, desktop panes and projects, plugin installs, the Hermes board's
// tools (they attach files from disk) and Hermes's connectors, which act in connected accounts (posting, sending)
// without a gtmworks approval. agent.disabled_toolsets is applied by Hermes after everything else
// (tools_config.py, _get_platform_tools), so a later edit of the platform list cannot bring these back.
// The composites `debugging` and `safe` are deliberately not listed: Hermes strips every tool of a disabled composite,
// so they would also strip web search; their dangerous tools are covered by terminal and file. `coding` is a posture,
// which Hermes subtracts only by its non-core tools (none), so listing it would change nothing.
export const alwaysOff = ['terminal', 'file', 'code_execution', 'computer_use', 'browser', 'delegation', 'project', 'desktop_ui', 'catalog', 'onboarding', 'kanban', 'connections'];

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
