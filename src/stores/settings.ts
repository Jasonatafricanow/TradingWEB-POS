import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_PRINTER_CONFIG } from '@/hardware/printer/types';
import type { PrinterConfig } from '@/hardware/printer/types';
import type { Currency, PromoRule } from '@/utils/money';
import type { EntityId } from '@/api/types';
import { getBuildConfig } from '@/config/deployment';

export interface StoreInfo {
  name: string;
  address: string;
  footer: string;
}

export interface PaymentMethodDef {
  method: string;
  label: string;
  enabled: boolean;
  /** 后台自定义的支付方式（可删除）；内置方式只能停用 */
  custom?: boolean;
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethodDef[] = [
  { method: 'cash', label: '现金', enabled: true },
  { method: 'card', label: '银行卡', enabled: true },
  { method: 'wechat', label: '微信支付', enabled: true },
  { method: 'alipay', label: '支付宝', enabled: true },
  { method: 'custom', label: '其他', enabled: true },
];

/** 店长审批矩阵：true = 店员执行该操作需店长 PIN（对标 Shopify Manager approvals / POS 权限） */
export interface ApprovalMatrix {
  discount: boolean;
  refund: boolean;
  stockAdjust: boolean;
  exchange: boolean;
}

export const DEFAULT_APPROVALS: ApprovalMatrix = {
  discount: true,
  refund: true,
  stockAdjust: true,
  exchange: true,
};

export interface SettingsState {
  dataSource: 'mock' | 'tradingweb';
  serverUrl: string;
  /** TradingWEB 门店 UUID；所有 POS catalog/checkout 必须显式带上。 */
  storeId: EntityId | null;
  /** bootstrap 返回的服务端定价版本。 */
  pricingVersion: string | null;
  currency: Currency;
  /** 税率，基点：850 = 8.5% */
  taxRateBps: number;
  store: StoreInfo;
  printer: PrinterConfig;
  paymentMethods: PaymentMethodDef[];
  hidScannerEnabled: boolean;
  /** 店长审批矩阵（按操作细分，替代原 managerApproval 单开关） */
  approvals: ApprovalMatrix;
  /** 本地满减规则（自动应用，有手动整单折扣时不叠加） */
  promoRules: PromoRule[];
  /** 当前操作库位（多库位后端就绪前为 null = 默认库位） */
  currentLocationId: EntityId | null;
  /** 结账完成后自动打印小票（失败静默，不打断收银） */
  autoPrintReceipt: boolean;
  set: (
    p: Partial<
      Omit<
        SettingsState,
        | 'set'
        | 'setPrinter'
        | 'setStore'
        | 'setPaymentMethodEnabled'
        | 'addPaymentMethod'
        | 'removePaymentMethod'
        | 'setApproval'
        | 'addPromoRule'
        | 'removePromoRule'
        | 'setPromoRuleEnabled'
      >
    >
  ) => void;
  setPrinter: (p: Partial<PrinterConfig>) => void;
  setStore: (p: Partial<StoreInfo>) => void;
  setPaymentMethodEnabled: (method: string, enabled: boolean) => void;
  addPaymentMethod: (label: string) => void;
  removePaymentMethod: (method: string) => void;
  setApproval: (key: keyof ApprovalMatrix, required: boolean) => void;
  addPromoRule: (thresholdCents: number, discountCents: number) => void;
  removePromoRule: (id: string) => void;
  setPromoRuleEnabled: (id: string, enabled: boolean) => void;
}

export function migrateSettingsState(persisted: any, version: number): SettingsState {
  if (persisted && version < 2) {
    if (persisted.managerApproval !== undefined && persisted.approvals === undefined) {
      const on = !!persisted.managerApproval;
      persisted.approvals = { discount: on, refund: on, stockAdjust: on, exchange: on };
    }
    delete persisted.managerApproval;
  }
  if (persisted && version < 3 && typeof persisted.currentLocationId === 'number') {
    persisted.currentLocationId =
      persisted.currentLocationId === 1
        ? 'mock-location-front'
        : persisted.currentLocationId === 2
          ? 'mock-location-warehouse'
          : `mock-location-${persisted.currentLocationId}`;
  }
  if (persisted && version < 4) {
    persisted.storeId = typeof persisted.storeId === 'string' && persisted.storeId ? persisted.storeId : null;
    persisted.pricingVersion = typeof persisted.pricingVersion === 'string' && persisted.pricingVersion
      ? persisted.pricingVersion
      : null;
  }
  return persisted as SettingsState;
}

export const partializeSettings = (state: SettingsState) => ({
  dataSource: state.dataSource,
  serverUrl: state.serverUrl,
  storeId: state.storeId,
  pricingVersion: state.pricingVersion,
  currency: state.currency,
  taxRateBps: state.taxRateBps,
  store: state.store,
  printer: state.printer,
  paymentMethods: state.paymentMethods,
  hidScannerEnabled: state.hidScannerEnabled,
  approvals: state.approvals,
  promoRules: state.promoRules,
  currentLocationId: state.currentLocationId,
  autoPrintReceipt: state.autoPrintReceipt,
});

export const useSettings = create<SettingsState>()(
  persist(
    (set) => {
      const build = getBuildConfig();
      return {
      dataSource: build.dataSource,
      serverUrl: build.serverUrl,
      storeId: build.storeId,
      pricingVersion: null,
      currency: build.currency as Currency,
      taxRateBps: build.taxRateBps,
      store: { name: build.storeName, address: build.storeAddress, footer: build.storeFooter },
      printer: { ...DEFAULT_PRINTER_CONFIG },
      paymentMethods: DEFAULT_PAYMENT_METHODS,
      hidScannerEnabled: true,
      approvals: { ...DEFAULT_APPROVALS },
      promoRules: [],
      currentLocationId: null,
      autoPrintReceipt: false,

      set: (p) => set(p as Partial<SettingsState>),
      setPrinter: (p) => set((s) => ({ printer: { ...s.printer, ...p } })),
      setStore: (p) => set((s) => ({ store: { ...s.store, ...p } })),

      setPaymentMethodEnabled: (method, enabled) =>
        set((s) => ({
          paymentMethods: s.paymentMethods.map((m) => (m.method === method ? { ...m, enabled } : m)),
        })),

      addPaymentMethod: (label) =>
        set((s) => {
          const name = label.trim();
          if (!name) return s;
          return {
            paymentMethods: [
              ...s.paymentMethods,
              { method: `custom_${Date.now()}`, label: name, enabled: true, custom: true },
            ],
          };
        }),

      removePaymentMethod: (method) =>
        set((s) => ({
          paymentMethods: s.paymentMethods.filter((m) => !(m.custom && m.method === method)),
        })),

      setApproval: (key, required) =>
        set((s) => ({ approvals: { ...s.approvals, [key]: required } })),

      addPromoRule: (thresholdCents, discountCents) =>
        set((s) => {
          if (thresholdCents <= 0 || discountCents <= 0 || discountCents >= thresholdCents) return s;
          const fmt = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));
          const rule: PromoRule = {
            id: `pr${Date.now()}`,
            label: `满${fmt(thresholdCents)}减${fmt(discountCents)}`,
            thresholdCents,
            discountCents,
            enabled: true,
          };
          return { promoRules: [...s.promoRules, rule].sort((a, b) => a.thresholdCents - b.thresholdCents) };
        }),

      removePromoRule: (id) => set((s) => ({ promoRules: s.promoRules.filter((r) => r.id !== id) })),

      setPromoRuleEnabled: (id, enabled) =>
        set((s) => ({ promoRules: s.promoRules.map((r) => (r.id === id ? { ...r, enabled } : r)) })),
      };
    },
    {
      name: 'twpos-settings',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
      migrate: migrateSettingsState,
      partialize: partializeSettings,
    }
  )
);
