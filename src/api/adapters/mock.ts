// 演示数据源：内置中文示例商品/客户，开箱即可完整跑通收银 → 结账 → 小票 → 退款流程。
// 也可作为离线兜底。数据仅存于内存。

import { variantLabel } from '../types';
import { ApiError } from '../client';
import type {
  CreateOrderInput, CreatePurchaseOrderInput, Customer, LocationStock, Order, PingResult,
  PosDataSource, Product, ProductVariant, PurchaseOrder, RefundInput, Staff,
  StockAdjustInput, StoreLocation, ExchangeOrderInput, ExchangeOrderResult,
  PosAuditUploadRecord, PosAuditUploadResult, PosCashMovement, PosShift,
  InventoryTransfer, InventoryTransferInput,
  LocationPurpose, OrderPageQuery, Page, PickupFulfillmentStatus, PosRangeReport, PosReportQuery,
} from '../types';
import { createLocalUuid } from '@/utils/uuid';
import { aggregateRange, dailySeries, hourlyDistribution, itemSales } from '@/utils/report';
import { proratedCredit } from '@/utils/money';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const mockProductId = (n: number) => `mock-product-${n}`;
const variantCounters = new Map<number, number>();
function v(productNumber: number, partial: Partial<ProductVariant>): ProductVariant {
  const variantNumber = (variantCounters.get(productNumber) ?? 0) + 1;
  variantCounters.set(productNumber, variantNumber);
  return {
    id: `mock-variant-${productNumber}-${variantNumber}`,
    productId: mockProductId(productNumber), sku: null, barcode: null, priceCents: null,
    option1: null, option2: null, option3: null, stock: 0, ...partial,
  };
}

const products: Product[] = [
  {
    id: mockProductId(1), name: '经典T恤', priceCents: 9900, type: 'physical', image: null, isActive: true,
    deliveryMethods: ['in_store'], hasVariants: true, sku: null, barcode: null, stock: null,
    variants: [
      v(1, { sku: 'TS-BLK-M', barcode: '6901234500011', priceCents: 9900, option1: '黑', option2: 'M', stock: 12 }),
      v(1, { sku: 'TS-BLK-L', barcode: '6901234500012', priceCents: 9900, option1: '黑', option2: 'L', stock: 8 }),
      v(1, { sku: 'TS-WHT-M', barcode: '6901234500013', priceCents: 10900, option1: '白', option2: 'M', stock: 5 }),
      v(1, { sku: 'TS-WHT-L', barcode: '6901234500014', priceCents: 10900, option1: '白', option2: 'L', stock: 0 }),
    ],
  },
  {
    id: mockProductId(2), name: '精品咖啡豆 250g', priceCents: 6800, type: 'physical', image: null, isActive: true,
    deliveryMethods: ['in_store'], hasVariants: true, sku: null, barcode: null, stock: null,
    variants: [
      v(2, { sku: 'CF-LT', barcode: '6901234500021', priceCents: 6800, option1: '浅烘', stock: 20 }),
      v(2, { sku: 'CF-MD', barcode: '6901234500022', priceCents: 6800, option1: '中烘', stock: 16 }),
      v(2, { sku: 'CF-DK', barcode: '6901234500023', priceCents: 7200, option1: '深烘', stock: 9 }),
    ],
  },
  { id: mockProductId(3), name: '陶瓷马克杯', priceCents: 4500, type: 'physical', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'MUG-01', barcode: '6901234500031', stock: 30, variants: [] },
  { id: mockProductId(4), name: '帆布托特包', priceCents: 12800, type: 'physical', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'BAG-01', barcode: '6901234500041', stock: 14, variants: [] },
  { id: mockProductId(5), name: '不锈钢保温杯 500ml', priceCents: 15900, type: 'physical', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'BTL-01', barcode: '6901234500051', stock: 22, variants: [] },
  { id: mockProductId(6), name: '手工曲奇礼盒', priceCents: 8800, type: 'physical', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'CK-01', barcode: '6901234500061', stock: 11, variants: [] },
  { id: mockProductId(7), name: '香薰蜡烛', priceCents: 5600, type: 'physical', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'CD-01', barcode: '6901234500071', stock: 18, variants: [] },
  { id: mockProductId(8), name: '礼品卡 ¥100', priceCents: 10000, type: 'virtual', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'GC-100', barcode: '6901234500081', stock: null, variants: [] },
  { id: mockProductId(9), name: '笔记本文具套装', priceCents: 3900, type: 'physical', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'ST-01', barcode: '6901234500091', stock: 40, variants: [] },
  { id: mockProductId(10), name: '门店服务费', priceCents: 2000, type: 'service', image: null, isActive: true, deliveryMethods: ['in_store'], hasVariants: false, sku: 'SVC-01', barcode: null, stock: null, variants: [] },
];

