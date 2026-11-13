'use client';
import { useI18n } from '@/lib/i18n-client';
import { workAction } from './work-actions';
// A card's approval decision: approve, or reject with a reason and the part that needs work. It lives inside the Card
// (ADR 0013); the card shows in "Waiting on you" until it is decided.
export function Decision({slug,company,card}:{slug:string,company:string,card:number}) { const {t}=useI18n();return <form action={workAction} className="decision-form"><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/><input type="hidden" name="card" value={card}/><button className="primary" name="op" value="approve">{t('approve')}</button><details><summary>{t('rejectWithAReason')}</summary><label>{t('rejectionReason')}<textarea dir="auto" className="field" name="reason" placeholder={t('enterRejectionReason')}/></label><div><label><input type="checkbox" name="caption_marked"/>{' '}{t('caption')}</label> <label><input type="checkbox" name="design_marked"/>{' '}{t('design')}</label></div><button name="op" value="reject">{t('confirmRejection')}</button></details></form>}
