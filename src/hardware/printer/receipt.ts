// 小票模板：订单小票 / 交接班小票 / 测试页 -> ReceiptDoc（硬件无关）
// 以及 ReceiptDoc -> 纯文本预览 / HTML（系统打印用）

import type { Order } from '@/api/types';
import { formatCents } from '@/utils/money';
import { padEndVisual, visualWidth, wrapVisual } from './text-layout';
import type { PaperWidthCols, ReceiptDoc, ReceiptLine } from './types';

export interface ReceiptContext {
  storeName: string;
  storeAddress: string;
  footer: string;
  symbol: string;
  widthCols: PaperWidthCols;
  openDrawer?: boolean;
  changeCents?: number;
  copyLabel?: string;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildOrderReceipt(order: Order, ctx: ReceiptContext): ReceiptDoc {
  const L: ReceiptLine[] = [];
  const money = (c: number) => formatCents(c, ctx.symbol);

  L.push({ kind: 'text', text: ctx.storeName, align: 'center', bold: true, size: 2 });
  if (ctx.storeAddress) L.push({ kind: 'text', text: ctx.storeAddress, align: 'center' });
  if (ctx.copyLabel) L.push({ kind: 'text', text: `【${ctx.copyLabel}】`, align: 'center' });
  L.push({ kind: 'hr' });
  L.push({ kind: 'row', left: '单号', right: order.number });
  L.push({ kind: 'row', left: '时间', right: fmtTime(order.createdAt) });
  if (order.staffName) L.push({ kind: 'row', left: '收银', right: order.staffName });
  if (order.customerName) L.push({ kind: 'row', left: '客户', right: order.customerName });
  L.push({ kind: 'hr' });

  for (const it of order.items) {
    L.push({ kind: 'row', left: it.name, right: money(it.unitPriceCents * it.qty) });
    const meta: string[] = [];
    if (it.variantLabel) meta.push(it.variantLabel);
    if (it.sku) meta.push(it.sku);
    L.push({
      kind: 'text',
      text: `  ${meta.length ? meta.join(' | ') + '  ' : ''}${money(it.unitPriceCents)} x ${it.qty}`,
    });
    if ((it.lineDiscountCents ?? 0) > 0) {
      L.push({ kind: 'text', text: `  行折扣 -${money(it.lineDiscountCents ?? 0)}` });
    }
  }

  L.push({ kind: 'hr' });
  L.push({ kind: 'row', left: '小计', right: money(order.subtotalCents) });
  if (order.discountCents > 0) {
    L.push({
      kind: 'row',
      left: order.promoLabel ? `折扣（含${order.promoLabel}）` : '折扣',
      right: `-${money(order.discountCents)}`,
    });
  }
  if (order.taxCents > 0) L.push({ kind: 'row', left: '税费', right: money(order.taxCents) });
  L.push({ kind: 'row', left: '合计', right: money(order.totalCents), bold: true });

  for (const p of order.payments) {
    L.push({ kind: 'row', left: p.label, right: money(p.amountCents) });
  }
  if (ctx.changeCents && ctx.changeCents > 0) {
    L.push({ kind: 'row', left: '找零', right: money(ctx.changeCents) });
  }
  if (order.refundedCents > 0) {
    L.push({ kind: 'row', left: '已退款', right: `-${money(order.refundedCents)}` });
  }
  if (order.note) {
    L.push({ kind: 'hr' });
    L.push({ kind: 'text', text: `备注: ${order.note}` });
  }
  L.push({ kind: 'hr' });
  if (ctx.footer) L.push({ kind: 'text', text: ctx.footer, align: 'center' });
  L.push({ kind: 'barcode', data: order.number });
  L.push({ kind: 'cut' });
  if (ctx.openDrawer) L.push({ kind: 'drawer' });
  return { lines: L };
}

export interface ShiftReceiptData {
  openedAt: number;
  closedAt: number;
  openedBy: string;
  closedBy: string;
  floatCents: number;
  cashSalesCents: number;
  cashRefundCents: number;
  cashInCents: number;
  cashOutCents: number;
  expectedCents: number;
  countedCents: number;
  diffCents: number;
  ordersCount: number;
  salesTotalCents: number;
  /** Server summaries intentionally omit local order counters and use the reconciliation fields below. */
  accountingSource?: 'local' | 'server';
}

export function buildShiftReceipt(s: ShiftReceiptData, ctx: ReceiptContext): ReceiptDoc {
  const money = (c: number) => formatCents(c, ctx.symbol);
  const t = (ms: number) => fmtTime(new Date(ms).toISOString());
  const L: ReceiptLine[] = [
    { kind: 'text', text: ctx.storeName, align: 'center', bold: true, size: 2 },
    { kind: 'text', text: '交接班报告', align: 'center', bold: true },
    { kind: 'hr' },
    { kind: 'row', left: '开班', right: `${s.openedBy} ${t(s.openedAt)}` },
    { kind: 'row', left: '交班', right: `${s.closedBy} ${t(s.closedAt)}` },
    { kind: 'hr' },
    ...(s.accountingSource === 'server'
      ? [{ kind: 'text' as const, text: '现金对账以服务器核算为准', align: 'center' as const }]
      : [
          { kind: 'row' as const, left: '订单数', right: String(s.ordersCount) },
          { kind: 'row' as const, left: '销售总额', right: money(s.salesTotalCents) },
        ]),
    { kind: 'hr' },
    { kind: 'row', left: '备用金', right: money(s.floatCents) },
    { kind: 'row', left: '现金销售', right: money(s.cashSalesCents) },
    { kind: 'row', left: '现金退款', right: `-${money(s.cashRefundCents)}` },
    { kind: 'row', left: '现金投入', right: money(s.cashInCents) },
    { kind: 'row', left: '现金取出', right: `-${money(s.cashOutCents)}` },
    { kind: 'row', left: '应有现金', right: money(s.expectedCents), bold: true },
    { kind: 'row', left: '实点现金', right: money(s.countedCents), bold: true },
    { kind: 'row', left: '差额', right: money(s.diffCents), bold: true },
    { kind: 'cut' },
  ];
  return { lines: L };
}

export function buildTestReceipt(ctx: ReceiptContext): ReceiptDoc {
  return {
    lines: [
      { kind: 'text', text: ctx.storeName || 'TradingWEB POS', align: 'center', bold: true, size: 2 },
      { kind: 'text', text: '打印机测试页', align: 'center' },
      { kind: 'hr' },
      { kind: 'row', left: '中文对齐测试', right: formatCents(123456, ctx.symbol) },
      { kind: 'row', left: 'ABC 123 english', right: 'OK' },
      { kind: 'text', text: '加粗测试', bold: true },
      { kind: 'text', text: '倍高倍宽测试', size: 2 },
      { kind: 'hr' },
      { kind: 'barcode', data: 'TEST-12345' },
      { kind: 'qr', data: 'https://tradingweb.example/pos-test' },
      { kind: 'text', text: '测试完成 ✔', align: 'center' },
      { kind: 'cut' },
    ],
  };
}

// ---------- 渲染 ----------

/** 纯文本渲染（App 内小票预览用） */
export function docToPlainText(doc: ReceiptDoc, widthCols: PaperWidthCols): string {
  const out: string[] = [];
  const center = (s: string) => {
    const w = visualWidth(s);
    const pad = Math.max(0, Math.floor((widthCols - w) / 2));
    return ' '.repeat(pad) + s;
  };
  for (const l of doc.lines) {
    switch (l.kind) {
      case 'text': {
        for (const part of wrapVisual(l.text, widthCols)) {
          out.push(l.align === 'center' ? center(part) : l.align === 'right' ? part.padStart(widthCols) : part);
        }
        break;
      }
      case 'row': {
        const rw = visualWidth(l.right);
        let lw = widthCols - rw - 1;
        if (lw < 6) lw = 6;
        const parts = wrapVisual(l.left, lw);
        const first = parts.shift() ?? '';
        out.push(padEndVisual(first, Math.max(0, widthCols - rw)) + l.right);
        for (const p of parts) out.push(p);
        break;
      }
      case 'hr':
        out.push('-'.repeat(widthCols));
        break;
      case 'feed':
        for (let i = 0; i < l.n; i++) out.push('');
        break;
      case 'barcode':
        out.push(center(`||| ${l.data} |||`));
        break;
      case 'qr':
        out.push(center(`[QR] ${l.data}`));
        break;
      case 'cut':
        out.push('');
        out.push(center('✂ - - - - - - - - -'));
        break;
      case 'drawer':
        break;
    }
  }
  return out.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML 渲染（系统打印 expo-print 用），按 80mm 纸样式 */
export function receiptDocToHtml(doc: ReceiptDoc): string {
  const rows: string[] = [];
  for (const l of doc.lines) {
    switch (l.kind) {
      case 'text': {
        const style = [
          l.align === 'center' ? 'text-align:center' : l.align === 'right' ? 'text-align:right' : '',
          l.bold ? 'font-weight:700' : '',
          l.size === 2 ? 'font-size:20px' : '',
        ].filter(Boolean).join(';');
        rows.push(`<div style="${style}">${esc(l.text) || '&nbsp;'}</div>`);
        break;
      }
      case 'row':
        rows.push(
          `<div style="display:flex;justify-content:space-between;gap:8px;${l.bold ? 'font-weight:700' : ''}"><span>${esc(l.left)}</span><span style="white-space:nowrap">${esc(l.right)}</span></div>`
        );
        break;
      case 'hr':
        rows.push('<div style="border-top:1px dashed #000;margin:4px 0"></div>');
        break;
      case 'feed':
        rows.push(`<div style="height:${l.n * 8}px"></div>`);
        break;
      case 'barcode':
        rows.push(`<div style="text-align:center;font-family:monospace">||| ${esc(l.data)} |||</div>`);
        break;
      case 'qr':
        rows.push(`<div style="text-align:center">[QR] ${esc(l.data)}</div>`);
        break;
      case 'cut':
      case 'drawer':
        break;
    }
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', monospace; font-size: 12px; width: 72mm; margin: 0 auto; color:#000; }
  </style></head><body>${rows.join('')}</body></html>`;
}
