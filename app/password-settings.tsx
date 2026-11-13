'use client';
import { useI18n } from '@/lib/i18n-client';
import SetPasswordForm from './set-password-form';
// A person's own password, beside their language in settings.
export default function PasswordSettings() {
 const {t}=useI18n();
 return <section className="panel section-title"><h2>{t('changePassword')}</h2><SetPasswordForm/></section>;
}
