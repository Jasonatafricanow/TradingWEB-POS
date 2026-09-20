import { describe, it, expect } from 'vitest';
import type { Order, OrderItem, Payment } from '@/api/types';
import type { ReceiptDoc, ReceiptLine } from '@/hardware/printer/types';
import {
  buildOrderReceipt,
  buildShiftReceipt,
  docToPlainText,
  receiptDocToHtml,
  type ReceiptContext,
  type ShiftReceiptData,
} from '@/hardware/printer/receipt';

// ── Helpers ─────────────────────────────────────────────────────

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    productId: 'product-1',
    variantId: null,
    name: '测试商品',
    variantLabel: null,
    sku: null,
    unitPriceCents: 1000,
    qty: 1,
    lineDiscountCents: 0,
    deliveryMethod: 'in_store',
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    method: 'cash',
    label: '现金',
    amountCents: 1000,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-001',
    number: 'POS-20260712-001',
    createdAt: '2026-07-12T10:30:00.000Z',
    source: 'pos',
    staffName: '张三',
    customerId: null,
    customerName: null,
    note: null,
    items: [makeItem()],
    itemCount: 1,
    subtotalCents: 1000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 1000,
    payments: [makePayment()],
    status: 'completed',
    refundedCents: 0,
    promoLabel: null,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ReceiptContext> = {}): ReceiptContext {
  return {
    storeName: '测试门店',
    storeAddress: '北京市朝阳区测试路1号',
    footer: '谢谢惠顾',
    symbol: '¥',
    widthCols: 32,
    ...overrides,
  };
}

function makeShiftData(overrides: Partial<ShiftReceiptData> = {}): ShiftReceiptData {
  return {
    openedAt: new Date('2026-07-12T09:00:00Z').getTime(),
    closedAt: new Date('2026-07-12T18:00:00Z').getTime(),
    openedBy: 'Alice',
    closedBy: 'Bob',
    floatCents: 10000,
    cashSalesCents: 50000,
    cashRefundCents: 5000,
    cashInCents: 3000,
    cashOutCents: 2000,
    expectedCents: 56000,
    countedCents: 55800,
    diffCents: -200,
    ordersCount: 25,
    salesTotalCents: 80000,
    ...overrides,
  };
}

/** Find the first line matching a predicate */
function findLine(doc: ReceiptDoc, predicate: (l: ReceiptLine) => boolean): ReceiptLine | undefined {
  return doc.lines.find(predicate);
}

// ── buildOrderReceipt ───────────────────────────────────────────

