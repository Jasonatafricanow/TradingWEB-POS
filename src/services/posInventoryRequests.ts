import type { CreatePurchaseOrderInput, InventoryTransferInput, StockAdjustInput } from '@/api/types';
import { hashPosApprovalRequest } from './posRequests';
import { centsToDecimalString } from '@/utils/money';

export interface PosInventoryAdjustmentWireRequest extends Record<string, unknown> {
  idempotency_key: string;
  store_id: string;
  product_id: string;
  variant_id: string | null;
  location_id: string;
  delta: number;
  reason: StockAdjustInput['reason'];
  note: string | null;
  approval_token: string | null;
}

export function buildPosInventoryAdjustmentRequest(
  input: StockAdjustInput,
  storeId: string,
): { body: PosInventoryAdjustmentWireRequest; resourceHash: string } {
  const body: PosInventoryAdjustmentWireRequest = {
    idempotency_key: input.clientRef,
    store_id: storeId,
    product_id: input.productId,
    variant_id: input.variantId,
    location_id: input.locationId ?? '',
    delta: input.delta,
    reason: input.reason,
    note: input.note,
    approval_token: input.approvalToken,
  };
  return {
    body,
    resourceHash: hashPosApprovalRequest(body as unknown as Record<string, unknown>),
  };
}

export function buildPosInventoryTransferRequest(input: InventoryTransferInput, storeId: string) {
  return {
    idempotency_key: input.clientRef,
    store_id: storeId,
    from_location_id: input.fromLocationId,
    to_location_id: input.toLocationId,
    note: input.note,
    items: input.items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: item.quantity,
    })),
  };
}

export function buildPosPurchaseOrderRequest(input: CreatePurchaseOrderInput, storeId: string) {
  return {
    idempotency_key: input.clientRef,
    ...buildPosPurchaseOrderIdentityFacts(input, storeId),
  };
}

export function buildPosPurchaseOrderIdentityFacts(
  input: Pick<CreatePurchaseOrderInput, 'supplier' | 'locationId' | 'items'>,
  storeId: string,
) {
  for (const item of input.items) {
    if (!Number.isSafeInteger(item.unitCostCents) || item.unitCostCents < 0) {
      throw new Error('Each purchase item requires an explicit non-negative unit cost');
    }
  }
  return {
    store_id: storeId,
    location_id: input.locationId,
    supplier: input.supplier,
    items: input.items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId,
      ordered_qty: item.qty,
      unit_cost: centsToDecimalString(item.unitCostCents),
    })),
  };
}

export function posPurchaseOrderReceiveKey(purchaseOrderId: string): string {
  return `pos-po-receive:${purchaseOrderId}`;
}
