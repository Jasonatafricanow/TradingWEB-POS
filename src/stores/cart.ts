import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { variantLabel } from '@/api/types';
import type { Customer, EntityId, Product, ProductVariant } from '@/api/types';
import type { CartDiscount, LineDiscount } from '@/utils/money';

let customSeq = 0;

export interface CartLine {
  key: string;
  productId: EntityId;
  variantId: EntityId | null;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  unitPriceCents: number;
  qty: number;
  custom: boolean;
  /** 行级折扣（percent 0-100 / amount 分，对行合计生效） */
  discount?: LineDiscount | null;
}

export interface HeldCart {
  id: string;
  name: string;
  at: number;
  lines: CartLine[];
  discount: CartDiscount | null;
  note: string;
  customer: Customer | null;
}

/** 换货：原单退货行形成抵扣额，随新单一起结算 */
export interface ExchangeReturnItem {
  id?: string; // Original order item ID
  productId: EntityId;
  variantId: EntityId | null;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  unitPriceCents: number;
  qty: number;
}

export interface ExchangeContext {
  orderId: string;
  orderNumber: string;
  creditCents: number;
  restock: boolean;
  items: ExchangeReturnItem[];
  /** 发起时的店长审批人（完成换货的审计沿用） */
  approvedBy?: string | null;
  /** 原单退款是否已执行（结算重试/中途退出后防止二次退款） */
  refunded?: boolean;
}

export interface CartState {
  lines: CartLine[];
  discount: CartDiscount | null;
  note: string;
  customer: Customer | null;
  holds: HeldCart[];
  /** 换货上下文（非 null 时购物车处于换货模式） */
  exchange: ExchangeContext | null;
  /** 加入商品；商品/变体无价格时返回 false（与主站"严格变体价格校验"口径一致） */
  addProduct: (p: Product, v: ProductVariant | null) => boolean;
  addCustom: (name: string, unitPriceCents: number) => void;
  setQty: (key: string, qty: number) => void;
  removeLine: (key: string) => void;
  setDiscount: (d: CartDiscount | null) => void;
  setLineDiscount: (key: string, d: LineDiscount | null) => void;
  setNote: (note: string) => void;
  setCustomer: (c: Customer | null) => void;
  startExchange: (ctx: ExchangeContext) => void;
  markExchangeRefunded: () => void;
  cancelExchange: () => void;
  clear: () => void;
  holdCurrent: (name: string) => void;
  resumeHold: (id: string) => void;
  deleteHold: (id: string) => void;
}

const legacyMockId = (value: unknown, prefix: string): string | null =>
  value === null || value === undefined
    ? null
    : typeof value === 'number'
      ? `${prefix}-${value}`
      : String(value) || null;

const legacyVariantIds: Record<number, string> = {
  101: 'mock-variant-1-1',
  102: 'mock-variant-1-2',
  103: 'mock-variant-1-3',
  104: 'mock-variant-2-1',
  105: 'mock-variant-2-2',
  106: 'mock-variant-2-3',
};

function migrateVariantId(value: unknown): string | null {
  if (typeof value === 'number') return legacyVariantIds[value] ?? `mock-variant-${value}`;
  return legacyMockId(value, 'mock-variant');
}

function migrateCartLine(value: unknown): CartLine | null {
  if (!value || typeof value !== 'object') return null;
  const line = { ...(value as Record<string, unknown>) };
  const custom = Boolean(line.custom) || line.productId === 0;
  const productId = custom
    ? 'local-product-custom'
    : legacyMockId(line.productId, 'mock-product');
  if (productId === null) return null;
  const variantId = migrateVariantId(line.variantId);
  return {
    ...(line as unknown as CartLine),
    key: custom ? String(line.key ?? `c-legacy-${productId}`) : `p${productId}:${variantId ?? 0}`,
    productId,
    variantId,
  };
}

function migrateCustomer(value: unknown): Customer | null {
  if (!value || typeof value !== 'object') return null;
  const customer = { ...(value as Record<string, unknown>) };
  const id = legacyMockId(customer.id, 'mock-customer');
  if (id === null) return null;
  return {
    ...(customer as unknown as Customer),
    id,
  };
}

