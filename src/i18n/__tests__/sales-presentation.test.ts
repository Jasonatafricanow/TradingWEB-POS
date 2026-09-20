import { describe, expect, it } from 'vitest';

import {
  fulfillmentStatusLabel,
  orderStatusLabel,
  pendingAuditDescription,
  pendingErrorMessage,
  translate,
} from '@/i18n';

describe('mobile sales presentation', () => {
  it('localizes order and fulfillment statuses from stable values', () => {
    expect(orderStatusLabel('zh', 'completed')).toBe('已完成');
    expect(orderStatusLabel('en', 'partial_refund')).toBe('Partially refunded');
    expect(orderStatusLabel('pt', 'refunded')).toBe('Reembolsado');
    expect([
      'Não atendido',
      'Em preparação',
      'Pronto para retirada',
      'Retirado',
    ]).toEqual(
      ['unfulfilled', 'preparing', 'ready', 'picked_up'].map((status) =>
        fulfillmentStatusLabel('pt', status),
      ),
    );
    expect(fulfillmentStatusLabel('en', 'future_status')).toBe('Unknown');
  });

  it('uses safe localized pending errors instead of server free text', () => {
    expect(
      pendingErrorMessage('pt', {
        status: 409,
        message: 'server secret',
      }, 'idem-42'),
    ).toBe(
      'Conflito no servidor: o pedido idem-42 não foi confirmado. Verifique-o no servidor.',
    );
    expect(
      pendingErrorMessage('en', {
        status: 500,
        message: 'database password',
      }, 'idem-42'),
    ).toBe('Sync could not be completed. Try again.');
    expect(
      pendingErrorMessage('en', {
        status: 401,
        message: 'expired bearer token',
      }, 'idem-42'),
    ).toBe('Sync could not be completed. Try again.');
  });

  it('keeps operational identifiers unchanged in localized audit text', () => {
    const expected = '删除待同步订单 idem-42，金额 MZN 12,00';
    expect(pendingAuditDescription('zh', 'idem-42', 'MZN 12,00')).toBe(expected);
    expect(pendingAuditDescription('en', 'idem-42', 'MZN 12,00')).toBe(expected);
    expect(pendingAuditDescription('pt', 'idem-42', 'MZN 12,00')).toBe(expected);
  });

  it('provides typed order and pending screen copy', () => {
    expect(translate('pt', 'orders.title')).toBe('Pedidos');
    expect(translate('en', 'pending.retry_now')).toBe('Retry now');
  });
});
