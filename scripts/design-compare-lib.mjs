// Pure helpers for scripts/design-compare.mjs (#285): argument checks, the screen table, output names and a
// static server over design-reference/ that never answers outside it.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

// A named screen says how to reach it in the reference and which built page it is compared with (null: none yet).
// The prototype has no URL routes: its sidebar switches views by `data-view` (chat, board, dashboard, log) and the
// account menu opens the settings overlay (`#sov`) with its sections. Each step is one `click`, `waitFor`, `waitGone`, `fill` ([selector, text]) or
// `scrollTo` with a CSS selector, or one `press` with a key as Playwright names it (`{ press: 'ArrowDown' }`), pressed
// where the focus is; a click on a sidebar item hidden behind the narrow-screen menu opens the menu first. A screen's `builtSteps` run the same way on the built page after it opens.
// The built steps also take `goto` (a built page opened as a document, captured while it still streams) and `finish` (a
// selector whose own animations are ended at once); `builtSettle: false` captures right after the steps, without waiting
// for the network to go quiet.
// Every screen starts from the prototype's default state. Only the alone screens and a Member's request screens touch
// the "viewing as" switcher: the alone ones show the workspace of an Owner working alone (#10); built, that is seeded
// R&S Consultations, its one Member Omar, with work_mode set to 'alone'. The
// request ones show Youssef, a Contributor in the team (#17); built, that is the first Contributor, signed in with
// --sign-in reviewer@example.com, over a request set up by hand (the compared screens' state for it went with #257).
const settings = [{ click: '#btn-me' }, { click: '[data-action="sov-open"]' }, { waitFor: '#sov[open] #sov-nav-company' }];
const alone = [{ click: '#btn-me' }, { click: '[data-action="set-as"][data-person="omar"][data-world="solo"]' }, { waitFor: '#sb-recent' }];
const asYoussef = [{ click: '#btn-me' }, { click: '[data-action="set-as"][data-person="youssef"][data-world="team"]' }, { waitFor: '#sb-recent' }];
const youssefRequest = [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-wa"]' }, { waitFor: '.ac-card' }];
// #185. The Team table's invitation, the same on both sides: open the form, send one, see its "Invite sent" row, then
// open the form again.
const inviteSteps = [{ click: '#inv-toggle' }, { fill: ['#inv-email', 'nour.hassan@rslearning.com'] }, { click: '.inv-go' }, { waitFor: '.ta-pending' }, { click: '#inv-toggle' }, { waitFor: '#inv-email' }];
const board = [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }];
const pickChat = [{ click: '#sh-tab-chat' }, { waitFor: '.priv-sheet' }];
const youssefAsks = 'Plan the Saudi ads for January';
// #167. Youssef asks the main Agent for an article, the job of SEO & Content, which is hidden from him.
const askForHidden = [{ click: '#btn-newchat' }, { fill: ['#ta-main', 'Write an SEO article about the accounting course'] }, { click: '[data-action="send"][data-key="main"]' }, { waitFor: '[data-action="ask-mgr"]' }];
const settingsSection = section => [...settings, { click: `#sov-nav-${section}` }, { waitFor: `#sov-nav-${section}[aria-current]` }];
// The ids of the optional comparison fixture (design/COMPARE.md, "Representative captures"). The tool never applies
// it: a person loads it by hand into a throwaway local database, then passes these ids with --built-path.
export const fixture = {
  file: 'scripts/design-compare-fixture.sql',
  mainAgent: '61000000-0000-0000-0000-000000000001',
  agent: '61000000-0000-0000-0000-000000000002',
  // SEO & Content, made from the ready-made SEO content writer, with no Conversation yet (#170).
  newAgent: '61000000-0000-0000-0000-000000000003',
  // Analyst, for which Lead proposed a faster model (#19), waiting on Omar's OK (#178).
  analyst: '61000000-0000-0000-0000-000000000004',
  conversation: '62000000-0000-0000-0000-000000000001',
  // Omar's Conversation in which Lead made Ads (#13), as the reference's thread th-made-ads.
  madeConversation: '62000000-0000-0000-0000-000000000002',
  channel: '69000000-0000-0000-0000-000000000001',
  // Omar's Conversation in which he told Ads a lasting rule (#18), as the reference's thread th-rule-ads.
  ruleConversation: '62000000-0000-0000-0000-000000000003',
  // The first Contributor's Conversation in which they told Ads a rule for the team (#25), as the reference's th-yo-ads;
  // the rule waits on Omar and the Manager as a learning suggestion.
  suggestionConversation: '62000000-0000-0000-0000-000000000004',
  // Omar's Conversation in which Ads waits on his answer to its question (#138), as the reference's th-meta (message m3).
  questionConversation: '62000000-0000-0000-0000-000000000005',
  // Omar's Conversation in which Ads hands him the article to publish (#139), as the reference's th-team (message t10).
  handConversation: '62000000-0000-0000-0000-000000000006',
  // Omar's Conversation in which Ads's reply shows its Run's four tool calls (#141), as the reference's th-meta (m3).
  stepsConversation: '62000000-0000-0000-0000-000000000007',
  // Omar's Conversation in which Ads's Run waits on his OK to publish the article (#163), as the reference's th-seo.
  permissionConversation: '62000000-0000-0000-0000-000000000008',
  // Omar's Conversation in which Analyst asks him to connect an app for the weekly report (#203), as the reference's
  // th-report (message r1).
  connectConversation: '62000000-0000-0000-0000-000000000009',
};
// #172. The chat and Numbers while their waiting part is still on its way. The workflow first applies the screen's own
// scripts/design-compare-<screen>.sql, which slows the one table that part reads; the tool itself never writes. The page
// is then opened as a document, which streams its frame and placeholder first (a sidebar link would show the page it
// had already prefetched whole), its 400ms hidden start is ended, and it is captured at once.
const loading = n => `6f000000-0000-0000-0000-00000000000${n}`;
const openSlowly = (page, placeholder) => [{ goto: page }, { finish: placeholder }, { waitFor: placeholder }];

