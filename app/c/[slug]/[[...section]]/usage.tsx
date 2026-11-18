import { getI18n } from '@/lib/i18n-server';
import Link from '@/lib/link';
import type { UsageRow } from '@/lib/company-app-items';

// Tokens per Agent of each company this person manages (#347, #32), each Agent's Hermes profile's own count
// (managedUsage): a profile two Agents still share is one row with both names. Token counts only; prices depend on each
// install's model plan. The settings overlay's Usage section (app/settings-overlay.tsx) shows the same table.
export async function UsageTable({rows}:{rows:UsageRow[]}) {
 const {t,locale}=await getI18n(); const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 const names=new Intl.ListFormat(locale,{type:'unit'});
 return <div className="panel table-wrap section-title"><table className="table usage-table"><thead><tr><th scope="col">{t('usageCompany')}</th><th scope="col">{t('usageAgent')}</th><th scope="col">{t('usageInput')}</th><th scope="col">{t('usageOutput')}</th><th scope="col">{t('usageSessions')}</th></tr></thead>
  <tbody>{rows.map(row=><tr key={`${row.company_id}:${row.agents[0]?.id}`}><td dir="auto">{row.company_name}</td><td dir="auto">{names.format(row.agents.map(agent=>agent.name))}</td>
   {row.input===null||row.output===null||row.sessions===null?<td colSpan={3}>{t('usageUnknown')}</td>:<><td>{count(row.input)}</td><td>{count(row.output)}</td><td>{count(row.sessions)}</td></>}</tr>)}</tbody></table></div>;
}

// The models one company's Agents ran on in the period (#32), each model's own count from Hermes's by_model rows added
// across that company's profiles. It stands apart from the totals above: Hermes merges auxiliary usage into it, so its
// sum can pass them. No price is shown.
export async function UsageModels({models}:{models:{model:string,input:number,output:number,sessions:number}[]}) {
 const {t,locale}=await getI18n(); const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 return <div className="panel table-wrap section-title"><table className="table usage-table usage-models"><thead><tr><th scope="col">{t('usageModel')}</th><th scope="col">{t('usageInput')}</th><th scope="col">{t('usageOutput')}</th><th scope="col">{t('usageSessions')}</th></tr></thead>
  <tbody>{models.map(model=><tr key={model.model}><td dir="auto">{model.model}</td><td>{count(model.input)}</td><td>{count(model.output)}</td><td>{count(model.sessions)}</td></tr>)}</tbody></table></div>;
}

export default async function Usage({rows,slug}:{rows:UsageRow[],slug:string}) {
 const {t}=await getI18n();
 return <><div className="tabs"><Link className="button" href={`/c/${slug}/settings`}>{t('general')}</Link><Link className="button active" href={`/c/${slug}/usage`}>{t('usage')}</Link></div>
  <section className="panel"><div className="panel-head"><div><h2>{t('usage')}</h2><p>{t('usageHelp')}</p></div></div></section>
  {rows.length?<UsageTable rows={rows}/>:<p className="empty section-title">{t('usageNone')}</p>}</>;
}
