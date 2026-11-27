// The apps a Company's Agents can use (#458): the one list. It holds every entry of the bundled Engine's own catalogue
// (Hermes v0.23.0 optional-mcps/*/manifest.yaml, keyed by the name the Engine gives it), gtmworks's ready-made remote
// servers whose address and sign-in kind are known, and one card for a server the Owner adds. Each app is on or off for
// each Agent. Under ADR 0020 an app comes with every tool it lists, reads and writes: gtmworks writes no tool filter.

import { markOf } from './app-mark.mjs';
import { roleApps } from './role-templates.mjs';

/** @typedef {'ads'|'content'|'communication'|'analytics'|'sales'|'more'} AppCategory */
/** @typedef {'engine'|'remote'|'sandbox'|'own'|'custom'} AppSource */
/** @typedef {{key:string,name:string,mark:string,category:AppCategory,source:AppSource,url?:string,docs?:string,auth?:'oauth'|'header'|'none'|'command',care?:'customers'|'money'}} App */
// Its tile's letter, for an app with no logo, follows the one rule of markOf (#577).
const app=(/** @type {Omit<App,'mark'>} */ entry)=>Object.freeze({...entry,mark:markOf(entry.name)});

// An Engine key is the manifest's name; a server key gtmworks makes allows `_` for the Engine's own `hugging_face`.
export const appKey=/^[a-z][a-z0-9_-]{0,63}$/;
// The key of a server the Owner names: its words, hyphenated.
/** @param {unknown} name */
export const serverKeyOf=name=>typeof name==='string'?name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64):'';

