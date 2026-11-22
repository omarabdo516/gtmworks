'use client';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import type { ModelCause } from '@/lib/model-causes';

// What a Conversation, a channel and a Card note say when a model call cannot succeed on a retry (#422, #457, #530):
// the cause, and where it is fixed. An Owner gets the link to Providers (the Company's model for no model
// at all, the Agent's model for a refusal); a Member is told to ask the Owner. `agent` names the Agent that could not
// reply. The caller draws the line around it, with `data-outcome` set from modelOutcome (lib/model-causes.ts).
const refusalWords={noCredit:'modelNoCredit',keyRefused:'modelKeyRefused',modelMissing:'modelMissing'} as const;

export function ModelLine({cause,agent,slug,owner}:{cause:ModelCause,agent:string,slug:string,owner:boolean}) {
 const {t}=useI18n();
 const fix=<Link className="note__link" href={overlayHref(slug,'models')}>{t(cause==='noModel'?'noModelConnect':'modelRefusedFix')}</Link>;
 if(cause==='noModel') return <>{t('noModelLine')} {owner?fix:t('noModelAskOwner')}</>;
 return <>{t(refusalWords[cause],agent)} {owner?fix:t('modelRefusedAskOwner')}</>;
}
