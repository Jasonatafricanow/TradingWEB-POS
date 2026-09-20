import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { PosCashMovement, PosDataSource, PosShift, PosSourceScope } from '@/api/types';
import type { ShiftReceiptData } from '@/hardware/printer/receipt';
import { normalizePosSourceScope, samePosSourceScope } from '@/services/sourceIdentity';
import { useAuth } from '@/stores/auth';
import { createLocalUuid } from '@/utils/uuid';

export interface CashMovement {
  id: string;
  kind: 'in' | 'out';
  label: string;
  amountCents: number;
  at: number;
  by: string;
}

interface PendingCashMovement {
  shiftId: string;
  kind: 'in' | 'out';
  label: string;
  amountCents: number;
  by: string;
  idempotencyKey: string;
  scope: PosSourceScope | null;
}

interface PendingShiftClose {
  shiftId: string;
  countedCents: number;
  by: string;
  idempotencyKey: string;
  scope: PosSourceScope | null;
}

export interface ShiftState {
  open: boolean;
  openedAt: number | null;
  openedBy: string;
  floatCents: number;
  cashSalesCents: number;
  cashRefundCents: number;
  movements: CashMovement[];
  ordersCount: number;
  salesTotalCents: number;
  lastSummary: ShiftReceiptData | null;
  accountingSource: 'local' | 'server';
  serverShiftId: string | null;
  serverScope: PosSourceScope | null;
  pendingCashMovement: PendingCashMovement | null;
  pendingClose: PendingShiftClose | null;
  openShift: (floatCents: number, by: string) => void;
  recordCashMovement: (kind: 'in' | 'out', label: string, amountCents: number, by: string) => void;
  recordOrder: (totalCents: number, cashCents: number) => void;
  recordRefund: (totalCents: number, cashCents: number) => void;
  expectedCashCents: () => number;
  closeShift: (countedCents: number, by: string) => ShiftReceiptData;
  recoverCurrentShift: (source: PosDataSource) => Promise<void>;
  openShiftWithSource: (source: PosDataSource, floatCents: number, by: string) => Promise<void>;
  recordCashMovementWithSource: (
    source: PosDataSource,
    kind: 'in' | 'out',
    label: string,
    amountCents: number,
    by: string,
  ) => Promise<void>;
  closeShiftWithSource: (
    source: PosDataSource,
    countedCents: number,
    by: string,
  ) => Promise<ShiftReceiptData>;
}

function operatorDisplayName(operatorId: string | null, fallback = ''): string {
  if (!operatorId) return fallback;
  const auth = useAuth.getState();
  return auth.staffList.find((staff) => staff.id === operatorId)?.name
    ?? (auth.currentStaff?.id === operatorId ? auth.currentStaff.name : undefined)
    ?? (auth.account?.id === operatorId ? auth.account.name : undefined)
    ?? fallback
    ?? operatorId;
}

function requireSourceScope(source: PosDataSource): PosSourceScope {
  const scope = typeof source.getSourceScope === 'function'
    ? normalizePosSourceScope(source.getSourceScope() ?? { serverUrl: '' })
    : null;
  if (!scope) throw new Error('TradingWEB source scope is unavailable');
  return scope;
}

function assertPersistedScope(
  persisted: PosSourceScope | null | undefined,
  current: PosSourceScope,
  label: string,
): void {
  if (!samePosSourceScope(persisted, current)) {
    throw new Error(`${label} belongs to a different TradingWEB source scope`);
  }
}

function assertOpenShift(shift: PosShift, scope: PosSourceScope): void {
  if (shift.status !== 'open') throw new Error('TradingWEB returned a non-open current shift response');
  if (shift.storeId !== scope.storeId) throw new Error('TradingWEB current shift store does not match source scope');
}

function openServerState(
  shift: PosShift,
  scope: PosSourceScope,
  openedBy?: string,
): Partial<ShiftState> {
  assertOpenShift(shift, scope);
  return {
    open: true,
    openedAt: Date.parse(shift.openedAt),
    openedBy: openedBy ?? operatorDisplayName(shift.openedBy, shift.openedBy),
    floatCents: shift.openingFloatCents,
    cashSalesCents: 0,
    cashRefundCents: 0,
    movements: [],
    ordersCount: 0,
    salesTotalCents: 0,
    accountingSource: 'server',
    serverShiftId: shift.id,
    serverScope: scope,
  };
}

