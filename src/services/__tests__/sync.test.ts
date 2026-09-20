import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api';
import type { CreateOrderInput, PosDataSource } from '@/api/types';
import type { PendingOrder } from '@/stores/pending';
import { canAutoSyncPending, classifySyncError, shouldQueuePendingOrder, syncPendingOrder } from '../sync';

const mockGetSyncHmacKey = vi.fn<() => Promise<string | null>>();

vi.mock('@/services/syncIntegrityKey', () => ({
  getSyncHmacKey: () => mockGetSyncHmacKey(),
}));

const request: CreateOrderInput = {
  clientRef: 'pos-replay-001',
  staffId: 'staff-1',
  staffName: 'Cashier',
  customerId: null,
  customerName: null,
  note: null,
  currency: 'ZAR',
  items: [],
  discount: null,
  subtotalCents: 1000,
  discountCents: 0,
  taxCents: 0,
  totalCents: 1000,
  payments: [],
};

const snapshot = {
  message: 'offline',
  status: 0,
  code: 'NETWORK',
  retryable: true,
  occurredAt: '2026-07-17T00:00:00.000Z',
};

function requestHash(input: CreateOrderInput): string {
  const json = JSON.stringify(input);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function pendingOrder(): PendingOrder {
  return {
    id: 'pending-1',
    idempotencyKey: 'pos-replay-001',
    requestHash: requestHash(request),
    request,
    status: 'pending',
    createdAt: '2026-07-17T00:00:00.000Z',
    firstError: snapshot,
    lastError: snapshot,
    attempts: 0,
    lastAttemptAt: null,
    serverOrderId: null,
  };
}

describe('classifySyncError', () => {
  it.each([
    [{ pendingCount: 1, dataSource: 'tradingweb', token: null, locked: false, staffId: 'staff-1', operatorSessionStaffId: 'staff-1' }, false],
    [{ pendingCount: 1, dataSource: 'tradingweb', token: 'account-token', locked: true, staffId: 'staff-1', operatorSessionStaffId: 'staff-1' }, false],
    [{ pendingCount: 1, dataSource: 'tradingweb', token: 'account-token', locked: false, staffId: null, operatorSessionStaffId: 'staff-1' }, false],
    [{ pendingCount: 1, dataSource: 'tradingweb', token: 'account-token', locked: false, staffId: 'staff-1', operatorSessionStaffId: null }, false],
    [{ pendingCount: 1, dataSource: 'tradingweb', token: 'account-token', locked: false, staffId: 'staff-1', operatorSessionStaffId: 'staff-2' }, false],
    [{ pendingCount: 1, dataSource: 'tradingweb', token: 'account-token', locked: false, staffId: 'staff-1', operatorSessionStaffId: 'staff-1' }, true],
  ])('allows automatic sync only for an unlocked authenticated matching operator session', (input, expected) => {
    expect(canAutoSyncPending(input as Parameters<typeof canAutoSyncPending>[0])).toBe(expected);
  });

  it('uses the Task 6 retryable contract instead of inferring from error class', () => {
    expect(classifySyncError(new ApiError('offline', 0, null, 'NETWORK', true))).toBe('retry');
    expect(classifySyncError(new ApiError('unavailable', 503, null, 'UNAVAILABLE', true))).toBe('retry');
    expect(classifySyncError(new ApiError('expired', 401, null, 'AUTH_REQUIRED', false))).toBe('reauth');
    expect(classifySyncError(new ApiError('conflict', 409, null, 'CONFLICT', false))).toBe('block');
    expect(classifySyncError(new ApiError('missing', 404, null, 'NOT_FOUND', false))).toBe('block');
    expect(classifySyncError(new ApiError('conflict', 409, null, 'CONFLICT', true))).toBe('block');
    expect(classifySyncError(new ApiError('expired', 401, null, 'AUTH_REQUIRED', true))).toBe('reauth');
  });

  it.each([
    [401, 'AUTH_REQUIRED'],
    [409, 'CONFLICT'],
  ])('never queues retryable HTTP %i checkout errors', (status, code) => {
    expect(shouldQueuePendingOrder(new ApiError('malformed retryability', status, null, code, true))).toBe(false);
  });

  it('queues only a retryable non-4xx ApiError', () => {
    expect(shouldQueuePendingOrder(new ApiError('offline', 0, null, 'NETWORK', true))).toBe(true);
  });
});

describe('syncPendingOrder', () => {
  beforeEach(() => {
    mockGetSyncHmacKey.mockReset().mockResolvedValue(null);
  });

  it('returns retryable network failures to pending', async () => {
    const createOrder = vi.fn().mockRejectedValue(new ApiError('offline', 0, null, 'NETWORK', true));

    const result = await syncPendingOrder(pendingOrder(), { createOrder } as unknown as PosDataSource);

    expect(result).toMatchObject({ status: 'pending', attempts: 1, lastError: { code: 'NETWORK' } });
  });

  it('blocks HTTP 401 to require reauthentication', async () => {
    const createOrder = vi.fn().mockRejectedValue(new ApiError('expired', 401, null, 'AUTH_REQUIRED', false));

    const result = await syncPendingOrder(pendingOrder(), { createOrder } as unknown as PosDataSource);

    expect(result).toMatchObject({ status: 'blocked', attempts: 1, lastError: { status: 401 } });
  });

  it.each([404, 409])('blocks non-retryable HTTP %i conflicts', async (status) => {
    const createOrder = vi.fn().mockRejectedValue(new ApiError('conflict', status, null, 'CONFLICT', false));

    const result = await syncPendingOrder(pendingOrder(), { createOrder } as unknown as PosDataSource);

    expect(result).toMatchObject({ status: 'blocked', attempts: 1, lastError: { status } });
  });

  it('records the server order ID when an idempotent replay succeeds', async () => {
    const createOrder = vi.fn().mockResolvedValue({ id: 'server-order-7' });

    const result = await syncPendingOrder(pendingOrder(), { createOrder } as unknown as PosDataSource);

    expect(createOrder).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({ status: 'synced', serverOrderId: 'server-order-7', attempts: 1 });
  });

  it.each([
    ['idempotency key and request clientRef differ', (order: PendingOrder) => ({
      ...order,
      idempotencyKey: 'pos-other-key',
    })],
    ['persisted request hash differs', (order: PendingOrder) => ({
      ...order,
      requestHash: 'fnv1a-tampered',
    })],
  ])('blocks replay when %s without calling the server', async (_reason, mutate) => {
    const createOrder = vi.fn();

    const result = await syncPendingOrder(mutate(pendingOrder()), { createOrder } as unknown as PosDataSource);

    expect(createOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'blocked',
      attempts: 0,
      lastError: { code: 'PENDING_REQUEST_INTEGRITY', retryable: false },
    });
  });

  it('upgrades a legacy fnv1a fingerprint to keyed HMAC before sending', async () => {
    mockGetSyncHmacKey.mockResolvedValue('ab'.repeat(32));
    const createOrder = vi.fn().mockResolvedValue({ id: 'server-order-8' });

    const result = await syncPendingOrder(pendingOrder(), { createOrder } as unknown as PosDataSource);

    expect(createOrder).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({ status: 'synced', serverOrderId: 'server-order-8' });
    expect(result.requestHash).toMatch(/^hmac-[0-9a-f]{64}$/);
  });

  it('keeps the legacy fingerprint when no SecureStore key is available', async () => {
    mockGetSyncHmacKey.mockResolvedValue(null);
    const createOrder = vi.fn().mockResolvedValue({ id: 'server-order-9' });

    const result = await syncPendingOrder(pendingOrder(), { createOrder } as unknown as PosDataSource);

    expect(createOrder).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'synced' });
    expect(result.requestHash).toBe(requestHash(request));
  });

  it('blocks a tampered keyed HMAC fingerprint without calling the server', async () => {
    mockGetSyncHmacKey.mockResolvedValue('ab'.repeat(32));
    const createOrder = vi.fn();
    const order = { ...pendingOrder(), requestHash: 'hmac-' + '00'.repeat(32) };

    const result = await syncPendingOrder(order, { createOrder } as unknown as PosDataSource);

    expect(createOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'blocked',
      attempts: 0,
      lastError: { code: 'PENDING_REQUEST_INTEGRITY', retryable: false },
    });
  });

  it('sends a valid keyed HMAC entry unchanged', async () => {
    const key = 'cd'.repeat(32);
    mockGetSyncHmacKey.mockResolvedValue(key);
    const { hmacPendingRequest } = await import('../sync');
    const requestHash = await hmacPendingRequest(request, key);
    const order = { ...pendingOrder(), requestHash };
    const createOrder = vi.fn().mockResolvedValue({ id: 'server-order-10' });

    const result = await syncPendingOrder(order, { createOrder } as unknown as PosDataSource);

    expect(createOrder).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({ status: 'synced', requestHash });
  });
});
