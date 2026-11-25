'use client';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { useZone } from '@/app/agent-made';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import type { ModelCause } from '@/lib/model-causes';

// What a Conversation, a channel and a Card note say when a model call cannot succeed on a retry (#422, #457, #530):
// the cause, and where it is fixed. An Owner gets the link to Providers (the Company's model for no model
// at all, the Agent's model for a refusal); a Member is told to ask the Owner. `agent` names the Agent that could not
// reply. The caller draws the line around it, with `data-outcome` set from modelOutcome (lib/model-causes.ts).
const refusalWords={noCredit:'modelNoCredit',keyRefused:'modelKeyRefused',modelMissing:'modelMissing',noAccess:'modelNoAccess'} as const;

// A Run whose every account ran out says when its usage resets (`resets`, an ISO time), when the Engine named it (#642):
// in the reader's own zone, hidden until the page knows it, as a message's time is (#520).
// It names the accounts that ran out (`ranOut`, as Settings › Providers names them), when the Engine's pool did (#731).
export function ModelLine({cause,agent,slug,owner,resets,ranOut}:{cause:ModelCause,agent:string,slug:string,owner:boolean,resets?:string,ranOut?:string[]}) {
 const {t,language}=useI18n();
 const zone=useZone();
 // Every account ran out (#622): the Owner adds one, or picks the Company's Fallback model, in Providers.
 const fix=<Link className="note__link" href={overlayHref(slug,'models')}>{t(cause==='noModel'?'noModelConnect':cause==='noAccess'?'modelNoAccessFix':'modelRefusedFix')}</Link>;
 if(cause==='noModel') return <>{t('noModelLine')} {owner?fix:t('noModelAskOwner')}</>;
 const at=cause==='noAccess'&&resets?new Date(resets):null;
 const reset=at&&!Number.isNaN(at.getTime())&&<><time dateTime={at.toISOString()} data-utc={zone}>{t('modelUsageResets',
  at.toLocaleDateString(localeFor(language),{weekday:'short',day:'numeric',month:'short',timeZone:zone}),
  at.toLocaleTimeString(localeFor(language),{hour:'2-digit',minute:'2-digit',timeZone:zone}))}</time>{' '}</>;
 // Each name is the Owner's own words, so it keeps its own direction (design-reference: bx).
 const names=ranOut?.length?new Intl.ListFormat(localeFor(language),{type:'conjunction'}).formatToParts(ranOut)
  .map((part,index)=>part.type==='element'?<bdi key={index}>{part.value}</bdi>:part.value):null;
 const [before,after]=t('modelAccountsRanOut','{0}').split('{0}');
 const out=cause==='noAccess'&&names&&<>{before}{names}{after}{' '}</>;
 return <>{t(refusalWords[cause],agent)} {out}{reset}{owner?fix:t('modelRefusedAskOwner')}</>;
}
