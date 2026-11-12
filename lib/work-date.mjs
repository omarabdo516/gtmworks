import { i18n } from './i18n.mjs';
/**
 * @param {string | null} value
 * @param {import('./i18n.mjs').Language} [language]
 * @param {Intl.DateTimeFormatOptions} [more] extra formatting, e.g. hour and minute (and the viewer's zone with `timeZone: undefined`)
 */
export function workDate(value, language = 'en', more) {
 if (!value) return i18n(language).t('noDate');
 const parsed = new Date(value);
 return Number.isNaN(parsed.getTime()) ? i18n(language).t('noDate') : parsed.toLocaleDateString(i18n(language).locale, {day:'numeric', month:'long', timeZone:'UTC', ...more});
}
