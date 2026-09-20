// 日/区间销售报表聚合（纯函数，node 可单测）
// 金额一律"分"(int)。热销额扣行级折扣；整单/满减折扣未按行摊派（口径同小计）。

import type { Order, PosRangeReport } from '@/api/types';
import { centsToDecimalString } from './money';

export interface DailyReport {
  ordersCount: number;
  grossCents: number;      // 销售总额（含已退部分）
  refundedCents: number;
  netCents: number;        // 净额 = gross - refunded
  avgOrderCents: number;
  byPayment: { label: string; amountCents: number }[];
  /** 热销 Top5：amountCents 为行折后实收（未摊整单/满减折扣） */
  topItems: { name: string; qty: number; amountCents: number }[];
  /** 员工业绩：按收银员分组（单数/销售额/退款） */
  byStaff: { name: string; orders: number; amountCents: number; refundedCents: number }[];
}

// ---------- 本地日键与区间判定 ----------

/** 本地日键 YYYY-MM-DD（按本地时区，避免 UTC 偏移导致跨日错分） */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function sameLocalDay(iso: string, ref: Date): boolean {
  return localDayKey(new Date(iso)) === localDayKey(ref);
}

/** iso 是否落在 [start, end] 本地日闭区间内（端点参数可反序，自动纠正） */
export function inLocalRange(iso: string, start: Date, end: Date): boolean {
  const k = localDayKey(new Date(iso));
  const a = localDayKey(start);
  const b = localDayKey(end);
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  return k >= lo && k <= hi;
}

