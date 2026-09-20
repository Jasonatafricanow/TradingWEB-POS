import type { Locale } from './locale';

const INTL_LOCALES: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  pt: 'pt-BR',
};

export function formatNumber(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], options).format(value);
}

export function formatMoney(
  locale: Locale,
  value: number,
  currency: string,
): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    style: 'currency',
    currency,
  }).format(value);
}

export function formatPercent(
  locale: Locale,
  value: number,
  options: { fractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    style: 'percent',
    minimumFractionDigits: options.fractionDigits,
    maximumFractionDigits: options.fractionDigits,
  }).format(value);
}

export function formatDate(
  locale: Locale,
  value: Date | number,
  options: { timeZone: string },
): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
    timeZone: options.timeZone,
  }).format(value);
}

export function formatDateTime(
  locale: Locale,
  value: Date | number,
  options: { timeZone: string },
): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timeZone,
  }).format(value);
}