function localExpected(state: Pick<ShiftState,
  'floatCents' | 'cashSalesCents' | 'cashRefundCents' | 'movements'
>): number {
  const cashIn = state.movements
    .filter((movement) => movement.kind === 'in')
    .reduce((sum, movement) => sum + movement.amountCents, 0);
  const cashOut = state.movements
    .filter((movement) => movement.kind === 'out')
    .reduce((sum, movement) => sum + movement.amountCents, 0);
  return state.floatCents + state.cashSalesCents - state.cashRefundCents + cashIn - cashOut;
}

function sameCashMovement(pending: PendingCashMovement, input: Omit<PendingCashMovement, 'idempotencyKey'>): boolean {
  return pending.shiftId === input.shiftId && pending.kind === input.kind
    && pending.label === input.label && pending.amountCents === input.amountCents && pending.by === input.by
    && samePosSourceScope(pending.scope, input.scope);
}

function hasServerFinancialState(state: Pick<ShiftState,
  'accountingSource' | 'serverShiftId' | 'serverScope' | 'pendingCashMovement' | 'pendingClose'
>): boolean {
  return state.accountingSource === 'server'
    || state.serverShiftId !== null
    || state.serverScope !== null
    || state.pendingCashMovement !== null
    || state.pendingClose !== null;
}

function assertLocalFinancialMutationAllowed(state: ShiftState): void {
  if (hasServerFinancialState(state)) {
    throw new Error('TradingWEB financial state must be reconciled before using Mock shift actions');
  }
}

function closedServerSummary(
  shift: PosShift,
  requestedCountedCents: number,
  expectedOperatorId: string,
): ShiftReceiptData {
  if (
    shift.status !== 'closed' || !shift.closedAt
    || shift.expectedCashCents === null || shift.countedCashCents === null
    || shift.differenceCashCents === null || !shift.reconciliation
  ) {
    throw new Error('TradingWEB returned an incomplete shift reconciliation');
  }
  const reconciledExpectedCents = shift.openingFloatCents
    + shift.reconciliation.cashSalesCents
    - shift.reconciliation.cashRefundCents
    + shift.reconciliation.cashInCents
    - shift.reconciliation.cashOutCents;
  if (
    shift.countedCashCents !== requestedCountedCents
    || shift.closedBy !== expectedOperatorId
    || shift.differenceCashCents !== shift.countedCashCents - shift.expectedCashCents
    || shift.expectedCashCents !== reconciledExpectedCents
  ) {
    throw new Error('TradingWEB shift reconciliation facts do not match the close request');
  }
  return {
    openedAt: Date.parse(shift.openedAt),
    closedAt: Date.parse(shift.closedAt),
    openedBy: operatorDisplayName(shift.openedBy, shift.openedBy),
    closedBy: operatorDisplayName(shift.closedBy, shift.closedBy ?? ''),
    floatCents: shift.openingFloatCents,
    cashSalesCents: shift.reconciliation.cashSalesCents,
    cashRefundCents: shift.reconciliation.cashRefundCents,
    cashInCents: shift.reconciliation.cashInCents,
    cashOutCents: shift.reconciliation.cashOutCents,
    expectedCents: shift.expectedCashCents,
    countedCents: shift.countedCashCents,
    diffCents: shift.differenceCashCents,
    // The Task 10 close DTO does not expose trustworthy order-count or all-tender sales totals.
    ordersCount: 0,
    salesTotalCents: 0,
    accountingSource: 'server',
  };
}

function confirmedCashMovement(movement: PosCashMovement, by: string): CashMovement {
  return {
    id: movement.id,
    kind: movement.kind,
    label: movement.reason,
    amountCents: movement.amountCents,
    at: Date.parse(movement.createdAt),
    by,
  };
}

