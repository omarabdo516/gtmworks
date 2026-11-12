'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { i18n, type Language } from './i18n.mjs';
const LanguageContext=createContext<Language>('en');
export function LanguageProvider({language,children}:{language:Language,children:ReactNode}) {
 return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}
export function useI18n() {
 const language=useContext(LanguageContext);
 return useMemo(()=>i18n(language),[language]);
}
