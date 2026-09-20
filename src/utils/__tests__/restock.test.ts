import { describe, it, expect } from 'vitest';
import { computeRestockSuggestions } from '../restock';
import type { EntityId, Order, OrderItem, Product } from '@/api/types';

const NOW = new Date('2026-07-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

function order(
  createdAt: string,
  items: { productId: EntityId; variantId: EntityId | null; qty: number }[]
): Order {
  const its: OrderItem[] = items.map((i) => ({
    productId: i.productId, variantId: i.variantId, name: 'x', variantLabel: null, sku: null,
    unitPriceCents: 1000, qty: i.qty, deliveryMethod: 'in_store',
  }));
  return {
    id: 'o' + Math.random(), number: 'N', createdAt, source: 'pos', staffName: null,
    customerId: null, customerName: null, note: null, items: its,
    itemCount: its.reduce((s, i) => s + i.qty, 0), subtotalCents: 0, discountCents: 0,
    taxCents: 0, totalCents: 0, payments: [], status: 'completed', refundedCents: 0,
  };
}

function simpleProduct(id: EntityId, stock: number | null): Product {
  return {
    id, name: 'P' + id, priceCents: 1000, type: 'physical', image: null, isActive: true,
    deliveryMethods: ['in_store'], hasVariants: false, variants: [], sku: 'S' + id, barcode: null, stock,
  };
}

describe('restock · velocity window alignment (regression for order sets spanning > windowMax days)', () => {
  it('excludes sales older than windowMax from the numerator', () => {
    const orders = [
      order(daysAgo(20), [{ productId: 'product-1', variantId: null, qty: 12 }]), // outside 14d window
      order(daysAgo(2), [{ productId: 'product-1', variantId: null, qty: 2 }]),   // inside
    ];
    const [s] = computeRestockSuggestions([simpleProduct('product-1', 1)], orders, NOW);
    expect(s.soldQty).toBe(2);   // NOT 14
    expect(s.dailyRate).toBe(1); // 2 units / 2-day span, not 14/14
  });
});

describe('restock · basics', () => {
  it('suggests restock for a fast-moving low-stock item', () => {
    const orders = [order(daysAgo(1), [{ productId: 'product-1', variantId: null, qty: 5 }])];
    const [s] = computeRestockSuggestions([simpleProduct('product-1', 1)], orders, NOW);
    expect(s.daysLeft).toBeLessThan(7);
    expect(s.suggestQty).toBe(Math.max(1, Math.ceil(14 * 5 - 1))); // 69
  });

  it('flags an out-of-stock item even with no in-window sales', () => {
    const orders = [order(daysAgo(30), [{ productId: 'product-9', variantId: null, qty: 1 }])];
    const res = computeRestockSuggestions([simpleProduct('product-1', 0)], orders, NOW);
    const hit = res.find((r) => r.productId === 'product-1');
    expect(hit).toBeTruthy();
    expect(hit!.suggestQty).toBeGreaterThanOrEqual(1);
  });

  it('does not nag a well-stocked item with no sales', () => {
    const orders = [order(daysAgo(1), [{ productId: 'product-2', variantId: null, qty: 1 }])];
    const res = computeRestockSuggestions([simpleProduct('product-1', 50)], orders, NOW);
    expect(res.find((r) => r.productId === 'product-1')).toBeUndefined();
  });
});