const customers: Customer[] = [
  { id: 'mock-customer-1', name: '王小明', email: 'xiaoming@example.com', phone: '13800000001', ordersCount: 3 },
  { id: 'mock-customer-2', name: '陈静', email: 'chenjing@example.com', phone: '13800000002', ordersCount: 1 },
  { id: 'mock-customer-3', name: 'David Lee', email: 'david@example.com', phone: null, ordersCount: 0 },
];

const staff: Staff[] = [
  { id: 'mock-staff-manager', name: '张三', email: 'zhangsan@store.com', role: 'manager', pin: '1234' },
  { id: 'mock-staff-clerk', name: '李四', email: 'lisi@store.com', role: 'staff', pin: '5678' },
];

const orders: Order[] = [];
const idempotentOrders = new Map<string, { signature: string; order: Order }>();
let orderSeq = 0;
let customerSeq = customers.length;

// ---------- 多库位（演示：前场 = 商品实时库存，后仓 = 独立台账） ----------
const locations: StoreLocation[] = [
  { id: 'mock-location-front', name: '门店前场', isActive: true, isStoreDefault: true },
  { id: 'mock-location-warehouse', name: '后仓', isActive: true, isStoreDefault: false },
];
const FRONT_LOCATION_ID = locations[0].id;
const WAREHOUSE_LOCATION_ID = locations[1].id;
/** 后仓库存台账：key = v<variantId> 或 p<productId> */
const warehouseStock = new Map<string, number>();
function whKey(productId: string, variantId: string | null): string {
  return variantId !== null ? `v${variantId}` : `p${productId}`;
}
function whGet(productId: string, variantId: string | null): number {
  const k = whKey(productId, variantId);
  if (!warehouseStock.has(k)) warehouseStock.set(k, 10); // 演示：后仓默认各 10 件
  return warehouseStock.get(k)!;
}

// ---------- 采购单（演示：内存） ----------
const purchaseOrders: PurchaseOrder[] = [];
let poSeq = 0;

/** 主库存增减（前场） */
function bumpMainStock(productId: string, variantId: string | null, delta: number): void {
  const p = products.find((pp) => pp.id === productId);
  if (!p) return;
  if (variantId !== null) {
    const vv = p.variants.find((x) => x.id === variantId);
    if (vv && vv.stock !== null) vv.stock += delta;
  } else if (p.stock !== null) {
    p.stock += delta;
  }
}

function nextOrderNumber(): string {
  orderSeq += 1;
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `P${ym}-${String(orderSeq).padStart(4, '0')}`;
}

export class MockDataSource implements PosDataSource {
  readonly kind = 'mock' as const;
  private mockShift: PosShift | null = null;
  private mockCashMovements: PosCashMovement[] = [];
  private mockMovementKeys = new Map<string, PosCashMovement>();
  private mockCloseKeys = new Map<string, { shiftId: string; countedCents: number; result: PosShift }>();
  private mockAdjustmentKeys = new Map<string, string>();
  private mockTransferKeys = new Map<string, { signature: string; result: InventoryTransfer }>();
  private mockPurchaseOrderKeys = new Map<string, { signature: string; result: PurchaseOrder }>();
  private mockAuditRecords = new Map<string, string>();

  getSourceScope(): null {
    return null;
  }

  async ping(): Promise<PingResult> {
    await delay(80);
    return { ok: true, message: '演示模式：本地数据正常' };
  }

