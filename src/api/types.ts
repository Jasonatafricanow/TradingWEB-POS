// 领域模型：与 TradingWEB 的 products / product_variants / orders / order_items 对齐。
// 金额一律为"分"(int)；后端 decimal 字符串在 adapter 层转换。

import type { CartDiscount } from '@/utils/money';

export type DataSourceKind = 'mock' | 'tradingweb';
export type EntityId = string;
export type PosPermission =
  | 'checkout'
  | 'refund'
  | 'exchange'
  | 'discount'
  | 'stock_adjust'
  | 'inventory_read'
  | 'inventory_adjust'
  | 'inventory_transfer'
  | 'purchase_order_read'
  | 'purchase_order_create'
  | 'purchase_order_receive';

export interface Staff {
  id: EntityId;
  name: string;
  email?: string | null;
  role: 'admin' | 'manager' | 'staff';
  /** 传输字段：后端 pos_pin。进入 auth store 时即被剥离，只保留哈希 */
  pin?: string | null;
  /** 加盐迭代 PIN 哈希：sha256$<iter>$<salt>$<digest>（见 utils/hash.ts）；本地只落盘哈希 */
  pinHash?: string | null;
  /** 仅 Mock/遗留本地员工可使用默认 PIN；TradingWEB 不得设置为 true。 */
  usesDefaultPin?: boolean;
  storeId?: EntityId | null;
  permissions?: PosPermission[];
  posEnabled?: boolean;
  posPinConfigured?: boolean;
}

export interface ProductVariant {
  id: EntityId;
  productId: EntityId;
  sku: string | null;
  /** 独立条码；TradingWEB 暂无 barcode 列时 adapter 以 sku 兜底 */
  barcode: string | null;
  /** 变体独立价（TradingWEB: product_variants.price）；null = 未设置 */
  priceCents: number | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  stock: number | null;
}

export function variantLabel(v: ProductVariant): string {
  return [v.option1, v.option2, v.option3].filter(Boolean).join(' / ');
}

export interface Product {
  id: EntityId;
  name: string;
  /** 展示/兜底价（TradingWEB: products.price）；有变体时下单一律用变体价 */
  priceCents: number | null;
  type: 'physical' | 'service' | 'virtual';
  image: string | null;
  isActive: boolean;
  deliveryMethods: string[];
  hasVariants: boolean;
  variants: ProductVariant[];
  /** 无变体商品的产品级条码/SKU */
  sku: string | null;
  barcode: string | null;
  stock: number | null;
}

export interface Customer {
  id: EntityId;
  name: string;
  email: string | null;
  phone: string | null;
  ordersCount?: number;
}

export interface Payment {
  method: string; // cash / card / wechat / alipay / custom...
  label: string;
  amountCents: number;
  ref?: string | null;
}

export interface OrderItem {
  id?: string; // Order item ID from DB (used for refunds/exchanges)
  productId: EntityId;
  variantId: EntityId | null;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  unitPriceCents: number; // 快照，与 order_items.unit_price 对齐
  qty: number;
  /** 行级折扣（该行合计减免的分）；对应 order_items.line_discount */
  lineDiscountCents?: number;
  /** in_store（门店购买）/ pickup（到店自提）/ ship（门店发货），需后端白名单支持 */
  deliveryMethod: string;
}

export type OrderStatus = 'completed' | 'partial_refund' | 'refunded';
export type PickupFulfillmentStatus = 'unfulfilled' | 'preparing' | 'ready' | 'picked_up';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface OrderPageQuery {
  page: number;
  pageSize?: number;
  source?: 'pos' | 'web' | 'all';
  search?: string;
  customerId?: EntityId;
  dateFrom?: string;
  dateTo?: string;
  fulfillmentStatus?: string;
}

export interface PosReportQuery {
  dateFrom: string;
  dateTo: string;
  source?: 'pos' | 'web' | 'all';
  staffId?: EntityId;
}

export interface PosRangeReport {
  store: { id: EntityId; name: string; timezoneOffset: string };
  startKey: string;
  endKey: string;
  source: 'pos' | 'web' | 'all';
  grossCents: number;
  refundedCents: number;
  refundsForOrdersCents: number;
  netCents: number;
  ordersCount: number;
  avgOrderCents: number;
  byPayment: { method: string; label: string; grossCents: number; refundedCents: number; netCents: number }[];
  byStaff: { staffId: EntityId | null; name: string; orders: number; grossCents: number; refundedCents: number; netCents: number }[];
  topItems: { name: string; qty: number; amountCents: number }[];
  daily: { dateKey: string; ordersCount: number; grossCents: number; refundedCents: number; netCents: number }[];
  hourly: { hour: number; ordersCount: number; grossCents: number }[];
}

