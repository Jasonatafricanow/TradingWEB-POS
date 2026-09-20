import { describe, expect, it } from 'vitest';

import { partializeAudit, useAudit } from '../audit';
import { partializeCart, useCart } from '../cart';
import { partializeSettings, useSettings } from '../settings';
import { partializeShift, useShift } from '../shift';

describe('persisted store shapes', () => {
  it('keeps cart transaction state without actions', () => {
    expect(Object.keys(partializeCart(useCart.getState())).sort()).toEqual([
      'customer', 'discount', 'exchange', 'holds', 'lines', 'note',
    ]);
  });

  it('keeps configuration without actions', () => {
    expect(Object.keys(partializeSettings(useSettings.getState())).sort()).toEqual([
      'approvals', 'autoPrintReceipt', 'currency', 'currentLocationId', 'dataSource',
      'hidScannerEnabled', 'paymentMethods', 'pricingVersion', 'printer', 'promoRules',
      'serverUrl', 'store', 'storeId', 'taxRateBps',
    ]);
  });

  it('keeps shift reconciliation facts without actions', () => {
    expect(Object.keys(partializeShift(useShift.getState())).sort()).toEqual([
      'accountingSource', 'cashRefundCents', 'cashSalesCents', 'floatCents', 'lastSummary',
      'movements', 'open', 'openedAt', 'openedBy', 'ordersCount', 'pendingCashMovement',
      'pendingClose', 'salesTotalCents', 'serverScope', 'serverShiftId',
    ]);
  });

  it('does not persist transient audit upload state', () => {
    expect(Object.keys(partializeAudit(useAudit.getState())).sort()).toEqual([
      'entries', 'uploadStatuses',
    ]);
  });
});
