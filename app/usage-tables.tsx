import type { UsageRow } from '@/lib/company-app-items';
import type { i18n } from '@/lib/i18n.mjs';

// Tokens per Agent of each company this person manages (#347, #32), each Agent's Hermes profile's own count
// (managedUsage): a profile two Agents still share is one row with both names. Token counts only; prices depend on each
// install's model plan. The usage page and the settings overlay's Usage section (#898: drawn in the browser) share them.
type T=ReturnType<typeof i18n>['t'];
export function UsageTable({t,locale,rows}:{t:T,locale:string,rows:UsageRow[]}) {
 const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 const names=new Intl.ListFormat(locale,{type:'unit'});
 return <div className="panel table-wrap section-title"><table className="table usage-table"><thead><tr><th scope="col">{t('usageCompany')}</th><th scope="col">{t('usageAgent')}</th><th scope="col">{t('usageInput')}</th><th scope="col">{t('usageOutput')}</th><th scope="col">{t('usageSessions')}</th></tr></thead>
  <tbody>{rows.map(row=><tr key={`${row.company_id}:${row.agents[0]?.id}`}><td dir="auto">{row.company_name}</td><td dir="auto">{names.format(row.agents.map(agent=>agent.name))}</td>
   {row.input===null||row.output===null||row.sessions===null?<td colSpan={3}>{t('usageUnknown')}</td>:<><td>{count(row.input)}</td><td>{count(row.output)}</td><td>{count(row.sessions)}</td></>}</tr>)}</tbody></table></div>;
}

// The models one company's Agents ran on in the period (#32), each model's own count from Hermes's by_model rows added
// across that company's profiles. It stands apart from the totals above: Hermes merges auxiliary usage into it, so its
// sum can pass them. No price is shown.
export function UsageModels({t,locale,models}:{t:T,locale:string,models:{model:string,input:number,output:number,sessions:number}[]}) {
 const count=(value:number)=>new Intl.NumberFormat(locale).format(value);
 return <div className="panel table-wrap section-title"><table className="table usage-table usage-models"><thead><tr><th scope="col">{t('usageModel')}</th><th scope="col">{t('usageInput')}</th><th scope="col">{t('usageOutput')}</th><th scope="col">{t('usageSessions')}</th></tr></thead>
  <tbody>{models.map(model=><tr key={model.model}><th scope="row" dir="auto">{model.model}</th><td>{count(model.input)}</td><td>{count(model.output)}</td><td>{count(model.sessions)}</td></tr>)}</tbody></table></div>;
}