export interface Order {
  id: string;
  number: string;
  createdAt: string; // ISO
  source: 'pos' | 'web';
  staffName: string | null;
  customerId: EntityId | null;
  customerName: string | null;
  note: string | null;
  items: OrderItem[];
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  payments: Payment[];
  status: OrderStatus;
  refundedCents: number;
  fulfillmentStatus?: string;
  pickupContactName?: string | null;
  pickupPhone?: string | null;
  pickupStoreId?: EntityId | null;
  pickupReadyAt?: string | null;
  pickedUpAt?: string | null;
  /** 命中的满减活动文案（小票展示用） */
  promoLabel?: string | null;
}

export interface CreateOrderInput {
  /** 客户端幂等键：服务端按此去重，防止断网重传导致重复订单（见 BACKEND_API.md） */
  clientRef?: string;
  staffId: EntityId;
  staffName: string;
  customerId: EntityId | null;
  customerName: string | null;
  note: string | null;
  currency: string;
  items: OrderItem[];
  discount: CartDiscount | null;
  /** 命中的满减活动文案 */
  promoLabel?: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  payments: Payment[];
  // 结构化履约信息
  buyerName?: string | null;
  buyerPhone?: string | null;
  deliveryDate?: string | null;
  deliveryTimeSlot?: string | null;
  shippingAddress?: {
    address_line1: string;
    address_line2?: string | null;
    city: string;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
}

export interface RefundInput {
  /** Stable across retries; maps to the Task 8 refund idempotency key. */
  clientRef: string;
  amountCents: number;
  reason: string;
  restock: boolean;
  returnItems: ExchangeReturnItemInput[];
  approvalToken: string | null;
  /** Mock-mode inventory compatibility; TradingWEB uses returnItems with order item IDs. */
  items?: { productId: EntityId; variantId: EntityId | null; qty: number }[];
}

export interface StockAdjustInput {
  /** Stable across retries; maps to the Task 11 adjustment idempotency key. */
  clientRef: string;
  productId: EntityId;
  variantId: EntityId | null;
  delta: number;
  reason: InventoryAdjustmentReason;
  note: string | null;
  approvalToken: string | null;
  /** TradingWEB inventory adjustments require a server-authorized purpose-scoped location. */
  locationId?: EntityId | null;
}

export type InventoryAdjustmentReason = 'count' | 'damage' | 'receive' | 'correction';

export interface InventoryRecord {
  id: EntityId;
  productId: EntityId;
  variantId: EntityId | null;
  storeId: EntityId;
  locationId: EntityId;
  locationName: string;
  stock: number;
  lowStockThreshold: number;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
}

export interface InventoryTransferInput {
  clientRef: string;
  fromLocationId: EntityId;
  toLocationId: EntityId;
  note: string | null;
  items: { productId: EntityId; variantId: EntityId | null; quantity: number }[];
}

export interface InventoryTransfer {
  id: EntityId;
  referenceNo: string;
  status: 'pending';
  storeId: EntityId;
  fromLocationId: EntityId;
  toLocationId: EntityId;
  operatorId: EntityId;
  items: { productId: EntityId; variantId: EntityId | null; quantity: number }[];
}

// ---------- TradingWEB purpose-scoped inventory locations ----------

export interface StoreLocation {
  id: EntityId;
  name: string;
  type?: string;
  isActive?: boolean;
  isStoreDefault?: boolean;
}

export type LocationPurpose = 'inventory_adjustment' | 'purchase_order' | 'inventory_transfer';

export interface LocationStock {
  locationId: EntityId;
  locationName: string;
  stock: number;
}

// ---------- 采购单（TradingWEB 权威端点） ----------

export type PurchaseOrderStatus = 'ordered' | 'received';

export interface PurchaseOrderItem {
  id?: EntityId;
  productId: EntityId;
  variantId: EntityId | null;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  qty: number;
  orderedQty?: number;
  receivedQty?: number;
  unitCostCents: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplier: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  receivedAt: string | null;
  locationId: EntityId | null;
  storeId?: EntityId;
  createdBy?: EntityId;
  receivedBy?: EntityId | null;
  items: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderInput {
  /** Stable across retries; generated once when the create form opens. */
  clientRef: string;
  supplier: string;
  locationId: EntityId;
  items: PurchaseOrderItem[];
}

export interface PingResult {
  ok: boolean;
  message: string;
}

export interface PosShift {
  id: string;
  storeId: string;
  openedBy: string;
  closedBy: string | null;
  status: 'open' | 'closed';
  openingFloatCents: number;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  differenceCashCents: number | null;
  openedAt: string;
  closedAt: string | null;
  reconciliation?: {
    cashSalesCents: number;
    cashRefundCents: number;
    cashInCents: number;
    cashOutCents: number;
  };
}

export interface PosCashMovement {
  id: string;
  shiftId: string;
  kind: 'in' | 'out';
  amountCents: number;
  reason: string;
  operatorId: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface PosAuditUploadRecord {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  hash: string;
  prev_hash: string | null;
  occurred_at: string;
}

export interface PosAuditUploadResult {
  accepted: number;
  duplicates: number;
}

export type PosTelemetryRecord =
  | { id: string; type: 'sync_failed'; code: string; pending_count: number; occurred_at: string }
  | { id: string; type: 'print_failed'; driver: string; message: string; occurred_at: string }
  | { id: string; type: 'scanner_failed'; source: string; message: string; occurred_at: string }
  | { id: string; type: 'app_error'; route: string; message: string; occurred_at: string };

export interface PosTelemetryResult { accepted: number; duplicates: number }

export interface PosSourceScope {
  serverUrl: string;
  storeId: string;
  operatorId: string;
  deviceId: string;
}

export interface ExchangeReturnItemInput {
  orderItemId: string;
  qty: number;
  restock: boolean;
}

export interface ExchangeOrderInput {
  clientRef: string;
  originalOrderId: string;
  returnItems: ExchangeReturnItemInput[];
  replacement: CreateOrderInput;
  differencePayment: Payment[];
  approvalToken: string | null;
}

export interface ExchangeOrderResult {
  exchangeId: string;
  originalOrderId: string;
  replacementOrder: Order;
  refundAmountCents: number;
  newOrderAmountCents: number;
  differenceAmountCents: number;
}

/**
 * POS 数据源统一接口：mock（演示/离线）与 tradingweb（真实后端）都实现它。
 * 页面永远只依赖这个接口，不直接碰 HTTP。
 */
export interface PosDataSource {
  readonly kind: DataSourceKind;
  /** Immutable authenticated identity used to bind persisted financial and audit state. */
  getSourceScope(): PosSourceScope | null;
  ping(): Promise<PingResult>;
  login(email: string, password: string): Promise<{ token: string; staff: Staff }>;
  fetchStaff(): Promise<Staff[]>;
  fetchApprovers(storeId: EntityId): Promise<Staff[]>;
  fetchProducts(query?: string): Promise<Product[]>;
  findByBarcode(code: string): Promise<{ product: Product; variant: ProductVariant | null } | null>;
  fetchCustomers(query?: string): Promise<Customer[]>;
  createCustomer(input: { name: string; email?: string; phone?: string }): Promise<Customer>;
  createOrder(input: CreateOrderInput): Promise<Order>;
  fetchOrders(query?: string, source?: 'pos' | 'all'): Promise<Order[]>;
  fetchOrdersPage(query: OrderPageQuery): Promise<Page<Order>>;
  fetchRangeReport(query: PosReportQuery): Promise<PosRangeReport>;
  fetchOrder(id: string): Promise<Order>;
  refundOrder(id: string, input: RefundInput): Promise<Order>;
  exchangeOrder(input: ExchangeOrderInput): Promise<ExchangeOrderResult>;
  adjustStock(input: StockAdjustInput): Promise<void>;
  /** 客户历史订单第一页兼容入口；真实列表使用服务端分页方法。 */
  fetchCustomerOrders(customerId: EntityId): Promise<Order[]>;
  fetchCustomerOrdersPage(customerId: EntityId, query: { page: number; pageSize?: number }): Promise<Page<Order>>;
  updatePickupFulfillment(orderId: EntityId, status: Exclude<PickupFulfillmentStatus, 'unfulfilled'>): Promise<{ id: EntityId; fulfillmentStatus: PickupFulfillmentStatus }>;
  /** Fetch only the locations the server authorizes for the requested workflow. */
  fetchLocations(purpose: LocationPurpose): Promise<StoreLocation[]>;
  fetchStockByLocation(productId: EntityId, variantId: EntityId | null): Promise<LocationStock[]>;
  createInventoryTransfer(input: InventoryTransferInput): Promise<InventoryTransfer>;
  /** 采购单权威端点；缺少权限或后端能力时必须显式失败。 */
  fetchPurchaseOrders(): Promise<PurchaseOrder[]>;
  createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder>;
  receivePurchaseOrder(id: string, approvalToken?: string | null): Promise<PurchaseOrder>;
  getCurrentShift(): Promise<PosShift | null>;
  openShift(input: { openingFloatCents: number }): Promise<PosShift>;
  recordCashMovement(shiftId: string, input: {
    kind: 'in' | 'out';
    amountCents: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<PosCashMovement>;
  closeShift(shiftId: string, input: {
    countedCents: number;
    idempotencyKey: string;
  }): Promise<PosShift>;
  uploadAuditBatch(records: PosAuditUploadRecord[]): Promise<PosAuditUploadResult>;
  uploadTelemetryBatch(records: PosTelemetryRecord[]): Promise<PosTelemetryResult>;
}

/** 离线/待同步场景：由下单输入构造本地订单对象（编号用本地占位号），用于小票与展示 */
export function buildLocalOrder(input: CreateOrderInput, number: string): Order {
  return {
    id: `local-${number}`,
    number,
    createdAt: new Date().toISOString(),
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
