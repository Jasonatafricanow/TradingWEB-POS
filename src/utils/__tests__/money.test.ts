import { describe, it, expect } from 'vitest';
import {
  computeTotals, lineDiscountCents, matchPromo, proratedCredit,
  parseMoneyToCents, centsToDecimalString, parseUserAmountToCents,
} from '../money';
import type { PromoRule, TotalsLineInput } from '../money';

const L = (
  unitPriceCents: number,
  qty: number,
  discount?: TotalsLineInput['discount']
): TotalsLineInput => ({ unitPriceCents, qty, discount });

describe('money · parsing', () => {
  it('parseMoneyToCents', () => {
    expect(parseMoneyToCents('19.99')).toBe(1999);
    expect(parseMoneyToCents(0)).toBe(0);
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
  });
  it('centsToDecimalString', () => {
    expect(centsToDecimalString(1999)).toBe('19.99');
    expect(centsToDecimalString(0)).toBe('0.00');
  });
  it('parseUserAmountToCents strips symbols, rejects empty/negative', () => {
    expect(parseUserAmountToCents('¥12.5')).toBe(1250);
    expect(parseUserAmountToCents('')).toBeNull();
    expect(parseUserAmountToCents('.5')).toBe(50);
    expect(parseUserAmountToCents('12.')).toBe(1200);
  });
  it('parseUserAmountToCents rejects malformed or unsafe input', () => {
    expect(parseUserAmountToCents('1.2.3')).toBeNull();
    expect(parseUserAmountToCents('-5')).toBeNull();
    expect(parseUserAmountToCents('abc')).toBeNull();
    expect(parseUserAmountToCents('1.234')).toBeNull();
    expect(parseUserAmountToCents('999999999999999')).toBeNull();
  });
});

describe('money · line discount', () => {
  it('percent of line gross', () =>
    expect(lineDiscountCents(L(10000, 2, { type: 'percent', value: 10 }))).toBe(2000));
  it('fixed amount capped at line gross', () =>
    expect(lineDiscountCents(L(10000, 2, { type: 'amount', value: 30000 }))).toBe(20000));
  it('no discount => 0', () => expect(lineDiscountCents(L(10000, 2))).toBe(0));
});

describe('money · computeTotals three-tier order (line -> cart -> promo), tax on net', () => {
  it('no discount, no tax', () => {
    const t = computeTotals([L(10000, 2)], null, 0);
    expect(t.subtotalCents).toBe(20000);
    expect(t.totalCents).toBe(20000);
    expect(t.discountCents).toBe(0);
  });

  it('line then cart percent applies to after-line net', () => {
    const t = computeTotals([L(10000, 2, { type: 'percent', value: 10 })], { type: 'percent', value: 10 }, 0);
    // afterLines = 20000 - 2000 = 18000; cart 10% = 1800; total 16200
    expect(t.lineDiscountCents).toBe(2000);
    expect(t.cartDiscountCents).toBe(1800);
    expect(t.discountCents).toBe(3800);
    expect(t.totalCents).toBe(16200);
  });

  it('promo picks highest met threshold when no manual cart discount', () => {
    const rules: PromoRule[] = [
      { id: 'a', label: '满100减5', thresholdCents: 10000, discountCents: 500, enabled: true },
      { id: 'b', label: '满200减20', thresholdCents: 20000, discountCents: 2000, enabled: true },
    ];
    const t = computeTotals([L(10000, 25)], null, 0, rules); // base 250000
    expect(t.promoLabel).toBe('满200减20');
    expect(t.promoDiscountCents).toBe(2000);
  });

  it('promo does NOT stack with a manual cart discount', () => {
    const rules: PromoRule[] = [
      { id: 'b', label: '满200减20', thresholdCents: 20000, discountCents: 2000, enabled: true },
    ];
    const t = computeTotals([L(10000, 3)], { type: 'amount', value: 1000 }, 0, rules);
    expect(t.cartDiscountCents).toBe(1000);
    expect(t.promoDiscountCents).toBe(0);
  });

  it('tax is charged on the net after all discounts', () => {
    const t = computeTotals([L(10000, 1)], { type: 'amount', value: 2000 }, 1000); // net 8000, 10%
    expect(t.taxCents).toBe(800);
    expect(t.totalCents).toBe(8800);
  });

  it('disabled promo rule is ignored by matchPromo', () => {
    const rules: PromoRule[] = [
      { id: 'b', label: 'x', thresholdCents: 100, discountCents: 50, enabled: false },
    ];
    expect(matchPromo(100000, rules)).toBeNull();
  });
});

describe('money · proratedCredit (exchange/return credit valuation)', () => {
  it('no discount/tax => equals gross (backward compatible)', () => {
    expect(proratedCredit(10000, 20000, 20000)).toBe(10000);
  });
  it('discounted order => scaled to actual paid share (regression: no over-credit)', () => {
    // subtotal 20000, paid 18000 (10% off). Returning one 10000 item credits 9000, not 10000.
    expect(proratedCredit(10000, 20000, 18000)).toBe(9000);
  });
  it('full return credits exactly the amount paid', () => {
    expect(proratedCredit(20000, 20000, 18000)).toBe(18000);
  });
  it('zero subtotal => fallback to gross (no divide-by-zero)', () => {
    expect(proratedCredit(5000, 0, 0)).toBe(5000);
  });
});