export const screens = {
  // The prototype's main screen: the Conversation with the main Agent, Lead, which it opens on.
  home: { reference: { steps: [] }, builtPath: '/c/rs-learning/chat' },
  board: { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }] }, builtPath: '/c/rs-learning/work/board' },
  // "Waiting on you" is the board's first column in the prototype; the product gathers it on Approvals.
  waiting: { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }, { scrollTo: '#col-waiting' }] }, builtPath: '/c/rs-learning/approvals' },
  // The dashboard loads for 650 ms before its figures appear.
  numbers: { reference: { steps: [{ click: '#sb-nav [data-view="dashboard"]' }, { waitFor: '#view-dashboard .kpis' }] }, builtPath: '/c/rs-learning/numbers' },
  log: { reference: { steps: [{ click: '#sb-nav [data-view="log"]' }, { waitFor: '#view-log:not([hidden])' }] }, builtPath: '/c/rs-learning/log' },
  // A Card's log with its note field (#22): the reference's card sheet on its Log tab, beside the built Card's sheet (#116).
  'card-log': { reference: { steps: [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }, { click: '.kcard[data-action="open-card"]' }, { click: '#sh-tab-log' }, { waitFor: '#ta-note' }] }, builtPath: '/c/rs-learning/work/board?card=1' },
  // A Conversation with an Agent other than Lead, opened from its tile in the sidebar. In a team it starts with the
  // private line (#25).
  'agent-chat': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }] }, builtPath: null },
  // #21. The details beside that chat: the Files tab of Ads; and the Activity tab of SEO, whose screen is asleep, the
  // empty frame the product always shows. Built: the fixture's Ads, with the files of its Cards and of Omar's own
  // Conversations with it.
  'agent-files': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }, { click: '#dp-tab-files' }, { waitFor: '#dp-tab-files[aria-selected="true"]' }] }, builtPath: `/c/rs-learning/chat/${fixture.agent}?tab=files` },
  'agent-screen': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="seo"]' }, { waitFor: '.scr-card' }] }, builtPath: `/c/rs-learning/chat/${fixture.agent}` },
  // #204. Ads's details, Activity: "Connected tools" (Meta Ads and Google Ads connected, GA4 not), then Manage pressed.
  // Built: an Agent with apps in its own Engine profile and one it was made to use (pass --built-path).
  'agent-tools': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }, { waitFor: '[data-action="manage-tools"]' }, { scrollTo: '[data-action="manage-tools"]' }] },
   builtPath: null, builtSteps: [{ waitFor: '.dp-tools .panel-row' }, { scrollTo: '.dp-tools' }] },
  'agent-tools-manage': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }, { click: '[data-action="manage-tools"]' }, { waitFor: '[data-action="disconnect"]' }, { scrollTo: '[data-action="manage-tools"]' }] },
   builtPath: null, builtSteps: [{ click: '.dp-tools .dp-label .link-btn' }, { waitFor: '.dp-tools .panel-row .link-btn' }, { scrollTo: '.dp-tools' }] },
  // #205. Ads's details, Activity: "Routines" with its rows, then Add pressed (its one-line field). Built: the fixture's
  // Ads on a profile of its own whose Engine holds Routines (pass --built-path for another Agent).
  'agent-routines': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }, { waitFor: '#dp-routines .rt-row' }, { scrollTo: '#dp-routines' }] },
   builtPath: `/c/rs-learning/chat/${fixture.agent}`, builtSteps: [{ waitFor: '#dp-routines .rt-row' }, { scrollTo: '#dp-routines' }] },
  'agent-routines-add': { reference: { steps: [{ click: '#sb-agents [data-action="open-agent"][data-agent="ads"]' }, { waitFor: '#dp-routines .rt-row' }, { click: '[data-action="add-routine"]' }, { waitFor: '#rt-new' }, { scrollTo: '#rt-new' }] },
   builtPath: `/c/rs-learning/chat/${fixture.agent}`, builtSteps: [{ waitFor: '#dp-routines .rt-row' }, { click: '#dp-routines .dp-label .link-btn' }, { waitFor: '#dp-rt-new' }, { scrollTo: '#dp-rt-new' }] },
  // A new Agent's details with no Routine: the empty line and "Try writing". Built: the fixture's SEO & Content, on a
  // profile of its own with no Routine.
  'agent-routines-empty': { reference: { steps: [{ click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }, { click: '[data-action="open-gallery-alt"]' }, { waitFor: '#modal[open] .tpl' }, { click: '[data-action="tpl-add"][data-tpl="writer"]' }, { waitFor: '.card__actions [data-action="ac-open"]' }, { click: '.card__actions [data-action="ac-open"]' }, { waitFor: '#dp-routines .rt-try' }, { scrollTo: '#dp-routines' }] },
   builtPath: `/c/rs-learning/chat/${fixture.newAgent}`, builtSteps: [{ waitFor: '#dp-routines .rt-try' }, { scrollTo: '#dp-routines' }] },
  // The settings overlay opens on its Company section. The built overlay is route-backed (app/settings-overlay.tsx):
  // ?section= opens a section and ?agent=<id> one Agent's page.
  settings: { reference: { steps: settings }, builtPath: '/c/rs-learning/settings' },
  invite: { reference: { steps: [...settings, ...inviteSteps] }, builtPath: '/c/rs-learning/settings', builtSteps: inviteSteps },
  agents: { reference: { steps: settingsSection('agents') }, builtPath: '/c/rs-learning/settings?section=agents' },
  // One Agent's page: Lead's settings inside the overlay. Built: the comparison fixture's main Agent, Lead (the seed
  // alone has no Agent with that id, so without the fixture the overlay shows the Agents list).
  agent: { reference: { steps: [...settingsSection('agents'), { click: '#sov-ag-lead' }, { waitFor: '#sov-tab-settings' }] }, builtPath: `/c/rs-learning/settings?agent=${fixture.mainAgent}` },
  // #178. Settings, Agents, Analyst: the note under its tabs while Lead's proposed model for it waits for the Owner
  // (the reference's chg-analyst). Built: the comparison fixture's Analyst, with the same proposal (#19).
  'agent-proposal': { reference: { steps: [...settingsSection('agents'), { click: '#sov-ag-analyst' }, { waitFor: '.sov-pend' }] }, builtPath: `/c/rs-learning/settings?agent=${fixture.analyst}` },
  // #30. Settings, Apps: the reference draws its app catalogue there; built, the apps the Engine offers the Company.
  apps: { reference: { steps: [...settingsSection('apps'), { waitFor: '#sov-apps .app-card' }] }, builtPath: '/c/rs-learning/settings?section=apps' },
  account: { reference: { steps: settingsSection('account') }, builtPath: '/c/rs-learning/settings?section=account' },
  knowledge: { reference: { steps: settingsSection('knowledge') }, builtPath: '/c/rs-learning/settings?section=knowledge' },
  // Recurring tasks (#31): every Agent's Routines. Built: the Routines are the Engine's, so they need an Engine that holds
  // some (the visual lane's `routines` state and its fake Engine).
  routines: { reference: { steps: settingsSection('routines') }, builtPath: '/c/rs-learning/settings?section=routines' },
  'home-alone': { reference: { steps: alone }, builtPath: '/c/rs-consultations/chat' },
  'settings-alone': { reference: { steps: [...alone, ...settings] }, builtPath: '/c/rs-consultations/settings' },
  // #13. "New agent" opens Lead's chat ready to type, with one hint line.
  'new-agent': { reference: { steps: [{ click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }] }, builtPath: '/c/rs-learning/chat?new=agent' },
  // #14. The ready-made gallery, opened from that hint line's link. Built, it has its own address and needs a main
  // Agent: the comparison fixture's Lead (the seed alone has none, so it shows the plain chat).
  'ready-roles': { reference: { steps: [{ click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }, { click: '[data-action="open-gallery-alt"]' }, { waitFor: '#modal[open] .tpl' }] }, builtPath: '/c/rs-learning/chat?new=ready' },
  // #170. The main Agent's empty chat once the workspace has other Agents: the reference's New chat, with Lead picked. Built: Lead's chat
  // with the comparison fixture's five Agents.
  'main-empty': { reference: { steps: [{ click: '#btn-newchat' }, { click: '[data-action="pick-new-agent"][data-agent="lead"]' }, { waitFor: '.empty-chat--agent .suggest' }] }, builtPath: '/c/rs-learning/chat' },
  // #170. A new Agent's empty chat: in the reference the Owner adds the ready-made SEO content writer from the gallery,
  // Lead makes it in the chat, and its card's Open opens it.
  // Built: the comparison fixture's SEO & Content, made from that role, which Omar has not written to.
  'new-agent-empty': { reference: { steps: [{ click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }, { click: '[data-action="open-gallery-alt"]' }, { waitFor: '#modal[open] .tpl' }, { click: '[data-action="tpl-add"][data-tpl="writer"]' }, { waitFor: '.card__actions [data-action="ac-open"]' }, { click: '.card__actions [data-action="ac-open"]' }, { waitFor: '.try-one' }] }, builtPath: `/c/rs-learning/chat/${fixture.newAgent}` },
  // The Conversation in which Lead made Ads, with its card. Built: the fixture's madeConversation (pass --built-path).
  'made-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-made-ads"]' }, { waitFor: '.ac-card' }] }, builtPath: null },
  // #136. The Meta campaign chat (th-meta) after the first angle is chosen: Ads's reply with the campaign plan's draft card under it. Built: none
  // since #257 removed the state that held it; set the Conversation up by hand and pass --built-path.
  'draft-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-meta"]' }, { click: '.opt[data-action="choose"]' }, { waitFor: '.card--draft' }] }, builtPath: null },
  // #137. The team chat (th-team): Critic's reply with the review card of the December ad texts under it. Built: none
  // since #257 removed the state that held it; set the Conversation up by hand and pass --built-path.
  'review-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-team"]' }, { waitFor: '.rvcard' }, { scrollTo: '.rvcard' }] }, builtPath: null },
  // #138. The Meta campaign chat (th-meta): Ads's question card, the angle to take, before it is answered. Built: the
  // fixture's questionConversation (pass --built-path).
  'question-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-meta"]' }, { waitFor: '.qcard' }, { scrollTo: '.qcard' }] }, builtPath: null },
  // #139. The team chat (th-team): the hand card under SEO's reply, the article to publish on WordPress, open. Built: the
  // fixture's handConversation (pass --built-path).
  'hand-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-team"]' }, { waitFor: '.hcard' }, { scrollTo: '.hcard' }] }, builtPath: null },
  // #163. The SEO article chat (th-seo): the approval card to publish the article, waiting. Built: the fixture's
  // permissionConversation (pass --built-path).
  'permission-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-seo"]' }, { waitFor: '[data-action="approve"]' }, { scrollTo: '.card__actions' }] }, builtPath: null },
  // #165. "Waiting on you" with the request Ads's Run waits on: the reference's board, its card waiting on Omar's OK to
  // publish the SEO article (c-seo); built, Approvals with the fixture's permissionConversation's request as its item.
  'permission-waiting': { reference: { steps: [...board, { waitFor: '.kcard[data-card="c-seo"]' }, { scrollTo: '.kcard[data-card="c-seo"]' }] }, builtPath: '/c/rs-learning/approvals',
   builtSteps: [{ waitFor: 'a.mcard[data-kind="permission"]' }, { scrollTo: 'a.mcard[data-kind="permission"]' }] },
  // #165. A request in a channel, under the Agent's turn. The reference draws a request only in a chat, so it is the
  // th-seo card as permission-card's. Built: a channel whose Agent's Run waits on the signed-in Member (pass --built-path).
  'permission-channel': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-seo"]' }, { waitFor: '[data-action="approve"]' }, { scrollTo: '.card__actions' }] }, builtPath: null,
   builtSteps: [{ waitFor: '[id^="permission-"] .card__actions' }, { scrollTo: '[id^="permission-"] .card__actions' }] },
  // #166. An Agent's standing permissions: on the reference, Always allow on the SEO article chat's approval (th-seo)
  // gives SEO its one standing permission, then SEO's details on Activity end with it, and its settings page shows it
  // after Tools. Built: an Agent whose own profile keeps an entry an Always allow put there (pass --built-path).
  'standing-activity': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-seo"]' }, { click: '[data-action="approve"][data-decision="always"]' },
   { click: '#sb-agents [data-action="open-agent"][data-agent="seo"]' }, { waitFor: '#details [data-action="revoke"]' }, { scrollTo: '#details [data-action="revoke"]' }] }, builtPath: null,
   builtSteps: [{ waitFor: '.details .sp' }, { scrollTo: '.details .sp' }] },
  'standing-settings': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-seo"]' }, { click: '[data-action="approve"][data-decision="always"]' },
   ...settingsSection('agents'), { click: '#sov-ag-seo' }, { waitFor: '#sov [data-action="revoke"]' }, { scrollTo: '#sov [data-action="revoke"]' }] }, builtPath: null,
   builtSteps: [{ waitFor: '#sov-agent-panel .sp' }, { scrollTo: '#sov-agent-panel .sp' }] },
  // #203. The weekly report chat (th-report): Analyst's reply with the card asking to connect an app, open. Built: the
  // fixture's connectConversation (pass --built-path).
  'connect-card': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-report"]' }, { waitFor: '[data-action="connect"]' }, { scrollTo: '.card__actions' }] }, builtPath: null },
  // #141. The Meta campaign chat (th-meta): Ads's reply with "Used 4 tools · 41 sec" pressed, its four steps open, one
  // skipped. Built: the fixture's stepsConversation (pass --built-path), its steps pressed open the same way.
  'run-steps': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-meta"]' }, { click: '[data-action="toggle-steps"][data-msg="m3"]' }, { waitFor: '#st-th-meta-m3:not([hidden])' }, { scrollTo: '#st-th-meta-m3' }] },
   builtPath: null, builtSteps: [{ click: '.steps__toggle' }, { waitFor: '.steps__list:not([hidden])' }, { scrollTo: '.steps' }] },
  // #18. The Conversation in which Omar told Ads a lasting rule, with the saved line under Ads's reply. Built: the
  // fixture's ruleConversation (pass --built-path).
  'rule-saved': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-rule-ads"]' }, { waitFor: '.note--saved' }] }, builtPath: null },
  // #144. A chat with Ads whose Card is on the board (`th-meta`), with the corner pill "On the board". Built: a
  // Conversation with an Agent other than the main one whose first reply put its Card In progress (pass --built-path).
  'chat-on-board': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-meta"]' }, { waitFor: '.corner-pill' }] }, builtPath: null },
  // #25. The reference decides a learning suggestion in Settings, Learning ("Learning suggestions": Youssef's rule for
  // Ads, with Decline and Make it team-wide); the product decides it where it waits, in "Waiting on you". Built: the
  // fixture's suggestion.
  learning: { reference: { steps: [...settingsSection('learning'), { waitFor: '.ln-sugg .ln-row' }] }, builtPath: '/c/rs-learning/approvals' },
  // Ads's page in Settings, saying when it was made and at whose request, and listing the rule it was told (#18).
  // Built: the fixture's Ads, which Lead made and Omar told the rule.
  'made-agent': { reference: { steps: [...settingsSection('agents'), { click: '#sov-ag-ads' }, { waitFor: '#sov-tab-settings' }] }, builtPath: `/c/rs-learning/settings?agent=${fixture.agent}` },
  channel: { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="ch-general"]' }, { waitFor: '.ch-intro' }] }, builtPath: `/c/rs-learning/channels/${fixture.channel}` },
  // The reference shows the request Omar answers in his chat with Lead; the product, where it waits.
  'ask-agent': { reference: { steps: [...asYoussef, { click: '#sb-agents [data-action="new-agent"]' }, { waitFor: '.new-hint' }] }, builtPath: '/c/rs-learning/chat?new=agent' },
  'request-sent': { reference: { steps: [...asYoussef, ...youssefRequest] }, builtPath: '/c/rs-learning/conversations/6b000000-0000-0000-0000-000000000003' },
  // #19. Lead's proposed model for Analyst: in Omar's chat with Lead, and where it waits on him. Built: the fixture's
  // Conversation and Approvals.
  'change-proposed': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-lead-model"]' }, { waitFor: '.chg-card' }] }, builtPath: '/c/rs-learning/conversations/62000000-0000-0000-0000-000000000010' },
  'change-waiting': { reference: { steps: [...board, { waitFor: '.kcard[data-card="c-chg-analyst"]' }, { scrollTo: '.kcard[data-card="c-chg-analyst"]' }] }, builtPath: '/c/rs-learning/approvals' },
  // #167. Lead's card asking whether to request an Agent hidden from the first Contributor (SEO & Content, as the
  // reference hides it from Youssef): offered, then after "Ask", then after "No, never mind". Built: the fixture's three
  // Conversations of the first Contributor with Lead, captured with --sign-in reviewer@example.com.
  'access-ask': { reference: { steps: [...asYoussef, ...askForHidden] }, builtPath: '/c/rs-learning/conversations/62000000-0000-0000-0000-000000000020' },
  'access-sent': { reference: { steps: [...asYoussef, ...askForHidden, { click: '[data-action="ask-mgr"][data-answer="yes"]' }, { waitFor: '.card.is-resolved .card__outcome' }, { waitGone: '#toast-host .toast' }] }, builtPath: '/c/rs-learning/conversations/62000000-0000-0000-0000-000000000021' },
  'access-no': { reference: { steps: [...asYoussef, ...askForHidden, { click: '[data-action="ask-mgr"][data-answer="no"]' }, { waitFor: '.card.is-resolved .card__outcome' }, { waitGone: '#toast-host .toast' }] }, builtPath: '/c/rs-learning/conversations/62000000-0000-0000-0000-000000000022' },
  'request-waiting': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-wa-req"]' }, { waitFor: '.ac-card--req' }] }, builtPath: '/c/rs-learning/approvals' },
  'request-made': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-wa-req"]' }, { click: '#ac-yes-rq-seed' }, { waitFor: '.ac-card:not(.ac-card--req)' }, ...asYoussef, ...youssefRequest] }, builtPath: '/c/rs-learning/conversations/6b000000-0000-0000-0000-000000000003' },
  // #153. The composer's "+" menu, opened: in the Conversation with Lead, and in the general channel.
  'plus-menu': { reference: { steps: [{ click: '.composer [data-action="plus-menu"]:visible' }, { waitFor: '[data-plus-menu]:not([hidden])' }, { finish: '[data-plus-menu]:not([hidden])' }] }, builtPath: '/c/rs-learning/chat',
   builtSteps: [{ click: '.composer__btn[aria-haspopup="menu"]' }, { waitFor: '.composer .menu' }, { finish: '.composer .menu' }] },
  'plus-menu-channel': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="ch-general"]' }, { waitFor: '.ch-intro' }, { click: '.composer [data-action="plus-menu"]:visible' }, { waitFor: '[data-plus-menu]:not([hidden])' }, { finish: '[data-plus-menu]:not([hidden])' }] },
   builtPath: `/c/rs-learning/channels/${fixture.channel}`, builtSteps: [{ click: '.composer__btn[aria-haspopup="menu"]' }, { waitFor: '.composer .menu' }, { finish: '.composer .menu' }] },
  // #158. The same menu in a Conversation, scrolled to its end: Connect apps and the Owner's Model. Built: a Conversation's
  // own address (pass --built-path /c/rs-learning/conversations/<id>; its Model rows are the Agent's Engine's).
  'plus-menu-model': { reference: { steps: [{ click: '.composer [data-action="plus-menu"]:visible' }, { waitFor: '[data-plus-menu]:not([hidden])' }, { finish: '[data-plus-menu]:not([hidden])' }, { scrollTo: '[data-plus-menu]:not([hidden]) [data-action="pick-model"]:last-child' }] }, builtPath: null,
   builtSteps: [{ click: '.composer__btn[aria-haspopup="menu"]' }, { waitFor: '.composer .menu [role="menuitemradio"]' }, { finish: '.composer .menu' }, { scrollTo: '.composer .menu [role="menuitemradio"]:last-child' }] },
  // #202. The composer's "+" menu, Connect apps: the apps sheet over the Conversation with Lead, the keyboard in its search.
  'plus-apps': { reference: { steps: [{ click: '.composer [data-action="plus-menu"]:visible' }, { waitFor: '[data-plus-menu]:not([hidden])' }, { click: '[data-plus-menu]:not([hidden]) [data-action="open-apps"]' }, { waitFor: '#apps[open] #apps-q' }, { finish: '#apps[open]' }] }, builtPath: '/c/rs-learning/chat',
   builtSteps: [{ click: '.composer__btn[aria-haspopup="menu"]' }, { waitFor: '.composer .menu' }, { click: '.composer .menu [aria-haspopup="dialog"]' }, { waitFor: 'dialog.apps-sheet[open] #apps-q' }, { finish: 'dialog.apps-sheet[open]' }] },
  // #24. New channel, from the "+" beside Channels; built, ?new=channel opens it over any page.
  'new-channel': { reference: { steps: [{ click: '#sb-threads [data-action="channel-new"]' }, { waitFor: '#modal[open] #tm-name' }] }, builtPath: `/c/rs-learning/channels/${fixture.channel}?new=channel` },
  // #24. The team channel حملة ديسمبر (th-team) with its members and Agents. Built: a team channel's own address (pass
  // --built-path) of a team channel set up by hand.
  // #145. A board Card's sheet on its Chat tab: the Card of Omar's own chat with Ads (th-meta), with that chat and its
  // composer; an idea with an Agent and no chat yet (c-idea2), with the way to start one; and the Card of another
  // Member's chat, the lock. The reference has no such Card until someone makes one, so Youssef starts a new chat to
  // @Ads (its Card goes on the board) and Omar opens it. Built, with the fixture: the Card of Omar's chat with Ads,
  // its idea with Ads, and the Card of the first Contributor's chat with Ads (`builtSteps` picks Chat there too).
  'card-chat': { reference: { steps: [...board, { click: '.kcard[data-card="c-meta"]' }, { waitFor: '#sheet-transcript .turn' }] }, builtPath: '/c/rs-learning/work/board?card=640006' },
  'card-chat-empty': { reference: { steps: [...board, { click: '.kcard[data-card="c-idea2"]' }, { waitFor: '#sheet-transcript .empty-chat' }] }, builtPath: '/c/rs-learning/work/board?card=640001' },
  'card-chat-locked': { reference: { steps: [...asYoussef, { click: '#btn-newchat' }, { fill: ['#ta-main', `@Ads ${youssefAsks}`] },
   { click: '[data-action="send"][data-key="main"]' }, { waitFor: '#chat-transcript .turn' }, { click: '#btn-me' }, { click: '[data-action="set-as"][data-person="omar"][data-world="team"]' },
   { waitFor: '#sb-recent' }, { waitGone: '#toast-host .toast' }, ...board, { click: `.kcard[aria-label^="${youssefAsks}"]` }, ...pickChat] }, builtPath: '/c/rs-learning/work/board?card=640007', builtSteps: pickChat },
  // #173. The account menu moved through with the keyboard: Arrow Down from the chosen language shows the next entry's
  // focus ring.
  'account-menu-keys': { reference: { steps: [{ click: '#btn-me' }, { waitFor: '#me-menu:not([hidden])' }, { press: 'ArrowDown' }] }, builtPath: '/c/rs-learning/chat', builtSteps: [{ click: '#btn-me' }, { waitFor: '#me-menu' }, { press: 'ArrowDown' }] },
  // #173. "N" on the board opens the new chat with its composer focused. Built, the chat has a composer only when the
  // Company has an Agent (the comparison fixture's Lead).
  'new-chat-key': { reference: { steps: [...board, { press: 'n' }, { waitFor: '#ta-main:focus' }] }, builtPath: '/c/rs-learning/work/board', builtSteps: [{ press: 'KeyN' }, { waitFor: '.composer__input:focus' }] },
  'team-channel': { reference: { steps: [{ click: '#sb-threads [data-action="open-thread"][data-thread="th-team"]' }, { waitFor: '.ch-intro' }] }, builtPath: null },
  // #172. The placeholders the reference shows while a chat or the dashboard loads, held on screen (`hold`: the
  // prototype's timers of 100ms or more never fire, so the content that replaces them never comes). Built: the same
  // page while the one table its waiting part reads is slow (above).
  'chat-loading': { reference: { hold: true, steps: [{ waitFor: '#chat-transcript [aria-busy="true"]' }] }, builtPath: '/c/rs-learning/home',
   builtSteps: openSlowly(`/c/rs-learning/conversations/${loading(3)}`, '.chat .transcript[aria-busy="true"]'), builtSettle: false },
  'numbers-loading': { reference: { hold: true, steps: [{ click: '#sb-nav [data-view="dashboard"]' }, { waitFor: '#view-dashboard [aria-busy="true"]' }] }, builtPath: '/c/rs-learning/home',
   builtSteps: openSlowly('/c/rs-learning/numbers', '.numbers-page [aria-busy="true"]'), builtSettle: false },
};

