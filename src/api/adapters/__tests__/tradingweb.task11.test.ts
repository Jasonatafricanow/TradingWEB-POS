import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../../client';
import { TradingWebDataSource } from '../tradingweb';
import { IDS } from '@/test/fixtures/pos';

const LOCATION_A = '66666666-6666-4666-8666-666666666666';
const LOCATION_B = '77777777-7777-4777-8777-777777777777';
const INVENTORY_A = '88888888-8888-4888-8888-888888888888';
const PO_ID = '99999999-9999-4999-8999-999999999999';
const PO_ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRANSFER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeSource(): TradingWebDataSource {
  return new TradingWebDataSource(
    new HttpClient(() => ({
      baseUrl: 'https://example.test',
      token: 'account-token',
      operatorSessionToken: 'operator-token',
      deviceId: 'android-installation-1',
    })),
    () => ({ storeId: IDS.store, pricingVersion: 'pricing-v1' }),
    () => ({
      serverUrl: 'https://example.test',
      storeId: IDS.store,
      operatorId: IDS.staff,
      deviceId: 'android-installation-1',
    }),
  );
}

function inventoryDto(patch: Record<string, unknown> = {}) {
  return {
    id: INVENTORY_A,
    product_id: IDS.product,
    variant_id: IDS.variant,
    store_id: IDS.store,
    location_id: LOCATION_A,
    stock: 8,
    low_stock_threshold: 3,
    product_title: 'Tee',
    variant_title: 'Black / M',
    sku: 'TEE-BLK-M',
    ...patch,
  };
}

function adjustmentDto(patch: Record<string, unknown> = {}) {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    inventory_id: INVENTORY_A,
    store_id: IDS.store,
    location_id: LOCATION_A,
    product_id: IDS.product,
    variant_id: IDS.variant,
    delta: -2,
    reason: 'damage',
    note: 'Broken seal',
    before_stock: 8,
    after_stock: 6,
    approved_by: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    operator_id: IDS.staff,
    ...patch,
  };
}

function poDto(patch: Record<string, unknown> = {}) {
  return {
    id: PO_ID,
    number: 'PO-0001',
    supplier: 'Supplier',
    store_id: IDS.store,
    location_id: LOCATION_A,
    status: 'ordered',
    created_by: IDS.staff,
    received_by: null,
    created_at: '2026-07-19T08:00:00.000Z',
    received_at: null,
    items: [{
      id: PO_ITEM_ID,
      product_id: IDS.product,
      variant_id: IDS.variant,
      ordered_qty: 4,
      received_qty: 0,
      unit_cost: '12.50',
    }],
    ...patch,
  };
}

