import { describe, expect, it } from 'vitest';
import {
  TRADINGWEB_ERROR_CODES,
  TRADINGWEB_ERROR_CONTRACT_VERSION,
  parseTradingWebErrorEnvelope,
  translateApiErrorCode,
} from '@/i18n/core/api-errors';

describe('TradingWEB error-code consumer snapshot', () => {
  it('covers the active bootstrap, operator-session, and checkout codes', () => {
    expect(TRADINGWEB_ERROR_CODES).toEqual(expect.arrayContaining([
      'STORE_ID_REQUIRED',
      'SESSION_INPUT_INVALID',
      'OPERATOR_SESSION_REQUIRED',
      'CHECKOUT_PERMISSION_REQUIRED',
      'PRICING_VERSION_CHANGED',
      'PIN_LOCKED',
      'PIN_INVALID',
      'REFUND_REQUEST_INVALID',
      'EXCHANGE_REQUEST_INVALID',
      'INVENTORY_ADJUSTMENT_REQUEST_INVALID',
      'FULFILLMENT_FORBIDDEN',
      'REPORT_QUERY_INVALID',
      'APPROVER_NOT_FOUND',
      'APPROVER_STORE_MISMATCH',
      'ORDER_QUERY_INVALID',
      'PICKUP_TRANSITION_INVALID',
      'REPORT_FORBIDDEN',
    ]));
    expect(translateApiErrorCode('STORE_ID_REQUIRED', 'en')).not.toBe(
      translateApiErrorCode('UNEXPECTED_ERROR', 'en'),
    );
  });

  it('uses explicit resource-appropriate translations instead of code-name heuristics', () => {
    const productMissing = translateApiErrorCode('PRODUCT_NOT_FOUND', 'en');
    expect(translateApiErrorCode('ORDER_NOT_FOUND', 'en')).toBe('The order was not found.');
    expect(translateApiErrorCode('SHIFT_NOT_FOUND', 'en')).toBe('The shift was not found.');
    expect(translateApiErrorCode('PURCHASE_ORDER_NOT_FOUND', 'en')).toBe(
      'The purchase order was not found.',
    );
    expect(translateApiErrorCode('TRANSFER_NOT_FOUND', 'en')).toBe(
      'The inventory transfer was not found.',
    );
    expect(translateApiErrorCode('ORDER_NOT_FOUND', 'en')).not.toBe(productMissing);
  });

  it('parses a known coded envelope with safe params and request ID', () => {
    expect(TRADINGWEB_ERROR_CONTRACT_VERSION).toBe(1);
    expect(parseTradingWebErrorEnvelope({
      error: {
        code: 'PRICING_CHANGED',
        params: {
          authoritative_total: '18.00',
          currency: 'USD',
          session_token: 'must-not-leak',
        },
        request_id: 'req-42',
        retryable: false,
      },
    })).toEqual({
      kind: 'coded',
      code: 'PRICING_CHANGED',
      params: { authoritative_total: '18.00', currency: 'USD' },
      requestId: 'req-42',
      retryable: false,
      legacyMessage: undefined,
    });
  });

  it('maps unknown codes to the generic code without inheriting retryability', () => {
    expect(parseTradingWebErrorEnvelope({
      error: {
        code: 'SQL_CONNECTION_FAILED',
        params: { password: 'secret' },
        retryable: true,
      },
    })).toEqual({
      kind: 'coded',
      code: 'UNEXPECTED_ERROR',
      params: {},
      requestId: undefined,
      retryable: false,
      legacyMessage: undefined,
    });
  });

  it('keeps HTTP status authoritative over a retryable response flag', () => {
    const body = { error: { code: 'FORBIDDEN', retryable: true } };
    expect(parseTradingWebErrorEnvelope(body, 403)).toMatchObject({ retryable: false });
    expect(parseTradingWebErrorEnvelope(body, 500)).toMatchObject({ retryable: true });
    expect(parseTradingWebErrorEnvelope(body, 503)).toMatchObject({ retryable: true });
  });

  it('accepts legacy strings without parsing their wording for retryability', () => {
    expect(parseTradingWebErrorEnvelope({ error: 'gateway timeout; retry now' })).toEqual({
      kind: 'legacy',
      message: 'gateway timeout; retry now',
      retryable: false,
    });
  });

  it('translates known and unknown presentation independently from behavior', () => {
    expect(translateApiErrorCode('PRICING_CHANGED', 'pt')).toContain('preços');
    expect(translateApiErrorCode('SOMETHING_NEW', 'zh')).toBe('出现意外错误，请重试。');
  });
});
