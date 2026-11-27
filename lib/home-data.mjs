import { i18n } from './i18n.mjs';
export const metricValue = (value, language = 'en') => value == null ? i18n(language).t('unavailable') : new Intl.NumberFormat(i18n(language).locale).format(value);