/** @type {readonly App[]} */
export const apps=Object.freeze([
 // The pinned Engine's catalogue. Its name is the key exactly as the manifest gives it.
 app({key:'airtable',name:'Airtable',category:'content',source:'engine',auth:'oauth'}),
 app({key:'algolia',name:'Algolia',category:'more',source:'engine',auth:'oauth'}),
 app({key:'alltrails',name:'AllTrails',category:'more',source:'engine',auth:'none'}),
 app({key:'amplitude',name:'Amplitude',category:'analytics',source:'engine',auth:'oauth'}),
 app({key:'asana',name:'Asana',category:'more',source:'engine',auth:'oauth'}),
 app({key:'atlassian',name:'Atlassian',category:'more',source:'engine',auth:'oauth'}),
 app({key:'attio',name:'Attio',category:'sales',source:'engine',auth:'oauth',care:'customers'}),
 app({key:'aws-knowledge',name:'AWS knowledge',category:'more',source:'engine',auth:'none'}),
 app({key:'betterstack',name:'Better Stack',category:'analytics',source:'engine',auth:'oauth'}),
 app({key:'buildkite',name:'Buildkite',category:'more',source:'engine',auth:'oauth'}),
 app({key:'calendly',name:'Calendly',category:'sales',source:'engine',auth:'oauth',care:'customers'}),
 app({key:'canva',name:'Canva',category:'content',source:'engine',auth:'oauth'}),
 app({key:'circleci',name:'CircleCI',category:'more',source:'engine',auth:'oauth'}),
 app({key:'clickup',name:'ClickUp',category:'more',source:'engine',auth:'oauth'}),
 app({key:'close',name:'Close',category:'sales',source:'engine',auth:'oauth',care:'customers'}),
 app({key:'cloudflare',name:'Cloudflare',category:'more',source:'engine',auth:'oauth'}),
 app({key:'cloudinary',name:'Cloudinary',category:'content',source:'engine',auth:'oauth'}),
 app({key:'comfy-cloud',name:'Comfy Cloud',category:'content',source:'engine',auth:'oauth'}),
 app({key:'context7',name:'Context7',category:'more',source:'engine',auth:'none'}),
 app({key:'craft',name:'Craft',category:'content',source:'engine',auth:'oauth'}),
 app({key:'datadog',name:'Datadog',category:'analytics',source:'engine',auth:'oauth'}),
 app({key:'deepwiki',name:'DeepWiki',category:'more',source:'engine',auth:'none'}),
 app({key:'dropbox',name:'Dropbox',category:'content',source:'engine',auth:'oauth'}),
 app({key:'figma',name:'Figma',category:'content',source:'engine',auth:'oauth'}),
 app({key:'fireflies',name:'Fireflies',category:'communication',source:'engine',auth:'oauth'}),
 app({key:'gamma',name:'Gamma',category:'content',source:'engine',auth:'oauth'}),
 app({key:'gitlab',name:'GitLab',category:'more',source:'engine',auth:'oauth'}),
 app({key:'globalping',name:'Globalping',category:'more',source:'engine',auth:'oauth'}),
 app({key:'grafana',name:'Grafana',category:'analytics',source:'engine',auth:'oauth'}),
 app({key:'hugging_face',name:'Hugging Face',category:'more',source:'engine',auth:'oauth'}),
 app({key:'indeed',name:'Indeed',category:'more',source:'engine',auth:'oauth'}),
 app({key:'intercom',name:'Intercom',category:'communication',source:'engine',auth:'oauth',care:'customers'}),
 app({key:'kiwi',name:'Kiwi.com',category:'more',source:'engine',auth:'none'}),
 app({key:'klaviyo',name:'Klaviyo',category:'communication',source:'engine',auth:'oauth'}),
 app({key:'linear',name:'Linear',category:'more',source:'engine',auth:'oauth'}),
 app({key:'microsoft-learn',name:'Microsoft Learn',category:'more',source:'engine',auth:'none'}),
 app({key:'miro',name:'Miro',category:'content',source:'engine',auth:'oauth'}),
 app({key:'mixpanel',name:'Mixpanel',category:'analytics',source:'engine',auth:'oauth'}),
 app({key:'monday',name:'monday.com',category:'more',source:'engine',auth:'oauth'}),
 app({key:'motherduck',name:'MotherDuck',category:'more',source:'engine',auth:'oauth'}),
 app({key:'n8n-official',name:'n8n',category:'more',source:'engine',auth:'oauth'}),
 app({key:'neon',name:'Neon',category:'more',source:'engine',auth:'oauth'}),
 app({key:'netlify',name:'Netlify',category:'more',source:'engine',auth:'oauth'}),
 app({key:'notion',name:'Notion',category:'content',source:'engine',auth:'oauth'}),
 app({key:'paypal',name:'PayPal',category:'more',source:'engine',auth:'oauth',care:'money'}),
 app({key:'plaid',name:'Plaid',category:'analytics',source:'engine',auth:'oauth',care:'money'}),
 app({key:'postman',name:'Postman',category:'more',source:'engine',auth:'oauth'}),
 app({key:'prisma-postgres',name:'Prisma Postgres',category:'more',source:'engine',auth:'oauth'}),
 app({key:'railway',name:'Railway',category:'more',source:'engine',auth:'oauth'}),
 app({key:'rentahuman',name:'RentAHuman',category:'more',source:'engine',auth:'oauth'}),
 app({key:'robinhood',name:'Robinhood',category:'more',source:'engine',auth:'oauth',care:'money'}),
 app({key:'semgrep',name:'Semgrep',category:'more',source:'engine',auth:'oauth'}),
 app({key:'sentry',name:'Sentry',category:'analytics',source:'engine',auth:'oauth'}),
 app({key:'square',name:'Square',category:'more',source:'engine',auth:'oauth',care:'money'}),
 app({key:'strava',name:'Strava',category:'more',source:'engine',auth:'oauth'}),
 app({key:'stripe',name:'Stripe',category:'more',source:'engine',auth:'oauth',care:'money'}),
 app({key:'supabase',name:'Supabase',category:'more',source:'engine',auth:'oauth'}),
 app({key:'todoist',name:'Todoist',category:'more',source:'engine',auth:'oauth'}),
 app({key:'trivago',name:'trivago',category:'more',source:'engine',auth:'none'}),
 app({key:'twelve-data',name:'Twelve Data',category:'analytics',source:'engine',auth:'oauth'}),
 app({key:'twilio-docs',name:'Twilio docs',category:'more',source:'engine',auth:'none'}),
 app({key:'unreal-engine',name:'Unreal Engine',category:'more',source:'engine',auth:'none'}),
 app({key:'vercel',name:'Vercel',category:'more',source:'engine',auth:'oauth'}),
 app({key:'webflow',name:'Webflow',category:'content',source:'engine',auth:'oauth'}),
 app({key:'wolfram',name:'Wolfram',category:'more',source:'engine',auth:'none'}),
 app({key:'wordpress-com',name:'WordPress.com',category:'content',source:'engine',auth:'oauth'}),

 // gtmworks's ready-made remote servers. Each is added through the same path as an Owner's own server, with the address
 // and sign-in kind filled in, and each carries the vendor's own documentation page. A vendor with no official public
 // remote server is left out, never guessed.
 // https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started
 app({key:'meta-ads',name:'Meta Ads',category:'ads',source:'remote',url:'https://mcp.facebook.com/ads',auth:'oauth',docs:'https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started'}),
 // https://ads.tiktok.com/resources/help/article/about-tiktok-for-business-mcp-server
 app({key:'tiktok-ads',name:'TikTok Ads',category:'ads',source:'remote',url:'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat',auth:'oauth',docs:'https://ads.tiktok.com/resources/help/article/about-tiktok-for-business-mcp-server'}),
 // https://docs.apollo.io/docs/apollo-mcp
 app({key:'apollo',name:'Apollo',category:'sales',source:'remote',url:'https://mcp.apollo.io/mcp',auth:'oauth',docs:'https://docs.apollo.io/docs/apollo-mcp'}),
 // https://developer.semrush.com/api/introduction/semrush-mcp
 app({key:'semrush',name:'Semrush',category:'analytics',source:'remote',url:'https://mcp.semrush.com/v2/mcp',auth:'oauth',docs:'https://developer.semrush.com/api/introduction/semrush-mcp'}),
 // https://docs.ahrefs.com/mcp/docs/introduction
 app({key:'ahrefs',name:'Ahrefs',category:'analytics',source:'remote',url:'https://api.ahrefs.com/mcp/mcp',auth:'oauth',docs:'https://docs.ahrefs.com/mcp/docs/introduction'}),
 // https://mcp.supermetrics.com/docs
 app({key:'supermetrics',name:'Supermetrics',category:'analytics',source:'remote',url:'https://mcp.supermetrics.com/mcp',auth:'oauth',docs:'https://mcp.supermetrics.com/docs'}),
 // https://developers.similarweb.com/docs/similarweb-mcp
 app({key:'similarweb',name:'Similarweb',category:'analytics',source:'remote',url:'https://mcp.similarweb.com',auth:'header',docs:'https://developers.similarweb.com/docs/similarweb-mcp'}),
 // https://developers.brevo.com/docs/mcp-protocol
 app({key:'brevo',name:'Brevo',category:'communication',source:'remote',url:'https://mcp.brevo.com/v1/brevo/mcp',auth:'header',docs:'https://developers.brevo.com/docs/mcp-protocol'}),
 // https://mailchimp.com/developer/transactional/guides/how-to-use-mailchimps-transactional-messaging-mcp/
 app({key:'mailchimp-transactional',name:'Mailchimp Transactional',category:'communication',source:'remote',url:'https://mandrillapp.com/mcp',auth:'header',docs:'https://mailchimp.com/developer/transactional/guides/how-to-use-mailchimps-transactional-messaging-mcp/'}),
 // https://docs.zapier.com/mcp/get-started/authentication
 app({key:'zapier',name:'Zapier',category:'more',source:'remote',url:'https://mcp.zapier.com/api/v1/connect',auth:'oauth',docs:'https://docs.zapier.com/mcp/get-started/authentication'}),
 // https://developers.make.com/mcp-server/make-mcp-server
 app({key:'make',name:'Make',category:'more',source:'remote',url:'https://mcp.make.com/v2',auth:'oauth',docs:'https://developers.make.com/mcp-server/make-mcp-server'}),
 // https://developers.buffer.com/guides/integrations/mcp
 app({key:'buffer',name:'Buffer',category:'content',source:'remote',url:'https://mcp.buffer.com/mcp',auth:'oauth',docs:'https://developers.buffer.com/guides/integrations/mcp'}),
 // https://www.hootsuite.com/integrations/mcp
 app({key:'hootsuite-content',name:'Hootsuite content',category:'content',source:'remote',url:'https://mcp.hootsuite.com/perch',auth:'oauth',docs:'https://www.hootsuite.com/integrations/mcp'}),
 // https://www.hootsuite.com/integrations/mcp
 app({key:'hootsuite-inbox',name:'Hootsuite inbox',category:'communication',source:'remote',url:'https://mcp.hootsuite.com/nest',auth:'oauth',docs:'https://www.hootsuite.com/integrations/mcp'}),
 // https://www.hootsuite.com/integrations/mcp
 app({key:'hootsuite-listening',name:'Hootsuite listening',category:'analytics',source:'remote',url:'https://mcp.hootsuite.com/lumen',auth:'oauth',docs:'https://www.hootsuite.com/integrations/mcp'}),
 // https://www.typeform.com/developers/mcp/
 app({key:'typeform',name:'Typeform',category:'content',source:'remote',url:'https://api.typeform.com/mcp',auth:'oauth',docs:'https://www.typeform.com/developers/mcp/'}),
 // https://university.clay.com/docs/connect-to-clay-mcp
 app({key:'clay',name:'Clay',category:'sales',source:'remote',url:'https://api.clay.com/v3/mcp',auth:'oauth',docs:'https://university.clay.com/docs/connect-to-clay-mcp'}),
 // https://docs.lusha.com/mcp-docs
 app({key:'lusha',name:'Lusha',category:'sales',source:'remote',url:'https://mcp.lusha.com',auth:'oauth',docs:'https://docs.lusha.com/mcp-docs',care:'customers'}),
 // https://docs.x.com/tools/mcp
 app({key:'x',name:'X',category:'communication',source:'remote',url:'https://api.x.com/mcp',auth:'header',docs:'https://docs.x.com/tools/mcp'}),

 // gtmworks's ready-made app that runs in the Company's work sandbox (#544, ADR 0025): the sandbox image carries it, its
 // MCP command runs there for the Agent it is on, and its designs are drawn by the Company's own Engine with the Company's
 // model access (lib/open-design.mjs). Nothing to sign in to.
 // https://github.com/nexu-io/open-design
 app({key:'open-design',name:'Open Design',mark:'O',category:'content',source:'sandbox',auth:'none',docs:'https://github.com/nexu-io/open-design'}),

 // The Owner's own server: the form, not a connection of its own. Its key is never a server's.
 app({key:'own',name:'Your own tool (MCP)',category:'more',source:'own'}),
]);

