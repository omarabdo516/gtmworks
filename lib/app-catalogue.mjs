// The apps a Company's Agents can use (#30): the one list. Each is an entry of the bundled Engine's own catalogue, keyed
// by the name the Engine gives it, and is on for the whole Company or off. An Agent never approves, publishes or spends
// (ADR 0006), and gtmworks has no approval path for an app's actions yet (ADR 0014), so an app offers its Agents only
// the read tools listed here: the Engine registers a connected app's tools by exact name from this list (its
// `tools.include`, Hermes v0.23.0 tools/mcp_tool_registration.py) and nothing else. Every list was reviewed tool by
// tool; an app whose tools read and write in one tool could not be made read-only and is not offered.
// Left out on purpose: Figma (its catalogue entry signs in to Figma under another product's name), Webflow and
// WordPress.com (reads and writes share their tools), and anything that moves money. Apps whose reads are customer
// records (Intercom, Attio, Close, Calendly) wait too: a Member's Customer data permission (members.grant_customer_data)
// cannot be checked on an Engine call, which carries no sender, so an app on for the whole Company would bypass it.

import { roleApps } from './role-templates.mjs';

/** @typedef {'content'|'communication'|'analytics'} AppCategory */
/** @typedef {{key:string,name:string,mark:string,category:AppCategory,readTools:readonly string[]}} App */
const app=(/** @type {App} */ entry)=>Object.freeze({...entry,readTools:Object.freeze([...entry.readTools])});

/** @type {readonly App[]} */
export const apps=Object.freeze([
 app({key:'klaviyo',name:'Klaviyo',mark:'K',category:'communication',readTools:['get_account_details','get_campaigns','get_campaign','get_campaign_message','get_campaign_recipient_estimation','get_catalog_items','get_catalog_item','get_catalog_variants','get_catalog_variant','get_catalog_categories','get_catalog_category','get_metrics','get_metric','query_metric_aggregates','get_custom_metrics','get_custom_metric','get_mapped_metrics','get_mapped_metric','get_metric_property','get_flows_triggered_by_metric','get_flows','get_flow','get_flow_message','get_flow_action','get_lists','get_list','get_segments','get_segment','get_flows_triggered_by_list','get_flows_triggered_by_segment','get_images','get_image','get_campaign_report','get_flow_report','query_form_values','query_form_series','query_segment_values','query_segment_series','list_email_templates','get_email_template','render_email_template','get_universal_content','get_all_universal_content','get_tag_groups','get_tag_group','get_tags','get_tag','get_campaign_ids_for_tag','get_flow_ids_for_tag','get_list_ids_for_tag','get_segment_ids_for_tag','get_forms','get_form','get_form_version','get_translations','get_translation','get_brand_buttons','get_brand_button','get_brand_colors','get_brand_color','get_brand_email_defaults','get_brand_email_default','get_brand_logos','get_brand_logo','get_brand_social_groups','get_brand_social_group','get_brand_voice','get_sending_domains','get_sending_domain','get_object_types','get_object_type','get_object_schema']}),
 app({key:'canva',name:'Canva',mark:'Ca',category:'content',readTools:['search-designs','get-design','get-design-pages','get-design-content','get-presenter-notes','get-export-formats','get-design-thumbnail','list-comments','list-replies','get-assets','search-brand-templates','list-brand-kits','get-brand-template-dataset','get-design-dataset','list-folder-items','search-folders','resolve-shortlink']}),
 app({key:'notion',name:'Notion',mark:'N',category:'content',readTools:['notion-search','notion-fetch','notion-list-private-pages','notion-list-shared-pages','notion-list-favorite-pages','notion-list-recent-pages','notion-list-page-backlinks','notion-query-meeting-notes','notion-get-self','notion-get-teams','notion-get-groups','notion-get-users','notion-get-comments','notion-get-version-changes','notion-view-version','notion-query-data-sources','notion-query-multiple-data-sources','notion-calendar-list-calendars','notion-calendar-list-events']}),
 app({key:'airtable',name:'Airtable',mark:'Ai',category:'content',readTools:['list_workspaces','list_bases','search_bases','list_tables_for_base','get_table_schema','list_views_for_table','list_records_for_table','search_records','list_pages_for_base','list_records_for_page','get_record_for_page','get_form_schema']}),
 app({key:'gamma',name:'Gamma',mark:'G',category:'content',readTools:['get_gammas','search_gammas','search_templates','read_gamma','get_gamma_outline','get_themes','get_folders']}),
 app({key:'amplitude',name:'Amplitude',mark:'Am',category:'analytics',readTools:['search_amp_entities','search_amp_data_taxonomy','get_amplitude_context','query_amplitude_data','get_amplitude_charts','get_amp_taxonomy','get_group_types']}),
 app({key:'mixpanel',name:'Mixpanel',mark:'MP',category:'analytics',readTools:['Run-Query','Get-Query-Schema','Get-Report','List-Dashboards','Get-Dashboard','Get-Business-Context','Get-Projects','Get-Events','List-Properties','Get-Property-Values','Search-Entities','Get-Tracking-Plan','List-Tracking-Plans','Get-Cohort','List-Cohorts','Describe-Cohort-Schema','Get-Metric','List-Metrics','List-Experiments','Get-Experiment']}),
]);

/** @param {unknown} key */
export const appByKey=key=>apps.find(entry=>entry.key===key);

// An app an Agent names in words (a request's apps #17, a handed step's app #139): the known app of that name, in any
// case, among the ready-made roles' apps and this list, or undefined.
const known=[...Object.entries(roleApps).map(([key,entry])=>({key,name:entry.name,mark:entry.mark})),...apps];
/** @param {string} name @returns {{key:string,name:string,mark:string}|undefined} */
export function knownApp(name) {
 const asked=name.trim().toLowerCase();
 return known.find(entry=>entry.name.toLowerCase()===asked);
}

// What a Company sees of an app: connected (its sign-in works), attention (on, but the Engine cannot reach it with a
// sign-in: a sign-in that never finished, was revoked at the vendor, or a vendor that does not answer) or off.
/** @typedef {'connected'|'attention'|'off'} AppState */
/** @param {boolean} installed @param {boolean} reached */
export const appState=(installed,reached)=>!installed?'off':reached?'connected':'attention';

// The fragment of the Company profile's config written before every sign-in (deep-merged by the Engine, lists replacing
// lists): the server on, only its read tools, none of its prompts or resources, and the sign-in returning to gtmworks.
/** @param {App} entry @param {string} redirectUri */
export const appConfig=(entry,redirectUri)=>({mcp_servers:{[entry.key]:{enabled:true,tools:{include:[...entry.readTools],prompts:false,resources:false},oauth:{redirect_uri:redirectUri}}}});
