import { vi, describe, it, expect, beforeEach } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useShift } from '../shift';
import type { CashMovement } from '../shift';
import type { PosDataSource } from '@/api/types';
import { useAuth } from '@/stores/auth';

vi.mock('@/hardware/printer/receipt', () => ({}));

const closedState = () => ({
  open: false,
  openedAt: null,
  openedBy: '',
  floatCents: 0,
  cashSalesCents: 0,
  cashRefundCents: 0,
  movements: [] as CashMovement[],
  ordersCount: 0,
  salesTotalCents: 0,
  lastSummary: null,
  accountingSource: 'local' as const,
  serverShiftId: null,
  serverScope: null,
  pendingCashMovement: null,
  pendingClose: null,
});

const SHIFT_ONE = '66666666-6666-4666-8666-666666666666';
const SHIFT_TWO = '77777777-7777-4777-8777-777777777777';
const STORE_ONE = '11111111-1111-4111-8111-111111111111';
const STORE_TWO = '88888888-8888-4888-8888-888888888888';
const OPERATOR_ONE = '22222222-2222-4222-8222-222222222222';
const OPERATOR_TWO = '99999999-9999-4999-8999-999999999999';
const SCOPE_ONE = {
  serverUrl: 'https://one.example.test',
  storeId: STORE_ONE,
  operatorId: OPERATOR_ONE,
  deviceId: 'android-installation-1',
};
const TEST_SCOPE = {
  serverUrl: 'https://example.test',
  storeId: 'store-1',
  operatorId: 'staff-1',
  deviceId: 'device-1',
};

function openServerShift(id = SHIFT_ONE, storeId = STORE_ONE) {
  return {
    id, storeId, openedBy: OPERATOR_ONE, closedBy: null, status: 'open' as const,
    openingFloatCents: 10000, expectedCashCents: null, countedCashCents: null,
    differenceCashCents: null, openedAt: '2026-07-18T09:00:00.000Z', closedAt: null,
  };
}

function closedServerShift(id = SHIFT_ONE, storeId = STORE_ONE) {
  return {
    ...openServerShift(id, storeId),
    status: 'closed' as const,
    closedBy: OPERATOR_ONE,
    expectedCashCents: 10000,
    countedCashCents: 10000,
    differenceCashCents: 0,
    closedAt: '2026-07-18T18:00:00.000Z',
    reconciliation: {
      cashSalesCents: 0,
      cashRefundCents: 0,
      cashInCents: 0,
      cashOutCents: 0,
    },
  };
}

function scopedSource(
  scope = SCOPE_ONE,
  patch: Record<string, unknown> = {},
): PosDataSource {
  return {
    kind: 'tradingweb',
    getSourceScope: () => scope,
    getCurrentShift: vi.fn(async () => openServerShift()),
    openShift: vi.fn(async () => openServerShift()),
    ...patch,
  } as unknown as PosDataSource;
}

async function persistShiftState(state: Record<string, unknown>, version = 2): Promise<void> {
  await AsyncStorage.setItem('twpos-shift', JSON.stringify({ state, version }));
  await useShift.persist.rehydrate();
}

