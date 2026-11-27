import { getI18n } from '@/lib/i18n-server';
import Link from '@/lib/link';
import type { UsageRow } from '@/lib/company-app-items';
import { UsageTable } from '@/app/usage-tables';

// The usage page (#347): its table is the one Settings › Usage draws (app/usage-tables.tsx).
export default async function Usage({rows,slug}:{rows:UsageRow[],slug:string}) {
 const {t,locale}=await getI18n();
 return <><div className="tabs"><Link className="button" href={`/c/${slug}/settings`}>{t('general')}</Link><Link className="button active" href={`/c/${slug}/usage`}>{t('usage')}</Link></div>
  <section className="panel"><div className="panel-head"><div><h2>{t('usage')}</h2><p>{t('usageHelp')}</p></div></div></section>
  {rows.length?<UsageTable t={t} locale={locale} rows={rows}/>:<p className="empty section-title">{t('usageNone')}</p>}</>;
}