describe('buildOrderReceipt', () => {
  // 1. Generates correct line structure
  it('generates a ReceiptDoc with expected line structure', () => {
    const doc = buildOrderReceipt(makeOrder(), makeCtx());

    expect(doc).toBeDefined();
    expect(doc.lines).toBeInstanceOf(Array);
    expect(doc.lines.length).toBeGreaterThan(0);

    // Must contain text, row, hr, barcode, and cut lines
    const kinds = new Set(doc.lines.map((l) => l.kind));
    expect(kinds.has('text')).toBe(true);
    expect(kinds.has('row')).toBe(true);
    expect(kinds.has('hr')).toBe(true);
    expect(kinds.has('barcode')).toBe(true);
    expect(kinds.has('cut')).toBe(true);
  });

  // 2. Includes store name, order number, time, staff
  it('includes store name, order number, time, and staff', () => {
    const order = makeOrder({ number: 'POS-999', staffName: '李四' });
    const ctx = makeCtx({ storeName: '好味道' });
    const doc = buildOrderReceipt(order, ctx);

    // Store name is first line
    const firstLine = doc.lines[0];
    expect(firstLine.kind).toBe('text');
    expect((firstLine as any).text).toBe('好味道');

    // Order number
    const numberRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '单号');
    expect(numberRow).toBeDefined();
    expect((numberRow as any).right).toBe('POS-999');

    // Time row
    const timeRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '时间');
    expect(timeRow).toBeDefined();
    expect((timeRow as any).right).toContain('2026');

    // Staff row
    const staffRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '收银');
    expect(staffRow).toBeDefined();
    expect((staffRow as any).right).toBe('李四');
  });

  // 3. Includes line items with variant labels and SKUs
  it('includes line items with variant labels and SKUs', () => {
    const item = makeItem({
      name: '拿铁咖啡',
      variantLabel: '大杯/加奶',
      sku: 'SKU-LATTE-L',
      unitPriceCents: 3500,
      qty: 2,
    });
    const order = makeOrder({
      items: [item],
      subtotalCents: 7000,
      totalCents: 7000,
      payments: [makePayment({ amountCents: 7000 })],
    });
    const doc = buildOrderReceipt(order, makeCtx());

    // The item row
    const itemRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '拿铁咖啡');
    expect(itemRow).toBeDefined();
    expect((itemRow as any).right).toBe('¥70.00');

    // The meta line should contain variant and sku
    const metaLine = findLine(
      doc,
      (l) => l.kind === 'text' && (l as any).text.includes('大杯/加奶') && (l as any).text.includes('SKU-LATTE-L'),
    );
    expect(metaLine).toBeDefined();
  });

  // 4. Includes line discount display when lineDiscountCents > 0
  it('includes line discount display when lineDiscountCents > 0', () => {
    const item = makeItem({
      name: '折扣商品',
      unitPriceCents: 5000,
      qty: 1,
      lineDiscountCents: 500,
    });
    const order = makeOrder({ items: [item] });
    const doc = buildOrderReceipt(order, makeCtx());

    const discountLine = findLine(
      doc,
      (l) => l.kind === 'text' && (l as any).text.includes('行折扣') && (l as any).text.includes('-¥5.00'),
    );
    expect(discountLine).toBeDefined();
  });

  // 5. Includes discount row when discountCents > 0
  it('includes discount row when discountCents > 0', () => {
    const order = makeOrder({ discountCents: 200 });
    const doc = buildOrderReceipt(order, makeCtx());

    const discountRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '折扣');
    expect(discountRow).toBeDefined();
    expect((discountRow as any).right).toBe('-¥2.00');
  });

  // 6. Includes promo label in discount row
  it('includes promo label in discount row when promoLabel is set', () => {
    const order = makeOrder({ discountCents: 1000, promoLabel: '满100减10' });
    const doc = buildOrderReceipt(order, makeCtx());

    const discountRow = findLine(
      doc,
      (l) => l.kind === 'row' && (l as any).left.includes('满100减10'),
    );
    expect(discountRow).toBeDefined();
    expect((discountRow as any).left).toBe('折扣（含满100减10）');
  });

  // 7. Includes change when ctx.changeCents > 0
  it('includes change row when ctx.changeCents > 0', () => {
    const ctx = makeCtx({ changeCents: 500 });
    const doc = buildOrderReceipt(makeOrder(), ctx);

    const changeRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '找零');
    expect(changeRow).toBeDefined();
    expect((changeRow as any).right).toBe('¥5.00');
  });

  // 8. Includes refund row when refundedCents > 0
  it('includes refund row when refundedCents > 0', () => {
    const order = makeOrder({ refundedCents: 800 });
    const doc = buildOrderReceipt(order, makeCtx());

    const refundRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '已退款');
    expect(refundRow).toBeDefined();
    expect((refundRow as any).right).toBe('-¥8.00');
  });

  // 9. Ends with barcode and cut
  it('ends with barcode and cut (and optional drawer)', () => {
    const doc = buildOrderReceipt(makeOrder(), makeCtx());
    const lines = doc.lines;

    // Last should be cut (no drawer by default)
    expect(lines[lines.length - 1].kind).toBe('cut');
    expect(lines[lines.length - 2].kind).toBe('barcode');

    // With openDrawer, last should be drawer
    const docWithDrawer = buildOrderReceipt(makeOrder(), makeCtx({ openDrawer: true }));
    expect(docWithDrawer.lines[docWithDrawer.lines.length - 1].kind).toBe('drawer');
    expect(docWithDrawer.lines[docWithDrawer.lines.length - 2].kind).toBe('cut');
  });

  // Extra: no change row when changeCents is 0 or undefined
  it('does not include change row when changeCents is 0 or undefined', () => {
    const doc = buildOrderReceipt(makeOrder(), makeCtx({ changeCents: 0 }));
    const changeRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '找零');
    expect(changeRow).toBeUndefined();

    const doc2 = buildOrderReceipt(makeOrder(), makeCtx());
    const changeRow2 = findLine(doc2, (l) => l.kind === 'row' && (l as any).left === '找零');
    expect(changeRow2).toBeUndefined();
  });

  // Extra: includes copy label when set
  it('includes copy label when ctx.copyLabel is set', () => {
    const ctx = makeCtx({ copyLabel: '补打' });
    const doc = buildOrderReceipt(makeOrder(), ctx);

    const copyLine = findLine(
      doc,
      (l) => l.kind === 'text' && (l as any).text.includes('补打'),
    );
    expect(copyLine).toBeDefined();
    expect((copyLine as any).text).toBe('【补打】');
  });

  // Extra: includes customer name when set
  it('includes customer name row when order has customerName', () => {
    const order = makeOrder({ customerName: '王五' });
    const doc = buildOrderReceipt(order, makeCtx());

    const customerRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '客户');
    expect(customerRow).toBeDefined();
    expect((customerRow as any).right).toBe('王五');
  });

  // Extra: includes note section
  it('includes note section when order has note', () => {
    const order = makeOrder({ note: '不要辣' });
    const doc = buildOrderReceipt(order, makeCtx());

    const noteLine = findLine(
      doc,
      (l) => l.kind === 'text' && (l as any).text.includes('不要辣'),
    );
    expect(noteLine).toBeDefined();
    expect((noteLine as any).text).toBe('备注: 不要辣');
  });
});

