import * as SecureStore from 'expo-secure-store';
import { describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import {
  getOperatorSessionToken,
  lockOperator,
  requireAccountReauthentication,
  requestApproval,
  unlockOperator,
} from '../operatorSession';
import { IDS } from '@/test/fixtures/pos';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('TradingWEB operator session', () => {
  it('mints approval with a temporary manager session without persisting it and restores the clerk', async () => {
    useAuth.setState({ token: 'account-jwt' });
    useSettings.setState({ serverUrl: 'https://example.test', dataSource: 'tradingweb', storeId: IDS.store });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ data: {
        contract_version: 'pos-v1', store: { id: IDS.store, name: 'Main Store' }, currency: 'USD', tax_rate: '0',
        promotions: [], pricing_version: 'pricing-v1', payment_methods: [], operator_session_ttl_seconds: 28800, approval_ttl_seconds: 300,
      } }))
      .mockResolvedValueOnce(json({ data: {
        token: 'clerk-session', operator: { accountUserId: 'user-1', staffId: IDS.staff, storeId: IDS.store, deviceId: 'device-1', permissions: ['refund'] },
        expiresAt: '2099-07-18T12:00:00.000Z',
      } }, 201))
      .mockResolvedValueOnce(json({ data: {
        token: 'manager-session', operator: { accountUserId: 'user-1', staffId: 'manager-1', storeId: IDS.store, deviceId: 'device-1', permissions: ['refund'] },
        expiresAt: '2099-07-18T12:00:00.000Z',
      } }, 201))
      .mockResolvedValueOnce(json({ data: { token: 'one-time-approval', expiresAt: '2099-07-18T12:05:00.000Z' } }, 201))
      .mockResolvedValueOnce(json({ data: { revoked: true } }));

    await unlockOperator(IDS.staff, '1111', IDS.store);
    vi.mocked(SecureStore.setItemAsync).mockClear();

    await expect(requestApproval('refund', 'a'.repeat(64), 'manager-1', '9876')).resolves.toBe('one-time-approval');

    expect(getOperatorSessionToken()).toBe('clerk-session');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(
      'twpos.operator-session.v1', expect.stringContaining('manager-session'),
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('9876'));
    expect(vi.mocked(globalThis.fetch).mock.calls[3][1]?.headers).toMatchObject({
      'X-POS-Operator-Session': 'manager-session',
    });
  });

  it('bootstraps the store, stores the raw token only in SecureStore, and revokes it on lock', async () => {
    useAuth.setState({ token: 'account-jwt' });
    useAuth.setState({
      currentStaff: { id: IDS.staff, name: 'Clerk', role: 'staff', permissions: [] },
      staffList: [{ id: IDS.staff, name: 'Clerk', role: 'staff', permissions: [] }],
    });
    useSettings.setState({ serverUrl: 'https://example.test', dataSource: 'tradingweb' });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ data: {
        contract_version: 'pos-v1',
        store: { id: IDS.store, name: 'Main Store' },
        currency: 'USD',
        tax_rate: '0.15',
        promotions: [],
        pricing_version: 'pricing-v1',
        payment_methods: [{ code: 'cash', label: 'Cash', type: 'offline_manual' }],
        operator_session_ttl_seconds: 28800,
        approval_ttl_seconds: 300,
      } }))
      .mockResolvedValueOnce(json({ data: {
        token: 'raw-operator-token',
        operator: {
          accountUserId: 'user-1', staffId: IDS.staff, storeId: IDS.store,
          deviceId: 'android-installation-1', permissions: ['checkout', 'not-a-pos-permission'],
        },
        expiresAt: '2099-07-15T12:00:00.000Z',
      } }, 201))
      .mockResolvedValueOnce(json({ data: { revoked: true } }));

    await unlockOperator(IDS.staff, '123456', IDS.store);

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      `https://example.test/api/admin/pos/bootstrap?store_id=${IDS.store}`,
    );
    expect(vi.mocked(globalThis.fetch).mock.calls[1][0]).toBe(
      'https://example.test/api/admin/pos/operator-sessions',
    );
    const sessionBody = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[1][1]?.body));
    expect(sessionBody).toMatchObject({ staff_id: IDS.staff, store_id: IDS.store, pin: '123456' });
    expect(getOperatorSessionToken()).toBe('raw-operator-token');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('twpos.operator-session.v1', expect.stringContaining('raw-operator-token'));
    expect(useSettings.getState()).toMatchObject({
      storeId: IDS.store,
      pricingVersion: 'pricing-v1',
      currency: 'USD',
      taxRateBps: 1500,
      paymentMethods: [{ method: 'cash', label: 'Cash', enabled: true }],
    });
    expect(useAuth.getState().currentStaff).toMatchObject({
      id: IDS.staff,
      permissions: ['checkout'],
    });
    expect(useAuth.getState().staffList.find((item) => item.id === IDS.staff)).toMatchObject({
      permissions: ['checkout'],
    });

    await lockOperator();

    expect(vi.mocked(globalThis.fetch).mock.calls[2][0]).toBe(
      'https://example.test/api/admin/pos/operator-sessions/current',
    );
    expect(vi.mocked(globalThis.fetch).mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
    expect(getOperatorSessionToken()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.operator-session.v1');
  });

  it('clears both the expired account token and operator session before reauthentication', async () => {
    useAuth.setState({ token: 'expired-account-jwt', account: null, staffList: [], currentStaff: null, locked: false });
    useSettings.setState({ serverUrl: 'https://example.test', dataSource: 'tradingweb' });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ data: {
        contract_version: 'pos-v1', store: { id: IDS.store, name: 'Main Store' }, currency: 'USD', tax_rate: '0',
        promotions: [], pricing_version: 'pricing-v1', payment_methods: [], operator_session_ttl_seconds: 28800, approval_ttl_seconds: 300,
      } }))
      .mockResolvedValueOnce(json({ data: {
        token: 'expired-operator-token',
        operator: { accountUserId: 'user-1', staffId: IDS.staff, storeId: IDS.store, deviceId: 'android-installation-1', permissions: ['checkout'] },
        expiresAt: '2099-07-15T12:00:00.000Z',
      } }, 201))
      .mockResolvedValueOnce(json({ data: { revoked: true } }));

    await unlockOperator(IDS.staff, '123456', IDS.store);
    await requireAccountReauthentication();

    expect(vi.mocked(globalThis.fetch).mock.calls[2]).toMatchObject([
      'https://example.test/api/admin/pos/operator-sessions/current',
      {
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer expired-account-jwt' }),
      },
    ]);
    expect(useAuth.getState()).toMatchObject({ token: null, account: null, currentStaff: null, locked: true });
    expect(getOperatorSessionToken()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.token.v2');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.operator-session.v1');
  });

  it('does not finish reauthentication while local credentials are still deleting', async () => {
    useAuth.setState({ token: 'expired-account-jwt', account: null, staffList: [], currentStaff: null, locked: false });
    useSettings.setState({ serverUrl: 'https://example.test', dataSource: 'tradingweb' });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ data: {
        contract_version: 'pos-v1', store: { id: IDS.store, name: 'Main Store' }, currency: 'USD', tax_rate: '0',
        promotions: [], pricing_version: 'pricing-v1', payment_methods: [], operator_session_ttl_seconds: 28800, approval_ttl_seconds: 300,
      } }))
      .mockResolvedValueOnce(json({ data: {
        token: 'expired-operator-token',
        operator: { accountUserId: 'user-1', staffId: IDS.staff, storeId: IDS.store, deviceId: 'android-installation-1', permissions: ['checkout'] },
        expiresAt: '2099-07-15T12:00:00.000Z',
      } }, 201))
      .mockResolvedValueOnce(json({ data: { revoked: true } }));
    await unlockOperator(IDS.staff, '123456', IDS.store);

    const tokenDeletion = deferred();
    const legacyTokenDeletion = deferred();
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation((key) => {
      if (key === 'twpos.token.v2') return tokenDeletion.promise;
      if (key === 'twpos.token') return legacyTokenDeletion.promise;
      return Promise.resolve();
    });

    let finished = false;
    const reauthentication = requireAccountReauthentication().then(() => { finished = true; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(finished).toBe(false);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.token.v2');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.operator-session.v1');
    const deletionKeys = vi.mocked(SecureStore.deleteItemAsync).mock.calls.map(([key]) => key);
    expect(deletionKeys.indexOf('twpos.operator-session.v1')).toBeLessThan(deletionKeys.indexOf('twpos.token.v2'));

    tokenDeletion.resolve();
    legacyTokenDeletion.resolve();
    await reauthentication;
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.operator-session.v1');
  });

  it('fails closed only after it also clears the operator session when account cleanup fails', async () => {
    useAuth.setState({ token: 'expired-account-jwt', account: null, staffList: [], currentStaff: null, locked: false });
    useSettings.setState({ serverUrl: 'https://example.test', dataSource: 'tradingweb' });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ data: {
        contract_version: 'pos-v1', store: { id: IDS.store, name: 'Main Store' }, currency: 'USD', tax_rate: '0',
        promotions: [], pricing_version: 'pricing-v1', payment_methods: [], operator_session_ttl_seconds: 28800, approval_ttl_seconds: 300,
      } }))
      .mockResolvedValueOnce(json({ data: {
        token: 'expired-operator-token',
        operator: { accountUserId: 'user-1', staffId: IDS.staff, storeId: IDS.store, deviceId: 'android-installation-1', permissions: ['checkout'] },
        expiresAt: '2099-07-15T12:00:00.000Z',
      } }, 201))
      .mockResolvedValueOnce(json({ data: { revoked: true } }));
    await unlockOperator(IDS.staff, '123456', IDS.store);

    vi.mocked(SecureStore.deleteItemAsync).mockImplementation((key) => {
      if (key === 'twpos.token.v2') return Promise.reject(new Error('secure store unavailable'));
      return Promise.resolve();
    });

    await expect(requireAccountReauthentication()).rejects.toThrow('secure store unavailable');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.operator-session.v1');
    expect(getOperatorSessionToken()).toBeNull();
  });

  it('clears local credentials and reports a failed remote revoke without blocking the reauthentication handoff', async () => {
    useAuth.setState({ token: 'expired-account-jwt', account: null, staffList: [], currentStaff: null, locked: false });
    useSettings.setState({ serverUrl: 'https://example.test', dataSource: 'tradingweb' });
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(json({ data: {
        contract_version: 'pos-v1', store: { id: IDS.store, name: 'Main Store' }, currency: 'USD', tax_rate: '0',
        promotions: [], pricing_version: 'pricing-v1', payment_methods: [], operator_session_ttl_seconds: 28800, approval_ttl_seconds: 300,
      } }))
      .mockResolvedValueOnce(json({ data: {
        token: 'expired-operator-token',
        operator: { accountUserId: 'user-1', staffId: IDS.staff, storeId: IDS.store, deviceId: 'android-installation-1', permissions: ['checkout'] },
        expiresAt: '2099-07-15T12:00:00.000Z',
      } }, 201))
      .mockResolvedValueOnce(json({ error: { message: 'already expired' } }, 401));
    await unlockOperator(IDS.staff, '123456', IDS.store);

    await expect(requireAccountReauthentication()).resolves.toMatchObject({ cleanupError: expect.anything() });
    expect(useAuth.getState()).toMatchObject({ token: null, account: null, currentStaff: null, locked: true });
    expect(getOperatorSessionToken()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.token.v2');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('twpos.operator-session.v1');
  });
});
