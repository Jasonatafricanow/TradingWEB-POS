// TradingWEB 对接适配器
// ------------------------------------------------------------------
// 对齐主站既有约定：
//   - Next.js API Routes，Bearer token 认证（auth-middleware）
//   - 业务校验错误 = 400 { error }（ValidationError），client.ts 已翻译
//   - products 携带 variants（option1/2/3、独立 price、sku）
//   - 下单按 variant 计价，unit_price/sku 快照进 order_items
//   - order_items.delivery_method 单值：POS 固定传 'in_store'
//     （需把 in_store 加入后端 delivery_method 白名单，见 docs/BACKEND_API.md）
//
// POS inventory, transfer, and purchasing writes use only authoritative /api/admin/pos/* contracts.
// 完整端点契约见 docs/BACKEND_API.md。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { centsToDecimalString, parseMoneyToCents } from '@/utils/money';
import { isRfc4122Uuid } from '@/utils/uuid';
import {
  buildPosCheckoutRequest,
  buildPosExchangeRequest,
  buildPosRefundRequest,
  hashPosApprovalRequest,
} from '@/services/posRequests';
import {
  buildPosInventoryAdjustmentRequest,
  buildPosInventoryTransferRequest,
  buildPosPurchaseOrderRequest,
  posPurchaseOrderReceiveKey,
} from '@/services/posInventoryRequests';
import { ApiError, HttpClient } from '../client';
import type { PosOrderDto } from '../contracts/pos';
import { variantLabel } from '../types';
import type {
  CreateOrderInput, CreatePurchaseOrderInput, Customer, LocationStock, Order, OrderItem,
  Payment, PingResult, PosDataSource, Product, ProductVariant, PurchaseOrder,
  PosPermission, RefundInput, Staff, StockAdjustInput, StoreLocation, ExchangeOrderInput, ExchangeOrderResult,
  PosAuditUploadRecord, PosAuditUploadResult, PosCashMovement, PosShift,
  PosSourceScope, InventoryRecord, InventoryTransferInput, InventoryTransfer,
  LocationPurpose,
} from '../types';

type Raw = Record<string, any>;
const PRODUCT_CACHE_KEY = 'twpos.products.cache.v2';

/** 兼容 {data: ...} 包装与直接返回两种风格 */
function unwrap(r: any): any {
  if (r && typeof r === 'object' && !Array.isArray(r) && 'data' in r) return (r as Raw).data;
  return r;
}

function asArray(r: any): Raw[] {
  const u = unwrap(r);
  if (Array.isArray(u)) return u;
  if (u && Array.isArray(u.items)) return u.items;
  if (u && Array.isArray(u.list)) return u.list;
  if (u && Array.isArray(u.products)) return u.products;
  if (u && Array.isArray(u.orders)) return u.orders;
  if (u && Array.isArray(u.customers)) return u.customers;
  return [];
}

function isMissingEndpoint(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
}

function splitMethods(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

const POS_PERMISSIONS = new Set<PosPermission>([
  'checkout', 'refund', 'exchange', 'discount', 'stock_adjust',
  'inventory_read', 'inventory_adjust', 'inventory_transfer',
  'purchase_order_read', 'purchase_order_create', 'purchase_order_receive',
]);

function splitPermissions(value: unknown): PosPermission[] {
  return splitMethods(value).filter((permission): permission is PosPermission =>
    POS_PERMISSIONS.has(permission as PosPermission));
}

const idOf = (value: unknown): string => String(value ?? '');
const nullableIdOf = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function invalidResponse(message: string, raw: unknown): never {
  throw new ApiError(`TradingWEB returned an invalid response: ${message}`, 502, raw, 'INVALID_RESPONSE');
}

function responseUuid(value: unknown, field: string, raw: unknown): string {
  if (typeof value !== 'string' || !isRfc4122Uuid(value)) invalidResponse(`${field} is not a UUID`, raw);
  return value;
}

function responseNullableUuid(value: unknown, field: string, raw: unknown): string | null {
  if (value === null) return null;
  return responseUuid(value, field, raw);
}

function responseTimestamp(value: unknown, field: string, raw: unknown): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    invalidResponse(`${field} is not an ISO timestamp`, raw);
  }
  return value;
}

function responseMoney(
  value: unknown,
  field: string,
  raw: unknown,
  options: { nullable?: boolean; positive?: boolean; allowNegative?: boolean } = {},
): number | null {
  if (value === null && options.nullable) return null;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    invalidResponse(`${field} is not a decimal money string`, raw);
  }
  const numeric = Number(value);
  const cents = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(cents)) {
    invalidResponse(`${field} is outside the supported money range`, raw);
  }
  if (!options.allowNegative && cents < 0) invalidResponse(`${field} must not be negative`, raw);
  if (options.positive && cents <= 0) invalidResponse(`${field} must be positive`, raw);
  return cents;
}

function responseCount(value: unknown, field: string, raw: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalidResponse(`${field} is not a non-negative integer`, raw);
  }
  return value;
}

function responseInteger(
  value: unknown,
  field: string,
  raw: unknown,
  options: { positive?: boolean; nonNegative?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    invalidResponse(`${field} is not an integer`, raw);
  }
  if (options.positive && value <= 0) invalidResponse(`${field} must be positive`, raw);
  if (options.nonNegative && value < 0) invalidResponse(`${field} must not be negative`, raw);
  return value;
}

function responseString(value: unknown, field: string, raw: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalidResponse(`${field} is empty`, raw);
  return value;
}

function responseNullableString(value: unknown, field: string, raw: unknown): string | null {
  if (value === null) return null;
  return responseString(value, field, raw);
}

function responseDataArray(response: unknown, label: string): Raw[] {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    invalidResponse(`${label} envelope is not an object`, response);
  }
  const data = (response as Raw).data;
  if (!Array.isArray(data)) invalidResponse(`${label} data is not an array`, response);
  return data;
}

function responseDataObject(response: unknown, label: string): Raw {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    invalidResponse(`${label} envelope is not an object`, response);
  }
  const data = (response as Raw).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    invalidResponse(`${label} data is not an object`, response);
  }
  return data;
}

function isValidCachedProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const product = value as Partial<Product>;
  if (typeof product.id !== 'string' || product.id.length === 0 || !Array.isArray(product.variants)) {
    return false;
  }
  return product.variants.every(
    (variant) =>
      typeof variant.id === 'string' &&
      variant.id.length > 0 &&
      typeof variant.productId === 'string' &&
      variant.productId.length > 0,
  );
}

export class TradingWebDataSource implements PosDataSource {
  readonly kind = 'tradingweb' as const;

  /** 商品缓存：条码本地兜底匹配 + 断网降级 */
  private productCache: Product[] = [];

  constructor(
    private http: HttpClient,
    private getPosContext: () => { storeId: string; pricingVersion: string } = () => ({ storeId: '', pricingVersion: '' }),
    private getScope: () => PosSourceScope | null = () => null,
  ) {}

  getSourceScope(): PosSourceScope | null {
    return this.getScope();
  }

  private async saveCache(list: Product[]): Promise<void> {
    try {
      await AsyncStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(list));
    } catch {
      // 缓存失败不影响主流程
    }
  }

  private async loadCache(): Promise<Product[] | null> {
    try {
      const raw = await AsyncStorage.getItem(PRODUCT_CACHE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const valid = parsed.filter(isValidCachedProduct);
      return valid.length > 0 ? valid : null;
    } catch {
      return null;
    }
  }

  // ---------- 映射 ----------

  private mapVariant(raw: Raw, productId: string): ProductVariant {
    return {
      id: idOf(raw.id ?? raw.variant_id ?? raw.variantId),
      productId,
      sku: raw.sku ?? null,
      barcode: raw.barcode ?? raw.sku ?? null,
      priceCents: parseMoneyToCents(raw.price),
      option1: raw.option1 ?? null,
      option2: raw.option2 ?? null,
      option3: raw.option3 ?? null,
      stock: raw.stock ?? raw.inventory ?? raw.quantity ?? null,
    };
  }

  private mapProduct(raw: Raw): Product {
    const id = idOf(raw.id ?? raw.product_id ?? raw.productId);
    const variants = (Array.isArray(raw.variants) ? raw.variants : []).map((x: Raw) =>
      this.mapVariant(x, id)
    );
    return {
      id,
      name: String(raw.name ?? raw.title ?? `商品#${id}`),
      priceCents: parseMoneyToCents(raw.price),
      type: (raw.type as Product['type']) ?? 'physical',
      image: raw.image ?? raw.image_url ?? raw.imageUrl ?? null,
      isActive: raw.is_active ?? raw.isActive ?? true,
      deliveryMethods: splitMethods(raw.delivery_methods ?? raw.delivery_method ?? raw.deliveryMethods),
      hasVariants: variants.length > 0,
      variants,
      sku: raw.sku ?? null,
      barcode: raw.barcode ?? raw.sku ?? null,
      stock: raw.stock ?? raw.inventory ?? null,
    };
  }

  private mapCustomer(raw: Raw): Customer {
    return {
      id: idOf(raw.id),
      name: String(raw.name ?? raw.email ?? `客户#${raw.id}`),
      email: raw.email ?? null,
      phone: raw.phone ?? null,
      ordersCount: raw.orders_count ?? raw.ordersCount,
    };
  }

  private mapPayment(raw: Raw): Payment {
    return {
      method: String(raw.method ?? 'custom'),
      label: String(raw.label ?? raw.method ?? '支付'),
      amountCents: parseMoneyToCents(raw.amount) ?? 0,
      ref: raw.reference ?? raw.ref ?? null,
    };
  }

  private mapOrderItem(raw: Raw): OrderItem {
    return {
      id: raw.id ? idOf(raw.id) : undefined,
      productId: idOf(raw.product_id ?? raw.productId),
      variantId: nullableIdOf(raw.variant_id ?? raw.variantId),
      name: String(raw.name ?? raw.product_name ?? '商品'),
      variantLabel: raw.variant_label ?? raw.variantLabel ?? null,
      sku: raw.sku ?? null,
      unitPriceCents: parseMoneyToCents(raw.unit_price ?? raw.unitPrice ?? raw.price) ?? 0,
      qty: Number(raw.quantity ?? raw.qty ?? 1),
      lineDiscountCents: parseMoneyToCents(raw.line_discount ?? raw.lineDiscount) ?? 0,
      deliveryMethod: String(raw.delivery_method ?? raw.deliveryMethod ?? 'in_store'),
    };
  }

  private mapOrder(raw: Raw): Order {
    const items = (Array.isArray(raw.items) ? raw.items : []).map((x: Raw) => this.mapOrderItem(x));
    const total = parseMoneyToCents(raw.total ?? raw.total_amount ?? raw.totalAmount) ?? 0;
    const refunded = parseMoneyToCents(raw.refunded_total ?? raw.refundedTotal) ?? 0;
    let status: Order['status'] = 'completed';
    if (raw.status === 'refunded' || (refunded > 0 && refunded >= total)) status = 'refunded';
    else if (raw.status === 'partial_refund' || refunded > 0) status = 'partial_refund';
    return {
      id: String(raw.id),
      number: String(raw.number ?? raw.order_no ?? raw.order_number ?? raw.orderNumber ?? raw.id),
      createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
      source: (raw.source === 'pos' ? 'pos' : raw.source === 'web' ? 'web' : 'pos'),
      staffName: raw.staff_name ?? raw.staffName ?? null,
      customerId: nullableIdOf(raw.customer_id ?? raw.customerId),
      customerName: raw.customer_name ?? raw.customerName ?? null,
      note: raw.note ?? null,
      items,
      itemCount: raw.item_count ?? raw.itemCount ?? items.reduce((s, i) => s + i.qty, 0),
      subtotalCents: parseMoneyToCents(raw.subtotal) ?? total,
      discountCents: parseMoneyToCents(raw.discount_total ?? raw.discountTotal) ?? 0,
      taxCents: parseMoneyToCents(raw.tax_total ?? raw.taxTotal) ?? 0,
      totalCents: total,
      payments: (Array.isArray(raw.payments) ? raw.payments : []).map((x: Raw) => this.mapPayment(x)),
      status,
      refundedCents: refunded,
      fulfillmentStatus: String(raw.fulfillment_status ?? raw.fulfillmentStatus ?? 'unfulfilled'),
      pickupContactName: raw.pickup_contact_name ?? raw.pickupContactName ?? null,
      pickupPhone: raw.pickup_phone ?? raw.pickupPhone ?? null,
      pickupStoreId: nullableIdOf(raw.pickup_store_id ?? raw.pickupStoreId),
      pickupReadyAt: raw.pickup_ready_at ?? raw.pickupReadyAt ?? null,
      pickedUpAt: raw.picked_up_at ?? raw.pickedUpAt ?? null,
      promoLabel: raw.promo_label ?? raw.promoLabel ?? null,
    };
  }

  /** 服务端只回了个 id 的最小实现时，用本地输入补全订单展示/打印所需字段 */
  private orderFromInput(input: CreateOrderInput, raw: Raw | null): Order {
    const id = raw?.id !== undefined ? String(raw.id) : `tw-${Date.now()}`;
    return {
      id,
      number: String(raw?.number ?? raw?.order_number ?? id),
      createdAt: String(raw?.created_at ?? new Date().toISOString()),
      source: 'pos',
      staffName: input.staffName,
      customerId: input.customerId,
      customerName: input.customerName,
      note: input.note,
      items: input.items,
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
  }

  private shortEntityLabel(prefix: string, id: string): string {
    return `${prefix} ${id.slice(0, 8)}`;
  }

  private mapInventoryRecord(raw: Raw): InventoryRecord {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalidResponse('inventory row is not an object', raw);
    }
    const storeId = responseUuid(raw.store_id, 'store_id', raw);
    const scope = this.getSourceScope();
    if (!scope || storeId !== scope.storeId) invalidResponse('inventory store does not match scope', raw);
    const locationId = responseUuid(raw.location_id, 'location_id', raw);
    const variantId = responseNullableUuid(raw.variant_id, 'variant_id', raw);
    const locationName = raw.location_name === undefined || raw.location_name === null
      ? this.shortEntityLabel('Location', locationId)
      : responseString(raw.location_name, 'location_name', raw);
    return {
      id: responseUuid(raw.id, 'id', raw),
      productId: responseUuid(raw.product_id, 'product_id', raw),
      variantId,
      storeId,
      locationId,
      locationName,
      stock: responseInteger(raw.stock, 'stock', raw),
      lowStockThreshold: responseInteger(raw.low_stock_threshold, 'low_stock_threshold', raw, { nonNegative: true }),
      productTitle: responseString(raw.product_title, 'product_title', raw),
      variantTitle: responseNullableString(raw.variant_title, 'variant_title', raw),
      sku: responseNullableString(raw.sku, 'sku', raw),
    };
  }

  private validateInventoryAdjustment(raw: Raw, input: StockAdjustInput): void {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalidResponse('inventory adjustment is not an object', raw);
    }
    const scope = this.getSourceScope();
    if (!scope) invalidResponse('inventory adjustment has no authenticated scope', raw);
    const storeId = responseUuid(raw.store_id, 'store_id', raw);
    const locationId = responseUuid(raw.location_id, 'location_id', raw);
    const productId = responseUuid(raw.product_id, 'product_id', raw);
    const variantId = responseNullableUuid(raw.variant_id, 'variant_id', raw);
    const delta = responseInteger(raw.delta, 'delta', raw);
    const beforeStock = responseInteger(raw.before_stock, 'before_stock', raw, { nonNegative: true });
    const afterStock = responseInteger(raw.after_stock, 'after_stock', raw, { nonNegative: true });
    const reason = responseString(raw.reason, 'reason', raw);
    const note = responseNullableString(raw.note, 'note', raw);
    responseUuid(raw.id, 'id', raw);
    responseUuid(raw.inventory_id, 'inventory_id', raw);
    responseUuid(raw.approved_by, 'approved_by', raw);
    const operatorId = responseUuid(raw.operator_id, 'operator_id', raw);
    if (
      storeId !== scope.storeId
      || operatorId !== scope.operatorId
      || locationId !== input.locationId
      || productId !== input.productId
      || variantId !== input.variantId
      || delta !== input.delta
      || reason !== input.reason
      || note !== input.note
      || afterStock - beforeStock !== delta
    ) {
      invalidResponse('inventory adjustment facts do not match request', raw);
    }
  }

  private mapPurchaseOrder(raw: Raw): PurchaseOrder {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalidResponse('purchase order is not an object', raw);
    }
    if (raw.status !== 'ordered' && raw.status !== 'received') {
      invalidResponse('purchase order status is invalid', raw);
    }
    const storeId = responseUuid(raw.store_id, 'store_id', raw);
    const scope = this.getSourceScope();
    if (!scope || storeId !== scope.storeId) invalidResponse('purchase order store does not match scope', raw);
    const status = raw.status as 'ordered' | 'received';
    const receivedBy = responseNullableUuid(raw.received_by, 'received_by', raw);
    const receivedAt = raw.received_at === null ? null : responseTimestamp(raw.received_at, 'received_at', raw);
    if (status === 'ordered' && (receivedBy !== null || receivedAt !== null)) {
      invalidResponse('ordered purchase order contains receipt facts', raw);
    }
    if (status === 'received' && (receivedBy === null || receivedAt === null)) {
      invalidResponse('received purchase order is missing receipt facts', raw);
    }
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      invalidResponse('purchase order items are missing', raw);
    }
    const items = raw.items.map((item: Raw) => {
      const productId = responseUuid(item.product_id, 'items.product_id', raw);
      const variantId = responseNullableUuid(item.variant_id, 'items.variant_id', raw);
      const orderedQty = responseInteger(item.ordered_qty, 'items.ordered_qty', raw, { positive: true });
      const receivedQty = responseInteger(item.received_qty, 'items.received_qty', raw, { nonNegative: true });
      if (receivedQty > orderedQty || (status === 'received' && receivedQty !== orderedQty)) {
        invalidResponse('purchase order received quantity is inconsistent', raw);
      }
      const unitCostCents = responseMoney(item.unit_cost, 'items.unit_cost', raw)!;
      const cachedProduct = this.productCache.find((product) => product.id === productId);
      const cachedVariant = cachedProduct?.variants.find((variant) => variant.id === variantId);
      return {
        id: responseUuid(item.id, 'items.id', raw),
        productId,
        variantId,
        name: cachedProduct?.name ?? this.shortEntityLabel('Product', productId),
        variantLabel: cachedVariant ? variantLabel(cachedVariant) || null : null,
        sku: cachedVariant?.sku ?? cachedProduct?.sku ?? null,
        qty: orderedQty,
        orderedQty,
        receivedQty,
        unitCostCents,
      };
    });
    return {
      id: responseUuid(raw.id, 'id', raw),
      number: responseString(raw.number, 'number', raw),
      supplier: responseString(raw.supplier, 'supplier', raw),
      status,
      createdAt: responseTimestamp(raw.created_at, 'created_at', raw),
      receivedAt,
      locationId: responseUuid(raw.location_id, 'location_id', raw),
      storeId,
      createdBy: responseUuid(raw.created_by, 'created_by', raw),
      receivedBy,
      items,
    };
  }

  // ---------- 接口实现 ----------

  async ping(): Promise<PingResult> {
    try {
      await this.http.get('/api/products?limit=1');
      return { ok: true, message: '已连接 TradingWEB' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async login(email: string, password: string) {
    const r: any = await this.http.post('/api/auth/login', { email, password });
    const u = unwrap(r) ?? {};
    const token: string | undefined = r?.token ?? u?.token;
    const user: Raw = r?.user ?? u?.user ?? u;
    if (!token) throw new ApiError('登录响应缺少 token，请核对 /api/auth/login 返回格式', 200, r);
    const staff: Staff = {
      id: idOf(user?.id),
      name: String(user?.name ?? user?.email ?? email),
      email: user?.email ?? email,
      role: (user?.role as Staff['role']) ?? 'staff',
      pin: null,
    };
    return { token, staff };
  }

  async fetchStaff(): Promise<Staff[]> {
    const r = await this.http.get('/api/admin/staff/me');
    const raw = unwrap(r) as Raw | null;
    if (!raw?.id) return [];
    const role: Staff['role'] = raw.role === 'admin' || raw.role === 'manager' ? raw.role : 'staff';
    return [{
      id: idOf(raw.id),
      name: String(raw.name ?? raw.email ?? `员工#${raw.id}`),
      email: raw.email ?? null,
      role,
      pin: null,
      storeId: nullableIdOf(raw.store_id ?? raw.storeId),
      permissions: splitPermissions(raw.pos_permissions ?? raw.permissions),
      posEnabled: raw.pos_enabled === true || raw.pos_enabled === 1,
      posPinConfigured: raw.pos_pin_configured === true,
      usesDefaultPin: false,
    }];
  }

  private mapShift(raw: Raw): PosShift {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidResponse('shift is not an object', raw);
    if (raw.status !== 'open' && raw.status !== 'closed') invalidResponse('shift status is invalid', raw);
    const status = raw.status as 'open' | 'closed';
    const openedAt = responseTimestamp(raw.opened_at, 'opened_at', raw);
    const openingFloatCents = responseMoney(raw.opening_float, 'opening_float', raw);
    const expectedCashCents = responseMoney(raw.expected_cash, 'expected_cash', raw, {
      nullable: status === 'open',
      allowNegative: true,
    });
    const countedCashCents = responseMoney(raw.counted_cash, 'counted_cash', raw, {
      nullable: status === 'open',
    });
    const differenceCashCents = responseMoney(raw.difference_cash, 'difference_cash', raw, {
      nullable: status === 'open',
      allowNegative: true,
    });
    let reconciliation: PosShift['reconciliation'];
    if (status === 'open') {
      if (
        raw.closed_by !== null || raw.closed_at !== null
        || expectedCashCents !== null || countedCashCents !== null || differenceCashCents !== null
        || (raw.reconciliation !== null && raw.reconciliation !== undefined)
      ) {
        invalidResponse('open shift contains closed reconciliation fields', raw);
      }
    } else {
      if (!raw.reconciliation || typeof raw.reconciliation !== 'object' || Array.isArray(raw.reconciliation)) {
        invalidResponse('closed shift reconciliation is missing', raw);
      }
      reconciliation = {
        cashSalesCents: responseMoney(raw.reconciliation.cash_sales, 'reconciliation.cash_sales', raw)!,
        cashRefundCents: responseMoney(raw.reconciliation.cash_refunds, 'reconciliation.cash_refunds', raw)!,
        cashInCents: responseMoney(raw.reconciliation.cash_in, 'reconciliation.cash_in', raw)!,
        cashOutCents: responseMoney(raw.reconciliation.cash_out, 'reconciliation.cash_out', raw)!,
      };
    }
    return {
      id: responseUuid(raw.id, 'id', raw),
      storeId: responseUuid(raw.store_id, 'store_id', raw),
      openedBy: responseUuid(raw.opened_by, 'opened_by', raw),
      closedBy: status === 'closed'
        ? responseUuid(raw.closed_by, 'closed_by', raw)
        : responseNullableUuid(raw.closed_by, 'closed_by', raw),
      status,
      openingFloatCents: openingFloatCents!,
      expectedCashCents,
      countedCashCents,
      differenceCashCents,
      openedAt,
      closedAt: status === 'closed' ? responseTimestamp(raw.closed_at, 'closed_at', raw) : null,
      ...(reconciliation ? { reconciliation } : {}),
    };
  }

  private mapCashMovement(raw: Raw): PosCashMovement {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalidResponse('cash movement is not an object', raw);
    }
    if (raw.kind !== 'in' && raw.kind !== 'out') invalidResponse('cash movement kind is invalid', raw);
    if (typeof raw.reason !== 'string' || !raw.reason.trim()) {
      invalidResponse('cash movement reason is empty', raw);
    }
    if (typeof raw.idempotency_key !== 'string' || !raw.idempotency_key.trim()) {
      invalidResponse('cash movement idempotency key is empty', raw);
    }
    return {
      id: responseUuid(raw.id, 'id', raw),
      shiftId: responseUuid(raw.shift_id, 'shift_id', raw),
      kind: raw.kind,
      amountCents: responseMoney(raw.amount, 'amount', raw, { positive: true })!,
      reason: raw.reason,
      operatorId: responseUuid(raw.operator_id, 'operator_id', raw),
      idempotencyKey: raw.idempotency_key,
      createdAt: responseTimestamp(raw.created_at, 'created_at', raw),
    };
  }

  async fetchApprovers(storeId: string): Promise<Staff[]> {
    const r = await this.http.get(
      `/api/admin/pos/approvers?store_id=${encodeURIComponent(storeId)}`,
    );
    return asArray(r).flatMap((raw) => {
      if (!raw?.id || !raw?.name || (raw.role !== 'admin' && raw.role !== 'manager')) return [];
      return [{
        id: idOf(raw.id),
        name: String(raw.name),
        role: raw.role,
        pin: null,
        storeId,
        usesDefaultPin: false,
      } satisfies Staff];
    });
  }

  async fetchProducts(query?: string): Promise<Product[]> {
    const q = (query ?? '').trim();
    try {
      const { storeId } = this.getPosContext();
      if (!storeId) throw new ApiError('请先选择门店并完成 POS bootstrap', 0, undefined, 'POS_STORE_REQUIRED');
      const r = await this.http.get(
        `/api/admin/pos/catalog?q=${encodeURIComponent(q)}&store_id=${encodeURIComponent(storeId)}`
      );
      const grouped = new Map<string, Product>();
      for (const raw of asArray(r)) {
        const productId = idOf(raw.product_id);
        let product = grouped.get(productId);
        if (!product) {
          product = {
            id: productId,
            name: String(raw.title ?? `商品#${productId}`),
            priceCents: parseMoneyToCents(raw.price) ?? 0,
            type: (raw.type as Product['type']) ?? 'physical',
            image: raw.image ?? null,
            isActive: true,
            deliveryMethods: ['in_store', 'pickup', 'ship'],
            hasVariants: false,
            variants: [],
            sku: raw.variant_id ? null : raw.sku ?? null,
            barcode: raw.variant_id ? null : raw.barcode ?? null,
            stock: raw.variant_id ? null : Number(raw.stock ?? 0),
          };
          grouped.set(productId, product);
        }
        if (raw.variant_id) {
          product.variants.push({
            id: idOf(raw.variant_id),
            productId,
            sku: raw.sku ?? null,
            barcode: raw.barcode ?? null,
            priceCents: parseMoneyToCents(raw.price) ?? 0,
            option1: raw.variant_title ?? null,
            option2: null,
            option3: null,
            stock: Number(raw.stock ?? 0),
          });
          product.hasVariants = true;
        }
      }
      const list = [...grouped.values()];
      if (!q) {
        this.productCache = list;
        this.saveCache(list); // 供冷启动断网降级
      }
      return list;
    } catch (e) {
      // 断网降级：无搜索词时返回上次成功拉取的商品（本地过滤搜索词也可支持）
      const cached = this.productCache.length > 0 ? this.productCache : await this.loadCache();
      if (cached && cached.length > 0) {
        this.productCache = cached;
        if (!q) return cached;
        const lq = q.toLowerCase();
        return cached.filter(
          (p) =>
            p.name.toLowerCase().includes(lq) ||
            (p.sku ?? '').toLowerCase().includes(lq) ||
            (p.barcode ?? '').includes(q) ||
            p.variants.some((v) => (v.sku ?? '').toLowerCase().includes(lq) || (v.barcode ?? '').includes(q))
        );
      }
      throw e;
    }
  }

  async findByBarcode(code: string) {
    const c = code.trim();
    if (!c) return null;
    // POS catalog 同时支持名称、SKU 与条码；本地再做精确匹配。
    const candidates = [...(await this.fetchProducts(c)), ...this.productCache];
    for (const p of candidates) {
      if (p.barcode === c || p.sku === c) return { product: p, variant: null };
      const hit = p.variants.find((vv) => vv.barcode === c || vv.sku === c);
      if (hit) return { product: p, variant: hit };
    }
    return null;
  }

  async fetchCustomers(query?: string): Promise<Customer[]> {
    const q = (query ?? '').trim();
    try {
      const r = await this.http.get(
        `/api/customers?limit=50${q ? `&search=${encodeURIComponent(q)}` : ''}`
      );
      return asArray(r).map((x) => this.mapCustomer(x));
    } catch (e) {
      if (isMissingEndpoint(e)) return [];
      throw e;
    }
  }

  async createCustomer(input: { name: string; email?: string; phone?: string }) {
    const r = await this.http.post('/api/customers', {
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
    });
    return this.mapCustomer(unwrap(r) ?? {});
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const { storeId, pricingVersion } = this.getPosContext();
    if (!storeId || !pricingVersion) {
      throw new ApiError('请先完成门店 bootstrap', 0, undefined, 'POS_BOOTSTRAP_REQUIRED');
    }
    const body = buildPosCheckoutRequest(input, storeId, pricingVersion);
    const raw = await this.http.post<{ data: PosOrderDto }>('/api/admin/pos/checkout', body);
    return this.mapOrder(unwrap(raw));
  }

  async fetchOrders(query?: string, source: 'pos' | 'all' = 'pos'): Promise<Order[]> {
    return (await this.fetchOrdersPage({ page: 1, pageSize: 50, source, search: query })).items;
  }

  async fetchOrdersPage(query: import('../types').OrderPageQuery): Promise<import('../types').Page<Order>> {
    const params = new URLSearchParams();
    params.set('page', String(query.page));
    params.set('page_size', String(query.pageSize ?? 50));
    params.set('source', query.source ?? 'pos');
    if (query.search?.trim()) params.set('search', query.search.trim());
    if (query.customerId) params.set('customer_id', query.customerId);
    if (query.dateFrom) params.set('date_from', query.dateFrom);
    if (query.dateTo) params.set('date_to', query.dateTo);
    if (query.fulfillmentStatus) params.set('fulfillment_status', query.fulfillmentStatus);
    const response = responseDataObject(await this.http.get(`/api/admin/pos/orders?${params.toString()}`), 'order page');
    if (!Array.isArray(response.items)) invalidResponse('order page items are missing', response);
    const page = Number(response.page);
    const pageSize = Number(response.page_size);
    const total = Number(response.total);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(total) || total < 0 || typeof response.has_more !== 'boolean') {
      invalidResponse('order page metadata is invalid', response);
    }
    return { items: response.items.map((item: Raw) => this.mapOrder(item)), page, pageSize, total, hasMore: response.has_more };
  }

  async fetchRangeReport(query: import('../types').PosReportQuery): Promise<import('../types').PosRangeReport> {
    const params = new URLSearchParams();
    params.set('date_from', query.dateFrom);
    params.set('date_to', query.dateTo);
    params.set('source', query.source ?? 'pos');
    if (query.staffId) params.set('staff_id', query.staffId);
    const raw = responseDataObject(await this.http.get(`/api/admin/pos/reports?${params.toString()}`), 'range report');
    const amount = (value: unknown, field: string) => {
      const cents = typeof value === 'string' || typeof value === 'number' || value === null || value === undefined
        ? parseMoneyToCents(value)
        : null;
      if (cents === null) invalidResponse(`range report ${field} is invalid`, raw);
      return cents;
    };
    if (!raw.store || typeof raw.store !== 'object' || Array.isArray(raw.store)) invalidResponse('range report store is invalid', raw);
    if (!Array.isArray(raw.by_payment_method) || !Array.isArray(raw.by_staff) || !Array.isArray(raw.top_items) || !Array.isArray(raw.daily) || !Array.isArray(raw.hourly)) {
      invalidResponse('range report series are invalid', raw);
    }
    const report: import('../types').PosRangeReport = {
      store: { id: idOf(raw.store.id), name: String(raw.store.name), timezoneOffset: String(raw.store.timezone_offset) },
      startKey: String(raw.date_from), endKey: String(raw.date_to), source: raw.source as 'pos' | 'web' | 'all',
      grossCents: amount(raw.gross, 'gross'), refundedCents: amount(raw.refunded, 'refunded'),
      refundsForOrdersCents: amount(raw.refunds_for_orders_in_period, 'refunds_for_orders_in_period'), netCents: amount(raw.net, 'net'),
      ordersCount: Number(raw.order_count), avgOrderCents: amount(raw.aov, 'aov'),
      byPayment: raw.by_payment_method.map((row: Raw) => ({ method: String(row.method), label: String(row.label), grossCents: amount(row.gross_amount, 'by_payment.gross'), refundedCents: amount(row.refunded_amount, 'by_payment.refunded'), netCents: amount(row.net_amount, 'by_payment.net') })),
      byStaff: raw.by_staff.map((row: Raw) => ({ staffId: nullableIdOf(row.staff_id), name: String(row.name), orders: Number(row.order_count), grossCents: amount(row.gross_amount, 'by_staff.gross'), refundedCents: amount(row.refunded_amount, 'by_staff.refunded'), netCents: amount(row.net_amount, 'by_staff.net') })),
      topItems: raw.top_items.map((row: Raw) => ({ name: String(row.name), qty: Number(row.quantity), amountCents: amount(row.gross_amount, 'top_items.gross') })),
      daily: raw.daily.map((row: Raw) => ({ dateKey: String(row.date), ordersCount: Number(row.order_count), grossCents: amount(row.gross_amount, 'daily.gross'), refundedCents: amount(row.refunded_amount, 'daily.refunded'), netCents: amount(row.net_amount, 'daily.net') })),
      hourly: raw.hourly.map((row: Raw) => ({ hour: Number(row.hour), ordersCount: Number(row.order_count), grossCents: amount(row.gross_amount, 'hourly.gross') })),
    };
    const paymentNet = report.byPayment.reduce((sum, row) => sum + row.netCents, 0);
    const dailyNet = report.daily.reduce((sum, row) => sum + row.netCents, 0);
    if (report.grossCents - report.refundedCents !== report.netCents || paymentNet !== report.netCents || dailyNet !== report.netCents || !Number.isInteger(report.ordersCount) || report.ordersCount < 0) {
      invalidResponse('range report totals do not reconcile', raw);
    }
    return report;
  }

  async fetchOrder(id: string): Promise<Order> {
    const r = await this.http.get(`/api/admin/pos/orders/${encodeURIComponent(id)}`);
    return this.mapOrder(unwrap(r) ?? {});
  }

  async refundOrder(id: string, input: RefundInput): Promise<Order> {
    const { storeId } = this.getPosContext();
    if (!storeId) throw new ApiError('请先完成门店 bootstrap', 0, undefined, 'POS_BOOTSTRAP_REQUIRED');
    const { body } = buildPosRefundRequest(id, input, storeId);
    await this.http.post(`/api/admin/pos/orders/${encodeURIComponent(id)}/refunds`, body);
    return this.fetchOrder(id);
  }

  async adjustStock(input: StockAdjustInput): Promise<void> {
    const { storeId } = this.getPosContext();
    if (!storeId) throw new ApiError('请先完成门店 bootstrap', 0, undefined, 'POS_BOOTSTRAP_REQUIRED');
    if (typeof input.approvalToken !== 'string' || !input.approvalToken.trim()) {
      throw new ApiError('库存调整需要服务器店长审批', 403, undefined, 'APPROVAL_REQUIRED');
    }
    if (!input.locationId) throw new ApiError('库存调整需要选择库位', 400, undefined, 'LOCATION_REQUIRED');
    const { body } = buildPosInventoryAdjustmentRequest(input, storeId);
    const response = await this.http.post('/api/admin/pos/inventory/adjustments', body);
    this.validateInventoryAdjustment(responseDataObject(response, 'inventory adjustment'), input);
  }

  async fetchCustomerOrders(customerId: string): Promise<Order[]> {
    return (await this.fetchCustomerOrdersPage(customerId, { page: 1, pageSize: 50 })).items;
  }

  async fetchCustomerOrdersPage(customerId: string, query: { page: number; pageSize?: number }): Promise<import('../types').Page<Order>> {
    return this.fetchOrdersPage({ page: query.page, pageSize: query.pageSize, source: 'all', customerId });
  }

  async updatePickupFulfillment(orderId: string, status: 'preparing' | 'ready' | 'picked_up') {
    const response = responseDataObject(await this.http.patch(
      `/api/admin/pos/orders/${encodeURIComponent(orderId)}/fulfillment`,
      { fulfillment_status: status },
    ), 'pickup fulfillment');
    if (String(response.id) !== orderId || !['preparing', 'ready', 'picked_up'].includes(String(response.fulfillment_status))) {
      invalidResponse('pickup fulfillment response is invalid', response);
    }
    return { id: String(response.id), fulfillmentStatus: String(response.fulfillment_status) as 'preparing' | 'ready' | 'picked_up' };
  }

  // ---------- 多库位（TradingWEB 权威 POS 端点） ----------

  async fetchLocations(purpose: LocationPurpose): Promise<StoreLocation[]> {
    const response = await this.http.get(
      `/api/admin/pos/inventory/locations?purpose=${encodeURIComponent(purpose)}`,
    );
    return responseDataArray(response, 'inventory locations').map((raw) => {
      if (typeof raw.is_active !== 'boolean' || typeof raw.is_store_default !== 'boolean') {
        invalidResponse('inventory location flags are invalid', raw);
      }
      return {
        id: responseUuid(raw.id, 'id', raw),
        name: responseString(raw.name, 'name', raw),
        type: responseString(raw.type, 'type', raw),
        isActive: raw.is_active,
        isStoreDefault: raw.is_store_default,
      };
    });
  }

  async fetchStockByLocation(productId: string, variantId: string | null): Promise<LocationStock[]> {
    const response = await this.http.get('/api/admin/pos/inventory');
    return responseDataArray(response, 'inventory')
      .map((raw) => this.mapInventoryRecord(raw))
      .filter((inventory) => inventory.productId === productId && inventory.variantId === variantId)
      .map((inventory) => ({
        locationId: inventory.locationId,
        locationName: inventory.locationName,
        stock: inventory.stock,
      }));
  }

  async createInventoryTransfer(input: InventoryTransferInput): Promise<InventoryTransfer> {
    const { storeId } = this.getPosContext();
    if (!storeId) throw new ApiError('请先完成门店 bootstrap', 0, undefined, 'POS_BOOTSTRAP_REQUIRED');
    const body = buildPosInventoryTransferRequest(input, storeId);
    const raw = responseDataObject(
      await this.http.post('/api/admin/pos/inventory/transfers', body),
      'inventory transfer',
    );
    if (raw.status !== 'pending') invalidResponse('inventory transfer status is invalid', raw);
    const scope = this.getSourceScope();
    if (!scope) invalidResponse('inventory transfer has no authenticated scope', raw);
    const responseStoreId = responseUuid(raw.store_id, 'store_id', raw);
    const fromLocationId = responseUuid(raw.from_location_id, 'from_location_id', raw);
    const toLocationId = responseUuid(raw.to_location_id, 'to_location_id', raw);
    const operatorId = responseUuid(raw.operator_id, 'operator_id', raw);
    if (!Array.isArray(raw.items) || raw.items.length !== input.items.length) {
      invalidResponse('inventory transfer items do not match request', raw);
    }
    const items = raw.items.map((item: Raw) => ({
      productId: responseUuid(item.product_id, 'items.product_id', raw),
      variantId: responseNullableUuid(item.variant_id, 'items.variant_id', raw),
      quantity: responseInteger(item.quantity, 'items.quantity', raw, { positive: true }),
    }));
    if (
      responseStoreId !== scope.storeId
      || fromLocationId !== input.fromLocationId
      || toLocationId !== input.toLocationId
      || operatorId !== scope.operatorId
      || items.some((item, index) => {
        const expected = input.items[index];
        return item.productId !== expected.productId
          || item.variantId !== expected.variantId
          || item.quantity !== expected.quantity;
      })
    ) {
      invalidResponse('inventory transfer facts do not match request', raw);
    }
    return {
      id: responseUuid(raw.id, 'id', raw),
      referenceNo: responseString(raw.reference_no, 'reference_no', raw),
      status: 'pending',
      storeId: responseStoreId,
      fromLocationId,
      toLocationId,
      operatorId,
      items,
    };
  }

  // ---------- 采购单（可选端点） ----------

  async fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
    const response = await this.http.get('/api/admin/pos/purchase-orders');
    return responseDataArray(response, 'purchase orders').map((raw) => this.mapPurchaseOrder(raw));
  }

  async createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    const { storeId } = this.getPosContext();
    if (!storeId) throw new ApiError('请先完成门店 bootstrap', 0, undefined, 'POS_BOOTSTRAP_REQUIRED');
    const body = buildPosPurchaseOrderRequest(input, storeId);
    const response = await this.http.post('/api/admin/pos/purchase-orders', body);
    const order = this.mapPurchaseOrder(responseDataObject(response, 'purchase order'));
    const scope = this.getSourceScope();
    if (
      !scope
      || order.createdBy !== scope.operatorId
      || order.locationId !== input.locationId
      || order.supplier !== input.supplier
      || order.items.length !== input.items.length
      || order.items.some((item, index) => {
        const expected = input.items[index];
        return item.productId !== expected.productId
          || item.variantId !== expected.variantId
          || item.orderedQty !== expected.qty
          || item.unitCostCents !== expected.unitCostCents;
      })
    ) {
      invalidResponse('created purchase order facts do not match request', response);
    }
    return order;
  }

  async receivePurchaseOrder(id: string, approvalToken?: string | null): Promise<PurchaseOrder> {
    const { storeId } = this.getPosContext();
    if (!storeId) throw new ApiError('请先完成门店 bootstrap', 0, undefined, 'POS_BOOTSTRAP_REQUIRED');
    const response = await this.http.post(
      `/api/admin/pos/purchase-orders/${encodeURIComponent(id)}/receive`,
      {
        idempotency_key: posPurchaseOrderReceiveKey(id),
        store_id: storeId,
        approval_token: approvalToken ?? null,
      },
    );
    const order = this.mapPurchaseOrder(responseDataObject(response, 'received purchase order'));
    const scope = this.getSourceScope();
    if (!scope || order.id !== id || order.status !== 'received' || order.receivedBy !== scope.operatorId) {
      invalidResponse('received purchase order facts do not match request', response);
    }
    return order;
  }

  async getCurrentShift(): Promise<PosShift | null> {
    const raw = unwrap(await this.http.get('/api/admin/pos/shifts/current'));
    if (raw === null) return null;
    const shift = this.mapShift(raw);
    if (shift.status !== 'open') invalidResponse('current shift is not open', raw);
    const scope = this.getSourceScope();
    if (scope && shift.storeId !== scope.storeId) invalidResponse('current shift store does not match scope', raw);
    return shift;
  }

  async openShift(input: { openingFloatCents: number }): Promise<PosShift> {
    const raw = unwrap(await this.http.post('/api/admin/pos/shifts', {
      opening_float: centsToDecimalString(input.openingFloatCents),
    }));
    const shift = this.mapShift(raw);
    const scope = this.getSourceScope();
    if (shift.status !== 'open') invalidResponse('opened shift is not open', raw);
    if (scope && (shift.storeId !== scope.storeId || shift.openedBy !== scope.operatorId)) {
      invalidResponse('opened shift identity does not match scope', raw);
    }
    return shift;
  }

  async recordCashMovement(shiftId: string, input: {
    kind: 'in' | 'out'; amountCents: number; reason: string; idempotencyKey: string;
  }): Promise<PosCashMovement> {
    const raw = unwrap(await this.http.post(
      `/api/admin/pos/shifts/${encodeURIComponent(shiftId)}/cash-movements`,
      {
        kind: input.kind,
        amount: centsToDecimalString(input.amountCents),
        reason: input.reason,
        idempotency_key: input.idempotencyKey,
      },
    ));
    const movement = this.mapCashMovement(raw);
    const scope = this.getSourceScope();
    if (
      movement.shiftId !== shiftId
      || movement.kind !== input.kind
      || movement.amountCents !== input.amountCents
      || movement.reason !== input.reason
      || movement.idempotencyKey !== input.idempotencyKey
      || (scope && movement.operatorId !== scope.operatorId)
    ) {
      invalidResponse('cash movement facts do not match request', raw);
    }
    return movement;
  }

  async closeShift(shiftId: string, input: {
    countedCents: number; idempotencyKey: string;
  }): Promise<PosShift> {
    const raw = unwrap(await this.http.post(
      `/api/admin/pos/shifts/${encodeURIComponent(shiftId)}/close`,
      {
        counted_cash: centsToDecimalString(input.countedCents),
        idempotency_key: input.idempotencyKey,
      },
    ));
    const shift = this.mapShift(raw);
    const scope = this.getSourceScope();
    const reconciliation = shift.reconciliation;
    const reconciledExpectedCents = reconciliation
      ? shift.openingFloatCents
        + reconciliation.cashSalesCents
        - reconciliation.cashRefundCents
        + reconciliation.cashInCents
        - reconciliation.cashOutCents
      : null;
    if (
      !scope
      || shift.id !== shiftId
      || shift.status !== 'closed'
      || shift.storeId !== scope.storeId
      || shift.closedBy !== scope.operatorId
      || shift.countedCashCents !== input.countedCents
      || shift.expectedCashCents === null
      || shift.differenceCashCents === null
      || shift.differenceCashCents !== shift.countedCashCents - shift.expectedCashCents
      || reconciledExpectedCents === null
      || shift.expectedCashCents !== reconciledExpectedCents
    ) {
      invalidResponse('closed shift facts do not match request', raw);
    }
    return shift;
  }

  async uploadAuditBatch(records: PosAuditUploadRecord[]): Promise<PosAuditUploadResult> {
    const raw = unwrap(await this.http.post('/api/admin/pos/audit-logs/batch', { records }));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalidResponse('audit acknowledgement is not an object', raw);
    }
    return {
      accepted: responseCount(raw.accepted, 'accepted', raw),
      duplicates: responseCount(raw.duplicates, 'duplicates', raw),
    };
  }

  async uploadTelemetryBatch(records: import('../types').PosTelemetryRecord[]): Promise<import('../types').PosTelemetryResult> {
    const raw = unwrap(await this.http.post('/api/admin/pos/telemetry', { records }));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidResponse('telemetry acknowledgement is not an object', raw);
    return { accepted: responseCount(raw.accepted, 'accepted', raw), duplicates: responseCount(raw.duplicates, 'duplicates', raw) };
  }

  async exchangeOrder(input: ExchangeOrderInput): Promise<ExchangeOrderResult> {
    const { storeId, pricingVersion } = this.getPosContext();
    if (!storeId || !pricingVersion) {
      throw new ApiError('请先完成门店 bootstrap', 0, undefined, 'POS_BOOTSTRAP_REQUIRED');
    }

    const { body } = buildPosExchangeRequest(input, storeId, pricingVersion);

    const raw = await this.http.post<{ data: Raw }>('/api/admin/pos/exchanges', body);
    const data = unwrap(raw);
    return {
      exchangeId: String(data.exchange_id),
      originalOrderId: String(data.original_order_id),
      replacementOrder: this.mapOrder(data.replacement_order),
      refundAmountCents: parseMoneyToCents(data.refund_amount) ?? 0,
      newOrderAmountCents: parseMoneyToCents(data.new_order_amount) ?? 0,
      differenceAmountCents: parseMoneyToCents(data.difference_amount) ?? 0,
    };
  }
}

export { hashPosApprovalRequest, variantLabel };
