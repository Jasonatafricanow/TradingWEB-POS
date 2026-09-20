export const SUPPORTED_LOCALES = ['zh', 'en', 'pt'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const supported = new Set<string>(SUPPORTED_LOCALES);

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && supported.has(value);
}