  async login(_email: string, _password: string) {
    await delay();
    return { token: 'mock-token', staff: staff[0] };
  }

  async fetchStaff() {
    await delay(60);
    return [...staff];
  }

  async getCurrentShift(): Promise<PosShift | null> {
    return this.mockShift?.status === 'open' ? { ...this.mockShift } : null;
  }

  async openShift(input: { openingFloatCents: number }): Promise<PosShift> {
    if (this.mockShift?.status === 'open') {
      throw new ApiError('A shift is already open', 409, undefined, 'SHIFT_ALREADY_OPEN');
    }
    this.mockCashMovements = [];
    this.mockMovementKeys.clear();
    this.mockCloseKeys.clear();
    this.mockShift = {
      id: createLocalUuid(),
      storeId: 'mock-store',
      openedBy: 'mock-staff-clerk',
      closedBy: null,
      status: 'open',
      openingFloatCents: input.openingFloatCents,
      expectedCashCents: null,
      countedCashCents: null,
      differenceCashCents: null,
      openedAt: new Date().toISOString(),
      closedAt: null,
    };
    return { ...this.mockShift };
  }

  async recordCashMovement(shiftId: string, input: {
    kind: 'in' | 'out'; amountCents: number; reason: string; idempotencyKey: string;
  }): Promise<PosCashMovement> {
    const replay = this.mockMovementKeys.get(input.idempotencyKey);
    if (replay) {
      if (
        replay.shiftId !== shiftId || replay.kind !== input.kind
        || replay.amountCents !== input.amountCents || replay.reason !== input.reason
      ) {
        throw new ApiError('Cash movement idempotency key was reused', 409, undefined, 'IDEMPOTENCY_KEY_REUSED');
      }
      return replay;
    }
    if (!this.mockShift || this.mockShift.id !== shiftId || this.mockShift.status !== 'open') {
      throw new ApiError('Shift not found', 404, undefined, 'SHIFT_NOT_FOUND');
    }
    const movement: PosCashMovement = {
      id: createLocalUuid(), shiftId, kind: input.kind, amountCents: input.amountCents,
      reason: input.reason, operatorId: 'mock-staff-clerk', idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    this.mockCashMovements.unshift(movement);
    this.mockMovementKeys.set(input.idempotencyKey, movement);
    return movement;
  }

  async closeShift(shiftId: string, input: {
    countedCents: number; idempotencyKey: string;
  }): Promise<PosShift> {
    const replay = this.mockCloseKeys.get(input.idempotencyKey);
    if (replay) {
      if (replay.shiftId !== shiftId || replay.countedCents !== input.countedCents) {
        throw new ApiError('Shift close idempotency key was reused', 409, undefined, 'IDEMPOTENCY_KEY_REUSED');
      }
      return { ...replay.result };
    }
    if (!this.mockShift || this.mockShift.id !== shiftId || this.mockShift.status !== 'open') {
      throw new ApiError('Shift not found', 404, undefined, 'SHIFT_NOT_FOUND');
    }
    const cashInCents = this.mockCashMovements
      .filter((movement) => movement.kind === 'in')
      .reduce((sum, movement) => sum + movement.amountCents, 0);
    const cashOutCents = this.mockCashMovements
      .filter((movement) => movement.kind === 'out')
      .reduce((sum, movement) => sum + movement.amountCents, 0);
    const expectedCashCents = this.mockShift.openingFloatCents + cashInCents - cashOutCents;
    const closed: PosShift = {
      ...this.mockShift,
      status: 'closed',
      closedBy: 'mock-staff-clerk',
      expectedCashCents,
      countedCashCents: input.countedCents,
      differenceCashCents: input.countedCents - expectedCashCents,
      closedAt: new Date().toISOString(),
      reconciliation: { cashSalesCents: 0, cashRefundCents: 0, cashInCents, cashOutCents },
    };
    this.mockShift = closed;
    this.mockCloseKeys.set(input.idempotencyKey, { shiftId, countedCents: input.countedCents, result: closed });
    return { ...closed };
  }

  async uploadAuditBatch(records: PosAuditUploadRecord[]): Promise<PosAuditUploadResult> {
    let accepted = 0;
    let duplicates = 0;
    for (const record of records) {
      const facts = JSON.stringify(record);
      const existing = this.mockAuditRecords.get(record.id);
      if (existing === undefined) {
        this.mockAuditRecords.set(record.id, facts);
        accepted += 1;
      } else if (existing === facts) {
        duplicates += 1;
      } else {
        throw new ApiError('Device audit UUID was reused with conflicting facts', 409, undefined, 'AUDIT_UUID_CONFLICT');
      }
    }
    return { accepted, duplicates };
  }

  async uploadTelemetryBatch(records: import('../types').PosTelemetryRecord[]) {
    return { accepted: records.length, duplicates: 0 };
  }

  async fetchApprovers() {
    await delay(60);
    return staff.filter((member) => member.role === 'admin' || member.role === 'manager');
  }

  async fetchProducts(query?: string) {
    await delay();
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return products.filter((p) => p.isActive);
    return products.filter(
      (p) =>
        p.isActive &&
        (p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.barcode ?? '').includes(q) ||
          p.variants.some(
            (vv) => (vv.sku ?? '').toLowerCase().includes(q) || (vv.barcode ?? '').includes(q)
          ))
    );
  }