// ── buildShiftReceipt ───────────────────────────────────────────

describe('buildShiftReceipt', () => {
  // 10. Includes all shift data fields
  it('includes all shift data fields', () => {
    const data = makeShiftData();
    const ctx = makeCtx({ storeName: '测试门店' });
    const doc = buildShiftReceipt(data, ctx);

    expect(doc.lines.length).toBeGreaterThan(0);

    // Store name
    const titleLine = doc.lines[0];
    expect((titleLine as any).text).toBe('测试门店');

    // Report label
    const reportLabel = findLine(doc, (l) => l.kind === 'text' && (l as any).text === '交接班报告');
    expect(reportLabel).toBeDefined();

    // Key data rows
    const assertRow = (left: string, expectedRight: string) => {
      const row = findLine(doc, (l) => l.kind === 'row' && (l as any).left === left);
      expect(row, `row '${left}' should exist`).toBeDefined();
      expect((row as any).right).toBe(expectedRight);
    };

    assertRow('订单数', '25');
    assertRow('销售总额', '¥800.00');
    assertRow('备用金', '¥100.00');
    assertRow('现金销售', '¥500.00');
    assertRow('现金退款', '-¥50.00');
    assertRow('现金投入', '¥30.00');
    assertRow('现金取出', '-¥20.00');
    assertRow('应有现金', '¥560.00');
    assertRow('实点现金', '¥558.00');
    assertRow('差额', '-¥2.00');

    // Opened/closed rows
    const openRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '开班');
    expect(openRow).toBeDefined();
    expect((openRow as any).right).toContain('Alice');

    const closeRow = findLine(doc, (l) => l.kind === 'row' && (l as any).left === '交班');
    expect(closeRow).toBeDefined();
    expect((closeRow as any).right).toContain('Bob');
  });

  it('ends with a cut line', () => {
    const doc = buildShiftReceipt(makeShiftData(), makeCtx());
    const last = doc.lines[doc.lines.length - 1];
    expect(last.kind).toBe('cut');
  });
});

