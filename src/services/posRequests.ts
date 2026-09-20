import { ApiError } from '@/api/client';
import type { PosCheckoutRequestV1 } from '@/api/contracts/pos';
import type { CreateOrderInput, ExchangeOrderInput, RefundInput } from '@/api/types';
import { sha256Hex } from '@/utils/hash';
import { centsToDecimalString } from '@/utils/money';

export interface PosRefundWireRequest {
  idempotency_key: string;
  store_id: string;
  return_items: { order_item_id: string; quantity: number; restock: boolean }[];
  reason: string;
  approval_token: string | null;
}

export interface PosExchangeWireRequest {
  idempotency_key: string;
  store_id: string;
  original_order_id: string;
  return_items: { order_item_id: string; quantity: number; restock: boolean }[];
  replacement: PosCheckoutRequestV1;
  difference_payment: { method: string; label: string; amount: string; reference: string | null }[];
  approval_token: string | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function hashPosApprovalRequest(request: Record<string, unknown>): string {
  const { approval_token: _approvalToken, ...approvedResource } = request;
  void _approvalToken;
  return sha256Hex(JSON.stringify(canonicalize(approvedResource)));
}

export function buildPosCheckoutRequest(
  input: CreateOrderInput,
  storeId: string,
  pricingVersion: string,
): PosCheckoutRequestV1 {
  if (!input.clientRef) {
    throw new ApiError('结账缺少幂等键', 400, undefined, 'CHECKOUT_IDEMPOTENCY_REQUIRED');
  }
  const fulfillmentMethod = input.items[0]?.deliveryMethod ?? 'in_store';
  if (input.items.some((item) => item.deliveryMethod !== fulfillmentMethod)) {
    throw new ApiError('同一订单不能混用不同履约方式', 400, undefined, 'FULFILLMENT_MIXED');
  }
  const fulfillment: PosCheckoutRequestV1['fulfillment'] = fulfillmentMethod === 'pickup'
    ? {
        method: 'pickup',
        contact_name: input.buyerName ?? '',
        phone: input.buyerPhone ?? '',
        ...(input.deliveryDate ? { pickup_at: input.deliveryDate } : {}),
      }
    : fulfillmentMethod === 'ship'
      ? {
          method: 'ship',
          contact_name: input.buyerName ?? '',
          phone: input.buyerPhone ?? '',
          address: [input.shippingAddress?.address_line1, input.shippingAddress?.address_line2, input.shippingAddress?.city]
            .filter(Boolean).join(', '),
        }
      : { method: 'in_store' };
  const lineDiscountTotal = input.items.reduce((sum, item) => sum + (item.lineDiscountCents ?? 0), 0);
  return {
    idempotency_key: input.clientRef,
    store_id: storeId,
    staff_id: input.staffId,
    customer_id: input.customerId,
    note: input.note,
    currency: input.currency,
    fulfillment,
    items: input.items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: item.qty,
      line_discount: centsToDecimalString(item.lineDiscountCents ?? 0),
    })),
    order_discount: centsToDecimalString(Math.max(0, input.discountCents - lineDiscountTotal)),
    pricing_preview: {
      subtotal: centsToDecimalString(input.subtotalCents),
      discount: centsToDecimalString(input.discountCents),
      tax: centsToDecimalString(input.taxCents),
      total: centsToDecimalString(input.totalCents),
    },
    pricing_version: pricingVersion,
    payments: input.payments.map((payment) => ({
      method: payment.method,
      label: payment.label,
      amount: centsToDecimalString(payment.amountCents),
      reference: payment.ref ?? null,
    })),
  };
}

export function buildPosRefundRequest(
  orderId: string,
  input: RefundInput,
  storeId: string,
): { body: PosRefundWireRequest; resourceHash: string } {
  const body: PosRefundWireRequest = {
    idempotency_key: input.clientRef,
    store_id: storeId,
    return_items: input.returnItems.map((item) => ({
      order_item_id: item.orderItemId,
      quantity: item.qty,
      restock: item.restock,
    })),
    reason: input.reason,
    approval_token: input.approvalToken,
  };
  return {
    body,
    resourceHash: hashPosApprovalRequest({ ...body, order_id: orderId }),
  };
}

export function buildPosExchangeRequest(
  input: ExchangeOrderInput,
  storeId: string,
  pricingVersion: string,
): { body: PosExchangeWireRequest; resourceHash: string } {
  const body: PosExchangeWireRequest = {
    idempotency_key: input.clientRef,
    store_id: storeId,
    original_order_id: input.originalOrderId,
    return_items: input.returnItems.map((item) => ({
      order_item_id: item.orderItemId,
      quantity: item.qty,
      restock: item.restock,
    })),
    replacement: buildPosCheckoutRequest(input.replacement, storeId, pricingVersion),
    difference_payment: input.differencePayment.map((payment) => ({
      method: payment.method,
      label: payment.label,
      amount: centsToDecimalString(payment.amountCents),
      reference: payment.ref ?? null,
    })),
    approval_token: input.approvalToken,
  };
  return { body, resourceHash: hashPosApprovalRequest(body as unknown as Record<string, unknown>) };
}
