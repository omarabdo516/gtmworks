'use client';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
export default function NotFound() {
 const {t}=useI18n();
 return <main className="panel login"><h1>{t('pageNotFound')}</h1><p>{t('pageNotFoundDescription')}</p><Link className="button" href="/">{t('home')}</Link></main>;
}
