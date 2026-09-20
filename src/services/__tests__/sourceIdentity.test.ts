import { describe, expect, it } from 'vitest';

import { canSwitchSource, sourceIdentity } from '../sourceIdentity';
import * as sourceIdentityModule from '../sourceIdentity';

describe('POS source identity guard', () => {
  it('normalizes equivalent server URLs', () => {
    expect(sourceIdentity({ dataSource: 'tradingweb', serverUrl: 'HTTPS://EXAMPLE.TEST/', storeId: 'store-1' }))
      .toBe(sourceIdentity({ dataSource: 'tradingweb', serverUrl: 'https://example.test', storeId: 'store-1' }));
  });

  it('blocks source/server/store changes while cart or pending business state exists', () => {
    const current = { dataSource: 'mock' as const, serverUrl: '', storeId: null };
    expect(canSwitchSource(current, { ...current, dataSource: 'tradingweb', serverUrl: 'https://example.test' }, 1)).toBe(false);
    expect(canSwitchSource(current, { ...current, dataSource: 'tradingweb', serverUrl: 'https://example.test' }, 0)).toBe(true);
    expect(canSwitchSource(current, current, 5)).toBe(true);
  });

  it('blocks source or server changes while a server shift or financial action is unresolved', () => {
    const current = {
      dataSource: 'tradingweb' as const,
      serverUrl: 'https://one.example.test',
      storeId: 'store-1',
    };
    const nextServer = { ...current, serverUrl: 'https://two.example.test' };
    const nextSource = { ...current, dataSource: 'mock' as const };

    expect(canSwitchSource(current, nextServer, 0, 1)).toBe(false);
    expect(canSwitchSource(current, nextSource, 0, 1)).toBe(false);
    expect(canSwitchSource(current, current, 0, 1)).toBe(true);
    expect(canSwitchSource(current, nextServer, 0, 0)).toBe(true);
  });

  it.each([
    ['an open server shift', { open: true, accountingSource: 'server', pendingCashMovement: null, pendingClose: null }, 1],
    ['a pending cash movement', { open: false, accountingSource: 'local', pendingCashMovement: {}, pendingClose: null }, 1],
    ['a pending close', { open: false, accountingSource: 'local', pendingCashMovement: null, pendingClose: {} }, 1],
    ['all server financial state', { open: true, accountingSource: 'server', pendingCashMovement: {}, pendingClose: {} }, 3],
    ['only local state', { open: true, accountingSource: 'local', pendingCashMovement: null, pendingClose: null }, 0],
  ])('counts %s for the login source-switch gate', (_label, state, expected) => {
    const count = (sourceIdentityModule as typeof sourceIdentityModule & {
      serverFinancialStateCount: (value: typeof state) => number;
    }).serverFinancialStateCount(state);

    expect(count).toBe(expected);
  });
});