export const languages = ['ar', 'en'];
export const themes = ['light', 'dark'];
export const defaultBuiltUrl = 'http://127.0.0.1:3000';
// The seeded Owner of every company.
export const defaultSignIn = 'omar@example.com';

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

const valued = { '--screen': 'screen', '--width': 'width', '--lang': 'lang', '--theme': 'theme', '--built-path': 'builtPath', '--built-url': 'builtUrl', '--sign-in': 'signIn', '--out': 'out' };

export function parseArgs(argv) {
  const raw = {};
  let referenceOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--reference-only') { referenceOnly = true; continue; }
    if (!(flag in valued)) throw new UsageError(`Unknown option ${flag}.`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value.`);
    raw[valued[flag]] = value;
  }
  for (const name of ['screen', 'width', 'lang', 'theme']) if (raw[name] === undefined) throw new UsageError(`--${name} is required.`);
  if (!Object.hasOwn(screens, raw.screen)) throw new UsageError(`Unknown screen "${raw.screen}". Valid screens: ${Object.keys(screens).join(', ')}.`);
  if (!/^[1-9]\d{1,4}$/.test(raw.width)) throw new UsageError('--width must be a whole number of pixels between 10 and 99999.');
  if (!languages.includes(raw.lang)) throw new UsageError('--lang must be ar or en.');
  if (!themes.includes(raw.theme)) throw new UsageError('--theme must be light or dark.');
  const builtPath = raw.builtPath ?? screens[raw.screen].builtPath;
  if (builtPath === null && !referenceOnly) throw new UsageError(`Screen "${raw.screen}" has no built equivalent yet; pass --built-path PATH or --reference-only.`);
  return {
    screen: raw.screen,
    width: Number(raw.width),
    lang: raw.lang,
    theme: raw.theme,
    builtPath,
    builtUrl: (raw.builtUrl ?? defaultBuiltUrl).replace(/\/+$/, ''),
    signIn: raw.signIn,
    out: raw.out,
    referenceOnly,
  };
}

export function outputPaths({ screen, lang, theme, width, out }) {
  const sideBySide = out ?? `test-results/design-compare/${screen}-${lang}-${theme}-${width}.png`;
  const stem = sideBySide.replace(/\.png$/i, '');
  return { sideBySide, reference: `${stem}-reference.png`, built: `${stem}-built.png` };
}

// The page to capture for a visitor who is not signed in. Language is an account setting, so a visitor cannot change
// it for later pages; the sign-in page alone takes it as `?language=ar` (app/sign-in/page.tsx) and is English
// without it. Any other page is captured where it is.
export function anonymousCaptureUrl(landedUrl, lang) {
  const url = new URL(landedUrl);
  if (url.pathname !== '/sign-in') return landedUrl;
  if (lang === 'ar') url.searchParams.set('language', 'ar');
  else url.searchParams.delete('language');
  return url.toString();
}

// Maps a request path to a file inside root, or null when it is malformed or would leave root.
export function resolveStaticPath(root, requestPath) {
  let path;
  try {
    path = decodeURIComponent(requestPath.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  const base = resolve(root);
  const file = resolve(base, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  return file.startsWith(base + sep) ? file : null;
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };

// Serves root on 127.0.0.1 at a free port. Resolves with the listening server.
export function startStaticServer(root) {
  const server = createServer((request, response) => {
    const file = resolveStaticPath(root, request.url ?? '/');
    let found = false;
    try { found = file !== null && statSync(file).isFile(); } catch { found = false; }
    if (!found) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

// GTMWORKS_DESIGN_REFERENCE points the tool at another copy of the reference: a test gives it a broken one (#271).
export const referenceRoot = process.env.GTMWORKS_DESIGN_REFERENCE || join(import.meta.dirname, '..', 'design-reference');

/**
 * What differs between a reference folder and its SHA256SUMS: a listed file changed or missing, a file the list does not
 * name, a malformed line. Empty when the folder is the approved copy. The comparison tool is the one reader of the frozen
 * reference, so it checks the folder before it draws a screen from it (#285, #271). @param {string} root @returns {string[]}
 */
export function referenceProblems(root) {
  const sums = join(root, 'SHA256SUMS');
  if (!existsSync(sums)) return [`${sums} is missing`];
  const problems = [];
  const listed = new Set();
  for (const line of readFileSync(sums, 'utf8').split('\n').filter(Boolean)) {
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (!match) { problems.push(`SHA256SUMS line is not "<sha256>  <path>": ${line}`); continue; }
    const path = match[2].replace(/^\.\//, '');
    listed.add(path);
    const file = join(root, path);
    if (!existsSync(file)) problems.push(`listed file is missing: ${path}`);
    else if (createHash('sha256').update(readFileSync(file)).digest('hex') !== match[1]) problems.push(`changed: ${path}`);
  }
  if (!listed.has('index.html')) problems.push('SHA256SUMS does not list index.html');
  const files = (directory, prefix = '') => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(join(directory, entry.name), path) : [path];
  });
  for (const path of files(root)) if (path !== 'SHA256SUMS' && !listed.has(path)) problems.push(`not in SHA256SUMS: ${path}`);
  return problems;
}
