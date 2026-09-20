import { describe, it, expect } from 'vitest';
import {
  aggregateOrders, sameLocalDay, localDayKey, inLocalRange, daysBetweenKeys,
  aggregateRange, lastNDays, dailySeries, hourlyDistribution, itemSales,
  csvCell, toCsv, dailySeriesToCsv, rangeReportToCsv,
  posRangeReportToCsv,
} from '../report';
import type { Order, OrderItem, Payment } from '@/api/types';

const DAY = new Date('2026-07-10T09:00:00');

function ord(p: Partial<Order> & { createdAt: string }): Order {
  return {
    id: 'o' + Math.random(), number: 'N', source: 'pos', staffName: null, customerId: null,
    customerName: null, note: null, items: [], itemCount: 0, subtotalCents: 0, discountCents: 0,
    taxCents: 0, totalCents: 0, payments: [], status: 'completed', refundedCents: 0, ...p,
  };
}
const item = (name: string, qty: number, unit: number): OrderItem => ({
  productId: 'product-1', variantId: null, name, variantLabel: null, sku: null,
  unitPriceCents: unit, qty, deliveryMethod: 'in_store',
});
const pay = (label: string, amountCents: number): Payment => ({ method: 'x', label, amountCents });

describe('report · sameLocalDay', () => {
  it('matches the same calendar day and excludes others', () => {
    expect(sameLocalDay('2026-07-10T23:00:00', DAY)).toBe(true);
    expect(sameLocalDay('2026-07-09T23:00:00', DAY)).toBe(false);
  });
});

describe('report · aggregateOrders', () => {
  const orders = [
    ord({ createdAt: '2026-07-10T10:00:00', totalCents: 10000, refundedCents: 2000, staffName: '张三',
      payments: [pay('现金', 10000)], items: [item('T恤', 2, 3000), item('杯子', 1, 4000)] }),
    ord({ createdAt: '2026-07-10T11:00:00', totalCents: 5000, refundedCents: 0, staffName: '李四',
      payments: [pay('微信支付', 5000)], items: [item('T恤', 1, 3000)] }),
    ord({ createdAt: '2026-07-09T11:00:00', totalCents: 9999, staffName: '张三', payments: [pay('现金', 9999)] }),
  ];
  const r = aggregateOrders(orders, DAY);
  it('counts only today', () => expect(r.ordersCount).toBe(2));
  it('gross / refunded / net', () => {
    expect(r.grossCents).toBe(15000);
    expect(r.refundedCents).toBe(2000);
    expect(r.netCents).toBe(13000);
  });
  it('average order value', () => expect(r.avgOrderCents).toBe(7500));
  it('per-staff sales & refund attribution, sorted by amount desc', () => {
    expect(r.byStaff[0]).toEqual({ name: '张三', orders: 1, amountCents: 10000, refundedCents: 2000 });
    expect(r.byStaff[1]).toEqual({ name: '李四', orders: 1, amountCents: 5000, refundedCents: 0 });
  });
  it('top items ranked by quantity', () => {
    expect(r.topItems[0]).toEqual({ name: 'T恤', qty: 3, amountCents: 9000 });
  });
  it('payment breakdown', () => {
    expect(r.byPayment.find((p) => p.label === '现金')!.amountCents).toBe(10000);
  });
});

describe('report · top items net line discount', () => {
  const withDisc = (name: string, unit: number, qty: number, lineDisc: number): OrderItem => ({
    productId: 'product-1', variantId: null, name, variantLabel: null, sku: null,
    unitPriceCents: unit, qty, lineDiscountCents: lineDisc, deliveryMethod: 'in_store',
  });
  it('subtracts line discount from top-item revenue; qty unaffected', () => {
    const orders = [ord({ createdAt: '2026-07-10T10:00:00', totalCents: 0, payments: [], items: [withDisc('鞋', 5000, 2, 1000)] })];
    expect(aggregateOrders(orders, DAY).topItems[0]).toEqual({ name: '鞋', qty: 2, amountCents: 9000 });
  });
  it('missing lineDiscountCents treated as 0 (backward compatible)', () => {
    const orders = [ord({ createdAt: '2026-07-10T10:00:00', totalCents: 0, payments: [],
      items: [{ productId: 'product-1', variantId: null, name: '帽', variantLabel: null, sku: null, unitPriceCents: 3000, qty: 2, deliveryMethod: 'in_store' }] })];
    expect(aggregateOrders(orders, DAY).topItems[0]).toEqual({ name: '帽', qty: 2, amountCents: 6000 });
  });
});

