// The tools every Agent gets, and the tools no Agent gets (ADR 0018; spec #389). This is the one place in gtmworks that
// places an Engine toolset: a new tool of the pinned Engine is offered only when it is named here, and one that runs
// code an Agent supplies, or reads a path an Agent chooses, in the Engine's own container is never offered.
//
// It is enforced by each profile's tool configuration (lib/company-profiles.mjs writes it through lib/hermes.mjs) and by
// gtmworks's own approvals, never by prompt text. There is no level and no policy version: the worker compares what the
// Engine reports with this module and corrects it (keepCompanyProfiles, keepAgentProfiles, checkAgentTools). The
// Company's own Apps' MCP servers (#30) sit beside the set and are not a difference; anything else the Engine reports is
// (appToolset, toolsDiffer).
//
// Toolset names are the pinned release's (Hermes v0.23.0, toolsets.py and hermes_cli/tools_config.py).

// What every Agent gets (ADR 0018, spec #389): web search and extraction, image analysis and generation, the profile's
// own skills, a task list, the company's memory, its past sessions, the Engine's question tool (#138) and scheduled
// work. The terminal, files and code execution are the work sandbox's (sandboxTools below); #393 offers them to every
// Agent when the sandbox exists by adding them here, in this one place.
export const everyAgentGets = Object.freeze(['web','vision','image_gen','skills','todo','memory','session_search','clarify','cronjob']);

// The work sandbox's tools (#389, #393). The terminal, the file tools and code execution run on the Engine's disk when
// no sandbox is behind them, so they are held back until one is. `toolConfig({sandbox:true})` offers them; #393 makes
// that the fixed set.
export const sandboxTools = Object.freeze(['terminal','file','code_execution']);

// Never offered to any Agent, with no switch: `browser` (its browser_exec runs the Agent's code in the Engine's own
// container), `computer_use` (until the screen spec), `tts` (text_to_speech writes on the Engine's disk at the path the
// Agent names), the video tools, desktop panes and projects, plugin installs (catalog), first-run cards (onboarding),
// the Hermes board's tools (kanban attaches files from disk) and Hermes's connectors (connections), which act in
// connected accounts (posting, sending) without a gtmworks approval. agent.disabled_toolsets is applied by Hermes after
// everything else (tools_config.py, _get_platform_tools), so a later edit of the platform list cannot bring these back.
// The composites `debugging` and `safe` are deliberately not listed: Hermes strips every tool of a disabled composite,
// so they would also strip web search; their dangerous tools are covered by terminal and file. `coding` is a posture,
// which Hermes subtracts only by its non-core tools (none), so listing it would change nothing.
export const noAgentGets = Object.freeze(['browser','computer_use','tts','video','video_gen','project','desktop_ui','catalog','onboarding','kanban','connections']);

// The config.yaml fragment for every Agent, deep-merged by Hermes into the profile's config (PUT /api/config). Lists
// replace lists in that merge, so each write states the whole list. `subagents` is the Owner's per-Agent switch (#29):
// on, the Engine's delegation toolset is offered too and no longer disabled, and the Engine passes that disabled list on
// to each child (tools/delegate_tool_toolsets.py 107-115), so a child never gains the sandbox's tools either.
/** @param {{subagents?:boolean,sandbox?:boolean}} [options] */
export function toolConfig({subagents=false,sandbox=false}={}) {
 const enabled=[...everyAgentGets,...(sandbox?sandboxTools:[]),...(subagents?['delegation']:[])];
 const disabled=[...noAgentGets,...(sandbox?[]:sandboxTools),...(subagents?[]:['delegation'])];
 return {platform_toolsets:{api_server:enabled},agent:{disabled_toolsets:disabled}};
}

// The toolsets a confirmed profile offers, as the Engine reports them.
/** @param {{subagents?:boolean,sandbox?:boolean}} [options] */
export const fixedToolsets=({subagents=false,sandbox=false}={})=>toolConfig({subagents,sandbox}).platform_toolsets.api_server;

// Whether a reported toolset is one of the Company's own Apps (#30): the MCP server gtmworks wrote into the profile's
// config, which the Engine names by the server or by the registry's `mcp-<server>` (toolsets.py, mcp_tool_registration.py).
// It is not a tool of the fixed set, and the checks below let it be. Never a toolset no Agent gets, whatever an App is
// called.
/** @param {string} name @param {string[]} apps */
export const appToolset=(name,apps=[])=>{
 const bare=name.startsWith('mcp-')?name.slice(4):name;
 return apps.includes(bare)&&!noAgentGets.includes(bare);
};

// Whether what the Engine reports is the fixed set: the same tools, no more and no fewer, with the Company's own Apps'
// servers beside them. A tool on that no Agent gets is never the fixed set, and neither is a toolset the module places
// nowhere (a tool the Engine added later, or a server gtmworks did not write).
/** @param {string[]} enabled @param {{subagents?:boolean,sandbox?:boolean,apps?:string[]}} [options] */
export function toolsDiffer(enabled,{subagents=false,sandbox=false,apps=[]}={}) {
 const wanted=fixedToolsets({subagents,sandbox});
 const got=[...new Set(enabled)].filter(name=>!appToolset(name,apps));
 return got.some(name=>!wanted.includes(name))||wanted.some(name=>!got.includes(name));
}

// The tools a sub-agent (a child Run of a profile with sub-agents on) may use, from the parent's config alone: everything
// its parent offers, minus what the Engine keeps from children (`delegation` and `kanban` whole, and the tools in
// tools/delegate_tool_toolsets.py 14-22), with the parent's disabled list inherited plus those toolsets
// (lines 107-115, called from tools/delegate_tool.py 256). A child of a profile that was not offered the sandbox's
// tools never gains them.
/** @param {{platform_toolsets?:{api_server?:string[]},agent?:{disabled_toolsets?:string[]}}} config */
export function childToolsets(config) {
 const parent=config?.platform_toolsets?.api_server??[];
 const disabled=config?.agent?.disabled_toolsets??[];
 const offered=parent.filter(name=>!disabled.includes(name));
 const kept=['delegation','kanban'];
 return {toolsets:offered.filter(name=>!kept.includes(name)),disabled:[...new Set([...disabled,...kept])]};
}

// Of the toolsets the Engine reports enabled for a profile's Runs, the ones no Agent may have on.
/** @param {string[]} enabled */
export const forbiddenOf=enabled=>enabled.filter(name=>noAgentGets.includes(name));

// An Agent's own profile in the Engine (ADR 0016), as the database derives it from the Agent's id
// (agent_engine_profile); gtmworks only recognises the name.
/** @param {unknown} name */
export const isAgentProfile=name=>typeof name==='string'&&/^ag-[0-9a-f]{32}$/.test(name);

// The Hermes profile of one Company: stable, derived from the Company's id, and a valid profile name
// (^[a-z0-9][a-z0-9_-]{0,63}$). The database derives the same name (company_engine_profile) and refuses any other.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @param {string} company */
export function companyProfile(company) {
 if(typeof company!=='string'||!uuid.test(company)) throw new Error('companyInvalid');
 return `co-${company.toLowerCase().replaceAll('-','')}`;
}
