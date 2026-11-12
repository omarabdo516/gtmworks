import en from './messages/en.json' with { type: 'json' };
import ar from './messages/ar.json' with { type: 'json' };
export const messages = { en, ar };
export const localeFor = language => language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US-u-nu-latn';
export function i18n(language = 'en') {
 const catalogue = messages[language];
 return { language, locale: localeFor(language), t(key, ...values) {
  if (!Object.hasOwn(catalogue, key)) throw new Error(`Missing message: ${key}`);
  return catalogue[key].replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
 } };
}
