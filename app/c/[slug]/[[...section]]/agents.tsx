'use client';
import { useI18n } from '@/lib/i18n-client';
import { messages } from '@/lib/i18n.mjs';
import Link from '@/lib/link';
import { useActionState, type ReactNode } from 'react';
import { Avatar, MemberPicker, type WorkMember } from '@/lib/work-activity';
import { agentDate } from '@/lib/agent-date.mjs';
import { createAgentKey, revokeAgentKey, saveWebhook } from './agent-actions';
type Member=WorkMember & {role:string,removed_at:string|null};
type Key={id:string,person_id:string,created_at:string,last_used_at:string|null,revoked_at:string|null};
type Delivery={id:number,status:string,attempts:number,created_at:string,last_status:number|null,last_error:string|null};
// A stored status or worker error that is a message catalogue key is translated; anything else (such as `HTTP 500`) is shown as it came.
const label=(value:string,t:(key:string)=>string)=>Object.hasOwn(messages.en,value)?t(value):value;
export default function Agents({company,slug,members,keys,owner,webhookUrl,deliveries,message,children}:{company:string,slug:string,members:Member[],keys:Key[],owner:boolean,webhookUrl:string,deliveries:Delivery[],message?:string,children:ReactNode}) { const {t,language}=useI18n();
 const [state,action,pending]=useActionState(createAgentKey,{});
 const [webhookState,webhookAction,webhookPending]=useActionState(saveWebhook,{});
 const contributors=members.filter(member=>member.role==='contributor' && !member.removed_at);
 const hidden=<><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/></>;
 return <>
  <nav className="tabs agent-tabs" aria-label={t('companySettings')}><Link className="button" href={`/c/${slug}/settings`}>{t('general')}</Link><Link className="button" href={`/c/${slug}/settings/members`}>{t('members')}</Link><Link className="button" href={`/c/${slug}/settings/work`}>{t('work')}</Link><Link className="button active" aria-current="page" href={`/c/${slug}/settings/agents`}>{t('agents')}</Link></nav>
  {!owner?<div className="stack">{children}<section className="panel"><h2>{t('agents')}</h2><p>{t('onlyTheCompanyOwnerCanManageKeys')}</p></section></div>:<div className="split-layout agents-layout">
   <section className="panel agents-panel">
    <h2>{t('agentKeys')}</h2><p>{t('manageAgentAccessToTheCompanyEachAgent')}</p>
    <form action={action} className="agent-create-form">{hidden}<label>{t('memberField')}{' '}<MemberPicker name="person" label={t('memberField')} members={contributors}/></label><button className="button" disabled={pending || !contributors.length}>{t('createKey')}</button></form>
    {state.error&&<p className="agent-notice" role="alert">{state.error}</p>}
    {message&&<p className="agent-notice" role="alert">{message}</p>}
    {state.key&&<p className="agent-notice agent-secret" role="status">{t('copyTheKeyNowItWillNotAppear')}{' '}<code dir="ltr">{state.key}</code></p>}
    <div className="detail-rows">{keys.length===0?<p className="empty">{t('noKeysYet')}</p>:keys.map(k=>{const name=members.find(m=>m.person_id===k.person_id)?.people?.name || t('member'); return <div key={k.id} className="detail-row agent-key-row section-title"><Avatar id={k.person_id} members={members} nameVisible/><div className="agent-row-main"><strong dir="auto">{name}</strong><p>{k.revoked_at?t('revoked'):t('lastUsed', k.last_used_at ? agentDate(k.last_used_at,language) : t('notUsedYet'))}</p></div>{!k.revoked_at&&<form action={revokeAgentKey}>{hidden}<input type="hidden" name="id" value={k.id}/><button className="button" aria-label={t('revokeKey', name)}>{t('revokeKeyAction')}</button></form>}</div>;})}</div>
   </section>
   <div className="grid gap-6">
    {children}
    <section className="panel agents-panel"><h2>{t('hermesNotifications')}</h2><p>{t('approvalsRejectionsAndCommentsAreSentImmediately')}</p><form action={webhookAction} className="agent-webhook-form">{hidden}<label>{t('notificationURL')}{' '}<input className="field" name="url" type="url" dir="ltr" required defaultValue={webhookUrl}/></label><label>{t('signingSecret')}{' '}<input className="field" name="secret" type="password" required autoComplete="new-password"/></label><button className="button" disabled={webhookPending}>{t('saveNotifications')}</button></form>{webhookState.message&&<p className="agent-notice" role="status">{webhookState.message}</p>}</section>
    <section className="panel agents-panel"><h2>{t('recentDeliveries')}</h2><p>{t('trackNotificationsSentToHermes')}</p><div className="detail-rows">{deliveries.length===0?<p className="empty">{t('noDeliveriesYet')}</p>:deliveries.map(d=><div key={d.id} className="detail-row agent-delivery-row"><div className="agent-row-main"><strong>{label(d.status,t)}</strong><p>{agentDate(d.created_at,language)}{' '}{t('attempts')}{' '}{d.attempts}{d.last_status&&t('httpStatus',d.last_status)}</p>{d.last_error&&<p dir="auto">{label(d.last_error,t)}</p>}</div></div>)}</div></section>
   </div>
  </div>}
 </>;
}
