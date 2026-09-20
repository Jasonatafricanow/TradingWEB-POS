import type { TranslationKeyWithoutParams } from './core/catalog';

type ShellTranslator = (key: TranslationKeyWithoutParams) => string;

export function getTabTitles(t: ShellTranslator) {
  return {
    index: t('tabs.pos'),
    orders: t('tabs.orders'),
    products: t('tabs.products'),
    customers: t('tabs.customers'),
    more: t('tabs.more'),
  } as const;
}

export function getStackTitles(t: ShellTranslator) {
  return {
    cart: t('stack.cart'),
    checkout: t('stack.checkout'),
    scanner: t('stack.scanner'),
    orderDetail: t('stack.order_detail'),
    productDetail: t('stack.product_detail'),
    customerDetail: t('stack.customer_detail'),
    shift: t('stack.shift'),
    reports: t('stack.reports'),
    audit: t('stack.audit'),
    purchasing: t('stack.purchasing'),
    pending: t('stack.pending'),
    settings: t('stack.settings'),
    hardware: t('stack.hardware'),
  } as const;
}