describe('useShift store', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useShift.setState(closedState() as any);
  });

  // ── 1. openShift ──────────────────────────────────────────────

  it('openShift sets open=true, floatCents, and resets counters', () => {
    // Pre-pollute state to ensure counters are actually reset
    useShift.setState({ ordersCount: 5, salesTotalCents: 9999, cashSalesCents: 500 });

    useShift.getState().openShift(10000, 'Alice');
    const s = useShift.getState();

    expect(s.open).toBe(true);
    expect(s.floatCents).toBe(10000);
    expect(s.openedBy).toBe('Alice');
    expect(s.openedAt).toBeTypeOf('number');
    expect(s.ordersCount).toBe(0);
    expect(s.salesTotalCents).toBe(0);
    expect(s.cashSalesCents).toBe(0);
    expect(s.cashRefundCents).toBe(0);
    expect(s.movements).toEqual([]);
  });

  // ── 2. recordOrder ────────────────────────────────────────────

  it('recordOrder increments ordersCount, salesTotalCents, and cashSalesCents', () => {
    useShift.getState().openShift(5000, 'Bob');
    useShift.getState().recordOrder(2500, 2500);
    useShift.getState().recordOrder(1800, 1800);

    const s = useShift.getState();
    expect(s.ordersCount).toBe(2);
    expect(s.salesTotalCents).toBe(4300);
    expect(s.cashSalesCents).toBe(4300);
  });

  // ── 3. recordRefund ───────────────────────────────────────────

  it('recordRefund decreases salesTotalCents and increases cashRefundCents', () => {
    useShift.getState().openShift(5000, 'Bob');
    useShift.getState().recordOrder(3000, 3000);
    useShift.getState().recordRefund(1000, 1000);

    const s = useShift.getState();
    expect(s.salesTotalCents).toBe(2000);
    expect(s.cashRefundCents).toBe(1000);
  });

  // ── 4. recordCashMovement ─────────────────────────────────────

  it('recordCashMovement adds a movement to the list', () => {
    useShift.getState().openShift(5000, 'Bob');
    useShift.getState().recordCashMovement('in', '零钱补充', 2000, 'Bob');

    const s = useShift.getState();
    expect(s.movements).toHaveLength(1);
    expect(s.movements[0].kind).toBe('in');
    expect(s.movements[0].label).toBe('零钱补充');
    expect(s.movements[0].amountCents).toBe(2000);
    expect(s.movements[0].by).toBe('Bob');
    expect(s.movements[0].id).toBeTruthy();
    expect(s.movements[0].at).toBeTypeOf('number');
  });

  // ── 5. expectedCashCents formula ──────────────────────────────

  it('expectedCashCents = float + cashSales − cashRefunds + cashIn − cashOut', () => {
    useShift.getState().openShift(10000, 'Charlie');

    // Record sales
    useShift.getState().recordOrder(5000, 5000);
    useShift.getState().recordOrder(3000, 3000);

    // Record refund
    useShift.getState().recordRefund(1000, 1000);

    // Cash movements
    useShift.getState().recordCashMovement('in', '零钱补入', 2000, 'Charlie');
    useShift.getState().recordCashMovement('out', '备用金取出', 1500, 'Charlie');
    useShift.getState().recordCashMovement('in', '补零钱', 500, 'Charlie');

    // expected = 10000 + 8000 - 1000 + (2000+500) - 1500 = 18000
    expect(useShift.getState().expectedCashCents()).toBe(18000);
  });

  // ── 6. closeShift returns correct ShiftReceiptData ────────────

  it('closeShift returns correct ShiftReceiptData with all fields', () => {
    useShift.getState().openShift(5000, 'Alice');
    useShift.getState().recordOrder(2000, 2000);
    useShift.getState().recordCashMovement('in', '补充', 1000, 'Alice');

    const summary = useShift.getState().closeShift(8500, 'Bob');

    expect(summary.openedBy).toBe('Alice');
    expect(summary.closedBy).toBe('Bob');
    expect(summary.floatCents).toBe(5000);
    expect(summary.cashSalesCents).toBe(2000);
    expect(summary.cashRefundCents).toBe(0);
    expect(summary.cashInCents).toBe(1000);
    expect(summary.cashOutCents).toBe(0);
    expect(summary.expectedCents).toBe(8000); // 5000 + 2000 + 1000
    expect(summary.countedCents).toBe(8500);
    expect(summary.ordersCount).toBe(1);
    expect(summary.salesTotalCents).toBe(2000);
    expect(summary.openedAt).toBeTypeOf('number');
    expect(summary.closedAt).toBeTypeOf('number');
  });

  // ── 7. closeShift resets state to closed ──────────────────────

  it('closeShift resets state to closed', () => {
    useShift.getState().openShift(5000, 'Alice');
    useShift.getState().recordOrder(2000, 2000);
    useShift.getState().closeShift(7000, 'Bob');

    const s = useShift.getState();
    expect(s.open).toBe(false);
    expect(s.openedAt).toBeNull();
    expect(s.openedBy).toBe('');
    expect(s.floatCents).toBe(0);
    expect(s.cashSalesCents).toBe(0);
    expect(s.cashRefundCents).toBe(0);
    expect(s.movements).toEqual([]);
    expect(s.ordersCount).toBe(0);
    expect(s.salesTotalCents).toBe(0);
  });

  // ── 8. closeShift stores lastSummary ──────────────────────────

  it('closeShift stores lastSummary in state', () => {
    useShift.getState().openShift(3000, 'Alice');
    useShift.getState().recordOrder(1500, 1500);

    const summary = useShift.getState().closeShift(4500, 'Bob');
    const s = useShift.getState();

    expect(s.lastSummary).not.toBeNull();
    expect(s.lastSummary).toEqual(summary);
    expect(s.lastSummary!.floatCents).toBe(3000);
    expect(s.lastSummary!.cashSalesCents).toBe(1500);
  });

  // ── 9. closeShift diffCents = countedCents − expectedCents ────

  it('closeShift diffCents = countedCents − expectedCents', () => {
    useShift.getState().openShift(10000, 'Alice');
    useShift.getState().recordOrder(5000, 5000);

    // Expected = 10000 + 5000 = 15000
    // Count short: 14500
    const summary = useShift.getState().closeShift(14500, 'Bob');
    expect(summary.diffCents).toBe(-500);

    // Re-open and count over
    useShift.getState().openShift(10000, 'Alice');
    useShift.getState().recordOrder(5000, 5000);
    const summary2 = useShift.getState().closeShift(16000, 'Bob');
    expect(summary2.diffCents).toBe(1000);
  });

  // ── 10. Full lifecycle ────────────────────────────────────────

  it('full shift lifecycle: open → orders → cash movements → refund → close → verify summary', () => {
    // Open
    useShift.getState().openShift(20000, 'Manager');
    expect(useShift.getState().open).toBe(true);

    // Orders
    useShift.getState().recordOrder(8800, 8800);   // cash sale
    useShift.getState().recordOrder(4200, 4200);   // cash sale
    useShift.getState().recordOrder(6000, 0);       // card-only sale (no cash)

    // Cash movements
    useShift.getState().recordCashMovement('in', '零钱补入', 5000, 'Manager');
    useShift.getState().recordCashMovement('out', '银行存款', 3000, 'Manager');

    // Refund
    useShift.getState().recordRefund(2000, 2000);

    // Pre-close assertions
    const preClosed = useShift.getState();
    expect(preClosed.ordersCount).toBe(3);
    expect(preClosed.salesTotalCents).toBe(17000); // 8800+4200+6000 - 2000
    expect(preClosed.cashSalesCents).toBe(13000);  // 8800+4200
    expect(preClosed.cashRefundCents).toBe(2000);
    expect(preClosed.movements).toHaveLength(2);

    // expected = 20000 + 13000 - 2000 + 5000 - 3000 = 33000
    expect(preClosed.expectedCashCents()).toBe(33000);

    // Close
    const summary = useShift.getState().closeShift(33200, 'Cashier');
    expect(summary.floatCents).toBe(20000);
    expect(summary.cashSalesCents).toBe(13000);
    expect(summary.cashRefundCents).toBe(2000);
    expect(summary.cashInCents).toBe(5000);
    expect(summary.cashOutCents).toBe(3000);
    expect(summary.expectedCents).toBe(33000);
    expect(summary.countedCents).toBe(33200);
    expect(summary.diffCents).toBe(200);
    expect(summary.ordersCount).toBe(3);
    expect(summary.salesTotalCents).toBe(17000);
    expect(summary.openedBy).toBe('Manager');
    expect(summary.closedBy).toBe('Cashier');

    // State is reset
    expect(useShift.getState().open).toBe(false);
    expect(useShift.getState().lastSummary).toEqual(summary);
  });

  // ── 11. Multiple cash movements of different kinds ────────────

  it('handles multiple cash movements of different kinds correctly', () => {
    useShift.getState().openShift(10000, 'Alice');

    useShift.getState().recordCashMovement('in', '零钱补入 1', 3000, 'Alice');
    useShift.getState().recordCashMovement('in', '零钱补入 2', 2000, 'Alice');
    useShift.getState().recordCashMovement('out', '存款 1', 1500, 'Alice');
    useShift.getState().recordCashMovement('out', '存款 2', 500, 'Alice');
    useShift.getState().recordCashMovement('in', '补零', 100, 'Alice');

    const s = useShift.getState();
    expect(s.movements).toHaveLength(5);

    // expected = 10000 + 0 (no cash sales) - 0 (no refunds) + (3000+2000+100) - (1500+500) = 13100
    expect(s.expectedCashCents()).toBe(13100);

    const summary = useShift.getState().closeShift(13100, 'Bob');
    expect(summary.cashInCents).toBe(5100);
    expect(summary.cashOutCents).toBe(2000);
    expect(summary.diffCents).toBe(0);
  });

  // ── 12. Edge: recordOrder with zero cashCents (card-only) ─────

  it('recordOrder with zero cashCents (card-only sale) does not affect cash totals', () => {
    useShift.getState().openShift(5000, 'Alice');

    // Card-only sale
    useShift.getState().recordOrder(10000, 0);

    const s = useShift.getState();
    expect(s.ordersCount).toBe(1);
    expect(s.salesTotalCents).toBe(10000);
    expect(s.cashSalesCents).toBe(0);
    // Expected cash is just the float since no cash was tendered
    expect(s.expectedCashCents()).toBe(5000);

    const summary = useShift.getState().closeShift(5000, 'Bob');
    expect(summary.cashSalesCents).toBe(0);
    expect(summary.salesTotalCents).toBe(10000);
    expect(summary.expectedCents).toBe(5000);
    expect(summary.diffCents).toBe(0);
  });

  // ── 13. Bonus: recordRefund without prior cash sales ──────────

  it('recordRefund works even without prior sales (negative expected cash)', () => {
    useShift.getState().openShift(5000, 'Alice');
    useShift.getState().recordRefund(3000, 3000);

    // expected = 5000 + 0 - 3000 = 2000
    expect(useShift.getState().expectedCashCents()).toBe(2000);
    expect(useShift.getState().salesTotalCents).toBe(-3000);
  });

  // ── 14. Bonus: movements are prepended (newest first) ─────────

  it('movements are prepended (newest first)', () => {
    useShift.getState().openShift(5000, 'Alice');
    useShift.getState().recordCashMovement('in', 'First', 100, 'Alice');
    useShift.getState().recordCashMovement('out', 'Second', 200, 'Alice');

    const s = useShift.getState();
    expect(s.movements[0].label).toBe('Second');
    expect(s.movements[1].label).toBe('First');
  });

  it('reuses the same cash-movement idempotency key after response loss', async () => {
    const keys: string[] = [];
    const source = {
      kind: 'tradingweb',
      getSourceScope: () => TEST_SCOPE,
      getCurrentShift: vi.fn(async () => ({
        id: 'shift-1', storeId: 'store-1', openedBy: 'staff-1', closedBy: null, status: 'open',
        openingFloatCents: 10000, expectedCashCents: null, countedCashCents: null,
        differenceCashCents: null, openedAt: '2026-07-18T09:00:00.000Z', closedAt: null,
      })),
      recordCashMovement: vi.fn(async (_id: string, input: { idempotencyKey: string }) => {
        keys.push(input.idempotencyKey);
        if (keys.length === 1) throw new Error('response lost');
        return {
          id: 'movement-1', shiftId: 'shift-1', kind: 'out', amountCents: 500, reason: 'Courier',
          operatorId: 'staff-1', idempotencyKey: input.idempotencyKey, createdAt: '2026-07-18T10:00:00.000Z',
        };
      }),
    } as unknown as PosDataSource;
    await useShift.getState().recoverCurrentShift(source);

    await expect(useShift.getState().recordCashMovementWithSource(
      source, 'out', 'Courier', 500, 'Clerk',
    )).rejects.toThrow('response lost');
    expect(useShift.getState().movements).toEqual([]);

    await useShift.getState().recordCashMovementWithSource(source, 'out', 'Courier', 500, 'Clerk');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(keys[1]).toBe(keys[0]);
    expect(useShift.getState().movements).toHaveLength(1);
  });

  it('keeps the shift open on close response loss and uses the server reconciliation on replay', async () => {
    const keys: string[] = [];
    const source = {
      kind: 'tradingweb',
      getSourceScope: () => TEST_SCOPE,
      getCurrentShift: vi.fn(async () => ({
        id: 'shift-1', storeId: 'store-1', openedBy: 'staff-1', closedBy: null, status: 'open',
        openingFloatCents: 10000, expectedCashCents: null, countedCashCents: null,
        differenceCashCents: null, openedAt: '2026-07-18T09:00:00.000Z', closedAt: null,
      })),
      closeShift: vi.fn(async (_id: string, input: { idempotencyKey: string }) => {
        keys.push(input.idempotencyKey);
        if (keys.length === 1) throw new Error('response lost');
        return {
          id: 'shift-1', storeId: 'store-1', openedBy: 'staff-1', closedBy: 'staff-1', status: 'closed',
          openingFloatCents: 10000, expectedCashCents: 20500, countedCashCents: 19500,
          differenceCashCents: -1000, openedAt: '2026-07-18T09:00:00.000Z',
          closedAt: '2026-07-18T18:00:00.000Z',
          reconciliation: { cashSalesCents: 12000, cashRefundCents: 1000, cashInCents: 500, cashOutCents: 1000 },
        };
      }),
    } as unknown as PosDataSource;
    await useShift.getState().recoverCurrentShift(source);
    useShift.getState().recordOrder(999999, 999999);

    await expect(useShift.getState().closeShiftWithSource(source, 19500, 'Closer')).rejects.toThrow('response lost');
    expect(useShift.getState().open).toBe(true);
    const summary = await useShift.getState().closeShiftWithSource(source, 19500, 'Closer');

    expect(keys[1]).toBe(keys[0]);
    expect(summary).toMatchObject({
      floatCents: 10000, cashSalesCents: 12000, cashRefundCents: 1000,
      cashInCents: 500, cashOutCents: 1000, expectedCents: 20500,
      countedCents: 19500, diffCents: -1000, accountingSource: 'server',
    });
    expect(summary.salesTotalCents).toBe(0);
    expect(summary.ordersCount).toBe(0);
    expect(useShift.getState()).toMatchObject({ open: false, lastSummary: summary });
  });

  it('replays a persisted close key during restart recovery when the server shift is already closed', async () => {
    useShift.setState({
      open: true,
      accountingSource: 'server',
      serverShiftId: 'shift-1',
      serverScope: TEST_SCOPE,
      pendingClose: {
        shiftId: 'shift-1', countedCents: 19500, by: 'Closer', idempotencyKey: 'close-stable-restart',
        scope: TEST_SCOPE,
      },
    } as any);
    const source = {
      kind: 'tradingweb',
      getSourceScope: () => TEST_SCOPE,
      getCurrentShift: vi.fn(async () => null),
      closeShift: vi.fn(async () => ({
        id: 'shift-1', storeId: 'store-1', openedBy: 'staff-1', closedBy: 'staff-1', status: 'closed',
        openingFloatCents: 10000, expectedCashCents: 20500, countedCashCents: 19500,
        differenceCashCents: -1000, openedAt: '2026-07-18T09:00:00.000Z',
        closedAt: '2026-07-18T18:00:00.000Z',
        reconciliation: { cashSalesCents: 12000, cashRefundCents: 1000, cashInCents: 500, cashOutCents: 1000 },
      })),
    } as unknown as PosDataSource;

    await useShift.getState().recoverCurrentShift(source);

    expect(source.closeShift).toHaveBeenCalledWith('shift-1', {
      countedCents: 19500, idempotencyKey: 'close-stable-restart',
    });
    expect(useShift.getState()).toMatchObject({
      open: false,
      pendingClose: null,
      lastSummary: { accountingSource: 'server', expectedCents: 20500, countedCents: 19500 },
    });
  });

  it('replays a persisted cash movement key after recovering the same open shift', async () => {
    useShift.setState({
      open: true,
      accountingSource: 'server',
      serverShiftId: 'shift-1',
      serverScope: TEST_SCOPE,
      pendingCashMovement: {
        shiftId: 'shift-1', kind: 'in', label: 'Float', amountCents: 500, by: 'Clerk',
        idempotencyKey: 'cash-stable-restart',
        scope: TEST_SCOPE,
      },
    } as any);
    const openShift = {
      id: 'shift-1', storeId: 'store-1', openedBy: 'staff-1', closedBy: null, status: 'open' as const,
      openingFloatCents: 10000, expectedCashCents: null, countedCashCents: null,
      differenceCashCents: null, openedAt: '2026-07-18T09:00:00.000Z', closedAt: null,
    };
    const source = {
      kind: 'tradingweb',
      getSourceScope: () => TEST_SCOPE,
      getCurrentShift: vi.fn(async () => openShift),
      recordCashMovement: vi.fn(async () => ({
        id: 'movement-1', shiftId: 'shift-1', kind: 'in', amountCents: 500, reason: 'Float',
        operatorId: 'staff-1', idempotencyKey: 'cash-stable-restart', createdAt: '2026-07-18T10:00:00.000Z',
      })),
    } as unknown as PosDataSource;

    await useShift.getState().recoverCurrentShift(source);

    expect(source.recordCashMovement).toHaveBeenCalledWith('shift-1', {
      kind: 'in', amountCents: 500, reason: 'Float', idempotencyKey: 'cash-stable-restart',
    });
    expect(useShift.getState()).toMatchObject({ pendingCashMovement: null });
    expect(useShift.getState().movements).toEqual([
      expect.objectContaining({ id: 'movement-1', amountCents: 500 }),
    ]);
  });

  it('persists and rehydrates the immutable scope of a server-backed shift', async () => {
    const source = scopedSource();

    await useShift.getState().openShiftWithSource(source, 10000, 'Clerk');
    const persisted = JSON.parse(String(await AsyncStorage.getItem('twpos-shift')));
    expect(persisted.state.serverScope).toEqual(SCOPE_ONE);

    useShift.setState(closedState() as any);
    await AsyncStorage.setItem('twpos-shift', JSON.stringify(persisted));
    await useShift.persist.rehydrate();
    expect((useShift.getState() as any).serverScope).toEqual(SCOPE_ONE);
    expect(useShift.getState()).toMatchObject({ open: true, serverShiftId: SHIFT_ONE });
  });

  it.each([
    ['server', { serverUrl: 'https://two.example.test' }],
    ['store', { storeId: STORE_TWO }],
    ['operator', { operatorId: OPERATOR_TWO }],
    ['device', { deviceId: 'android-installation-2' }],
  ])('refuses %s-scoped recovery before any server mutation', async (_label, changed) => {
    await persistShiftState({
      ...closedState(),
      open: true,
      accountingSource: 'server',
      serverShiftId: SHIFT_ONE,
      serverScope: SCOPE_ONE,
      pendingCashMovement: {
        shiftId: SHIFT_ONE,
        kind: 'out',
        label: 'Courier',
        amountCents: 500,
        by: 'Clerk',
        idempotencyKey: 'stable-cross-scope',
        scope: SCOPE_ONE,
      },
    });
    const getCurrentShift = vi.fn(async () => openServerShift());
    const recordCashMovement = vi.fn(async (_shiftId: string, input: any) => ({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      shiftId: SHIFT_ONE,
      kind: 'out' as const,
      amountCents: 500,
      reason: 'Courier',
      operatorId: OPERATOR_ONE,
      idempotencyKey: input.idempotencyKey,
      createdAt: '2026-07-18T10:00:00.000Z',
    }));
    const source = scopedSource({ ...SCOPE_ONE, ...changed }, { getCurrentShift, recordCashMovement });

    await expect(useShift.getState().recoverCurrentShift(source)).rejects.toThrow(/scope/i);

    expect(getCurrentShift).not.toHaveBeenCalled();
    expect(recordCashMovement).not.toHaveBeenCalled();
    expect(useShift.getState().pendingCashMovement).toMatchObject({
      idempotencyKey: 'stable-cross-scope',
    });
  });

  it('keeps a pending cash conflict and stable key when the current shift changed', async () => {
    const first = scopedSource(SCOPE_ONE, {
      recordCashMovement: vi.fn(async () => { throw new Error('response lost'); }),
    });
    await useShift.getState().openShiftWithSource(first, 10000, 'Clerk');
    await expect(useShift.getState().recordCashMovementWithSource(
      first, 'out', 'Courier', 500, 'Clerk',
    )).rejects.toThrow('response lost');
    const pending = useShift.getState().pendingCashMovement as any;
    const changed = scopedSource(SCOPE_ONE, {
      getCurrentShift: vi.fn(async () => openServerShift(SHIFT_TWO)),
      recordCashMovement: vi.fn(),
    });

    await expect(useShift.getState().recoverCurrentShift(changed)).rejects.toThrow(/unresolved cash movement/i);

    expect(useShift.getState().pendingCashMovement).toEqual(pending);
    expect((changed.recordCashMovement as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('treats pending cash and close requests as one financial lock', async () => {
    const cashPending = scopedSource(SCOPE_ONE, {
      recordCashMovement: vi.fn(async () => { throw new Error('cash response lost'); }),
      closeShift: vi.fn(async () => closedServerShift()),
    });
    await useShift.getState().openShiftWithSource(cashPending, 10000, 'Clerk');
    await expect(useShift.getState().recordCashMovementWithSource(
      cashPending, 'out', 'Courier', 500, 'Clerk',
    )).rejects.toThrow('cash response lost');
    await expect(useShift.getState().closeShiftWithSource(cashPending, 9500, 'Clerk'))
      .rejects.toThrow(/cash movement/i);
    expect(cashPending.closeShift).not.toHaveBeenCalled();

    useShift.setState(closedState() as any);
    const closePending = scopedSource(SCOPE_ONE, {
      closeShift: vi.fn(async () => { throw new Error('close response lost'); }),
      recordCashMovement: vi.fn(),
    });
    await useShift.getState().openShiftWithSource(closePending, 10000, 'Clerk');
    await expect(useShift.getState().closeShiftWithSource(closePending, 10000, 'Clerk'))
      .rejects.toThrow('close response lost');
    await expect(useShift.getState().recordCashMovementWithSource(
      closePending, 'in', 'Float', 500, 'Clerk',
    )).rejects.toThrow(/close/i);
    expect(closePending.recordCashMovement).not.toHaveBeenCalled();
  });

  it('recovers an open POST response loss only from a matching current store and scope', async () => {
    const recovered = scopedSource(SCOPE_ONE, {
      openShift: vi.fn(async () => { throw new Error('open response lost'); }),
      getCurrentShift: vi.fn(async () => openServerShift()),
    });

    await useShift.getState().openShiftWithSource(recovered, 10000, 'Clerk');

    expect(recovered.getCurrentShift).toHaveBeenCalledOnce();
    expect(useShift.getState()).toMatchObject({ open: true, serverShiftId: SHIFT_ONE });
    expect((useShift.getState() as any).serverScope).toEqual(SCOPE_ONE);

    useShift.setState(closedState() as any);
    const wrongStore = scopedSource(SCOPE_ONE, {
      openShift: vi.fn(async () => { throw new Error('open response lost'); }),
      getCurrentShift: vi.fn(async () => openServerShift(SHIFT_TWO, STORE_TWO)),
    });
    await expect(useShift.getState().openShiftWithSource(wrongStore, 10000, 'Clerk'))
      .rejects.toThrow(/store|scope/i);
    expect(useShift.getState()).toMatchObject({ open: false, serverShiftId: null });
  });

  it('fails closed when legacy persisted server state has no immutable scope', async () => {
    await persistShiftState({
      ...closedState(),
      open: true,
      accountingSource: 'server',
      serverShiftId: SHIFT_ONE,
      pendingClose: {
        shiftId: SHIFT_ONE,
        countedCents: 10000,
        by: 'Clerk',
        idempotencyKey: 'legacy-unscoped-close',
      },
    }, 1);
    const source = scopedSource(SCOPE_ONE, {
      closeShift: vi.fn(async () => closedServerShift()),
    });

    await expect(useShift.getState().recoverCurrentShift(source)).rejects.toThrow(/scope/i);
    expect(source.getCurrentShift).not.toHaveBeenCalled();
    expect(useShift.getState().pendingClose).toMatchObject({ idempotencyKey: 'legacy-unscoped-close' });
  });

  it('retains pending cash facts when a malformed 2xx movement does not match the request', async () => {
    const source = scopedSource(SCOPE_ONE, {
      recordCashMovement: vi.fn(async (_shiftId: string, input: { idempotencyKey: string }) => ({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        shiftId: SHIFT_TWO,
        kind: 'in',
        amountCents: 1,
        reason: 'Different',
        operatorId: OPERATOR_ONE,
        idempotencyKey: `${input.idempotencyKey}-changed`,
        createdAt: '2026-07-18T10:00:00.000Z',
      })),
    });
    await useShift.getState().openShiftWithSource(source, 10000, 'Clerk');

    await expect(useShift.getState().recordCashMovementWithSource(
      source, 'out', 'Courier', 500, 'Clerk',
    )).rejects.toThrow(/match|malformed|response/i);

    expect(useShift.getState().movements).toEqual([]);
    expect(useShift.getState().pendingCashMovement).toMatchObject({
      shiftId: SHIFT_ONE,
      kind: 'out',
      amountCents: 500,
      idempotencyKey: expect.any(String),
    });
  });

  it('retains pending close and produces no receipt for a non-closed 2xx response', async () => {
    const source = scopedSource(SCOPE_ONE, {
      closeShift: vi.fn(async () => ({
        ...openServerShift(),
        expectedCashCents: 10000,
        countedCashCents: 10000,
        differenceCashCents: 0,
        closedBy: OPERATOR_ONE,
        closedAt: '2026-07-18T18:00:00.000Z',
        reconciliation: {
          cashSalesCents: 0,
          cashRefundCents: 0,
          cashInCents: 0,
          cashOutCents: 0,
        },
      })),
    });
    await useShift.getState().openShiftWithSource(source, 10000, 'Clerk');

    await expect(useShift.getState().closeShiftWithSource(source, 10000, 'Clerk'))
      .rejects.toThrow(/closed|response|reconciliation/i);

    expect(useShift.getState()).toMatchObject({ open: true, lastSummary: null });
    expect(useShift.getState().pendingClose).toMatchObject({ idempotencyKey: expect.any(String) });
  });

  it.each([
    ['open', (source: PosDataSource) => useShift.getState().openShiftWithSource(source, 20000, 'Mock Clerk')],
    ['cash movement', (source: PosDataSource) => useShift.getState().recordCashMovementWithSource(
      source, 'out', 'Mock cash out', 500, 'Mock Clerk',
    )],
    ['close', (source: PosDataSource) => useShift.getState().closeShiftWithSource(source, 10000, 'Mock Clerk')],
  ])('fails closed before a mock %s can mutate server-backed shift state', async (_label, action) => {
    useShift.setState({
      ...closedState(),
      open: true,
      openedAt: Date.parse('2026-07-18T09:00:00.000Z'),
      openedBy: 'Server Clerk',
      floatCents: 10000,
      accountingSource: 'server',
      serverShiftId: SHIFT_ONE,
      serverScope: SCOPE_ONE,
    } as any);
    const mockSource = { kind: 'mock', getSourceScope: () => null } as unknown as PosDataSource;

    await expect(action(mockSource)).rejects.toThrow(/server|TradingWEB|financial/i);

    expect(useShift.getState()).toMatchObject({
      open: true,
      openedBy: 'Server Clerk',
      floatCents: 10000,
      accountingSource: 'server',
      serverShiftId: SHIFT_ONE,
      serverScope: SCOPE_ONE,
      movements: [],
      pendingCashMovement: null,
      pendingClose: null,
      lastSummary: null,
    });
  });

  it('retains pending close when a closed response has inconsistent reconciliation facts', async () => {
    const source = scopedSource(SCOPE_ONE, {
      closeShift: vi.fn(async () => ({
        ...closedServerShift(),
        expectedCashCents: 9999,
        differenceCashCents: 1,
      })),
    });
    await useShift.getState().openShiftWithSource(source, 10000, 'Clerk');

    await expect(useShift.getState().closeShiftWithSource(source, 10000, 'Clerk'))
      .rejects.toThrow(/reconciliation|expected|response/i);

    expect(useShift.getState()).toMatchObject({ open: true, lastSummary: null });
    expect(useShift.getState().pendingClose).toMatchObject({
      shiftId: SHIFT_ONE,
      countedCents: 10000,
      scope: SCOPE_ONE,
      idempotencyKey: expect.any(String),
    });
  });

  it('resolves recovered server operator IDs to current display names for shift UI and receipt', async () => {
    useAuth.setState({
      staffList: [{
        id: OPERATOR_ONE,
        name: 'Alice Clerk',
        role: 'staff',
        pin: null,
      }],
      currentStaff: {
        id: OPERATOR_ONE,
        name: 'Alice Clerk',
        role: 'staff',
        pin: null,
      },
    });
    const source = scopedSource(SCOPE_ONE, {
      closeShift: vi.fn(async () => ({
        ...openServerShift(),
        status: 'closed' as const,
        closedBy: OPERATOR_ONE,
        expectedCashCents: 10000,
        countedCashCents: 10000,
        differenceCashCents: 0,
        closedAt: '2026-07-18T18:00:00.000Z',
        reconciliation: {
          cashSalesCents: 0,
          cashRefundCents: 0,
          cashInCents: 0,
          cashOutCents: 0,
        },
      })),
    });

    await useShift.getState().recoverCurrentShift(source);
    expect(useShift.getState().openedBy).toBe('Alice Clerk');
    const receipt = await useShift.getState().closeShiftWithSource(source, 10000, 'Alice Clerk');
    expect(receipt).toMatchObject({ openedBy: 'Alice Clerk', closedBy: 'Alice Clerk' });
  });
});
