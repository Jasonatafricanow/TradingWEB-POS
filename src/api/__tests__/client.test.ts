import { describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  HttpClient,
  isRetryableApiError,
  localizedErrorMessage,
} from '../client';

function client(): HttpClient {
  return new HttpClient(() => ({ baseUrl: 'https://example.test', token: 'jwt' }));
}

describe('HttpClient POS errors', () => {
  it('parses stable error codes and keeps business conflicts non-retryable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: 'PRICING_CHANGED',
        params: { authoritative_total: '18.00', currency: 'USD' },
        request_id: 'req-price',
        retryable: false,
      },
    }), { status: 409 }));

    const error = await client().get('/api/admin/pos/catalog').catch((caught) => caught);
    expect(error).toMatchObject({
      code: 'PRICING_CHANGED',
      status: 409,
      retryable: false,
      params: { authoritative_total: '18.00', currency: 'USD' },
      requestId: 'req-price',
    });
    expect(isRetryableApiError(error)).toBe(false);
  });

  it('fails closed for an unknown 4xx code even when the envelope says retryable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'SOMETHING_NEW', retryable: true },
    }), { status: 409 }));

    const error = await client().get('/api/admin/pos/catalog').catch((caught) => caught);
    expect(error).toMatchObject({
      code: 'UNEXPECTED_ERROR',
      status: 409,
      retryable: false,
      params: {},
    });
  });

  it.each([502, 503, 504])('always treats gateway status %s as retryable', async (status) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'UPSTREAM_ERROR', message: 'Unavailable', retryable: false },
    }), { status }));

    const error = await client().get('/api/admin/pos/catalog').catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(isRetryableApiError(error)).toBe(true);
  });

  it('marks transport failures retryable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('offline'));
    const error = await client().get('/api/admin/pos/catalog').catch((caught) => caught);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0, retryable: true });
  });

  it.each([500, 501])('respects a known coded retryable envelope for status %s', async (status) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'INTERNAL_ERROR', retryable: true },
    }), { status }));

    const error = await client().get('/api/admin/pos/catalog').catch((caught) => caught);
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', status, retryable: true });
    expect(isRetryableApiError(error)).toBe(true);
  });

  it('localizes coded errors while keeping legacy text compatibility-only', () => {
    expect(
      localizedErrorMessage(
        new ApiError('Pricing changed', 409, null, 'PRICING_CHANGED', false),
        'pt',
      ),
    ).toContain('preços');
    expect(
      localizedErrorMessage(
        new ApiError('temporary legacy message', 400, null, 'LEGACY_ERROR', false),
        'zh',
      ),
    ).toBe('temporary legacy message');
    expect(localizedErrorMessage(new Error('password=secret'), 'en')).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
