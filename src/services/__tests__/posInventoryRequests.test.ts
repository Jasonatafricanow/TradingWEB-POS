import { describe, expect, it } from 'vitest';

import {
  buildPosInventoryAdjustmentRequest,
  buildPosInventoryTransferRequest,
  buildPosPurchaseOrderIdentityFacts,
  buildPosPurchaseOrderRequest,
  posPurchaseOrderReceiveKey,
} from '../posInventoryRequests';
import { hashPosApprovalRequest } from '../posRequests';
import { IDS } from '@/test/fixtures/pos';

const LOCATION_A = '66666666-6666-4666-8666-666666666666';
const LOCATION_B = '77777777-7777-4777-8777-777777777777';

describe('Task 11 inventory wire requests', () => {
  it('builds the exact approval-bound inventory adjustment body', () => {
    const built = buildPosInventoryAdjustmentRequest({
      clientRef: 'adjust-stable-1',
      productId: IDS.product,
      variantId: IDS.variant,
      locationId: LOCATION_A,
      delta: -2,
      reason: 'damage',
      note: 'Broken seal',
      approvalToken: 'approval-token',
    }, IDS.store);

    expect(built.body).toEqual({
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
    expect(built.resourceHash).toBe(hashPosApprovalRequest(built.body));
    expect(built.resourceHash).toBe(hashPosApprovalRequest({
      ...built.body,
      approval_token: 'a-different-single-use-token',
    }));
  });

  it('builds the exact stable inventory transfer request', () => {
    expect(buildPosInventoryTransferRequest({
      clientRef: 'transfer-stable-1',
      fromLocationId: LOCATION_A,
      toLocationId: LOCATION_B,
      note: 'Move to sales floor',
      items: [{ productId: IDS.product, variantId: IDS.variant, quantity: 3 }],
    }, IDS.store)).toEqual({
      idempotency_key: 'transfer-stable-1',
      store_id: IDS.store,
      from_location_id: LOCATION_A,
      to_location_id: LOCATION_B,
      note: 'Move to sales floor',
      items: [{ product_id: IDS.product, variant_id: IDS.variant, quantity: 3 }],
    });
  });

  it('builds exact purchase create and deterministic receive idempotency', () => {
    expect(buildPosPurchaseOrderRequest({
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
    }, IDS.store)).toEqual({
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
    expect(posPurchaseOrderReceiveKey('po/id')).toBe('pos-po-receive:po/id');
  });

  it('rejects a purchase item whose unit cost was not explicitly supplied', () => {
    expect(() => buildPosPurchaseOrderRequest({
      clientRef: 'po-create-stable-2',
      supplier: 'Supplier',
      locationId: LOCATION_A,
      items: [{
        productId: IDS.product,
        variantId: null,
        name: 'Tee',
        variantLabel: null,
        sku: 'TEE',
        qty: 1,
      }],
    } as any, IDS.store)).toThrow('unit cost');
  });

  it('binds purchase idempotency only to wire facts, not display metadata', () => {
    const base = {
      supplier: 'Supplier',
      locationId: LOCATION_A,
      items: [{
        productId: IDS.product, variantId: IDS.variant, name: 'Old title',
        variantLabel: 'Old label', sku: 'OLD-SKU', qty: 2, unitCostCents: 500,
      }],
    };
    expect(buildPosPurchaseOrderIdentityFacts(base, IDS.store)).toEqual(
      buildPosPurchaseOrderIdentityFacts({
        ...base,
        items: [{ ...base.items[0], name: 'New title', variantLabel: 'New label', sku: 'NEW-SKU' }],
      }, IDS.store),
    );
    expect(buildPosPurchaseOrderIdentityFacts(base, IDS.store)).toEqual({
      store_id: IDS.store,
      location_id: LOCATION_A,
      supplier: 'Supplier',
      items: [{
        product_id: IDS.product,
        variant_id: IDS.variant,
        ordered_qty: 2,
        unit_cost: '5.00',
      }],
    });
  });
});