const resetClosedState = (lastSummary: ShiftReceiptData | null): Partial<ShiftState> => ({
  open: false,
  openedAt: null,
  openedBy: '',
  floatCents: 0,
  cashSalesCents: 0,
  cashRefundCents: 0,
  movements: [],
  ordersCount: 0,
  salesTotalCents: 0,
  accountingSource: 'local',
  serverShiftId: null,
  serverScope: null,
  pendingCashMovement: null,
  pendingClose: null,
  lastSummary,
});

export const partializeShift = (state: ShiftState) => ({
  open: state.open,
  openedAt: state.openedAt,
  openedBy: state.openedBy,
  floatCents: state.floatCents,
  cashSalesCents: state.cashSalesCents,
  cashRefundCents: state.cashRefundCents,
  movements: state.movements,
  ordersCount: state.ordersCount,
  salesTotalCents: state.salesTotalCents,
  lastSummary: state.lastSummary,
  accountingSource: state.accountingSource,
  serverShiftId: state.serverShiftId,
  serverScope: state.serverScope,
  pendingCashMovement: state.pendingCashMovement,
  pendingClose: state.pendingClose,
});

export const useShift = create<ShiftState>()(
  persist(
    (set, get) => ({
      open: false,
      openedAt: null,
      openedBy: '',
      floatCents: 0,
      cashSalesCents: 0,
      cashRefundCents: 0,
      movements: [],
      ordersCount: 0,
      salesTotalCents: 0,
      lastSummary: null,
      accountingSource: 'local',
      serverShiftId: null,
      serverScope: null,
      pendingCashMovement: null,
      pendingClose: null,

      openShift: (floatCents, by) => {
        assertLocalFinancialMutationAllowed(get());
        set({
          open: true,
          openedAt: Date.now(),
          openedBy: by,
          floatCents,
          cashSalesCents: 0,
          cashRefundCents: 0,
          movements: [],
          ordersCount: 0,
          salesTotalCents: 0,
          accountingSource: 'local',
          serverShiftId: null,
          serverScope: null,
          pendingCashMovement: null,
          pendingClose: null,
        });
      },

      recordCashMovement: (kind, label, amountCents, by) => {
        assertLocalFinancialMutationAllowed(get());
        set((state) => ({
          movements: [
            { id: createLocalUuid(), kind, label, amountCents, at: Date.now(), by },
            ...state.movements,
          ],
        }));
      },

      recordOrder: (totalCents, cashCents) => set((state) => state.accountingSource === 'server'
        ? state
        : {
            ordersCount: state.ordersCount + 1,
            salesTotalCents: state.salesTotalCents + totalCents,
            cashSalesCents: state.cashSalesCents + cashCents,
          }),

      recordRefund: (totalCents, cashCents) => set((state) => state.accountingSource === 'server'
        ? state
        : {
            salesTotalCents: state.salesTotalCents - totalCents,
            cashRefundCents: state.cashRefundCents + cashCents,
          }),

      expectedCashCents: () => localExpected(get()),

      closeShift: (countedCents, by) => {
        const state = get();
        assertLocalFinancialMutationAllowed(state);
        const cashInCents = state.movements
          .filter((movement) => movement.kind === 'in')
          .reduce((sum, movement) => sum + movement.amountCents, 0);
        const cashOutCents = state.movements
          .filter((movement) => movement.kind === 'out')
          .reduce((sum, movement) => sum + movement.amountCents, 0);
        const expectedCents = localExpected(state);
        const summary: ShiftReceiptData = {
          openedAt: state.openedAt ?? Date.now(),
          closedAt: Date.now(),
          openedBy: state.openedBy,
          closedBy: by,
          floatCents: state.floatCents,
          cashSalesCents: state.cashSalesCents,
          cashRefundCents: state.cashRefundCents,
          cashInCents,
          cashOutCents,
          expectedCents,
          countedCents,
          diffCents: countedCents - expectedCents,
          ordersCount: state.ordersCount,
          salesTotalCents: state.salesTotalCents,
          accountingSource: 'local',
        };
        set(resetClosedState(summary));
        return summary;
      },

      recoverCurrentShift: async (source) => {
        if (source.kind !== 'tradingweb') return;
        const before = get();
        const scope = requireSourceScope(source);
        const hasPersistedServerState = before.accountingSource === 'server'
          || before.serverShiftId !== null
          || before.pendingCashMovement !== null
          || before.pendingClose !== null;
        if (hasPersistedServerState) assertPersistedScope(before.serverScope, scope, 'Persisted shift');
        if (before.pendingCashMovement) {
          assertPersistedScope(before.pendingCashMovement.scope, scope, 'Pending cash movement');
        }
        if (before.pendingClose) assertPersistedScope(before.pendingClose.scope, scope, 'Pending close');
        if (before.pendingCashMovement && before.pendingClose) {
          throw new Error('Unresolved cash movement and close requests conflict on the same shift');
        }
        const shift = await source.getCurrentShift();
        if (shift) assertOpenShift(shift, scope);
        if (before.pendingClose) {
          if (shift && shift.id !== before.pendingClose.shiftId) {
            throw new Error('TradingWEB current shift does not match the unresolved close');
          }
          const closed = await source.closeShift(before.pendingClose.shiftId, {
            countedCents: before.pendingClose.countedCents,
            idempotencyKey: before.pendingClose.idempotencyKey,
          });
          if (closed.id !== before.pendingClose.shiftId || closed.storeId !== scope.storeId) {
            throw new Error('TradingWEB close response does not match the pending shift scope');
          }
          set(resetClosedState(closedServerSummary(
            closed,
            before.pendingClose.countedCents,
            scope.operatorId,
          )));
          return;
        }
        if (!shift) {
          if (before.pendingCashMovement) {
            throw new Error('Cannot reconcile the unresolved cash movement without an open shift');
          }
          set(resetClosedState(get().lastSummary));
          return;
        }
        if (before.pendingCashMovement && before.pendingCashMovement.shiftId !== shift.id) {
          throw new Error('TradingWEB current shift conflicts with the unresolved cash movement');
        }
        const pendingCashMovement = before.pendingCashMovement;
        set({
          ...openServerState(shift, scope),
          pendingCashMovement,
          pendingClose: null,
        });
        if (pendingCashMovement) {
          const movement = await source.recordCashMovement(shift.id, {
            kind: pendingCashMovement.kind,
            amountCents: pendingCashMovement.amountCents,
            reason: pendingCashMovement.label,
            idempotencyKey: pendingCashMovement.idempotencyKey,
          });
          if (
            movement.shiftId !== pendingCashMovement.shiftId
            || movement.kind !== pendingCashMovement.kind
            || movement.amountCents !== pendingCashMovement.amountCents
            || movement.reason !== pendingCashMovement.label
            || movement.idempotencyKey !== pendingCashMovement.idempotencyKey
            || movement.operatorId !== scope.operatorId
          ) {
            throw new Error('TradingWEB cash movement response does not match the pending request');
          }
          set({
            movements: [confirmedCashMovement(movement, pendingCashMovement.by)],
            pendingCashMovement: null,
          });
        }
      },

      openShiftWithSource: async (source, floatCents, by) => {
        if (source.kind === 'mock') {
          get().openShift(floatCents, by);
          return;
        }
        const before = get();
        if (before.pendingCashMovement || before.pendingClose) {
          throw new Error('A financial operation is unresolved; opening another shift is blocked');
        }
        const scope = requireSourceScope(source);
        let shift: PosShift;
        try {
          shift = await source.openShift({ openingFloatCents: floatCents });
        } catch (error) {
          const typed = error as { status?: unknown; retryable?: unknown } | null;
          if (typed && typeof typed.status === 'number' && typed.status > 0 && typed.retryable !== true) {
            throw error;
          }
          let recovered: PosShift | null;
          try {
            recovered = await source.getCurrentShift();
          } catch {
            throw error;
          }
          if (!recovered) throw error;
          assertOpenShift(recovered, scope);
          if (
            recovered.openedBy !== scope.operatorId
            || recovered.openingFloatCents !== floatCents
          ) {
            throw new Error('TradingWEB current shift cannot be safely matched to the lost open response');
          }
          shift = recovered;
        }
        assertOpenShift(shift, scope);
        if (shift.openedBy !== scope.operatorId) {
          throw new Error('TradingWEB opened shift operator does not match source scope');
        }
        set({ ...openServerState(shift, scope, by), pendingCashMovement: null, pendingClose: null });
      },

      recordCashMovementWithSource: async (source, kind, label, amountCents, by) => {
        if (source.kind === 'mock') {
          get().recordCashMovement(kind, label, amountCents, by);
          return;
        }
        const scope = requireSourceScope(source);
        const state = get();
        assertPersistedScope(state.serverScope, scope, 'Open shift');
        if (state.pendingClose) {
          throw new Error('Previous shift close outcome is unresolved; cash movement is blocked');
        }
        const shiftId = get().serverShiftId;
        if (!shiftId || !get().open) throw new Error('No current TradingWEB shift');
        const facts = { shiftId, kind, label, amountCents, by, scope };
        const existing = get().pendingCashMovement;
        if (existing && !sameCashMovement(existing, facts)) {
          throw new Error('Previous cash movement outcome is unresolved; retry the same movement first');
        }
        const pending = existing ?? { ...facts, idempotencyKey: createLocalUuid() };
        if (!existing) set({ pendingCashMovement: pending });
        const movement = await source.recordCashMovement(shiftId, {
          kind,
          amountCents,
          reason: label,
          idempotencyKey: pending.idempotencyKey,
        });
        if (
          movement.shiftId !== shiftId
          || movement.kind !== kind
          || movement.amountCents !== amountCents
          || movement.reason !== label
          || movement.idempotencyKey !== pending.idempotencyKey
          || movement.operatorId !== scope.operatorId
        ) {
          throw new Error('TradingWEB cash movement response does not match the pending request');
        }
        set((state) => ({
          movements: [
            confirmedCashMovement(movement, by),
            ...state.movements.filter((item) => item.id !== movement.id),
          ],
          pendingCashMovement: null,
        }));
      },

      closeShiftWithSource: async (source, countedCents, by) => {
        if (source.kind === 'mock') return get().closeShift(countedCents, by);
        const scope = requireSourceScope(source);
        const state = get();
        assertPersistedScope(state.serverScope, scope, 'Open shift');
        if (state.pendingCashMovement) {
          throw new Error('Previous cash movement outcome is unresolved; shift close is blocked');
        }
        const shiftId = get().serverShiftId;
        if (!shiftId || !get().open) throw new Error('No current TradingWEB shift');
        const existing = get().pendingClose;
        if (existing && (
          existing.shiftId !== shiftId || existing.countedCents !== countedCents || existing.by !== by
        )) {
          throw new Error('Previous shift close outcome is unresolved; retry the same count first');
        }
        if (existing) assertPersistedScope(existing.scope, scope, 'Pending close');
        const pending = existing ?? {
          shiftId,
          countedCents,
          by,
          idempotencyKey: createLocalUuid(),
          scope,
        };
        if (!existing) set({ pendingClose: pending });
        const closed = await source.closeShift(shiftId, {
          countedCents,
          idempotencyKey: pending.idempotencyKey,
        });
        if (closed.id !== shiftId || closed.storeId !== scope.storeId) {
          throw new Error('TradingWEB close response does not match the pending shift scope');
        }
        const summary = closedServerSummary(closed, countedCents, scope.operatorId);
        set(resetClosedState(summary));
        return summary;
      },
    }),
    {
      name: 'twpos-shift',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persisted: unknown) => ({
        ...(persisted as Partial<ShiftState>),
        accountingSource: (persisted as Partial<ShiftState>)?.serverShiftId ? 'server' : 'local',
        serverShiftId: (persisted as Partial<ShiftState>)?.serverShiftId ?? null,
        serverScope: normalizePosSourceScope(
          (persisted as Partial<ShiftState>)?.serverScope ?? { serverUrl: '' },
        ),
        pendingCashMovement: (persisted as Partial<ShiftState>)?.pendingCashMovement ?? null,
        pendingClose: (persisted as Partial<ShiftState>)?.pendingClose ?? null,
      }) as ShiftState,
      partialize: partializeShift,
    },
  ),
);
