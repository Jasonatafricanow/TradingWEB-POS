import { describe, expect, it } from 'vitest';

import {
  dataSourceLabel,
  formatPosMoney,
  productTypeLabel,
  scannerSourceLabel,
  translate,
} from '@/i18n';

describe('mobile register and cart presentation', () => {
  it('maps stable register protocol values to localized labels', () => {
    expect(dataSourceLabel('en', 'mock')).toBe('Demo');
    expect(scannerSourceLabel('pt', 'camera')).toBe('C\u00e2mera');
    expect(scannerSourceLabel('en', 'future')).toBe('Scanner');
    expect(productTypeLabel('pt', 'service')).toBe('Servi\u00e7o');
    expect(productTypeLabel('en', 'future')).toBe('Product');
  });

  it('provides typed cart copy and safe interpolation', () => {
    expect(translate('pt', 'cart.empty')).toBe('O carrinho est\u00e1 vazio');
    expect(translate('en', 'cart.item_count', { count: 3 })).toBe('3 items');
    expect(translate('en', 'cart.held_count', { count: 2 })).toBe('2 held orders');
    expect(translate('en', 'cart.line_price', {
      unitPrice: '$5.00',
      count: 2,
      total: '$10.00',
    })).toBe('$5.00 × 2 = $10.00');
  });

  it('formats POS money from configured ISO currency and locale', () => {
    expect(formatPosMoney('en', 1250, 'USD')).toBe('$12.50');
    expect(formatPosMoney('pt', 125000, 'MZN')).toContain('1.250,00');
  });
});
