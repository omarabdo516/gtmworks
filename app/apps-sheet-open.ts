'use client';
import { createContext, useContext } from 'react';
import { useI18n } from '@/lib/i18n-client';
import type { Reader } from './company-apps-read';

// Where the apps sheet is opened from, and at which app's page: a card or a row that cannot finish a sign-in itself
// opens the sheet on that app instead (#458). Kept apart from the sheet so a row need not carry the sheet's modules.
// `agent`: the Agent that asked for the app, picked on its page so a Connect there is for that Agent.
export type OpenApps=(opener:HTMLElement|null,app?:string,agent?:string)=>void;
// `person`: the signed-in person, whose copy of the apps the browser holds (#552).
export type Apps={company:string,person:string,open:OpenApps};
export const AppsContext=createContext<Apps|null>(null);
export const useAppsSheet=()=>useContext(AppsContext)?.open??null;
export const useAppsCompany=()=>useContext(AppsContext)?.company??null;
// Whose copy of a Company's apps a part of the page reads: the signed-in person the Shell drew, in the reader's language.
// Every page with a Company draws the sheet's provider around it; a part drawn alone has no person and its own copy.
export function useAppsReader(company:string):Reader {
 const person=useContext(AppsContext)?.person??''; const {language}=useI18n();
 return {company,person,language};
}
