import './globals.css';
import { getI18n } from '@/lib/i18n-server';
import { LanguageProvider } from '@/lib/i18n-client';
import { IBM_Plex_Sans_Arabic, Vazirmatn } from 'next/font/google';
import { NavigationFeedback } from '@/lib/link';
import { FailureNotice } from '@/lib/failure-notice';
import { ClientErrorReporter } from '@/lib/client-errors';
const vazirmatn = Vazirmatn({subsets:['arabic'],weight:'variable',display:'swap',variable:'--font-arabic'});
// The approved reference's face for the shell and the Agent Conversation (app/shell.css).
const plex = IBM_Plex_Sans_Arabic({subsets:['arabic','latin'],weight:['400','600'],display:'swap',variable:'--font-plex-arabic'});
export const metadata = { title: 'gtmworks' };
export default async function Layout({children}:{children:React.ReactNode}) { const {language,theme}=await getI18n(); return <html lang={language} dir={language==='ar'?'rtl':'ltr'} data-theme={theme} className={`${vazirmatn.variable} ${plex.variable}`}><body><LanguageProvider language={language}><NavigationFeedback /><FailureNotice /><ClientErrorReporter />{children}</LanguageProvider></body></html>; }
