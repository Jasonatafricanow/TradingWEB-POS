import { describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HttpClient } from '../../client';
import { TradingWebDataSource } from '../tradingweb';
import * as tradingwebModule from '../tradingweb';
import type { CreateOrderInput } from '../../types';
import { IDS } from '@/test/fixtures/pos';

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
      token: 'token',
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

const SHIFT_ID = '66666666-6666-4666-8666-666666666666';
const MOVEMENT_ID = '77777777-7777-4777-8777-777777777777';

function validOpenShiftDto(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SHIFT_ID,
    store_id: IDS.store,
    opened_by: IDS.staff,
    closed_by: null,
    status: 'open',
    opening_float: '100.00',
    expected_cash: null,
    counted_cash: null,
    difference_cash: null,
    opened_at: '2026-07-18T09:00:00.000Z',
    closed_at: null,
    ...patch,
  };
}

function validClosedShiftDto(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return validOpenShiftDto({
    closed_by: IDS.staff,
    status: 'closed',
    expected_cash: '95.25',
    counted_cash: '96.00',
    difference_cash: '0.75',
    closed_at: '2026-07-18T18:00:00.000Z',
    reconciliation: {
      cash_sales: '10.00',
      cash_refunds: '2.00',
      cash_in: '0.00',
      cash_out: '12.75',
    },
    ...patch,
  });
}

function orderInput(): CreateOrderInput {
  return {
    clientRef: 'android-checkout-001',
    staffId: IDS.staff,
    staffName: '收银员',
    customerId: null,
    customerName: null,
    note: null,
    currency: 'USD',
    items: [{
      productId: IDS.product,
      variantId: IDS.variant,
      name: '测试商品',
      variantLabel: null,
      sku: 'SKU-1',
      unitPriceCents: 1000,
      qty: 2,
      lineDiscountCents: 100,
      deliveryMethod: 'in_store',
    }],
    discount: null,
    subtotalCents: 2000,
    discountCents: 300,
    taxCents: 0,
    totalCents: 1700,
    payments: [
      { method: 'cash', label: 'Cash', amountCents: 700, ref: null },
      { method: 'card', label: 'Card', amountCents: 1000, ref: 'TERM-1' },
    ],
  };
}