export function migrateCartState(persisted: unknown, version: number): CartState {
  const state = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 1) {
    state.lines = Array.isArray(state.lines)
      ? state.lines.map(migrateCartLine).filter((line): line is CartLine => line !== null)
      : [];
    state.customer = migrateCustomer(state.customer);
    state.holds = Array.isArray(state.holds)
      ? state.holds.map((raw) => {
          const hold = { ...(raw as Record<string, unknown>) };
          return {
            ...hold,
            lines: Array.isArray(hold.lines)
              ? hold.lines.map(migrateCartLine).filter((line): line is CartLine => line !== null)
              : [],
            customer: migrateCustomer(hold.customer),
          };
        })
      : [];
    if (state.exchange && typeof state.exchange === 'object') {
      const exchange = { ...(state.exchange as Record<string, unknown>) };
      const originalItems = Array.isArray(exchange.items) ? exchange.items : [];
      const migratedItems = originalItems
        .map(migrateCartLine)
        .filter((line): line is CartLine => line !== null);
      exchange.items = migratedItems;
      state.exchange = migratedItems.length !== originalItems.length ? null : exchange;
    }
  }
  return state as unknown as CartState;
}

export const partializeCart = (state: CartState) => ({
  lines: state.lines,
  discount: state.discount,
  note: state.note,
  customer: state.customer,
  holds: state.holds,
  exchange: state.exchange,
});

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      discount: null,
      note: '',
      customer: null,
      holds: [],
      exchange: null,

      addProduct: (p, v) => {
        const price = v ? v.priceCents : p.priceCents;
        if (price === null || price === undefined) return false;
        const key = `p${p.id}:${v ? v.id : 0}`;
        set((s) => {
          const exist = s.lines.find((l) => l.key === key);
          if (exist) {
            return { lines: s.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) };
          }
          const line: CartLine = {
            key,
            productId: p.id,
            variantId: v ? v.id : null,
            name: p.name,
            variantLabel: v ? variantLabel(v) : null,
            sku: v ? v.sku : p.sku,
            unitPriceCents: price,
            qty: 1,
            custom: false,
            discount: null,
          };
          return { lines: [...s.lines, line] };
        });
        return true;
      },

      addCustom: (name, unitPriceCents) =>
        set((s) => ({
          lines: [
            ...s.lines,
            {
              key: `c${Date.now()}${++customSeq}`,
              productId: 'local-product-custom',
              variantId: null,
              name,
              variantLabel: null,
              sku: null,
              unitPriceCents,
              qty: 1,
              custom: true,
              discount: null,
            },
          ],
        })),

      setQty: (key, qty) =>
        set((s) => ({
          lines:
            qty <= 0
              ? s.lines.filter((l) => l.key !== key)
              : s.lines.map((l) => (l.key === key ? { ...l, qty } : l)),
        })),

      removeLine: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
      setDiscount: (discount) => set({ discount }),

      setLineDiscount: (key, d) =>
        set((s) => ({
          lines: s.lines.map((l) => (l.key === key ? { ...l, discount: d } : l)),
        })),

      setNote: (note) => set({ note }),
      setCustomer: (customer) => set({ customer }),

      startExchange: (ctx) => set({ exchange: { ...ctx, refunded: false } }),
      markExchangeRefunded: () =>
        set((s) => (s.exchange ? { exchange: { ...s.exchange, refunded: true } } : s)),
      cancelExchange: () => {
        const ex = get().exchange;
        if (ex?.refunded) return; // 原单已退款：不允许静默取消（结算页会给出提示）
        set({ exchange: null });
      },

      clear: () => set({ lines: [], discount: null, note: '', customer: null, exchange: null }),

      holdCurrent: (name) => {
        const s = get();
        if (s.lines.length === 0 || s.exchange) return; // 换货模式不允许挂单
        const hold: HeldCart = {
          id: `h${Date.now()}`,
          name: name || `挂单 ${new Date().toTimeString().slice(0, 5)}`,
          at: Date.now(),
          lines: s.lines,
          discount: s.discount,
          note: s.note,
          customer: s.customer,
        };
        set({ holds: [hold, ...s.holds], lines: [], discount: null, note: '', customer: null });
      },

      resumeHold: (id) => {
        const s = get();
        const h = s.holds.find((x) => x.id === id);
        if (!h || s.lines.length > 0 || s.exchange) return;
        set({
          lines: h.lines,
          discount: h.discount,
          note: h.note,
          customer: h.customer,
          holds: s.holds.filter((x) => x.id !== id),
        });
      },

      deleteHold: (id) => set((s) => ({ holds: s.holds.filter((x) => x.id !== id) })),
    }),
    {
      name: 'twpos-cart',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      migrate: migrateCartState,
      partialize: partializeCart,
    }
  )
);

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((s, l) => s + l.qty, 0);
}
