import { interpolate, type InterpolationValue } from './interpolate';
import type { Locale } from './locale';
import { enShell } from '../locales/en/shell';
import { enSales } from '../locales/en/sales';
import { ptShell } from '../locales/pt/shell';
import { ptSales } from '../locales/pt/sales';
import { zhShell } from '../locales/zh/shell';
import { zhSales } from '../locales/zh/sales';

export const shellCatalogs = {
  zh: { ...zhShell, ...zhSales },
  en: { ...enShell, ...enSales },
  pt: { ...ptShell, ...ptSales },
} as const;
export type TranslationKey = keyof typeof shellCatalogs.en;

type PlaceholderNames<Value extends string> =
  Value extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never;
export type TranslationParams<Key extends TranslationKey> =
  [PlaceholderNames<(typeof shellCatalogs.en)[Key]>] extends [never]
    ? Record<string, never>
    : Record<PlaceholderNames<(typeof shellCatalogs.en)[Key]>, InterpolationValue>;
export type TranslationKeyWithoutParams = {
  [Key in TranslationKey]: PlaceholderNames<(typeof shellCatalogs.en)[Key]> extends never ? Key : never;
}[TranslationKey];
type KeysWithParams = Exclude<TranslationKey, TranslationKeyWithoutParams>;

export interface Translator {
  <Key extends TranslationKeyWithoutParams>(key: Key): string;
  <Key extends KeysWithParams>(key: Key, params: TranslationParams<Key>): string;
}

export function getCatalogKeys<Catalog extends Readonly<Record<string, string>>>(
  catalog: Catalog,
): (keyof Catalog)[] {
  return Object.keys(catalog).sort() as (keyof Catalog)[];
}

export function translate<Key extends TranslationKeyWithoutParams>(locale: Locale, key: Key): string;
export function translate<Key extends KeysWithParams>(
  locale: Locale,
  key: Key,
  params: TranslationParams<Key>,
): string;
export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Readonly<Record<string, InterpolationValue>> = {},
): string {
  const catalog = shellCatalogs[locale] as Readonly<Record<string, string>>;
  const template = catalog[key];
  if (template === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Missing translation key "${key}" for locale "${locale}"`);
    }
    return catalog['common.unexpected_error'];
  }
  return interpolate(template, params);
}
