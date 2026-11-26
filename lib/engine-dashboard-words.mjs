// The words a line of the Owner's Engine dashboard in the Activity log may carry (#873, lib/engine-dashboard-activity.mjs),
// each a fixed word and never a value of a request: what the line is, the page it was on, the kind of change and which
// refused action. The database refuses any other
// (log_engine_dashboard), and the log reads each by its own catalogue words (lib/activity-log.mjs). Imported by the
// browser too, so it imports nothing.

/** The dashboard's pages a change is named by, as its navigation names them (web/src/App.tsx on the pinned Engine). */
export const dashboardPages=/** @type {const} */(['keys','config','plugins','mcp','channels','webhooks','pairing','cron','skills','models','profiles','files','system','sessions','kanban']);
/** @typedef {typeof dashboardPages[number]} DashboardPage */
/** The kinds of change a line names. */
export const dashboardChanges=/** @type {const} */(['keySaved','keyRemoved','pluginInstalled','platformSet','platformConnected','settingSaved','added','removed','changed']);
/** @typedef {typeof dashboardChanges[number]} DashboardChangeKind */
/** What a line is: a visit, a change the Engine took, a change it did not take, or one of the refused actions. */
export const dashboardActs=/** @type {const} */(['opened','changed','rejected','refused']);
/** @typedef {typeof dashboardActs[number]} DashboardAct */
/** The refused actions (lib/engine-dashboard-refusals.mjs). */
export const dashboardRefusalKinds=/** @type {const} */(['engineKey','hermesUpdate','backupImport','agentProfile']);
/** @typedef {typeof dashboardRefusalKinds[number]} DashboardRefusalKind */
