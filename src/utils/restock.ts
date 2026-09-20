// 补货建议（纯函数，node 可单测）：
// 基于最近订单估算日均销速 → 现库存可售天数 → 低于阈值给出建议采购量。
// 口径：销速 = 窗口期内售出数量 / 窗口天数（窗口 = min(最早订单距今天数, 14)，至少 1 天）。
// 明确标注为估算：样本只有"最近拉取的订单"（默认后端 limit=50）。

import type { EntityId, Order, Product } from '@/api/types';

export interface RestockSuggestion {
  key: string;
  productId: EntityId;
  variantId: EntityId | null;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  stock: number;
  /** 窗口期内售出件数 */
  soldQty: number;
  /** 日均销速（保留 2 位） */
  dailyRate: number;
  /** 可售天数（库存/销速；销速为 0 时为 Infinity） */
  daysLeft: number;
  /** 建议采购量 = ceil(目标天数*销速 - 现库存)，最少 1 */
  suggestQty: number;
}

export interface RestockOptions {
  /** 可售天数低于该值才建议补货 */
  alertDays?: number;
  /** 补到能卖这么多天 */
  targetDays?: number;
  windowMaxDays?: number;
}

export function computeRestockSuggestions(
  products: Product[],
  orders: Order[],
  now: Date = new Date(),
  opts: RestockOptions = {}
): RestockSuggestion[] {
  const alertDays = opts.alertDays ?? 7;
  const targetDays = opts.targetDays ?? 14;
  const windowMax = opts.windowMaxDays ?? 14;

  if (orders.length === 0) return [];
  // 只统计窗口期（windowMax 天）内的订单，使销速的分子（售出量）与分母（天数）时间范围一致，
  // 避免订单集跨度 > windowMax 天时把长周期销量除以短窗口，导致销速虚高、补货量偏大。
  const cutoff = now.getTime() - windowMax * 86400000;
  const windowed = orders.filter((o) => new Date(o.createdAt).getTime() >= cutoff);
  const oldest = windowed.length
    ? Math.min(...windowed.map((o) => new Date(o.createdAt).getTime()))
    : cutoff;
  const spanDays = Math.max(1, Math.min(windowMax, (now.getTime() - oldest) / 86400000));

  // 售出统计：variant 用 v<id>，产品级用 p<id>
  const sold = new Map<string, number>();
  for (const o of windowed) {
    for (const it of o.items) {
      if (it.productId.startsWith('local-product-')) continue; // 自定义商品不参与
      const k = it.variantId !== null ? `v${it.variantId}` : `p${it.productId}`;
      sold.set(k, (sold.get(k) ?? 0) + it.qty);
    }
  }

  const out: RestockSuggestion[] = [];
  for (const p of products) {
    if (p.type !== 'physical') continue;
    const targets = p.hasVariants
      ? p.variants.map((v) => ({
          key: `v${v.id}`,
          variantId: v.id,
          label: [v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || null,
          sku: v.sku,
          stock: v.stock,
        }))
      : [{ key: `p${p.id}`, variantId: null as EntityId | null, label: null, sku: p.sku, stock: p.stock }];
    for (const t of targets) {
      if (t.stock === null) continue;
      const soldQty = sold.get(t.key) ?? 0;
      if (soldQty === 0 && t.stock > 0) continue; // 没有销速且有库存：不打扰
      const dailyRate = soldQty / spanDays;
      const daysLeft = dailyRate > 0 ? t.stock / dailyRate : t.stock > 0 ? Infinity : 0;
      if (daysLeft >= alertDays) continue;
      const suggestQty = Math.max(1, Math.ceil(targetDays * dailyRate - t.stock));
      out.push({
        key: t.key,
        productId: p.id,
        variantId: t.variantId,
        name: p.name,
        variantLabel: t.label,
        sku: t.sku,
        stock: t.stock,
        soldQty,
        dailyRate: Math.round(dailyRate * 100) / 100,
        daysLeft: Number.isFinite(daysLeft) ? Math.round(daysLeft * 10) / 10 : daysLeft,
        suggestQty,
      });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
