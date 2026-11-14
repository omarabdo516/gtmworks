'use client';
import { useI18n } from '@/lib/i18n-client';
import SetPasswordForm from './set-password-form';
// A person's own password. In the settings overlay's "Your account" it sits below the language, drawn as the
// reference draws a section (a quiet label over a card).
export default function PasswordSettings({variant}:{variant?:'overlay'}) {
 const {t}=useI18n();
 if(variant==='overlay') return <section className="dp-sec sov-password" aria-labelledby="ac-h-pw"><h4 className="dp-label" id="ac-h-pw"><span>{t('changePassword')}</span></h4><div className="panel-card set-card"><SetPasswordForm/></div></section>;
 return <section className="panel section-title"><h2>{t('changePassword')}</h2><SetPasswordForm/></section>;
}
