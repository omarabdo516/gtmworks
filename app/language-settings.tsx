'use client';
import { useActionState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { saveLanguage } from './language-actions';
export default function LanguageSettings() {
 const {t,language}=useI18n();
 const [error,action,pending]=useActionState(saveLanguage,'');
 return <section className="panel section-title"><h2>{t('language')}</h2><form action={action}><label>{t('interfaceLanguage')} <select name="language" defaultValue={language} key={language} disabled={pending}><option value="en">{t('english')}</option><option value="ar">{t('arabic')}</option></select></label> <button disabled={pending}>{t('save')}</button>{error&&<p role="alert">{error}</p>}</form></section>;
}
