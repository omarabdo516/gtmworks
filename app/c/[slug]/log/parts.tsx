import type { I18n } from '@/lib/i18n.mjs';

// The note the Activity log page (page.tsx) draws in place of its rows. It imports no server code, so a component test
// draws it as the page does: a log with rows that no row matches says so and offers everything back.
export function LogEmpty({t,slug,total}:{t:I18n['t'],slug:string,total:number}) {
 return <div className="panel-card lgp-empty"><p className="panel-empty">{total?t('logNoMatch'):t('logEmpty')}</p>{total?<a className="btn btn--secondary btn--sm" href={`/c/${slug}/log`}>{t('logShowAll')}</a>:null}</div>;
}
