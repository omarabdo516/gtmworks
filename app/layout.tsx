import './globals.css';
import { getI18n } from '@/lib/i18n-server';
import { LanguageProvider } from '@/lib/i18n-client';
import { Vazirmatn } from 'next/font/google';
import { NavigationFeedback } from '@/lib/link';
import { FailureNotice } from '@/lib/failure-notice';
import { ClientErrorReporter } from '@/lib/client-errors';
const vazirmatn = Vazirmatn({subsets:['arabic'],weight:'variable',display:'swap',variable:'--font-arabic'});
export const metadata = { title: 'gtmworks' };
export default async function Layout({children}:{children:React.ReactNode}) { const {language,theme}=await getI18n(); return <html lang={language} dir={language==='ar'?'rtl':'ltr'} data-theme={theme} className={vazirmatn.variable}><body><LanguageProvider language={language}><NavigationFeedback /><FailureNotice /><ClientErrorReporter />{children}</LanguageProvider></body></html>; }
