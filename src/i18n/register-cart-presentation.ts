import { translate, type TranslationKeyWithoutParams } from './core/catalog';
import { formatMoney } from './core/format';
import type { Locale } from './core/locale';

const SCANNER_SOURCE_KEYS = {
  camera: 'catalog.scanner.camera',
  hid: 'catalog.scanner.hid',
  ble: 'catalog.scanner.ble',
} as const satisfies Record<string, TranslationKeyWithoutParams>;

const PRODUCT_TYPE_KEYS = {
  physical: 'catalog.type.physical',
  service: 'catalog.type.service',
  virtual: 'catalog.type.virtual',
} as const satisfies Record<string, TranslationKeyWithoutParams>;

export function dataSourceLabel(locale: Locale, source: string): string {
  return source === 'tradingweb' ? 'TradingWEB' : translate(locale, 'catalog.source.demo');
}

export function scannerSourceLabel(locale: Locale, source: string): string {
  return translate(
    locale,
    SCANNER_SOURCE_KEYS[source as keyof typeof SCANNER_SOURCE_KEYS] ??
      'catalog.scanner.unknown',
  );
}

export function productTypeLabel(locale: Locale, type: string): string {
  return translate(
    locale,
    PRODUCT_TYPE_KEYS[type as keyof typeof PRODUCT_TYPE_KEYS] ?? 'catalog.type.unknown',
  );
}

export function formatPosMoney(locale: Locale, cents: number, currency: string): string {
  return formatMoney(locale, cents / 100, currency);
}
