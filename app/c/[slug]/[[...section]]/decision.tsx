'use client';
import { useI18n } from '@/lib/i18n-client';
import type { WorkAction } from './work';
// A card's approval decision: approve, or reject with a reason and the part that needs work. It lives inside the Card
// (ADR 0013); the card shows in "Waiting on you" until it is decided. The marked parts are named apart from the card's
// own Caption field beside them, so each control has its own label.
export function Decision({slug,company,card,workAction}:{slug:string,company:string,card:number,workAction:WorkAction}) { const {t}=useI18n();return <form action={workAction} className="decision-form"><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/><input type="hidden" name="card" value={card}/><button className="primary" name="op" value="approve">{t('approve')}</button><details><summary>{t('rejectWithAReason')}</summary><label>{t('rejectionReason')}<textarea dir="auto" className="field" name="reason" placeholder={t('enterRejectionReason')}/></label><div><label><input type="checkbox" name="caption_marked"/>{' '}{t('captionNeedsWork')}</label> <label><input type="checkbox" name="design_marked"/>{' '}{t('designNeedsWork')}</label></div><button name="op" value="reject">{t('confirmRejection')}</button></details></form>}