/** @param {unknown} key */
export const appByKey=key=>apps.find(entry=>entry.key===key);
// A server gtmworks found in an Agent's profile: its name is its key. Frozen, as catalogue entries are, because it
// travels to the browser as a card.
/** @param {string} key @returns {App} */
export const customApp=key=>Object.freeze({key,name:key,mark:markOf(key),category:'more',source:'custom'});

// An app an Agent names in words (a request's apps #17, a handed step's app #139): the known app of that name, in any
// case, among the ready-made roles' apps and this list, or undefined.
const known=[...Object.entries(roleApps).map(([key,entry])=>({key,name:entry.name,mark:markOf(entry.name)})),...apps.filter(entry=>entry.source!=='own')];
/** @param {string} name @returns {{key:string,name:string,mark:string}|undefined} */
export function knownApp(name) {
 const asked=name.trim().toLowerCase();
 return known.find(entry=>entry.name.toLowerCase()===asked);
}

// What a Company sees of an app: connected (its sign-in works), attention (on, but the Engine cannot reach it with a
// sign-in or a token: a sign-in that never finished, a token that was revoked, or a vendor that does not answer) or off.
// An app that is on reads checking while its own test has not answered yet (#770, #898): the list never waits for it.
/** @typedef {'connected'|'attention'|'off'|'checking'} AppState */
/** @param {boolean} installed @param {boolean} reached */
export const appState=(installed,reached)=>!installed?'off':reached?'connected':'attention';
// An app is on per Agent (#30): each Agent's state is its own profile's. The card shows one state for all of them:
// connected when any Agent with a profile of its own is connected, else checking while any of them is still being tested,
// else attention when any of them is, else off. An Agent still on the main Agent's profile adds nothing of its own.
/** @param {{own:boolean,state:AppState|null}[]} agents @returns {AppState} */
export const mergedState=agents=>{
 const states=agents.filter(agent=>agent.own).map(agent=>agent.state);
 return states.includes('connected')?'connected':states.includes('checking')?'checking':states.includes('attention')?'attention':'off';
};

// The fragment of a profile's config written before a sign-in or a turn-on (deep-merged by the Engine): the server on and,
// for OAuth, the sign-in returning to gtmworks. No tool filter: an app gives an Agent every tool it lists (ADR 0020).
/** @param {App} entry @param {string|null} redirectUri */
export const appConfig=(entry,redirectUri)=>({mcp_servers:{[entry.key]:{enabled:true,...(entry.auth==='oauth'&&redirectUri?{oauth:{redirect_uri:redirectUri}}:{})}}});
