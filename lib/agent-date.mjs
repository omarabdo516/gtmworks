import { localeFor } from './i18n.mjs';
/** Format agent events consistently on server and client. */
export function agentDate(value, language = 'en') {
 const date = new Date(value);
 return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(localeFor(language), { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'UTC' });
}
