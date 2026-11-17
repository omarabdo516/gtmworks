import type { I18n } from '@/lib/i18n.mjs';

// The note the Activity log page (page.tsx) draws in place of its rows. It imports no server code, so a component test
// draws it as the page does: a log with rows that no row matches says so and offers everything back. Which note it is
// comes from logEmptyNote (lib/activity-log.mjs), read from the Company's whole log.
export function LogEmpty({t,slug,note}:{t:I18n['t'],slug:string,note:'noMatch'|'empty'}) {
 return <div className="panel-card lgp-empty"><p className="panel-empty">{note==='noMatch'?t('logNoMatch'):t('logEmpty')}</p>{note==='noMatch'?<a className="btn btn--secondary btn--sm" href={`/c/${slug}/log`}>{t('logShowAll')}</a>:null}</div>;
}
