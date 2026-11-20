'use client';
import { createContext, useContext } from 'react';

// Where the apps sheet is opened from, and at which app's page: a card or a row that cannot finish a sign-in itself
// opens the sheet on that app instead (#458). Kept apart from the sheet so a row need not carry the sheet's modules.
export type OpenApps=(opener:HTMLElement|null,app?:string)=>void;
export type Apps={company:string,open:OpenApps};
export const AppsContext=createContext<Apps|null>(null);
export const useAppsSheet=()=>useContext(AppsContext)?.open??null;
export const useAppsCompany=()=>useContext(AppsContext)?.company??null;