  async findByBarcode(code: string) {
    await delay(60);
    const c = code.trim();
    if (!c) return null;
    for (const p of products) {
      if (!p.isActive) continue;
      if (p.barcode === c || p.sku === c) return { product: p, variant: null };
      const hit = p.variants.find((vv) => vv.barcode === c || vv.sku === c);
      if (hit) return { product: p, variant: hit };
    }
    return null;
  }

  async fetchCustomers(query?: string) {
    await delay();
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return [...customers];
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').includes(q)
    );
  }

  async createCustomer(input: { name: string; email?: string; phone?: string }) {
    await delay();
    const c: Customer = {
      id: `mock-customer-${++customerSeq}`, name: input.name,
      email: input.email || null, phone: input.phone || null, ordersCount: 0,
    };
    customers.unshift(c);
    return c;
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    await delay(200);
    if (!input.clientRef) {
      throw new ApiError('结账缺少幂等键', 400, undefined, 'CHECKOUT_IDEMPOTENCY_REQUIRED');
    }
    const signature = JSON.stringify(input);
    const replay = idempotentOrders.get(input.clientRef);
    if (replay) {
      if (replay.signature !== signature) {
        throw new ApiError('幂等键已被其他请求使用', 409, undefined, 'IDEMPOTENCY_KEY_REUSED');
      }
      return replay.order;
    }
    if (!staff.some((member) => member.id === input.staffId)) {
      throw new ApiError('操作员与结账请求不匹配', 403, undefined, 'OPERATOR_MISMATCH');
    }
    if (input.payments.length === 0) {
      throw new ApiError('至少需要一种支付方式', 400, undefined, 'PAYMENT_REQUIRED');
    }

    let authoritativeSubtotal = 0;
    let lineDiscountTotal = 0;
    for (const item of input.items) {
      const p = products.find((pp) => pp.id === item.productId);
      if (!p) throw new ApiError('商品不存在', 404, undefined, 'PRODUCT_NOT_FOUND');
      const variant = item.variantId ? p.variants.find((x) => x.id === item.variantId) : null;
      if (item.variantId && !variant) throw new ApiError('商品变体不存在', 404, undefined, 'VARIANT_NOT_FOUND');
      const authoritativePrice = variant?.priceCents ?? p.priceCents;
      if (authoritativePrice === null || authoritativePrice !== item.unitPriceCents) {
        throw new ApiError('服务端价格已变化', 409, { authoritativePrice }, 'PRICING_CHANGED');
      }
      const gross = authoritativePrice * item.qty;
      const lineDiscount = item.lineDiscountCents ?? 0;
      if (item.qty <= 0 || lineDiscount < 0 || lineDiscount > gross) {
        throw new ApiError('商品数量或行折扣无效', 400, undefined, 'LINE_INVALID');
      }
      const available = variant?.stock ?? p.stock;
      if (available !== null && available < item.qty) {
        throw new ApiError('库存不足', 409, { available }, 'INSUFFICIENT_INVENTORY');
      }
      authoritativeSubtotal += gross;
      lineDiscountTotal += lineDiscount;
    }
    const orderDiscount = input.discountCents - lineDiscountTotal;
    const authoritativeTotal = authoritativeSubtotal - input.discountCents + input.taxCents;
    const paymentTotal = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (input.subtotalCents !== authoritativeSubtotal || input.totalCents !== authoritativeTotal) {
      throw new ApiError('服务端价格已变化', 409, {
        subtotalCents: authoritativeSubtotal,
        totalCents: authoritativeTotal,
      }, 'PRICING_CHANGED');
    }
    if (orderDiscount < 0 || input.discountCents > authoritativeSubtotal) {
      throw new ApiError('订单折扣无效', 400, undefined, 'ORDER_DISCOUNT_INVALID');
    }
    if (paymentTotal !== authoritativeTotal) {
      throw new ApiError('支付合计与订单总额不一致', 409, undefined, 'PAYMENT_TOTAL_MISMATCH');
    }

    // 所有规则通过后才扣库存，保持失败无副作用。
    // 先按 (productId, variantId) 汇总需求再预检：逐行判断会让同一 SKU 的重复行绕过库存上限。
    const productNeed = new Map<string, { qty: number; stock: number | null }>();
    const variantNeed = new Map<string, { qty: number; stock: number | null }>();
    for (const item of input.items) {
      const p = products.find((pp) => pp.id === item.productId);
      if (!p) throw new ApiError('商品不存在', 400, undefined, 'PRODUCT_NOT_FOUND');
      if (item.variantId) {
        const vv = p.variants.find((x) => x.id === item.variantId);
        if (!vv) throw new ApiError('商品变体不存在', 400, undefined, 'PRODUCT_NOT_FOUND');
        const key = `${item.productId}\u0000${item.variantId}`;
        const need = variantNeed.get(key) ?? { qty: 0, stock: vv.stock };
        need.qty += item.qty;
        variantNeed.set(key, need);
      } else {
        const need = productNeed.get(item.productId) ?? { qty: 0, stock: p.stock };
        need.qty += item.qty;
        productNeed.set(item.productId, need);
      }
    }
    for (const need of variantNeed.values()) {
      if (need.stock !== null && need.stock < need.qty) {
        throw new ApiError('库存不足', 409, undefined, 'INSUFFICIENT_STOCK');
      }
    }
    for (const need of productNeed.values()) {
      if (need.stock !== null && need.stock < need.qty) {
        throw new ApiError('库存不足', 409, undefined, 'INSUFFICIENT_STOCK');
      }
    }
    for (const item of input.items) {
      const p = products.find((pp) => pp.id === item.productId)!;
      if (item.variantId) {
        const vv = p.variants.find((x) => x.id === item.variantId);
        if (vv && vv.stock !== null) vv.stock -= item.qty;
      } else if (p.stock !== null) {
        p.stock -= item.qty;
      }
    }
    const order: Order = {
      id: `m${Date.now()}`,
      number: nextOrderNumber(),
      createdAt: new Date().toISOString(),
      source: 'pos',
      staffName: input.staffName,
      customerId: input.customerId,
      customerName: input.customerName,
      note: input.note,
      items: input.items.map((i, idx) => ({ ...i, id: `mock-item-id-${Date.now()}-${idx}` })),
      itemCount: input.items.reduce((s, i) => s + i.qty, 0),
      subtotalCents: input.subtotalCents,
      discountCents: input.discountCents,
      taxCents: input.taxCents,
      totalCents: input.totalCents,
      payments: input.payments,
      status: 'completed',
      refundedCents: 0,
      promoLabel: input.promoLabel ?? null,
    };
    orders.unshift(order);
    idempotentOrders.set(input.clientRef, { signature, order });
    if (input.customerId) {
      const c = customers.find((cc) => cc.id === input.customerId);
      if (c) c.ordersCount = (c.ordersCount ?? 0) + 1;
    }
    return order;
  }

  async fetchOrders(query?: string, source: 'pos' | 'all' = 'pos') {
    await delay();
    const q = (query ?? '').trim().toLowerCase();
    let result = orders;
    if (source === 'pos') result = orders.filter(o => o.source === 'pos');
    if (!q) return [...result];
    return result.filter(
      (o) => o.number.toLowerCase().includes(q) || (o.customerName ?? '').toLowerCase().includes(q)
    );
  }

  async fetchOrdersPage(query: OrderPageQuery): Promise<Page<Order>> {
    const all = await this.fetchOrders(query.search, query.source === 'web' ? 'all' : query.source ?? 'pos');
    const filtered = all.filter((order) => {
      if (query.source === 'web' && order.source !== 'web') return false;
      if (query.customerId && order.customerId !== query.customerId) return false;
      if (query.fulfillmentStatus && (order.fulfillmentStatus ?? 'unfulfilled') !== query.fulfillmentStatus) return false;
      return true;
    });
    const pageSize = query.pageSize ?? 50;
    const offset = (query.page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize),
      page: query.page,
      pageSize,
      total: filtered.length,
      hasMore: offset + pageSize < filtered.length,
    };
  }

  async fetchRangeReport(query: PosReportQuery): Promise<PosRangeReport> {
    const start = new Date(`${query.dateFrom}T00:00:00`);
    const end = new Date(`${query.dateTo}T23:59:59.999`);
    const selected = orders.filter((order) => query.source === 'all' || !query.source || order.source === query.source);
    const report = aggregateRange(selected, start, end);
    const byPayment = report.byPayment.map((row, index) => ({
      method: row.label,
      label: row.label,
      grossCents: row.amountCents,
      refundedCents: index === 0 ? report.refundedCents : 0,
      netCents: row.amountCents - (index === 0 ? report.refundedCents : 0),
    }));
    return {
      store: { id: 'mock-store-1', name: 'Mock Store', timezoneOffset: '+00:00' },
      startKey: report.startKey, endKey: report.endKey, source: query.source ?? 'pos',
      grossCents: report.grossCents, refundedCents: report.refundedCents, refundsForOrdersCents: report.refundedCents,
      netCents: report.netCents, ordersCount: report.ordersCount, avgOrderCents: report.avgOrderCents,
      byPayment,
      byStaff: report.byStaff.map((row) => ({ staffId: null, name: row.name, orders: row.orders, grossCents: row.amountCents, refundedCents: row.refundedCents, netCents: row.amountCents - row.refundedCents })),
      topItems: itemSales(selected.filter((order) => new Date(order.createdAt) >= start && new Date(order.createdAt) <= end)),
      daily: dailySeries(selected, start, end),
      hourly: hourlyDistribution(selected).map((row) => ({ hour: row.hour, ordersCount: row.ordersCount, grossCents: row.amountCents })),
    };
  }

  async fetchOrder(id: string) {
    await delay(60);
    const o = orders.find((oo) => oo.id === id);
    if (!o) throw new Error('订单不存在');
    return o;
  }

  async refundOrder(id: string, input: RefundInput): Promise<Order> {
    await delay(200);
    const o = orders.find((oo) => oo.id === id);
    if (!o) throw new Error('订单不存在');
    const remaining = o.totalCents - o.refundedCents;
    if (input.amountCents <= 0 || input.amountCents > remaining) {
      throw new Error(`退款金额需在 0 与剩余可退 ${(remaining / 100).toFixed(2)} 之间`);
    }
    o.refundedCents += input.amountCents;
    o.status = o.refundedCents >= o.totalCents ? 'refunded' : 'partial_refund';
    if (input.restock) {
      if (input.items && input.items.length > 0) {
        // 按行退货：精确回补（换货/行级退货路径）
        for (const it of input.items) bumpMainStock(it.productId, it.variantId, it.qty);
      } else if (o.status === 'refunded') {
        // 仅金额退款：只有全额退款才整单回补（部分退款无法确定退了哪些行）
        for (const item of o.items) bumpMainStock(item.productId, item.variantId, item.qty);
      }
    }
    return o;
  }

  async exchangeOrder(input: ExchangeOrderInput): Promise<ExchangeOrderResult> {
    await delay(300);
    const original = orders.find((o) => o.id === input.originalOrderId);
    if (!original) throw new Error('原订单不存在');

    // Process returns & restock
    let grossReturnedCents = 0;
    for (const item of input.returnItems) {
      const origItem = original.items.find((it) => it.id === item.orderItemId || it.productId === item.orderItemId);
      if (!origItem) throw new Error('退货商品在原订单中不存在');
      if (item.qty > origItem.qty) throw new Error('退货数量超限');

      grossReturnedCents += origItem.unitPriceCents * item.qty;

      if (item.restock) {
        bumpMainStock(origItem.productId, origItem.variantId, item.qty);
      }
    }

    // 抵扣按实付比例摊销（与生产口径一致），打折订单不超额退
    const refundCents = Math.min(
      proratedCredit(grossReturnedCents, original.subtotalCents, original.totalCents),
      original.totalCents - original.refundedCents,
    );

    original.refundedCents += refundCents;
    original.status = original.refundedCents >= original.totalCents ? 'refunded' : 'partial_refund';

    // Create replacement order
    const replacementOrder = await this.createOrder(input.replacement);
    return {
      exchangeId: `mock-exchange-${Date.now()}`,
      originalOrderId: original.id,
      replacementOrder,
      refundAmountCents: refundCents,
      newOrderAmountCents: replacementOrder.totalCents,
      differenceAmountCents: Math.max(0, replacementOrder.totalCents - refundCents),
    };
  }

  async adjustStock(input: StockAdjustInput) {
    await delay();
    const signature = JSON.stringify({
      productId: input.productId, variantId: input.variantId, locationId: input.locationId ?? FRONT_LOCATION_ID,
      delta: input.delta, reason: input.reason, note: input.note,
    });
    const replay = this.mockAdjustmentKeys.get(input.clientRef);
    if (replay) {
      if (replay !== signature) {
        throw new ApiError('Idempotency key was reused with a different adjustment', 409, undefined, 'IDEMPOTENCY_KEY_REUSED');
      }
      return;
    }
    const p = products.find((pp) => pp.id === input.productId);
    if (!p) throw new Error('商品不存在');
    if ((input.locationId ?? FRONT_LOCATION_ID) === WAREHOUSE_LOCATION_ID) {
      // 后仓台账
      const k = whKey(input.productId, input.variantId);
      warehouseStock.set(k, whGet(input.productId, input.variantId) + input.delta);
      this.mockAdjustmentKeys.set(input.clientRef, signature);
      return;
    }
    if (input.variantId) {
      const vv = p.variants.find((x) => x.id === input.variantId);
      if (!vv) throw new Error('变体不存在');
      vv.stock = (vv.stock ?? 0) + input.delta;
    } else {
      p.stock = (p.stock ?? 0) + input.delta;
    }
    this.mockAdjustmentKeys.set(input.clientRef, signature);
  }

  async fetchCustomerOrders(customerId: string): Promise<Order[]> {
    await delay(60);
    return orders.filter((o) => o.customerId === customerId);
  }

  async fetchCustomerOrdersPage(customerId: string, query: { page: number; pageSize?: number }): Promise<Page<Order>> {
    return this.fetchOrdersPage({ page: query.page, pageSize: query.pageSize, source: 'all', customerId });
  }

  async updatePickupFulfillment(orderId: string, status: Exclude<PickupFulfillmentStatus, 'unfulfilled'>) {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error('订单不存在');
    const current = order.fulfillmentStatus ?? 'unfulfilled';
    const next: Record<string, string> = { unfulfilled: 'preparing', preparing: 'ready', ready: 'picked_up' };
    if (next[current] !== status || !order.pickupStoreId) throw new ApiError('非法自提状态转换', 409, undefined, 'PICKUP_TRANSITION_INVALID');
    order.fulfillmentStatus = status;
    if (status === 'ready') order.pickupReadyAt = new Date().toISOString();
    if (status === 'picked_up') order.pickedUpAt = new Date().toISOString();
    return { id: order.id, fulfillmentStatus: status };
  }

  // ---------- 多库位 ----------

  async fetchLocations(purpose: LocationPurpose): Promise<StoreLocation[]> {
    await delay(60);
    return purpose === 'inventory_transfer'
      ? [...locations]
      : locations.filter((location) => location.isActive && location.isStoreDefault);
  }

  async fetchStockByLocation(productId: string, variantId: string | null): Promise<LocationStock[]> {
    await delay(60);
    const p = products.find((pp) => pp.id === productId);
    if (!p) throw new Error('商品不存在');
    const main =
      variantId !== null ? p.variants.find((x) => x.id === variantId)?.stock ?? 0 : p.stock ?? 0;
    return [
      { locationId: FRONT_LOCATION_ID, locationName: locations[0].name, stock: main },
      { locationId: WAREHOUSE_LOCATION_ID, locationName: locations[1].name, stock: whGet(productId, variantId) },
    ];
  }

  async createInventoryTransfer(input: InventoryTransferInput): Promise<InventoryTransfer> {
    await delay();
    const signature = JSON.stringify(input);
    const replay = this.mockTransferKeys.get(input.clientRef);
    if (replay) {
      if (replay.signature !== signature) {
        throw new ApiError('Idempotency key was reused with a different transfer', 409, undefined, 'IDEMPOTENCY_KEY_REUSED');
      }
      return replay.result;
    }
    if (input.fromLocationId === input.toLocationId) throw new Error('调出与调入库位不能相同');
    for (const item of input.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('调拨数量无效');
      const available = input.fromLocationId === WAREHOUSE_LOCATION_ID
        ? whGet(item.productId, item.variantId)
        : item.variantId
          ? products.find((product) => product.id === item.productId)?.variants.find((variant) => variant.id === item.variantId)?.stock ?? 0
          : products.find((product) => product.id === item.productId)?.stock ?? 0;
      if (available < item.quantity) throw new Error('调出库位库存不足');
    }
    const result: InventoryTransfer = {
      id: createLocalUuid(),
      referenceNo: `MOCK-TR-${Date.now()}`,
      status: 'pending',
      storeId: 'mock-store',
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      operatorId: 'mock-staff-clerk',
      items: input.items.map((item) => ({ ...item })),
    };
    this.mockTransferKeys.set(input.clientRef, { signature, result });
    return result;
  }

  // ---------- 采购单 ----------

  async fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
    await delay(60);
    return [...purchaseOrders];
  }

  async createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    await delay();
    const signature = JSON.stringify(input);
    const replay = this.mockPurchaseOrderKeys.get(input.clientRef);
    if (replay) {
      if (replay.signature !== signature) {
        throw new ApiError('Idempotency key was reused with a different purchase order', 409, undefined, 'IDEMPOTENCY_KEY_REUSED');
      }
      return replay.result;
    }
    poSeq += 1;
    const po: PurchaseOrder = {
      id: `po${Date.now()}`,
      number: `PO-${String(poSeq).padStart(4, '0')}`,
      supplier: input.supplier,
      status: 'ordered',
      createdAt: new Date().toISOString(),
      receivedAt: null,
      locationId: input.locationId,
      items: input.items,
    };
    purchaseOrders.unshift(po);
    this.mockPurchaseOrderKeys.set(input.clientRef, { signature, result: po });
    return po;
  }

  async receivePurchaseOrder(id: string, _approvalToken?: string | null): Promise<PurchaseOrder> {
    await delay();
    const po = purchaseOrders.find((x) => x.id === id);
    if (!po) throw new Error('采购单不存在');
    if (po.status === 'received') return po;
    for (const it of po.items) {
      if ((po.locationId ?? FRONT_LOCATION_ID) === WAREHOUSE_LOCATION_ID) {
        const k = whKey(it.productId, it.variantId);
        warehouseStock.set(k, whGet(it.productId, it.variantId) + it.qty);
      } else {
        bumpMainStock(it.productId, it.variantId, it.qty);
      }
    }
    po.status = 'received';
    po.receivedAt = new Date().toISOString();
    return po;
  }
}

export { variantLabel };
