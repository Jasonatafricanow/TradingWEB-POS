import { describe, expect, it } from 'vitest';
import { getStackTitles, getTabTitles } from '@/i18n/mobile-shell';
import { translate } from '@/i18n';

describe('mobile shell translation bindings', () => {
  it('binds every tab route to a translated title without changing route identity', () => {
    const english = getTabTitles((key) => translate('en', key));
    const portuguese = getTabTitles((key) => translate('pt', key));

    expect(Object.keys(english)).toEqual(['index', 'orders', 'products', 'customers', 'more']);
    expect(english).toEqual({
      index: 'POS',
      orders: 'Orders',
      products: 'Products',
      customers: 'Customers',
      more: 'More',
    });
    expect(portuguese.more).toBe('Mais');
    expect(Object.keys(portuguese)).toEqual(Object.keys(english));
  });

  it('binds stack route names to translated titles without changing route identity', () => {
    const chinese = getStackTitles((key) => translate('zh', key));
    const portuguese = getStackTitles((key) => translate('pt', key));

    expect(chinese.cart).toBe('购物车');
    expect(portuguese.cart).toBe('Carrinho');
    expect(Object.keys(portuguese)).toEqual(Object.keys(chinese));
  });

  it('translates deployment import controls and the MZN option in every supported locale', () => {
    expect(translate('en', 'settings.deploy_import')).toBe('Import deployment configuration');
    expect(translate('pt', 'settings.deploy_apply')).toBe('Aplicar');
    expect(translate('zh', 'settings.deploy_parse_failed_title')).toBe('无法解析');
    expect(translate('en', 'settings.currency_mzn_label')).toBe('MT MZN');
  });
});