// 日键 <-> UTC 毫秒（仅用于按天数步进/相减，避免夏令时误差）
function keyToUTC(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function utcToKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** 两个日键相差的自然日数（endKey - startKey）；同日为 0 */
export function daysBetweenKeys(startKey: string, endKey: string): number {
  return Math.round((keyToUTC(endKey) - keyToUTC(startKey)) / 86400000);
}

// ---------- 核心聚合 ----------

/** 对"已按日期筛好"的订单列表求汇总（无日期过滤，供单日/区间共用） */
function aggregateList(list: Order[]): DailyReport {
  const grossCents = list.reduce((s, o) => s + o.totalCents, 0);
  const refundedCents = list.reduce((s, o) => s + o.refundedCents, 0);

  const pay = new Map<string, number>();
  const items = new Map<string, { qty: number; amountCents: number }>();
  const staff = new Map<string, { orders: number; amountCents: number; refundedCents: number }>();
  for (const o of list) {
    for (const p of o.payments) pay.set(p.label, (pay.get(p.label) ?? 0) + p.amountCents);
    for (const it of o.items) {
      const cur = items.get(it.name) ?? { qty: 0, amountCents: 0 };
      cur.qty += it.qty;
      // 热销额扣除行级折扣（对应 order_items.line_discount），反映该行实收。
      // 注：整单折扣/满减未按行摊到单品（口径同小计），故热销额是"行折后"而非"整单折后"。
      cur.amountCents += it.unitPriceCents * it.qty - (it.lineDiscountCents ?? 0);
      items.set(it.name, cur);
    }
    const sName = o.staffName ?? '未署名';
    const sc = staff.get(sName) ?? { orders: 0, amountCents: 0, refundedCents: 0 };
    sc.orders += 1;
    sc.amountCents += o.totalCents;
    sc.refundedCents += o.refundedCents;
    staff.set(sName, sc);
  }
  return {
    ordersCount: list.length,
    grossCents,
    refundedCents,
    netCents: grossCents - refundedCents,
    avgOrderCents: list.length ? Math.round(grossCents / list.length) : 0,
    byPayment: [...pay.entries()]
      .map(([label, amountCents]) => ({ label, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents),
    topItems: [...items.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5),
    byStaff: [...staff.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amountCents - a.amountCents),
  };
}

/** 单日汇总（默认今天）。行为与旧版一致。 */
export function aggregateOrders(orders: Order[], day: Date = new Date()): DailyReport {
  return aggregateList(orders.filter((o) => sameLocalDay(o.createdAt, day)));
}

// ---------- 区间报表 ----------

export interface RangeReport extends DailyReport {
  startKey: string;   // YYYY-MM-DD（含端点）
  endKey: string;     // YYYY-MM-DD（含端点）
  days: number;       // 覆盖自然日数（含端点，≥1）
}

/** 区间汇总（本地日闭区间，端点可反序）。 */
export function aggregateRange(orders: Order[], start: Date, end: Date): RangeReport {
  const a = localDayKey(start);
  const b = localDayKey(end);
  const startKey = a <= b ? a : b;
  const endKey = a <= b ? b : a;
  const list = orders.filter((o) => {
    const k = localDayKey(new Date(o.createdAt));
    return k >= startKey && k <= endKey;
  });
  return { ...aggregateList(list), startKey, endKey, days: daysBetweenKeys(startKey, endKey) + 1 };
}

/** 以 ref 为终点往前 n 天（含当天共 n 天）。n=7 => 最近 7 天。 */
export function lastNDays(orders: Order[], n: number, ref: Date = new Date()): RangeReport {
  const startMs = keyToUTC(localDayKey(ref)) - (Math.max(1, n) - 1) * 86400000;
  const [sy, sm, sd] = utcToKey(startMs).split('-').map(Number);
  return aggregateRange(orders, new Date(sy, sm - 1, sd), ref);
}

// ---------- 趋势 / 时段分布 / 单品明细 ----------

export interface DayPoint {
  dateKey: string;      // YYYY-MM-DD
  ordersCount: number;
  grossCents: number;
  refundedCents: number;
  netCents: number;
}

/** 区间内逐日汇总，空日补 0（按日键升序），便于画折线/柱状。端点可反序。 */
export function dailySeries(orders: Order[], start: Date, end: Date): DayPoint[] {
  const a = localDayKey(start);
  const b = localDayKey(end);
  const startKey = a <= b ? a : b;
  const endKey = a <= b ? b : a;
  const n = daysBetweenKeys(startKey, endKey);

  const buckets = new Map<string, DayPoint>();
  for (let i = 0; i <= n; i++) {
    const key = utcToKey(keyToUTC(startKey) + i * 86400000);
    buckets.set(key, { dateKey: key, ordersCount: 0, grossCents: 0, refundedCents: 0, netCents: 0 });
  }
  for (const o of orders) {
    const bucket = buckets.get(localDayKey(new Date(o.createdAt)));
    if (!bucket) continue; // 区间外
    bucket.ordersCount += 1;
    bucket.grossCents += o.totalCents;
    bucket.refundedCents += o.refundedCents;
    bucket.netCents = bucket.grossCents - bucket.refundedCents;
  }
  return [...buckets.values()];
}

export interface HourPoint {
  hour: number;         // 0-23（本地小时）
  ordersCount: number;
  amountCents: number;  // 成交额（totalCents 汇总）
}

/** 24 桶按本地小时分布（找高峰时段）。传入已按需筛好的订单。 */
export function hourlyDistribution(orders: Order[]): HourPoint[] {
  const out: HourPoint[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, ordersCount: 0, amountCents: 0 }));
  for (const o of orders) {
    const h = new Date(o.createdAt).getHours();
    if (h < 0 || h > 23) continue;
    out[h].ordersCount += 1;
    out[h].amountCents += o.totalCents;
  }
  return out;
}

/** 全部单品销量（不截断，按实收额降序），供导出/明细。 */
export function itemSales(orders: Order[]): { name: string; qty: number; amountCents: number }[] {
  const items = new Map<string, { qty: number; amountCents: number }>();
  for (const o of orders) {
    for (const it of o.items) {
      const cur = items.get(it.name) ?? { qty: 0, amountCents: 0 };
      cur.qty += it.qty;
      cur.amountCents += it.unitPriceCents * it.qty - (it.lineDiscountCents ?? 0);
      items.set(it.name, cur);
    }
  }
  return [...items.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

// ---------- CSV 导出（纯字符串，前端写文件/分享）----------

/** 单元格转义：含 , " 或换行时用双引号包裹并把内部 " 转成 ""（RFC 4180） */
export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 二维数组 -> CSV 文本（CRLF 行分隔，RFC 4180） */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** 逐日趋势导出为 CSV（金额为 decimal 字符串，Excel 友好） */
export function dailySeriesToCsv(series: DayPoint[]): string {
  const rows: (string | number)[][] = [['日期', '订单数', '销售额', '退款', '净额']];
  for (const p of series) {
    rows.push([p.dateKey, p.ordersCount, centsToDecimalString(p.grossCents), centsToDecimalString(p.refundedCents), centsToDecimalString(p.netCents)]);
  }
  return toCsv(rows);
}

/** 区间报表导出为 CSV（概览 + 支付分布 + 单品明细）。 */
export function rangeReportToCsv(report: RangeReport, items: { name: string; qty: number; amountCents: number }[]): string {
  const rows: (string | number)[][] = [];
  rows.push(['区间', `${report.startKey} ~ ${report.endKey}`]);
  rows.push(['天数', report.days]);
  rows.push(['订单数', report.ordersCount]);
  rows.push(['销售总额', centsToDecimalString(report.grossCents)]);
  rows.push(['退款', centsToDecimalString(report.refundedCents)]);
  rows.push(['净额', centsToDecimalString(report.netCents)]);
  rows.push(['客单价', centsToDecimalString(report.avgOrderCents)]);
  rows.push([]);
  rows.push(['支付方式', '金额']);
  for (const p of report.byPayment) rows.push([p.label, centsToDecimalString(p.amountCents)]);
  rows.push([]);
  rows.push(['单品', '数量', '实收额']);
  for (const it of items) rows.push([it.name, it.qty, centsToDecimalString(it.amountCents)]);
  return toCsv(rows);
}

/** TradingWEB 权威区间报表导出；包含门店、时区和两种退款口径。 */
export function posRangeReportToCsv(report: PosRangeReport): string {
  const rows: (string | number)[][] = [
    ['门店', report.store.name],
    ['门店 ID', report.store.id],
    ['时区偏移', report.store.timezoneOffset],
    ['来源', report.source],
    ['区间', `${report.startKey} ~ ${report.endKey}`],
    ['订单数', report.ordersCount],
    ['销售总额', centsToDecimalString(report.grossCents)],
    ['区间内退款', centsToDecimalString(report.refundedCents)],
    ['区间订单最终退款', centsToDecimalString(report.refundsForOrdersCents)],
    ['净额', centsToDecimalString(report.netCents)],
    ['客单价', centsToDecimalString(report.avgOrderCents)],
    [],
    ['支付方式', '销售额', '退款分摊', '净额'],
  ];
  for (const row of report.byPayment) rows.push([row.label, centsToDecimalString(row.grossCents), centsToDecimalString(row.refundedCents), centsToDecimalString(row.netCents)]);
  rows.push([], ['员工', '订单数', '销售额', '退款', '净额']);
  for (const row of report.byStaff) rows.push([row.name, row.orders, centsToDecimalString(row.grossCents), centsToDecimalString(row.refundedCents), centsToDecimalString(row.netCents)]);
  rows.push([], ['单品', '数量', '销售额']);
  for (const row of report.topItems) rows.push([row.name, row.qty, centsToDecimalString(row.amountCents)]);
  rows.push([], ['日期', '订单数', '销售额', '退款', '净额']);
  for (const row of report.daily) rows.push([row.dateKey, row.ordersCount, centsToDecimalString(row.grossCents), centsToDecimalString(row.refundedCents), centsToDecimalString(row.netCents)]);
  return toCsv(rows);
}
