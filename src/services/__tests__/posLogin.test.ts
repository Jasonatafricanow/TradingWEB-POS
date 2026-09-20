import { describe, expect, it, vi } from 'vitest';

import type { PosDataSource, Staff } from '@/api/types';
import { useAuth } from '@/stores/auth';
import { completeTradingWebUnlock } from '../posLogin';

const calls: string[] = [];

vi.mock('../operatorSession', () => ({
  unlockOperator: vi.fn(async () => { calls.push('session'); }),
  getUsableOperatorSessionPermissions: vi.fn(() => ['inventory_adjust']),
}));

describe('completeTradingWebUnlock Task 10 recovery', () => {
  it('creates the operator session before recovering the current server shift', async () => {
    calls.length = 0;
    const operator: Staff = {
      id: 'staff-1', name: 'Clerk', role: 'staff', storeId: 'store-1', permissions: ['checkout'],
    };
    useAuth.setState({ staffList: [operator], currentStaff: null, locked: true });
    const source = {
      kind: 'tradingweb',
      getSourceScope: () => ({
        serverUrl: 'https://example.test',
        storeId: 'store-1',
        operatorId: 'staff-1',
        deviceId: 'device-1',
      }),
      getCurrentShift: vi.fn(async () => {
        calls.push('shift');
        return {
          id: 'shift-1', storeId: 'store-1', openedBy: 'staff-1', closedBy: null, status: 'open',
          openingFloatCents: 10000, expectedCashCents: null, countedCashCents: null,
          differenceCashCents: null, openedAt: '2026-07-18T09:00:00.000Z', closedAt: null,
        };
      }),
      fetchApprovers: vi.fn(async () => []),
    } as unknown as PosDataSource;

    await completeTradingWebUnlock(source, operator, '1234', 'store-1');

    expect(calls).toEqual(['session', 'shift']);
    expect(source.getCurrentShift).toHaveBeenCalledOnce();
    expect(useAuth.getState()).toMatchObject({
      currentStaff: { ...operator, permissions: ['inventory_adjust'] },
      locked: false,
    });
  });
});
