import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCatalogKeys,
  getPlaceholderNames,
  shellCatalogs,
  translate,
} from '@/i18n';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('mobile typed catalog contract', () => {
  if (false) {
    // @ts-expect-error placeholder-bearing keys require their declared params
    translate('en', 'settings.promotion_summary');
    // @ts-expect-error parameter-free keys reject interpolation data
    translate('en', 'tabs.pos', { count: 1 });
  }

  it('keeps direct non-empty key coverage identical in zh, en, and pt', () => {
    const canonicalKeys = getCatalogKeys(shellCatalogs.en);
    expect(getCatalogKeys(shellCatalogs.zh)).toEqual(canonicalKeys);
    expect(getCatalogKeys(shellCatalogs.pt)).toEqual(canonicalKeys);

    for (const locale of ['zh', 'en', 'pt'] as const) {
      for (const key of canonicalKeys) {
        expect(shellCatalogs[locale][key].trim(), `${locale}:${key}`).not.toBe('');
        expect(shellCatalogs[locale][key], `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('keeps placeholder names and multiplicity identical across locales', () => {
    for (const key of getCatalogKeys(shellCatalogs.en)) {
      const expected = getPlaceholderNames(shellCatalogs.en[key]);
      expect(getPlaceholderNames(shellCatalogs.zh[key]), `zh:${key}`).toEqual(expected);
      expect(getPlaceholderNames(shellCatalogs.pt[key]), `pt:${key}`).toEqual(expected);
    }
  });

  it('interpolates declared parameters and rejects missing or extra values', () => {
    expect(translate('en', 'more.pending_orders', { count: 4 })).toBe(
      'Pending orders (4)',
    );
    expect(() =>
      translate('en', 'more.pending_orders', {} as never),
    ).toThrow(/missing.*count/i);
    expect(() =>
      translate('en', 'more.pending_orders', { count: 4, token: 'secret' } as never),
    ).toThrow(/unexpected.*token/i);
  });

  it('does not leak missing raw keys or generated labels in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = translate('pt', 'tabs.unknown' as never);
    expect(result).toBe(shellCatalogs.pt['common.unexpected_error']);
    expect(result).not.toContain('tabs.unknown');
    expect(result).not.toBe('Unknown');
  });
});