describe('TradingWebDataSource Task 11 POS contracts', () => {
  it('loads exact POS locations and stock rows only from scoped inventory', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okJson({ data: [
        { id: LOCATION_A, name: 'Sales floor', type: 'retail', is_active: true, is_store_default: true },
        { id: LOCATION_B, name: 'Back room', type: 'warehouse', is_active: true, is_store_default: false },
      ] }))
      .mockResolvedValueOnce(okJson({ data: [inventoryDto({ location_name: null })] }));

    const source = makeSource();
    await expect(source.fetchLocations('inventory_adjustment')).resolves.toEqual([
      { id: LOCATION_A, name: 'Sales floor', type: 'retail', isActive: true, isStoreDefault: true },
      { id: LOCATION_B, name: 'Back room', type: 'warehouse', isActive: true, isStoreDefault: false },
    ]);
    await expect(source.fetchStockByLocation(IDS.product, IDS.variant)).resolves.toEqual([{
      locationId: LOCATION_A,
      locationName: 'Location 66666666',
      stock: 8,
    }]);

    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/api/admin/pos/inventory/locations?purpose=inventory_adjustment',
      'https://example.test/api/admin/pos/inventory',
    ]);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({
        'X-POS-Operator-Session': 'operator-token',
        'X-POS-Device-ID': 'android-installation-1',
      }),
    });
  });

  it('sends the exact approved adjustment and retains its supplied idempotency key', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: adjustmentDto() }));

    await expect((makeSource() as any).adjustStock({
      clientRef: 'adjust-stable-1',
      productId: IDS.product,
      variantId: IDS.variant,
      locationId: LOCATION_A,
      delta: -2,
      reason: 'damage',
      note: 'Broken seal',
      approvalToken: 'approval-token',
    })).resolves.toBeUndefined();

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      'https://example.test/api/admin/pos/inventory/adjustments',
    );
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body))).toEqual({
      idempotency_key: 'adjust-stable-1',
      store_id: IDS.store,
      product_id: IDS.product,
      variant_id: IDS.variant,
      location_id: LOCATION_A,
      delta: -2,
      reason: 'damage',
      note: 'Broken seal',
      approval_token: 'approval-token',
    });
  });

  it('rejects an inventory adjustment before HTTP when server approval is missing', async () => {
    await expect(makeSource().adjustStock({
      clientRef: 'adjust-stable-without-approval',
      productId: IDS.product,
      variantId: IDS.variant,
      locationId: LOCATION_A,
      delta: 1,
      reason: 'count',
      note: null,
      approvalToken: null,
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED', status: 403 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['operator', { operator_id: LOCATION_B }],
    ['delta', { delta: -1 }],
    ['reason', { reason: 'count' }],
    ['stock arithmetic', { after_stock: 7 }],
  ])('rejects an adjustment acknowledgement with mismatched %s facts', async (_label, patch) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: adjustmentDto(patch) }));

    await expect(makeSource().adjustStock({
      clientRef: 'adjust-stable-1',
      productId: IDS.product,
      variantId: IDS.variant,
      locationId: LOCATION_A,
      delta: -2,
      reason: 'damage',
      note: 'Broken seal',
      approvalToken: 'approval-token',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('creates a pending transfer with the exact stable wire request', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({
      data: {
        id: TRANSFER_ID,
        reference_no: 'TR-0001',
        status: 'pending',
        store_id: IDS.store,
        from_location_id: LOCATION_A,
        to_location_id: LOCATION_B,
        operator_id: IDS.staff,
        items: [{ product_id: IDS.product, variant_id: IDS.variant, quantity: 3 }],
      },
    }));

    await expect((makeSource() as any).createInventoryTransfer({
      clientRef: 'transfer-stable-1',
      fromLocationId: LOCATION_A,
      toLocationId: LOCATION_B,
      note: null,
      items: [{ productId: IDS.product, variantId: IDS.variant, quantity: 3 }],
    })).resolves.toEqual({
      id: TRANSFER_ID,
      referenceNo: 'TR-0001',
      status: 'pending',
      storeId: IDS.store,
      fromLocationId: LOCATION_A,
      toLocationId: LOCATION_B,
      operatorId: IDS.staff,
      items: [{ productId: IDS.product, variantId: IDS.variant, quantity: 3 }],
    });

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      'https://example.test/api/admin/pos/inventory/transfers',
    );
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body))).toEqual({
      idempotency_key: 'transfer-stable-1',
      store_id: IDS.store,
      from_location_id: LOCATION_A,
      to_location_id: LOCATION_B,
      note: null,
      items: [{ product_id: IDS.product, variant_id: IDS.variant, quantity: 3 }],
    });
  });

  it('maps purchase orders strictly and posts exact create and receive requests', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okJson({ data: [poDto()] }))
      .mockResolvedValueOnce(okJson({ data: poDto() }))
      .mockResolvedValueOnce(okJson({ data: poDto({
        status: 'received',
        received_by: IDS.staff,
        received_at: '2026-07-19T09:00:00.000Z',
        items: [{ ...poDto().items[0], received_qty: 4 }],
      }) }));

    const source = makeSource();
    await expect(source.fetchPurchaseOrders()).resolves.toEqual([expect.objectContaining({
      id: PO_ID,
      number: 'PO-0001',
      storeId: IDS.store,
      locationId: LOCATION_A,
      status: 'ordered',
      createdBy: IDS.staff,
      receivedBy: null,
      items: [expect.objectContaining({
        id: PO_ITEM_ID,
        orderedQty: 4,
        receivedQty: 0,
        unitCostCents: 1250,
      })],
    })]);
    await source.createPurchaseOrder({
      clientRef: 'po-create-stable-1',
      supplier: 'Supplier',
      locationId: LOCATION_A,
      items: [{
        productId: IDS.product,
        variantId: IDS.variant,
        name: 'Tee',
        variantLabel: 'Black / M',
        sku: 'TEE-BLK-M',
        qty: 4,
        unitCostCents: 1250,
      }],
    } as any);
    await source.receivePurchaseOrder(PO_ID);

    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/api/admin/pos/purchase-orders',
      'https://example.test/api/admin/pos/purchase-orders',
      `https://example.test/api/admin/pos/purchase-orders/${PO_ID}/receive`,
    ]);
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[1][1]?.body))).toEqual({
      idempotency_key: 'po-create-stable-1',
      store_id: IDS.store,
      location_id: LOCATION_A,
      supplier: 'Supplier',
      items: [{
        product_id: IDS.product,
        variant_id: IDS.variant,
        ordered_qty: 4,
        unit_cost: '12.50',
      }],
    });
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[2][1]?.body))).toEqual({
      idempotency_key: `pos-po-receive:${PO_ID}`,
      store_id: IDS.store,
      approval_token: null,
    });
  });

  it.each([
    ['inventory foreign store', () => ({ data: [inventoryDto({ store_id: LOCATION_A })] }), 'fetchStockByLocation'],
    ['inventory fractional stock', () => ({ data: [inventoryDto({ stock: 1.5 })] }), 'fetchStockByLocation'],
    ['inventory invalid UUID', () => ({ data: [inventoryDto({ location_id: 'bad' })] }), 'fetchStockByLocation'],
    ['purchase invalid status', () => ({ data: [poDto({ status: 'draft' })] }), 'fetchPurchaseOrders'],
    ['purchase invalid timestamp', () => ({ data: [poDto({ created_at: 'today' })] }), 'fetchPurchaseOrders'],
    ['purchase foreign store', () => ({ data: [poDto({ store_id: LOCATION_A })] }), 'fetchPurchaseOrders'],
  ])('rejects malformed or out-of-scope %s DTOs', async (_label, response, method) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson(response()));

    const source = makeSource() as any;
    const promise = method === 'fetchStockByLocation'
      ? source.fetchStockByLocation(IDS.product, IDS.variant)
      : source[method]();
    await expect(promise).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    [{ id: 'bad', name: 'Sales floor', type: 'retail', is_active: true, is_store_default: true }],
    [{ id: LOCATION_A, name: '', type: 'retail', is_active: true, is_store_default: true }],
    [{ id: LOCATION_A, name: 'Sales floor', type: '', is_active: true, is_store_default: true }],
    [{ id: LOCATION_A, name: 'Sales floor', type: 'retail', is_active: 1, is_store_default: true }],
    [{ id: LOCATION_A, name: 'Sales floor', type: 'retail', is_active: true, is_store_default: 1 }],
  ])('rejects malformed location DTOs (%o)', async (location) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: [location] }));

    await expect(makeSource().fetchLocations('inventory_transfer')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    [{ id: 'bad', reference_no: 'TR-0001', status: 'pending', store_id: IDS.store, from_location_id: LOCATION_A, to_location_id: LOCATION_B, operator_id: IDS.staff, items: [{ product_id: IDS.product, variant_id: null, quantity: 1 }] }],
    [{ id: TRANSFER_ID, reference_no: '', status: 'pending', store_id: IDS.store, from_location_id: LOCATION_A, to_location_id: LOCATION_B, operator_id: IDS.staff, items: [{ product_id: IDS.product, variant_id: null, quantity: 1 }] }],
    [{ id: TRANSFER_ID, reference_no: 'TR-0001', status: 'complete', store_id: IDS.store, from_location_id: LOCATION_A, to_location_id: LOCATION_B, operator_id: IDS.staff, items: [{ product_id: IDS.product, variant_id: null, quantity: 1 }] }],
    [{ id: TRANSFER_ID, reference_no: 'TR-0001', status: 'pending', store_id: LOCATION_A, from_location_id: LOCATION_A, to_location_id: LOCATION_B, operator_id: IDS.staff, items: [{ product_id: IDS.product, variant_id: null, quantity: 1 }] }],
    [{ id: TRANSFER_ID, reference_no: 'TR-0001', status: 'pending', store_id: IDS.store, from_location_id: LOCATION_B, to_location_id: LOCATION_A, operator_id: IDS.staff, items: [{ product_id: IDS.product, variant_id: null, quantity: 1 }] }],
    [{ id: TRANSFER_ID, reference_no: 'TR-0001', status: 'pending', store_id: IDS.store, from_location_id: LOCATION_A, to_location_id: LOCATION_B, operator_id: LOCATION_A, items: [{ product_id: IDS.product, variant_id: null, quantity: 1 }] }],
    [{ id: TRANSFER_ID, reference_no: 'TR-0001', status: 'pending', store_id: IDS.store, from_location_id: LOCATION_A, to_location_id: LOCATION_B, operator_id: IDS.staff, items: [{ product_id: IDS.product, variant_id: IDS.variant, quantity: 1 }] }],
  ])('rejects malformed transfer acknowledgements (%o)', async (data) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data }));

    await expect((makeSource() as any).createInventoryTransfer({
      clientRef: 'transfer-stable-1',
      fromLocationId: LOCATION_A,
      toLocationId: LOCATION_B,
      note: null,
      items: [{ productId: IDS.product, variantId: null, quantity: 1 }],
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
