import { posix } from 'node:path';
import { i18n } from './i18n.mjs';

// What the Owner's Hermes dashboard refuses (#871, spec #866, ADR 0033 item 4). Everything on the dashboard is open to an
// Owner but four things that break gtmworks itself (Omar, 2026-11-26), each refused at the gate (lib/engine-dashboard.mjs)
// on its route, before anything reaches the Engine, with a page that says gtmworks manages it and where:
// - `engineKey`, showing the Engine's own key. The key is in the Engine's environment and in every profile's .env, and
//   the route that shows a key's value (POST /api/env/reveal) cannot tell it from a model key, so showing any key is
//   refused; writing keys stays open. A backup archive holds every .env (hermes_cli/backup.py), so downloading one is
//   showing the key too. Any other answer that would hold the key is refused the same way by the gate.
// - `hermesUpdate`, updating Hermes away from the install's pin (POST /api/hermes/update).
// - `backupImport`, importing a backup over the Engine's data (POST /api/ops/import, /api/ops/import-upload).
// - `agentProfile`, making, renaming or deleting a profile, which is an Agent (POST /api/profiles, /api/profiles/import,
//   PATCH and DELETE /api/profiles/<name>), so gtmworks's list of Agents and the Engine's never disagree. Writes to an
//   existing profile (its soul, description, model) stay open.
// A refusal is a named outcome: its kind is what the Activity log records (#873).

/** @typedef {import('./engine-dashboard-words.mjs').DashboardRefusalKind} DashboardRefusalKind */
/** One refusal: which of the four it is, the Settings section where gtmworks does it instead, that section's name, and
 * what the page says. @typedef {{kind:DashboardRefusalKind,section:string,sectionName:string,says:string}} DashboardRefusal */

/** @type {Record<string,DashboardRefusal>} */
export const refusals=Object.freeze({
 // Showing a key, and any answer that would hold the Engine's: model keys are set in Providers too.
 keyShown:{kind:'engineKey',section:'models',sectionName:'settingsModels',says:'engineRefusedKey'},
 // A backup's download: gtmworks's own backup holds the Engine, made on the server.
 backupShown:{kind:'engineKey',section:'backup',sectionName:'settingsBackup',says:'engineRefusedBackup'},
 hermesUpdate:{kind:'hermesUpdate',section:'about',sectionName:'settingsAboutApp',says:'engineRefusedUpdate'},
 backupImport:{kind:'backupImport',section:'backup',sectionName:'settingsBackup',says:'engineRefusedImport'},
 agentProfile:{kind:'agentProfile',section:'agents',sectionName:'agents',says:'engineRefusedAgent'},
});

// The routes, as the pinned Engine names them (hermes_cli/web_routers: config_env.py 1098, ops.py 602-648, actions.py
// 241, profiles.py 814-984). HEAD asks what GET asks.
/** @type {[string,RegExp,DashboardRefusal][]} */
const routes=[
 ['POST',/^\/api\/env\/reveal$/,refusals.keyShown],
 ['GET',/^\/api\/ops\/backup\/download$/,refusals.backupShown],
 ['POST',/^\/api\/hermes\/update$/,refusals.hermesUpdate],
 ['POST',/^\/api\/ops\/import(?:-upload)?$/,refusals.backupImport],
 ['POST',/^\/api\/profiles(?:\/import)?$/,refusals.agentProfile],
 ['PATCH',/^\/api\/profiles\/[^/]+$/,refusals.agentProfile],
 ['DELETE',/^\/api\/profiles\/[^/]+$/,refusals.agentProfile],
];

/**
 * The route a dashboard path names, as the Engine's router matches it: each escape read once (as the server reads the
 * path before routing), its dot segments resolved, doubled and trailing slashes dropped, in lower case. The Activity log
 * reads a change's route the same way (#873, lib/engine-dashboard-activity.mjs).
 * @param {string} path the path under the dashboard's prefix, its query left on or not
 */
export function dashboardRoute(path) {
 const decoded=path.split('?')[0].replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));
 return (posix.normalize(`/${decoded}`).replace(/\/+$/,'')||'/').toLowerCase();
}

/**
 * Which of the four a dashboard request is, or null for every other request, which is open.
 * @param {string} method @param {string} path the path under the dashboard's prefix
 * @returns {DashboardRefusal|null}
 */
export function dashboardRefusal(method,path) {
 const route=dashboardRoute(path);
 const asked=method.toUpperCase()==='HEAD'?'GET':method.toUpperCase();
 return routes.find(([verb,pattern])=>verb===asked&&pattern.test(route))?.[2]??null;
}

const escape=(/** @type {string} */ text)=>text.replace(/[&<>"']/g,mark=>`&#${mark.charCodeAt(0)};`);

/**
 * The refusal's answer, in the person's language: a page of gtmworks's when a browser opened it as a page, and for the
 * dashboard's own code, which shows an error's `detail` in its pages, the same words as JSON. 403: the Owner may open the
 * dashboard; this one thing is gtmworks's.
 * @param {DashboardRefusal} refusal @param {{slug:string,language:'en'|'ar',page:boolean}} to
 */
export function refusedAnswer(refusal,{slug,language,page}) {
 const {t}=i18n(language);
 const where=`/c/${slug}/settings?section=${refusal.section}`;
 const place=`${t('settings')} › ${t(refusal.sectionName)}`;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(!page) return Response.json({detail:t(refusal.says,place),refused:refusal.kind,where},{status:403,headers});
 const says=escape(t(refusal.says,place)).replace(escape(place),`<a href="${escape(where)}">${escape(place)}</a>`);
 const dir=language==='ar'?'rtl':'ltr';
 const html=`<!doctype html><html lang="${language}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(t('engineRefusedTitle'))}</title>`
  // gtmworks's own colours (app/tokens.css: --gw-bg-pane, --gw-text-1, --gw-text-2), light and dark.
  +'<style>:root{color-scheme:light dark;--gw-bg-pane:#FFFFFF;--gw-text-1:#1C1C1C;--gw-text-2:#1C1C1CB8}@media (prefers-color-scheme:dark){:root{--gw-bg-pane:#161616;--gw-text-1:#F5F5F5;--gw-text-2:#F5F5F5B8}}'
  +'body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--gw-bg-pane);color:var(--gw-text-1);font:15px/24px system-ui,sans-serif}'
  +'main{max-width:480px;padding:24px 16px}h1{font-size:20px;line-height:28px;margin:0 0 8px}p{margin:0 0 16px;color:var(--gw-text-2)}a{color:inherit}</style></head>'
  +`<body><main><h1>${escape(t('engineRefusedTitle'))}</h1><p>${says}</p><p><a href="/c/${escape(slug)}/hermes/">${escape(t('engineRefusedBack'))}</a></p></main></body></html>`;
 return new Response(html,{status:403,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}

/** Whether a request wants a page (a browser's navigation) rather than data. @param {Headers} headers */
export const wantsPage=headers=>headers.get('sec-fetch-mode')==='navigate'||/\btext\/html\b/.test(headers.get('accept')??'');
