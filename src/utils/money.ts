// 金额统一用"分"(整数)运算，避免浮点误差。
// TradingWEB 后端金额是 decimal 字符串，出入口用 parseMoneyToCents / centsToDecimalString 转换。
// 折扣三层：行级折扣 -> 整单手动折扣 -> 本地满减（有手动整单折扣时满减不叠加）。

export type Currency = 'USD' | 'CNY' | 'EUR' | 'MZN';

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: '$',
  CNY: '¥',
  EUR: '€',
  MZN: 'MT',
};

export function parseMoneyToCents(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatCents(cents: number, symbol = '¥'): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}${symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** 解析用户输入的金额文本 -> 分；非法返回 null（拒绝多小数点、负数、溢出精度的超大数） */
export function parseUserAmountToCents(text: string): number | null {
  const t = text.trim();
  if (!t || t.includes('-')) return null;
  const cleaned = t.replace(/[^\d.]/g, '');
  if (!cleaned || !/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  const cents = Math.round(n * 100);
  if (!Number.isFinite(n) || !Number.isSafeInteger(cents)) return null;
  return cents;
}

export interface CartDiscount {
  type: 'percent' | 'amount';
  /** percent: 0-100（可带小数）；amount: 分 */
  value: number;
}

/** 行级折扣：percent 0-100；amount = 该行合计减免的分 */
export interface LineDiscount {
  type: 'percent' | 'amount';
  value: number;
}

/** 本地满减规则（店长在设置页配置）：净额满 thresholdCents 减 discountCents */
export interface PromoRule {
  id: string;
  label: string;
  thresholdCents: number;
  discountCents: number;
  enabled: boolean;
}

export interface TotalsLineInput {
  unitPriceCents: number;
  qty: number;
  discount?: LineDiscount | null;
}

export interface Totals {
  /** 商品原价合计（行折扣前） */
  subtotalCents: number;
  /** 行级折扣合计 */
  lineDiscountCents: number;
  /** 整单手动折扣 */
  cartDiscountCents: number;
  /** 满减 */
  promoDiscountCents: number;
  /** 命中的满减规则文案（未命中为 null） */
  promoLabel: string | null;
  /** 折扣总额 = 行级 + 整单 + 满减（订单 discount_total） */
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** 单行折扣金额（对行合计 unitPrice*qty 生效，封顶不超过行合计） */
export function lineDiscountCents(l: TotalsLineInput): number {
  if (!l.discount) return 0;
  const gross = l.unitPriceCents * l.qty;
  const d =
    l.discount.type === 'percent'
      ? Math.round((gross * l.discount.value) / 100)
      : Math.round(l.discount.value);
  return Math.max(0, Math.min(gross, d));
}

/** 命中的满减规则：取满足门槛的最高一档 */
export function matchPromo(baseCents: number, rules: PromoRule[] | undefined): PromoRule | null {
  if (!rules || rules.length === 0) return null;
  let best: PromoRule | null = null;
  for (const r of rules) {
    if (!r.enabled || r.thresholdCents <= 0 || r.discountCents <= 0) continue;
    if (baseCents >= r.thresholdCents && (!best || r.thresholdCents > best.thresholdCents)) best = r;
  }
  return best;
}

export function computeTotals(
  lines: TotalsLineInput[],
  discount: CartDiscount | null,
  taxRateBps: number,
  promoRules?: PromoRule[]
): Totals {
  const subtotalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0);
  const lineDisc = lines.reduce((s, l) => s + lineDiscountCents(l), 0);
  const afterLines = subtotalCents - lineDisc;

  let cartDisc = 0;
  if (discount) {
    cartDisc =
      discount.type === 'percent'
        ? Math.round((afterLines * discount.value) / 100)
        : Math.round(discount.value);
    cartDisc = Math.max(0, Math.min(afterLines, cartDisc));
  }

  // 满减：仅在没有手动整单折扣时自动生效，门槛按行折后净额判定
  let promoDisc = 0;
  let promoLabel: string | null = null;
  if (cartDisc === 0) {
    const rule = matchPromo(afterLines, promoRules);
    if (rule) {
      promoDisc = Math.min(rule.discountCents, afterLines);
      promoLabel = rule.label;
    }
  }

  const taxable = Math.max(0, afterLines - cartDisc - promoDisc);
  const taxCents = Math.round((taxable * taxRateBps) / 10000);
  return {
    subtotalCents,
    lineDiscountCents: lineDisc,
    cartDiscountCents: cartDisc,
    promoDiscountCents: promoDisc,
    promoLabel,
    discountCents: lineDisc + cartDisc + promoDisc,
    taxCents,
    totalCents: taxable + taxCents,
  };
}

/**
 * 退货抵扣额按实付比例摊销：退货商品原价占整单原价(subtotal)的比例 × 实付总额(total，已含折扣与税)。
 * - 无折扣无税时 total == subtotal，结果等于原价，向后兼容原行为。
 * - subtotalCents <= 0（如整单皆为 0 元自定义行）时回退为原价，避免除零。
 * 说明：整单/满减折扣与税按原价比例摊到各行，对逐行折扣是近似（跨行会有轻微互补），
 *       但远优于此前"按原价全额抵扣"导致的对打折订单超额退款。
 */
export function proratedCredit(
  grossReturnedCents: number,
  subtotalCents: number,
  totalCents: number
): number {
  if (subtotalCents <= 0) return grossReturnedCents;
  return Math.round((totalCents * grossReturnedCents) / subtotalCents);
}