// ---------- 区间 / 趋势 / 时段 / 导出 ----------

describe('report · localDayKey & range predicates', () => {
  it('localDayKey zero-pads month/day', () => {
    expect(localDayKey(new Date('2026-03-05T12:00:00'))).toBe('2026-03-05');
  });
  it('inLocalRange is inclusive on both endpoints', () => {
    const s = new Date('2026-07-08T00:00:00'); const e = new Date('2026-07-10T00:00:00');
    expect(inLocalRange('2026-07-08T23:00:00', s, e)).toBe(true);
    expect(inLocalRange('2026-07-10T00:30:00', s, e)).toBe(true);
    expect(inLocalRange('2026-07-11T00:30:00', s, e)).toBe(false);
    expect(inLocalRange('2026-07-07T23:59:00', s, e)).toBe(false);
  });
  it('inLocalRange tolerates reversed endpoints', () => {
    const s = new Date('2026-07-10T00:00:00'); const e = new Date('2026-07-08T00:00:00');
    expect(inLocalRange('2026-07-09T10:00:00', s, e)).toBe(true);
  });
  it('daysBetweenKeys counts calendar days incl. month boundary', () => {
    expect(daysBetweenKeys('2026-07-10', '2026-07-10')).toBe(0);
    expect(daysBetweenKeys('2026-07-08', '2026-07-10')).toBe(2);
    expect(daysBetweenKeys('2026-06-29', '2026-07-01')).toBe(2);
  });
});

describe('report · aggregateRange', () => {
  const orders = [
    ord({ createdAt: '2026-07-08T10:00:00', totalCents: 3000, payments: [pay('现金', 3000)], items: [item('A', 1, 3000)] }),
    ord({ createdAt: '2026-07-09T10:00:00', totalCents: 5000, payments: [pay('微信', 5000)], items: [item('B', 1, 5000)] }),
    ord({ createdAt: '2026-07-10T10:00:00', totalCents: 2000, refundedCents: 500, payments: [pay('现金', 2000)], items: [item('A', 1, 2000)] }),
    ord({ createdAt: '2026-07-11T10:00:00', totalCents: 9999, payments: [pay('现金', 9999)] }),
  ];
  const r = aggregateRange(orders, new Date('2026-07-08T09:00:00'), new Date('2026-07-10T09:00:00'));
  it('spans inclusive range, excludes outside', () => { expect(r.ordersCount).toBe(3); expect(r.grossCents).toBe(10000); });
  it('reports day span and keys', () => { expect(r.days).toBe(3); expect(r.startKey).toBe('2026-07-08'); expect(r.endKey).toBe('2026-07-10'); });
  it('net subtracts refunds across range', () => { expect(r.refundedCents).toBe(500); expect(r.netCents).toBe(9500); });
  it('endpoints may be passed reversed', () => {
    const rr = aggregateRange(orders, new Date('2026-07-10T09:00:00'), new Date('2026-07-08T09:00:00'));
    expect(rr.ordersCount).toBe(3); expect(rr.startKey).toBe('2026-07-08');
  });
});

describe('report · lastNDays', () => {
  const ref = new Date('2026-07-10T09:00:00');
  const orders = [
    ord({ createdAt: '2026-07-07T10:00:00', totalCents: 1000, payments: [] }),
    ord({ createdAt: '2026-07-08T10:00:00', totalCents: 2000, payments: [] }),
    ord({ createdAt: '2026-07-10T10:00:00', totalCents: 3000, payments: [] }),
  ];
  it('includes today and n-1 prior days', () => {
    const r = lastNDays(orders, 3, ref);
    expect(r.days).toBe(3);
    expect(r.startKey).toBe('2026-07-08');
    expect(r.endKey).toBe('2026-07-10');
    expect(r.ordersCount).toBe(2);
    expect(r.grossCents).toBe(5000);
  });
});

describe('report · dailySeries', () => {
  const orders = [
    ord({ createdAt: '2026-07-08T10:00:00', totalCents: 3000, refundedCents: 0, payments: [] }),
    ord({ createdAt: '2026-07-10T10:00:00', totalCents: 2000, refundedCents: 500, payments: [] }),
  ];
  const s = dailySeries(orders, new Date('2026-07-08T00:00:00'), new Date('2026-07-10T00:00:00'));
  it('one point per calendar day, ascending, zero-filled gaps', () => {
    expect(s.length).toBe(3);
    expect(s.map((p) => p.dateKey)).toEqual(['2026-07-08', '2026-07-09', '2026-07-10']);
    expect(s[1]).toEqual({ dateKey: '2026-07-09', ordersCount: 0, grossCents: 0, refundedCents: 0, netCents: 0 });
  });
  it('buckets orders and computes net', () => {
    expect(s[0].grossCents).toBe(3000);
    expect(s[2]).toEqual({ dateKey: '2026-07-10', ordersCount: 1, grossCents: 2000, refundedCents: 500, netCents: 1500 });
  });
});

