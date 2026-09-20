import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
} from '@/i18n/core/format';

describe('mobile locale-aware formatters', () => {
  it('formats numbers and money using the selected locale and transaction currency', () => {
    expect(formatNumber('en', 1234.5)).toBe('1,234.5');
    expect(formatNumber('pt', 1234.5)).toBe('1.234,5');
    expect(formatMoney('en', 1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney('zh', 1234.5, 'USD')).toBe('US$1,234.50');
    expect(formatMoney('pt', 1234.5, 'USD')).toBe('US$\u00a01.234,50');
  });

  it('formats percentages from fractional values', () => {
    expect(formatPercent('en', 0.125, { fractionDigits: 1 })).toBe('12.5%');
    expect(formatPercent('pt', 0.125, { fractionDigits: 1 })).toBe('12,5%');
  });

  it('formats dates in an explicit store time zone', () => {
    const date = new Date('2026-07-29T23:30:00.000Z');
    expect(formatDate('en', date, { timeZone: 'UTC' })).toBe('Jul 29, 2026');
    expect(formatDate('zh', date, { timeZone: 'UTC' })).toBe('2026年7月29日');
    expect(formatDate('pt', date, { timeZone: 'UTC' })).toBe('29 de jul. de 2026');
  });
});
