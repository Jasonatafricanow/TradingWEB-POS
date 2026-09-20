import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ApiError, getDataSource } from '@/api';
import type { CreateOrderInput } from '@/api/types';
import { hashPendingRequest, syncErrorSnapshot, syncPendingOrder } from '@/services/sync';

export type PendingStatus = 'pending' | 'syncing' | 'blocked' | 'synced';

export interface SyncErrorSnapshot {
  message: string;
  status: number;
  code: string;
  retryable: boolean;
  occurredAt: string;
}

export interface PendingOrder {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  request: Readonly<CreateOrderInput>;
  status: PendingStatus;
  createdAt: string;
  firstError: SyncErrorSnapshot;
  lastError: SyncErrorSnapshot;
  attempts: number;
  lastAttemptAt: string | null;
  serverOrderId: string | null;
}

interface PendingState {
  items: PendingOrder[];
  syncing: boolean;
  add: (input: CreateOrderInput, error: ApiError) => PendingOrder;
  remove: (id: string) => boolean;
  resumeAfterReauthentication: (id: string) => boolean;
  syncOne: (id: string) => Promise<{ ok: number; fail: number }>;
  syncAll: () => Promise<{ ok: number; fail: number }>;
}

const stringifyId = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function immutableRequest(input: CreateOrderInput): Readonly<CreateOrderInput> {
  const copy = JSON.parse(JSON.stringify(input)) as CreateOrderInput;
  const freeze = (value: unknown): unknown => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  return freeze(copy) as Readonly<CreateOrderInput>;
}

function normalizeLegacyRequest(raw: unknown, fallbackClientRef: string): Readonly<CreateOrderInput> {
  const request = { ...((raw ?? {}) as CreateOrderInput) };
  request.clientRef = request.clientRef || fallbackClientRef;
  request.staffId = stringifyId(request.staffId) ?? '';
  request.customerId = stringifyId(request.customerId);
  request.items = (request.items ?? []).map((line) => ({
    ...line,
    productId: stringifyId(line.productId) ?? '',
    variantId: stringifyId(line.variantId),
  }));
  return immutableRequest(request);
}

function legacyErrorSnapshot(raw: unknown, createdAt: string): SyncErrorSnapshot {
  if (raw && typeof raw === 'object' && 'message' in raw && 'status' in raw) {
    return raw as SyncErrorSnapshot;
  }
  return {
    message: typeof raw === 'string' ? raw : 'Legacy pending sync failure',
    status: 0,
    code: 'LEGACY_PENDING_ERROR',
    retryable: true,
    occurredAt: createdAt,
  };
}

export function migratePendingState(persisted: unknown, version: number): PendingState {
  const state = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 2 && Array.isArray(state.items)) {
    state.items = state.items.map((raw) => {
      const legacy = raw as Record<string, unknown>;
      const createdAt = typeof legacy.createdAt === 'string' ? legacy.createdAt : new Date().toISOString();
      const id = typeof legacy.id === 'string' ? legacy.id : `pending-${createdAt}`;
      const request = normalizeLegacyRequest(legacy.request ?? legacy.input, id);
      const idempotencyKey = typeof legacy.idempotencyKey === 'string'
        ? legacy.idempotencyKey
        : request.clientRef || id;
      const firstError = legacyErrorSnapshot(legacy.firstError ?? legacy.lastError, createdAt);
      return {
        id,
        idempotencyKey,
        requestHash: typeof legacy.requestHash === 'string' ? legacy.requestHash : hashPendingRequest(request),
        request,
        status: legacy.status === 'blocked' || legacy.status === 'synced' || legacy.status === 'syncing'
          ? legacy.status
          : 'pending',
        createdAt,
        firstError,
        lastError: legacyErrorSnapshot(legacy.lastError ?? firstError, createdAt),
        attempts: typeof legacy.attempts === 'number' ? legacy.attempts : 0,
        lastAttemptAt: typeof legacy.lastAttemptAt === 'string' ? legacy.lastAttemptAt : null,
        serverOrderId: stringifyId(legacy.serverOrderId),
      } satisfies PendingOrder;
    });
  }
  return state as unknown as PendingState;
}

let seq = 0;

export const usePending = create<PendingState>()(
  persist(
    (set, get) => ({
      items: [],
      syncing: false,

      add: (input, error) => {
        if (!input.clientRef) throw new Error('Pending orders require a checkout idempotency key.');
        seq += 1;
        const createdAt = new Date().toISOString();
        const request = immutableRequest(input);
        const errorSnapshot = syncErrorSnapshot(error);
        const item: PendingOrder = {
          id: `pending-${Date.now()}-${seq}`,
          idempotencyKey: input.clientRef,
          requestHash: hashPendingRequest(request),
          request,
          status: 'pending',
          createdAt,
          firstError: errorSnapshot,
          lastError: errorSnapshot,
          attempts: 0,
          lastAttemptAt: null,
          serverOrderId: null,
        };
        set((state) => ({ items: [item, ...state.items] }));
        return item;
      },

      remove: (id) => {
        const current = get().items.find((item) => item.id === id);
        if (!current || get().syncing || current.status === 'syncing') return false;
        set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
        return true;
      },

      resumeAfterReauthentication: (id) => {
        let resumed = false;
        set((state) => ({
          items: state.items.map((item) => {
            if (item.id !== id || item.status !== 'blocked' || item.lastError.status !== 401) return item;
            resumed = true;
            return { ...item, status: 'pending' };
          }),
        }));
        return resumed;
      },

      syncOne: async (id) => {
        if (get().syncing) return { ok: 0, fail: 0 };
        const item = get().items.find((current) => current.id === id);
        if (!item || item.status === 'blocked' || item.status === 'synced') return { ok: 0, fail: 0 };

        set({ syncing: true });
        try {
          const queued = item.status === 'syncing' ? { ...item, status: 'pending' as const } : item;
          set((state) => ({
            items: state.items.map((current) => current.id === id ? { ...current, status: 'syncing' } : current),
          }));
          const result = await syncPendingOrder(queued, getDataSource(), get().items.length);
          if (result.status === 'synced') {
            set((state) => ({ items: state.items.filter((current) => current.id !== id) }));
            return { ok: 1, fail: 0 };
          }
          set((state) => ({
            items: state.items.map((current) => current.id === id ? result : current),
          }));
          return { ok: 0, fail: 1 };
        } finally {
          set({ syncing: false });
        }
      },

      syncAll: async () => {
        if (get().syncing) return { ok: 0, fail: 0 };
        set({ syncing: true });
        let ok = 0;
        let fail = 0;
        try {
          for (const item of [...get().items]) {
            if (item.status === 'blocked' || item.status === 'synced') continue;
            const queued = item.status === 'syncing' ? { ...item, status: 'pending' as const } : item;
            set((state) => ({
              items: state.items.map((current) => current.id === item.id ? { ...current, status: 'syncing' } : current),
            }));
            const result = await syncPendingOrder(queued, getDataSource(), get().items.length);
            if (result.status === 'synced') {
              set((state) => ({ items: state.items.filter((current) => current.id !== item.id) }));
              ok += 1;
            } else {
              set((state) => ({
                items: state.items.map((current) => current.id === item.id ? result : current),
              }));
              fail += 1;
            }
          }
        } finally {
          set({ syncing: false });
        }
        return { ok, fail };
      },
    }),
    {
      name: 'twpos-pending',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: migratePendingState,
      partialize: (state) => ({ items: state.items }) as unknown as PendingState,
    }
  )
);