describe('report · hourlyDistribution', () => {
  const orders = [
    ord({ createdAt: '2026-07-10T10:15:00', totalCents: 1000, payments: [] }),
    ord({ createdAt: '2026-07-10T10:45:00', totalCents: 2000, payments: [] }),
    ord({ createdAt: '2026-07-10T14:05:00', totalCents: 4000, payments: [] }),
  ];
  const h = hourlyDistribution(orders);
  it('has 24 buckets', () => expect(h.length).toBe(24));
  it('sums orders and amount per local hour', () => {
    expect(h[10]).toEqual({ hour: 10, ordersCount: 2, amountCents: 3000 });
    expect(h[14]).toEqual({ hour: 14, ordersCount: 1, amountCents: 4000 });
    expect(h[9].ordersCount).toBe(0);
  });
});

describe('report · itemSales (uncapped)', () => {
  it('returns all distinct items (not capped at 5), net of line discount, sorted by amount', () => {
    const wd = (name: string, unit: number, qty: number, ld: number): OrderItem => ({
      productId: 'product-1', variantId: null, name, variantLabel: null, sku: null,
      unitPriceCents: unit, qty, lineDiscountCents: ld, deliveryMethod: 'in_store',
    });
    const orders = [ord({ createdAt: '2026-07-10T10:00:00', totalCents: 0, payments: [],
      items: [wd('a', 100, 1, 0), item('b', 1, 200), item('c', 1, 300), item('d', 1, 400), item('e', 1, 500), wd('f', 1000, 1, 100)] })];
    const s = itemSales(orders);
    expect(s.length).toBe(6);
    expect(s[0]).toEqual({ name: 'f', qty: 1, amountCents: 900 });
  });
});

describe('report · CSV export', () => {
  it('csvCell escapes comma / quote / newline; leaves plain untouched', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(1234)).toBe('1234');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he "q"')).toBe('"he ""q"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });

  it('exports server range reports with store and reconciliation context', () => {
    const csv = posRangeReportToCsv({
      store: { id: 'store-1', name: 'Main Store', timezoneOffset: '+02:00' }, startKey: '2026-07-01', endKey: '2026-07-03', source: 'pos',
      grossCents: 120000, refundedCents: 4000, refundsForOrdersCents: 4500, netCents: 116000, ordersCount: 120, avgOrderCents: 1000,
      byPayment: [{ method: 'cash', label: 'Cash', grossCents: 120000, refundedCents: 4000, netCents: 116000 }],
      byStaff: [], topItems: [{ name: 'Product', qty: 120, amountCents: 120000 }], daily: [], hourly: [],
    });
    expect(csv).toContain('门店,Main Store');
    expect(csv).toContain('区间,2026-07-01 ~ 2026-07-03');
    expect(csv).toContain('Cash,1200.00,40.00,1160.00');
  });
  it('toCsv joins cells with commas and rows with CRLF', () => {
    expect(toCsv([['a', 'b'], [1, 2]])).toBe('a,b\r\n1,2');
  });
  it('dailySeriesToCsv has header and decimal money', () => {
    const csv = dailySeriesToCsv([{ dateKey: '2026-07-10', ordersCount: 2, grossCents: 10000, refundedCents: 500, netCents: 9500 }]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('日期,订单数,销售额,退款,净额');
    expect(lines[1]).toBe('2026-07-10,2,100.00,5.00,95.00');
  });
  it('rangeReportToCsv includes range header, payment and item rows', () => {
    const r = aggregateRange(
      [ord({ createdAt: '2026-07-10T10:00:00', totalCents: 3000, payments: [pay('现金', 3000)], items: [item('A', 1, 3000)] })],
      new Date('2026-07-10T00:00:00'), new Date('2026-07-10T00:00:00'));
    const csv = rangeReportToCsv(r, itemSales([ord({ createdAt: '2026-07-10T10:00:00', totalCents: 3000, payments: [], items: [item('A', 1, 3000)] })]));
    expect(csv.includes('区间,2026-07-10 ~ 2026-07-10')).toBe(true);
    expect(csv.includes('现金,30.00')).toBe(true);
    expect(csv.includes('A,1,30.00')).toBe(true);
  });
});
