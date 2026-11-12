import en from './messages/en.json';
export type Language = 'en' | 'ar';
export type I18n = { language:Language, locale:string, t:(key:string,...values:unknown[])=>string };
export const messages: {en:typeof en,ar:typeof en};
export function localeFor(language:Language):string;
export function i18n(language?:Language):I18n;
