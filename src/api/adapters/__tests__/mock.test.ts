import { describe, expect, it } from 'vitest';
import { MockDataSource } from '../mock';
import { ApiError } from '../../client';
import type { CreateOrderInput } from '../../types';

function orderInput(patch: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    clientRef: `mock-checkout-${Date.now()}-${Math.random()}`,
    staffId: 'mock-staff-clerk',
    staffName: '李四',
    customerId: null,
    customerName: null,
    note: null,
    currency: 'USD',
    items: [{
      productId: 'mock-product-3', variantId: null, name: '陶瓷马克杯', variantLabel: null,
      sku: 'MUG-01', unitPriceCents: 4500, qty: 1, lineDiscountCents: 0, deliveryMethod: 'in_store',
    }],
    discount: null,
    subtotalCents: 4500,
    discountCents: 0,
    taxCents: 0,
    totalCents: 4500,
    payments: [{ method: 'cash', label: '现金', amountCents: 4500, ref: null }],
    ...patch,
  };
}

describe('MockDataSource stable entity IDs', () => {
  it('preserves a complete local shift lifecycle through the Task 10 adapter contract', async () => {
    const source = new MockDataSource();

    await expect(source.getCurrentShift()).resolves.toBeNull();
    const opened = await source.openShift({ openingFloatCents: 10000 });
    await expect(source.getCurrentShift()).resolves.toEqual(opened);
    await source.recordCashMovement(opened.id, {
      kind: 'in', amountCents: 2000, reason: 'Float top-up', idempotencyKey: 'mock-cash-1',
    });
    const closed = await source.closeShift(opened.id, {
      countedCents: 12000, idempotencyKey: 'mock-close-1',
    });

    expect(closed).toMatchObject({
      status: 'closed', expectedCashCents: 12000, countedCashCents: 12000, differenceCashCents: 0,
      reconciliation: { cashInCents: 2000 },
    });
    await expect(source.getCurrentShift()).resolves.toBeNull();
  });

  it('replays the original close result for the same idempotency key after the shift is closed', async () => {
    const source = new MockDataSource();
    const opened = await source.openShift({ openingFloatCents: 10000 });
    const request = { countedCents: 10000, idempotencyKey: 'mock-close-replay-1' };

    const first = await source.closeShift(opened.id, request);
    const replay = await source.closeShift(opened.id, request);

    expect(replay).toEqual(first);
    await expect(source.closeShift(opened.id, {
      countedCents: 9999,
      idempotencyKey: request.idempotencyKey,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('uses deterministic string IDs that match persisted-state migrations', async () => {
    const source = new MockDataSource();
    const [products, staff, customers, locations] = await Promise.all([
      source.fetchProducts(),
      source.fetchStaff(),
      source.fetchCustomers(),
      source.fetchLocations('inventory_transfer'),
    ]);

    expect(products[0].id).toBe('mock-product-1');
    expect(products[0].variants[0]).toMatchObject({
      id: 'mock-variant-1-1',
      productId: 'mock-product-1',
    });
    expect(staff.map((item) => item.id)).toEqual(['mock-staff-manager', 'mock-staff-clerk']);
    expect(customers[0].id).toBe('mock-customer-1');
    expect(locations.map((item) => item.id)).toEqual([
      'mock-location-front',
      'mock-location-warehouse',
    ]);
  });

  it('replays the first order for the same clientRef without deducting inventory twice', async () => {
    const source = new MockDataSource();
    const input = orderInput();
    const before = (await source.fetchProducts()).find((p) => p.id === 'mock-product-3')!.stock!;

    const first = await source.createOrder(input);
    const replay = await source.createOrder(input);
    const after = (await source.fetchProducts()).find((p) => p.id === 'mock-product-3')!.stock!;

    expect(replay).toBe(first);
    expect(after).toBe(before - 1);
  });

  it('rejects forged staff and stale client pricing with typed non-retryable errors', async () => {
    const source = new MockDataSource();

    await expect(source.createOrder(orderInput({ staffId: 'forged-staff' }))).rejects.toMatchObject({
      code: 'OPERATOR_MISMATCH', status: 403, retryable: false,
    });
    const stale = orderInput();
    stale.items[0].unitPriceCents = 1;
    await expect(source.createOrder(stale)).rejects.toMatchObject({
      code: 'PRICING_CHANGED', status: 409, retryable: false,
    });
  });

  it('rejects aggregated demand that exceeds stock across duplicate lines without partial mutation', async () => {
    const source = new MockDataSource();
    const before = (await source.fetchProducts()).find((p) => p.id === 'mock-product-3')!.stock!;
    const line = {
      productId: 'mock-product-3', variantId: null, name: '陶瓷马克杯', variantLabel: null,
      sku: 'MUG-01', unitPriceCents: 4500, qty: 20, lineDiscountCents: 0, deliveryMethod: 'in_store' as const,
    };
    const input = orderInput({
      items: [line, { ...line }],
      subtotalCents: 180000,
      totalCents: 180000,
      payments: [{ method: 'cash', label: '现金', amountCents: 180000, ref: null }],
    });

    await expect(source.createOrder(input)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK', status: 409,
    });
    expect((await source.fetchProducts()).find((p) => p.id === 'mock-product-3')!.stock).toBe(before);
  });

  it('uses ApiError for mock contract failures', async () => {
    const source = new MockDataSource();
    const input = orderInput({ payments: [] });
    await expect(source.createOrder(input)).rejects.toBeInstanceOf(ApiError);
  });

  it('replays adjustments by clientRef and rejects a changed request', async () => {
    const source = new MockDataSource();
    const input = {
      clientRef: 'mock-adjust-1', productId: 'mock-product-3', variantId: null,
      locationId: 'mock-location-front', delta: 2, reason: 'count' as const,
      note: null, approvalToken: null,
    };
    const before = (await source.fetchProducts()).find((item) => item.id === input.productId)!.stock!;

    await source.adjustStock(input);
    await source.adjustStock(input);
    expect((await source.fetchProducts()).find((item) => item.id === input.productId)!.stock).toBe(before + 2);
    await expect(source.adjustStock({ ...input, delta: 3 })).rejects.toMatchObject({
      status: 409, code: 'IDEMPOTENCY_KEY_REUSED', retryable: false,
    });
  });

  it('replays transfers and purchase orders by clientRef and rejects changed requests', async () => {
    const source = new MockDataSource();
    const transfer = {
      clientRef: 'mock-transfer-1', fromLocationId: 'mock-location-front',
      toLocationId: 'mock-location-warehouse', note: null,
      items: [{ productId: 'mock-product-3', variantId: null, quantity: 1 }],
    };
    const firstTransfer = await source.createInventoryTransfer(transfer);
    await expect(source.createInventoryTransfer(transfer)).resolves.toEqual(firstTransfer);
    await expect(source.createInventoryTransfer({ ...transfer, note: 'changed' })).rejects.toMatchObject({
      status: 409, code: 'IDEMPOTENCY_KEY_REUSED', retryable: false,
    });

    const po = {
      clientRef: 'mock-po-1', supplier: 'Supplier', locationId: 'mock-location-front',
      items: [{ productId: 'mock-product-3', variantId: null, name: 'Mug', variantLabel: null, sku: 'MUG-01', qty: 2, unitCostCents: 0 }],
    };
    const firstPo = await source.createPurchaseOrder(po);
    await expect(source.createPurchaseOrder(po)).resolves.toEqual(firstPo);
    await expect(source.createPurchaseOrder({ ...po, supplier: 'Changed' })).rejects.toMatchObject({
      status: 409, code: 'IDEMPOTENCY_KEY_REUSED', retryable: false,
    });
  });
});
