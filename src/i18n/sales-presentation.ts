import { translate, type TranslationKeyWithoutParams } from './core/catalog';
import type { Locale } from './core/locale';

const ORDER_STATUS_KEYS = {
  completed: 'orders.status.completed',
  partial_refund: 'orders.status.partial_refund',
  refunded: 'orders.status.refunded',
} as const satisfies Record<string, TranslationKeyWithoutParams>;

const FULFILLMENT_STATUS_KEYS = {
  unfulfilled: 'orders.fulfillment.unfulfilled',
  preparing: 'orders.fulfillment.preparing',
  ready: 'orders.fulfillment.ready_for_pickup',
  picked_up: 'orders.fulfillment.picked_up',
} as const satisfies Record<string, TranslationKeyWithoutParams>;

export function orderStatusLabel(locale: Locale, status: string): string {
  return translate(
    locale,
    ORDER_STATUS_KEYS[status as keyof typeof ORDER_STATUS_KEYS] ?? 'orders.status.unknown',
  );
}

export function fulfillmentStatusLabel(locale: Locale, status: string): string {
  return translate(
    locale,
    FULFILLMENT_STATUS_KEYS[status as keyof typeof FULFILLMENT_STATUS_KEYS] ??
      'orders.fulfillment.unknown',
  );
}

export function pendingErrorMessage(
  locale: Locale,
  error: Readonly<{ status?: number | null; message?: string | null }>,
  orderNumber: string,
): string {
  if (error.status === 409) {
    return translate(locale, 'pending.conflict', { orderNumber });
  }
  return translate(locale, 'pending.error_safe');
}

export function pendingAuditDescription(
  locale: Locale,
  orderNumber: string,
  amount: string,
): string {
  return translate(locale, 'pending.audit_delete', { orderNumber, amount });
}