describe('TradingWebDataSource UUID mapping', () => {
  it('maps the Task 10 shift DTOs and sends exact money/idempotency fields', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okJson({ data: {
        id: SHIFT_ID, store_id: IDS.store, opened_by: IDS.staff, closed_by: null,
        status: 'open', opening_float: '100.00', expected_cash: null,
        counted_cash: null, difference_cash: null,
        opened_at: '2026-07-18T09:00:00.000Z', closed_at: null,
      } }))
      .mockResolvedValueOnce(okJson({ data: {
        id: MOVEMENT_ID, shift_id: SHIFT_ID, kind: 'out', amount: '5.25',
        reason: 'Courier', operator_id: IDS.staff, idempotency_key: 'cash-stable-1',
        created_at: '2026-07-18T10:00:00.000Z',
      } }))
      .mockResolvedValueOnce(okJson({ data: {
        id: SHIFT_ID, store_id: IDS.store, opened_by: IDS.staff, closed_by: IDS.staff,
        status: 'closed', opening_float: '100.00', expected_cash: '95.25',
        counted_cash: '96.00', difference_cash: '0.75',
        opened_at: '2026-07-18T09:00:00.000Z', closed_at: '2026-07-18T18:00:00.000Z',
        reconciliation: { cash_sales: '10.00', cash_refunds: '2.00', cash_in: '0.00', cash_out: '12.75' },
      } }));

    const source = makeSource();
    await expect(source.getCurrentShift()).resolves.toMatchObject({
      id: SHIFT_ID, storeId: IDS.store, openingFloatCents: 10000, expectedCashCents: null,
    });
    await expect(source.recordCashMovement(SHIFT_ID, {
      kind: 'out', amountCents: 525, reason: 'Courier', idempotencyKey: 'cash-stable-1',
    })).resolves.toMatchObject({ id: MOVEMENT_ID, shiftId: SHIFT_ID, amountCents: 525 });
    await expect(source.closeShift(SHIFT_ID, {
      countedCents: 9600, idempotencyKey: 'close-stable-1',
    })).resolves.toMatchObject({
      expectedCashCents: 9525, countedCashCents: 9600, differenceCashCents: 75,
      reconciliation: { cashSalesCents: 1000, cashRefundCents: 200, cashInCents: 0, cashOutCents: 1275 },
    });

    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/api/admin/pos/shifts/current',
      `https://example.test/api/admin/pos/shifts/${SHIFT_ID}/cash-movements`,
      `https://example.test/api/admin/pos/shifts/${SHIFT_ID}/close`,
    ]);
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[1][1]?.body))).toEqual({
      kind: 'out', amount: '5.25', reason: 'Courier', idempotency_key: 'cash-stable-1',
    });
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[2][1]?.body))).toEqual({
      counted_cash: '96.00', idempotency_key: 'close-stable-1',
    });
  });

  it('opens shifts and uploads the exact audit batch without adding sensitive fields', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okJson({ data: {
        id: SHIFT_ID, store_id: IDS.store, opened_by: IDS.staff, closed_by: null,
        status: 'open', opening_float: '20.00', expected_cash: null,
        counted_cash: null, difference_cash: null,
        opened_at: '2026-07-18T09:00:00.000Z', closed_at: null,
      } }))
      .mockResolvedValueOnce(okJson({ data: { accepted: 1, duplicates: 0 } }));
    const record = {
      id: '00000000-0000-4000-8000-000000000002', event_type: 'shift_open',
      entity_type: 'pos_device_event', entity_id: null,
      payload: { action: 'shift_open', detail_hash: 'b'.repeat(64) },
      hash: 'a'.repeat(64), prev_hash: null, occurred_at: '2026-07-18T09:00:00.000Z',
    };

    const source = makeSource();
    await source.openShift({ openingFloatCents: 2000 });
    await expect(source.uploadAuditBatch([record])).resolves.toEqual({ accepted: 1, duplicates: 0 });

    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body))).toEqual({ opening_float: '20.00' });
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[1][1]?.body))).toEqual({ records: [record] });
  });

  it('accepts valid two-decimal money without floating-point conversion artifacts', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({
      data: validOpenShiftDto({ opening_float: '0.29' }),
    }));

    await expect(makeSource().getCurrentShift()).resolves.toMatchObject({ openingFloatCents: 29 });
  });

  it.each([
    ['counted cash', { counted_cash: '95.99' }],
    ['closing operator', { closed_by: '99999999-9999-4999-8999-999999999999' }],
    ['difference', { difference_cash: '0.76' }],
    ['expected cash formula', { expected_cash: '95.24', difference_cash: '0.76' }],
  ])('rejects a validly-shaped close response with inconsistent %s facts', async (_field, patch) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: validClosedShiftDto(patch) }));

    await expect(makeSource().closeShift(SHIFT_ID, {
      countedCents: 9600,
      idempotencyKey: 'close-stable-1',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    ['shift id', { id: '' }],
    ['store id', { store_id: 'not-a-uuid' }],
    ['operator id', { opened_by: null }],
    ['status', { status: 'pending' }],
    ['opening money', { opening_float: '100.00oops' }],
    ['opened timestamp', { opened_at: 'not-a-date' }],
    ['open nullable totals', { expected_cash: '100.00' }],
    ['closed reconciliation', {
      status: 'closed',
      closed_by: IDS.staff,
      expected_cash: '100.00',
      counted_cash: '100.00',
      difference_cash: '0.00',
      closed_at: '2026-07-18T18:00:00.000Z',
    }],
  ])('rejects a malformed 2xx shift DTO (%s)', async (_field, patch) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: validOpenShiftDto(patch) }));

    await expect(makeSource().getCurrentShift()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    ['movement id', { id: '' }],
    ['shift id', { shift_id: 'not-a-uuid' }],
    ['kind', { kind: 'sideways' }],
    ['amount', { amount: '5.25oops' }],
    ['reason', { reason: '' }],
    ['operator id', { operator_id: '' }],
    ['idempotency key', { idempotency_key: '' }],
    ['created timestamp', { created_at: 'yesterday' }],
  ])('rejects a malformed 2xx cash movement DTO (%s)', async (_field, patch) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: {
      id: MOVEMENT_ID,
      shift_id: SHIFT_ID,
      kind: 'out',
      amount: '5.25',
      reason: 'Courier',
      operator_id: IDS.staff,
      idempotency_key: 'cash-stable-1',
      created_at: '2026-07-18T10:00:00.000Z',
      ...patch,
    } }));

    await expect(makeSource().recordCashMovement(SHIFT_ID, {
      kind: 'out', amountCents: 525, reason: 'Courier', idempotencyKey: 'cash-stable-1',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    [{ accepted: 'one', duplicates: 0 }],
    [{ accepted: -1, duplicates: 2 }],
    [{ accepted: 0.5, duplicates: 0.5 }],
    [{ accepted: 1 }],
  ])('rejects malformed audit acknowledgement counts (%o)', async (result) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: result }));

    await expect(makeSource().uploadAuditBatch([])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('exposes one canonical approval hash builder for the exact wire request', () => {
    const hash = (tradingwebModule as typeof tradingwebModule & {
      hashPosApprovalRequest: (request: Record<string, unknown>) => string;
    }).hashPosApprovalRequest;
    expect(typeof hash).toBe('function');
    expect(hash({ b: 2, approval_token: 'must-not-be-bound', a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });

  it('uses the Task 8 refund endpoint with explicit return items and approval token', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okJson({ data: {
        refund_id: 'refund-1', order_id: 'order-1', amount: '10.00', refunded_total: '10.00', items: [],
      } }))
      .mockResolvedValueOnce(okJson({ data: {
        id: 'order-1', order_no: 'POS-001', created_at: '2026-07-18T00:00:00.000Z', source: 'pos',
        status: 'refunded', subtotal: '10.00', discount_total: '0.00', tax_total: '0.00', total: '10.00',
        refunded_total: '10.00', items: [], payments: [],
      } }));

    await makeSource().refundOrder('order-1', {
      clientRef: 'refund-1',
      amountCents: 1000,
      reason: '退货',
      restock: true,
      returnItems: [{ orderItemId: 'item-1', qty: 1, restock: true }],
      approvalToken: 'approval-token',
    } as any);

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('https://example.test/api/admin/pos/orders/order-1/refunds');
    expect(JSON.parse(String(init?.body))).toEqual({
      idempotency_key: 'refund-1',
      store_id: IDS.store,
      return_items: [{ order_item_id: 'item-1', quantity: 1, restock: true }],
      reason: '退货',
      approval_token: 'approval-token',
    });
  });

  it('never silently mints exchange approval with the current operator', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (request) => {
      const url = String(request);
      if (url.endsWith('/api/admin/pos/approvals')) {
        return okJson({ data: { token: 'silently-minted-token' } });
      }
      return okJson({ data: {
        exchange_id: 'exchange-1', original_order_id: 'order-1', refund_amount: '10.00',
        new_order_amount: '17.00', difference_amount: '7.00',
        replacement_order: {
          id: 'order-2', order_no: 'POS-002', created_at: '2026-07-18T00:00:00.000Z', source: 'pos',
          status: 'completed', subtotal: '20.00', discount_total: '3.00', tax_total: '0.00', total: '17.00',
          refunded_total: '0.00', items: [], payments: [],
        },
      } });
    });

    await makeSource().exchangeOrder({
      clientRef: 'exchange-1',
      originalOrderId: 'order-1',
      returnItems: [{ orderItemId: 'item-1', qty: 1, restock: true }],
      replacement: orderInput(),
      differencePayment: [{ method: 'cash', label: 'Cash', amountCents: 700, ref: null }],
      approvalToken: null,
    });

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('https://example.test/api/admin/pos/exchanges');
    expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body)).approval_token).toBeNull();
  });

  it('posts the exact V1 checkout contract with operator headers and no legacy fallback', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({
      data: {
        id: 'order-1', order_no: 'POS-001', created_at: '2026-07-15T00:00:00.000Z',
        source: 'pos', status: 'completed', financial_status: 'paid', fulfillment_status: 'fulfilled',
        subtotal: '20.00', discount_total: '3.00', tax_total: '0.00', total: '17.00', refunded_total: '0.00',
        items: [{
          id: 'item-1', product_id: IDS.product, variant_id: IDS.variant, name: '测试商品', sku: 'SKU-1',
          quantity: 2, unit_price: '10.00', line_discount: '1.00', delivery_method: 'in_store',
        }],
        payments: [
          { method: 'cash', label: 'Cash', amount: '7.00', reference: null },
          { method: 'card', label: 'Card', amount: '10.00', reference: 'TERM-1' },
        ],
      },
    }));

    const result = await makeSource().createOrder(orderInput());

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('https://example.test/api/admin/pos/checkout');
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'X-POS-Operator-Session': 'operator-token',
        'X-POS-Device-ID': 'android-installation-1',
      }),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      idempotency_key: 'android-checkout-001',
      store_id: IDS.store,
      currency: 'USD',
      staff_id: IDS.staff,
      customer_id: null,
      note: null,
      fulfillment: { method: 'in_store' },
      items: [{
        product_id: IDS.product,
        variant_id: IDS.variant,
        quantity: 2,
        line_discount: '1.00',
      }],
      order_discount: '2.00',
      pricing_preview: { subtotal: '20.00', discount: '3.00', tax: '0.00', total: '17.00' },
      pricing_version: 'pricing-v1',
      payments: [
        { method: 'cash', label: 'Cash', amount: '7.00', reference: null },
        { method: 'card', label: 'Card', amount: '10.00', reference: 'TERM-1' },
      ],
    });
    expect(result).toMatchObject({ id: 'order-1', number: 'POS-001', totalCents: 1700 });
  });

  it('uses the POS catalog endpoint with store scope', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: [{
      product_id: IDS.product,
      variant_id: IDS.variant,
      title: '测试商品',
      variant_title: '蓝色',
      sku: 'SKU-1',
      barcode: '690000000001',
      price: '99.00',
      type: 'physical',
      stock: 5,
      image: null,
    }] }));

    const rows = await makeSource().fetchProducts('SKU-1');

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      `https://example.test/api/admin/pos/catalog?q=SKU-1&store_id=${IDS.store}`,
    );
    expect(rows[0]).toMatchObject({ id: IDS.product, variants: [{ id: IDS.variant, productId: IDS.product }] });
  });
  it('preserves TradingWEB product and variant UUIDs without numeric coercion', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      okJson({
        data: [
          {
            product_id: IDS.product,
            variant_id: IDS.variant,
            title: '测试商品',
            price: '99.00',
            type: 'physical',
            sku: 'SKU-1',
            barcode: '690000000001',
            stock: 5,
          },
        ],
      }),
    );

    const rows = await makeSource().fetchProducts();

    expect(rows[0].id).toBe(IDS.product);
    expect(rows[0].variants[0].id).toBe(IDS.variant);
    expect(rows[0].variants[0].productId).toBe(IDS.product);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'twpos.products.cache.v2',
      expect.any(String),
    );
  });

  it('preserves TradingWEB staff UUIDs returned by login', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      okJson({ token: 'jwt', user: { id: IDS.staff, name: '收银员', role: 'staff' } }),
    );

    const result = await makeSource().login('staff@example.test', 'secret');

    expect(result.staff.id).toBe(IDS.staff);
  });

  it('loads the current POS staff identity without receiving a PIN', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: {
      id: IDS.staff,
      store_id: IDS.store,
      name: '收银员',
      email: 'staff@example.test',
      role: 'operator',
      pos_enabled: true,
      pos_pin_configured: true,
      pos_permissions: ['checkout'],
    } }));

    const staff = await makeSource().fetchStaff();

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      'https://example.test/api/admin/staff/me',
    );
    expect(staff).toEqual([expect.objectContaining({
      id: IDS.staff,
      storeId: IDS.store,
      role: 'staff',
      pin: null,
      posPinConfigured: true,
      permissions: ['checkout'],
    })]);
  });

  it('discovers only minimum approver identities from the session-scoped POS endpoint', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ data: [
      { id: 'manager-1', name: 'Manager One', role: 'manager' },
      { id: 'admin-1', name: 'Admin One', role: 'admin' },
    ] }));

    const approvers = await makeSource().fetchApprovers(IDS.store);

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      `https://example.test/api/admin/pos/approvers?store_id=${IDS.store}`,
    );
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({
        'X-POS-Operator-Session': 'operator-token',
        'X-POS-Device-ID': 'android-installation-1',
      }),
    });
    expect(approvers).toEqual([
      { id: 'manager-1', name: 'Manager One', role: 'manager', pin: null, storeId: IDS.store, usesDefaultPin: false },
      { id: 'admin-1', name: 'Admin One', role: 'admin', pin: null, storeId: IDS.store, usesDefaultPin: false },
    ]);
    expect(Object.keys(approvers[0]).sort()).toEqual([
      'id', 'name', 'pin', 'role', 'storeId', 'usesDefaultPin',
    ]);
  });

  it('preserves UUID relationships across customers, orders, stock and purchasing', async () => {
    const locationId = '66666666-6666-4666-8666-666666666666';
    const purchaseOrderId = '77777777-7777-4777-8777-777777777777';
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okJson({ data: [{ id: IDS.customer, name: '客户' }] }))
      .mockResolvedValueOnce(
        okJson({
          data: {
            items: [{
              id: 'order-uuid',
              customer_id: IDS.customer,
              items: [
                {
                  product_id: IDS.product,
                  variant_id: IDS.variant,
                  name: '商品',
                  quantity: 1,
                  unit_price: '99.00',
                },
              ],
            }],
            page: 1,
            page_size: 50,
            total: 1,
            has_more: false,
          },
        }),
      )
      .mockResolvedValueOnce(okJson({ data: [{
        id: locationId, name: '后仓', type: 'warehouse', is_active: true, is_store_default: false,
      }] }))
      .mockResolvedValueOnce(
        okJson({ data: [{
          id: '88888888-8888-4888-8888-888888888888',
          product_id: IDS.product,
          variant_id: IDS.variant,
          store_id: IDS.store,
          location_id: locationId,
          location_name: '后仓',
          stock: 8,
          low_stock_threshold: 2,
          product_title: '商品',
          variant_title: '默认',
          sku: 'SKU-1',
        }] }),
      )
      .mockResolvedValueOnce(
        okJson({
          data: [
            {
              id: purchaseOrderId,
              number: 'PO-0001',
              location_id: locationId,
              store_id: IDS.store,
              supplier: '供应商',
              status: 'ordered',
              created_by: IDS.staff,
              received_by: null,
              created_at: '2026-07-19T08:00:00.000Z',
              received_at: null,
              items: [
                {
                  id: '99999999-9999-4999-8999-999999999999',
                  product_id: IDS.product,
                  variant_id: IDS.variant,
                  ordered_qty: 2,
                  received_qty: 0,
                  unit_cost: '0.00',
                },
              ],
            },
          ],
        }),
      );

    const source = makeSource();
    const customers = await source.fetchCustomers();
    const orders = await source.fetchOrders();
    const locations = await source.fetchLocations('inventory_transfer');
    const stock = await source.fetchStockByLocation(IDS.product, IDS.variant);
    const purchaseOrders = await source.fetchPurchaseOrders();

    expect(customers[0].id).toBe(IDS.customer);
    expect(orders[0]).toMatchObject({ customerId: IDS.customer });
    expect(orders[0].items[0]).toMatchObject({
      productId: IDS.product,
      variantId: IDS.variant,
    });
    expect(locations[0].id).toBe(locationId);
    expect(stock[0].locationId).toBe(locationId);
    expect(purchaseOrders[0]).toMatchObject({ id: purchaseOrderId, locationId });
    expect(purchaseOrders[0].items[0]).toMatchObject({
      productId: IDS.product,
      variantId: IDS.variant,
    });
  });

  it('encodes customer IDs and uses the scoped inventory collection endpoint', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okJson({ data: { items: [], page: 1, page_size: 50, total: 0, has_more: false } }))
      .mockResolvedValueOnce(okJson({ data: [] }));

    const source = makeSource();
    await source.fetchCustomerOrders('customer/with space');
    await source.fetchStockByLocation('product/with space', 'variant/with space');

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      'https://example.test/api/admin/pos/orders?page=1&page_size=50&source=all&customer_id=customer%2Fwith+space',
    );
    expect(vi.mocked(globalThis.fetch).mock.calls[1][0]).toBe(
      'https://example.test/api/admin/pos/inventory',
    );
  });

  it('does not load the unversioned product cache after the ID migration', async () => {
    await AsyncStorage.setItem(
      'twpos.products.cache',
      JSON.stringify([{ id: null, variants: [{ id: null, productId: null }] }]),
    );
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('offline'));

    await expect(makeSource().fetchProducts()).rejects.toThrow('offline');
  });
});
