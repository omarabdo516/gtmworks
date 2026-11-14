import { getI18n } from '@/lib/i18n-server';
import Link from '@/lib/link';

export type UsageDay={company_id:string,company_name:string,day:string,input_tokens:number,output_tokens:number,runs:number,unknown_runs:number};

// Tokens per company per day, as the database allows this person to see them (usage_by_day): a company Owner sees
// the companies they own. Token counts only; prices depend on each install's model plan. The settings overlay's
// Usage section (app/settings-overlay.tsx) shows the same table.
export async function UsageTable({rows}:{rows:UsageDay[]}) {
 const {t,locale}=await getI18n(); const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 return <div className="panel table-wrap section-title"><table className="table usage-table"><thead><tr><th scope="col">{t('usageCompany')}</th><th scope="col">{t('usageDay')}</th><th scope="col">{t('usageInput')}</th><th scope="col">{t('usageOutput')}</th><th scope="col">{t('usageRuns')}</th><th scope="col">{t('usageUnknown')}</th></tr></thead>
  <tbody>{rows.map(row=><tr key={`${row.company_id}:${row.day}`}><td dir="auto">{row.company_name}</td><td><time dateTime={row.day}>{row.day}</time></td><td>{count(row.input_tokens)}</td><td>{count(row.output_tokens)}</td><td>{count(row.runs)}</td><td>{count(row.unknown_runs)}</td></tr>)}</tbody></table></div>;
}

export default async function Usage({rows,slug}:{rows:UsageDay[],slug:string}) {
 const {t}=await getI18n();
 return <><div className="tabs"><Link className="button" href={`/c/${slug}/settings`}>{t('general')}</Link><Link className="button active" href={`/c/${slug}/usage`}>{t('usage')}</Link></div>
  <section className="panel"><div className="panel-head"><div><h2>{t('usage')}</h2><p>{t('usageHelp')}</p></div></div></section>
  {rows.length?<UsageTable rows={rows}/>:<p className="empty section-title">{t('usageNone')}</p>}</>;
}