// ── docToPlainText ──────────────────────────────────────────────

describe('docToPlainText', () => {
  // 11. Renders basic receipt to readable text
  it('renders a basic receipt to readable text', () => {
    const doc = buildOrderReceipt(makeOrder(), makeCtx());
    const text = docToPlainText(doc, 32);

    expect(text).toContain('测试门店');
    expect(text).toContain('POS-20260712-001');
    expect(text).toContain('测试商品');
    expect(text).toContain('¥10.00');
    expect(text).toContain('|||'); // barcode representation
    expect(text).toContain('✂');   // cut representation
  });

  it('renders hr as dashes', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'hr' }],
    };
    const text = docToPlainText(doc, 32);
    expect(text).toBe('-'.repeat(32));
  });

  it('centers text with center alignment', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'text', text: 'Hi', align: 'center' }],
    };
    const text = docToPlainText(doc, 32);
    // "Hi" is 2 chars → padding = floor((32-2)/2) = 15 spaces
    expect(text).toBe(' '.repeat(15) + 'Hi');
  });

  it('renders rows with left and right justified', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'row', left: '合计', right: '¥10.00' }],
    };
    const text = docToPlainText(doc, 32);
    expect(text).toContain('合计');
    expect(text).toContain('¥10.00');
    // The right side should be at the end
    expect(text.trimEnd().endsWith('¥10.00')).toBe(true);
  });

  it('renders feed as empty lines', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'feed', n: 3 }],
    };
    const text = docToPlainText(doc, 32);
    // 3 empty lines
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    lines.forEach((l) => expect(l).toBe(''));
  });
});

// ── receiptDocToHtml ────────────────────────────────────────────

describe('receiptDocToHtml', () => {
  // 12. Generates valid HTML
  it('generates valid HTML with doctype and structure', () => {
    const doc = buildOrderReceipt(makeOrder(), makeCtx());
    const html = receiptDocToHtml(doc);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
    expect(html).toContain('charset="utf-8"');
  });

  it('renders text lines as divs', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'text', text: '你好世界', align: 'center', bold: true, size: 2 }],
    };
    const html = receiptDocToHtml(doc);

    expect(html).toContain('text-align:center');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-size:20px');
    expect(html).toContain('你好世界');
  });

  it('renders row lines as flex divs', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'row', left: '合计', right: '¥10.00', bold: true }],
    };
    const html = receiptDocToHtml(doc);

    expect(html).toContain('display:flex');
    expect(html).toContain('justify-content:space-between');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('合计');
    expect(html).toContain('¥10.00');
  });

  it('renders hr as dashed border div', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'hr' }],
    };
    const html = receiptDocToHtml(doc);
    expect(html).toContain('border-top:1px dashed #000');
  });

  it('escapes HTML special characters', () => {
    const doc: ReceiptDoc = {
      lines: [{ kind: 'text', text: '<script>alert("xss")</script>' }],
    };
    const html = receiptDocToHtml(doc);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders barcode and qr in HTML', () => {
    const doc: ReceiptDoc = {
      lines: [
        { kind: 'barcode', data: 'POS-001' },
        { kind: 'qr', data: 'https://example.com' },
      ],
    };
    const html = receiptDocToHtml(doc);

    expect(html).toContain('||| POS-001 |||');
    expect(html).toContain('[QR] https://example.com');
  });

  it('includes 80mm page size in CSS', () => {
    const doc: ReceiptDoc = { lines: [] };
    const html = receiptDocToHtml(doc);
    expect(html).toContain('size: 80mm auto');
    expect(html).toContain('width: 72mm');
  });
});
