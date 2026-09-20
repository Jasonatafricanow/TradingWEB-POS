import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../../client';
import { TradingWebDataSource } from '../tradingweb';
import { IDS } from '@/test/fixtures/pos';
import { buildPosCheckoutRequest } from '@/services/posRequests';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function source(): TradingWebDataSource {
  return new TradingWebDataSource(
    new HttpClient(() => ({
      baseUrl: 'https://example.test', token: 'account-token', operatorSessionToken: 'operator-token', deviceId: 'device-1',
    })),
    () => ({ storeId: IDS.store, pricingVersion: 'pricing-v1' }),
    () => ({ serverUrl: 'https://example.test', storeId: IDS.store, operatorId: IDS.staff, deviceId: 'device-1' }),
  );
}

function orderDto(index = 1) {
  return {
    id: `order-${index}`,
    order_no: `POS-${index}`,
    created_at: '2026-07-21T10:00:00.000Z',
    source: index % 2 ? 'web' : 'pos',
    customer_id: IDS.customer,
    customer_name: 'Customer',
    status: 'completed',
    financial_status: 'paid',
    fulfillment_status: 'ready',
    total: '12.34',
    refunded_total: '0.00',
    item_count: 2,
    pickup_contact_name: 'Pickup Customer',
    pickup_phone: '+258840000001',
    pickup_store_id: IDS.store,
    pickup_ready_at: '2026-07-21T11:00:00.000Z',
    picked_up_at: null,
  };
}

describe('Task 12 paginated omnichannel adapter', () => {
  it('sends the optional pickup schedule as structured RFC3339 data', () => {
    const request = buildPosCheckoutRequest({
      clientRef: 'checkout-1', staffId: IDS.staff, staffName: 'Staff', customerId: IDS.customer, customerName: 'Customer', note: null,
      currency: 'USD', discount: null, subtotalCents: 1000, discountCents: 0, taxCents: 0, totalCents: 1000,
      buyerName: 'Pickup Customer', buyerPhone: '+258840000001', deliveryDate: '2026-07-22T10:00:00+02:00',
      items: [{ productId: IDS.product, variantId: IDS.variant, name: 'Product', variantLabel: null, sku: 'SKU', unitPriceCents: 1000, qty: 1, deliveryMethod: 'pickup' }],
      payments: [{ method: 'cash', label: 'Cash', amountCents: 1000 }],
    }, IDS.store, 'pricing-v1');
    expect(request.fulfillment).toEqual({
      method: 'pickup', contact_name: 'Pickup Customer', phone: '+258840000001', pickup_at: '2026-07-22T10:00:00+02:00',
    });
  });

  it('uses the strict POS page endpoint and maps structured fulfillment', async () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockResolvedValue(okJson({
      data: { items: [orderDto()], page: 2, page_size: 50, total: 120, has_more: true },
    }));

    const page = await source().fetchOrdersPage({ page: 2, pageSize: 50, source: 'all', search: 'Customer' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/admin/pos/orders?page=2&page_size=50&source=all&search=Customer',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(page).toMatchObject({ page: 2, pageSize: 50, total: 120, hasMore: true });
    expect(page.items[0]).toMatchObject({
      source: 'web', fulfillmentStatus: 'ready', pickupContactName: 'Pickup Customer', pickupStoreId: IDS.store,
    });
  });

  it('keeps customer history server-filtered and does not fall back to limit=50', async () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockResolvedValue(okJson({
      data: { items: [orderDto(2)], page: 1, page_size: 25, total: 61, has_more: true },
    }));

    await source().fetchCustomerOrdersPage(IDS.customer, { page: 1, pageSize: 25 });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.test/api/admin/pos/orders?page=1&page_size=25&source=all&customer_id=${IDS.customer}`,
      expect.anything(),
    );
    expect(fetchMock.mock.calls.flat().join(' ')).not.toContain('/api/orders?');
  });

  it('updates pickup state through the scoped fulfillment endpoint', async () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockResolvedValue(okJson({ data: { id: 'order-1', fulfillment_status: 'picked_up' } }));

    await expect(source().updatePickupFulfillment('order-1', 'picked_up')).resolves.toEqual({ id: 'order-1', fulfillmentStatus: 'picked_up' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/admin/pos/orders/order-1/fulfillment',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ fulfillment_status: 'picked_up' }) }),
    );
  });

  it('loads order detail through the POS-scoped endpoint', async () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockResolvedValue(okJson({ data: orderDto() }));
    await source().fetchOrder('order/with space');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/admin/pos/orders/order%2Fwith%20space',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
