import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../client';
import { TradingWebDataSource } from '../tradingweb';
import { IDS } from '@/test/fixtures/pos';

function source() {
  return new TradingWebDataSource(
    new HttpClient(() => ({ baseUrl: 'https://example.test', token: 'account', operatorSessionToken: 'operator', deviceId: 'device-1' })),
    () => ({ storeId: IDS.store, pricingVersion: 'pricing-v1' }),
    () => ({ serverUrl: 'https://example.test', storeId: IDS.store, operatorId: IDS.staff, deviceId: 'device-1' }),
  );
}

function response() {
  return { data: {
    store: { id: IDS.store, name: 'Main Store', timezone_offset: '+02:00' },
    date_from: '2026-07-01', date_to: '2026-07-03', source: 'all',
    gross: '1200.00', refunded: '40.00', refunds_for_orders_in_period: '45.00', net: '1160.00', order_count: 120, aov: '10.00',
    by_payment_method: [{ method: 'cash', label: 'Cash', gross_amount: '1200.00', refunded_amount: '40.00', net_amount: '1160.00' }],
    by_staff: [{ staff_id: IDS.staff, name: 'Alice', order_count: 120, gross_amount: '1200.00', refunded_amount: '40.00', net_amount: '1160.00' }],
    top_items: [{ name: 'Product', quantity: 120, gross_amount: '1200.00' }],
    daily: [{ date: '2026-07-01', order_count: 120, gross_amount: '1200.00', refunded_amount: '40.00', net_amount: '1160.00' }],
    hourly: [{ hour: 10, order_count: 120, gross_amount: '1200.00' }],
  } };
}

describe('Task 13 range reports', () => {
  it('loads a complete server report and maps decimal money to cents', async () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify(response()), { status: 200, headers: { 'content-type': 'application/json' } }));
    const report = await source().fetchRangeReport({ dateFrom: '2026-07-01', dateTo: '2026-07-03', source: 'all' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/admin/pos/reports?date_from=2026-07-01&date_to=2026-07-03&source=all',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(report).toMatchObject({ grossCents: 120000, refundedCents: 4000, netCents: 116000, ordersCount: 120 });
    expect(report.byPayment[0]).toMatchObject({ method: 'cash', netCents: 116000 });
    expect(report.daily[0]).toMatchObject({ dateKey: '2026-07-01', netCents: 116000 });
  });

  it('fails closed on internally unreconciled report totals', async () => {
    const bad = response();
    bad.data.net = '999.00';
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify(bad), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(source().fetchRangeReport({ dateFrom: '2026-07-01', dateTo: '2026-07-03', source: 'all' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
