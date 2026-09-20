import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api';
import type { CreateOrderInput } from '@/api/types';
import { usePending } from '../pending';

const source = vi.hoisted(() => ({ createOrder: vi.fn() }));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  getDataSource: () => source,
}));

const input = (): CreateOrderInput => ({
  clientRef: 'pos-offline-001',
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
});

describe('pending order state machine', () => {
  beforeEach(() => {
    usePending.setState({ items: [], syncing: false });
    source.createOrder.mockReset();
  });

  it('creates a pending queue record with an immutable checkout request', () => {
    const request = input();
    const order = usePending.getState().add(
      request,
      new ApiError('offline', 0, null, 'NETWORK', true),
    );

    expect(order).toMatchObject({
      status: 'pending',
      idempotencyKey: 'pos-offline-001',
      request,
      attempts: 0,
      lastAttemptAt: null,
      serverOrderId: null,
    });
    expect(order.request).not.toBe(request);
  });

  it('resumes a persisted syncing record with its original idempotency key', async () => {
    const order = usePending.getState().add(
      input(),
      new ApiError('offline', 0, null, 'NETWORK', true),
    );
    usePending.setState({ items: [{ ...order, status: 'syncing' }] });
    source.createOrder.mockResolvedValue({ id: 'server-order-1' });

    await expect(usePending.getState().syncAll()).resolves.toEqual({ ok: 1, fail: 0 });
    expect(source.createOrder).toHaveBeenCalledWith(order.request);
    expect(usePending.getState().items).toEqual([]);
  });

  it('resumes only the selected blocked 401 record after reauthentication', async () => {
    const selected = usePending.getState().add(
      input(),
      new ApiError('expired', 401, null, 'AUTH_REQUIRED', false),
    );
    const other = usePending.getState().add(
      { ...input(), clientRef: 'pos-offline-002' },
      new ApiError('expired', 401, null, 'AUTH_REQUIRED', false),
    );
    usePending.setState({ items: [{ ...selected, status: 'blocked' }, { ...other, status: 'blocked' }] });

    await usePending.getState().syncAll();
    expect(source.createOrder).not.toHaveBeenCalled();

    expect(usePending.getState().resumeAfterReauthentication(selected.id)).toBe(true);
    expect(usePending.getState().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: selected.id,
        status: 'pending',
        idempotencyKey: selected.idempotencyKey,
        request: expect.objectContaining({ clientRef: selected.idempotencyKey }),
      }),
      expect.objectContaining({ id: other.id, status: 'blocked' }),
    ]));

    source.createOrder.mockResolvedValue({ id: 'server-order-401' });
    await expect(usePending.getState().syncAll()).resolves.toEqual({ ok: 1, fail: 0 });
    expect(source.createOrder).toHaveBeenCalledWith(selected.request);
    expect(source.createOrder).not.toHaveBeenCalledWith(other.request);
  });

  it('does not resume a different blocked 401 record', () => {
    const order = usePending.getState().add(
      input(),
      new ApiError('expired', 401, null, 'AUTH_REQUIRED', false),
    );
    usePending.setState({ items: [{ ...order, status: 'blocked' }] });

    expect(usePending.getState().resumeAfterReauthentication('other-pending-record')).toBe(false);
    expect(usePending.getState().items[0]).toMatchObject({
      id: order.id,
      status: 'blocked',
    });
  });

  it('refuses deletion while global or item sync is in flight and reports whether a record was removed', () => {
    const order = usePending.getState().add(
      input(),
      new ApiError('offline', 0, null, 'NETWORK', true),
    );

    usePending.setState({ syncing: true });
    expect(usePending.getState().remove(order.id)).toBe(false);
    expect(usePending.getState().items).toHaveLength(1);

    usePending.setState({ syncing: false, items: [{ ...order, status: 'syncing' }] });
    expect(usePending.getState().remove(order.id)).toBe(false);
    expect(usePending.getState().items).toHaveLength(1);

    usePending.setState({ items: [order] });
    expect(usePending.getState().remove(order.id)).toBe(true);
    expect(usePending.getState().remove(order.id)).toBe(false);
  });

  it('syncs only the selected pending record from a row retry', async () => {
    const selected = usePending.getState().add(
      input(),
      new ApiError('offline', 0, null, 'NETWORK', true),
    );
    const other = usePending.getState().add(
      { ...input(), clientRef: 'pos-offline-002' },
      new ApiError('offline', 0, null, 'NETWORK', true),
    );
    source.createOrder.mockResolvedValue({ id: 'server-order-selected' });

    await expect(usePending.getState().syncOne(selected.id)).resolves.toEqual({ ok: 1, fail: 0 });

    expect(source.createOrder).toHaveBeenCalledTimes(1);
    expect(source.createOrder).toHaveBeenCalledWith(selected.request);
    expect(usePending.getState().items).toEqual([other]);
  });
});
