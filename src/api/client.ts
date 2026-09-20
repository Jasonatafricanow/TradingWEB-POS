// HTTP 客户端：对齐 TradingWEB 的约定
//  - Authorization: Bearer <token>（auth-middleware）
//  - 业务校验错误 = HTTP 400 { error: string }（ValidationError）
//  - 其余非 2xx 抛 ApiError

import { parseTradingWebErrorEnvelope, translateApiErrorCode } from '@/i18n/core/api-errors';
import type { TradingWebErrorParamValue } from '@/i18n/core/api-errors';
import type { Locale } from '@/i18n';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    readonly code = 'UNKNOWN',
    readonly retryable = false,
    readonly params: Readonly<Record<string, TradingWebErrorParamValue>> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** TradingWEB ValidationError（HTTP 400），message 可直接展示给收银员 */
export class ApiValidationError extends ApiError {
  constructor(
    message: string,
    body?: unknown,
    code = 'INVALID_REQUEST',
    params: Readonly<Record<string, TradingWebErrorParamValue>> = {},
    requestId?: string,
  ) {
    super(message, 400, body, code, false, params, requestId);
    this.name = 'ApiValidationError';
  }
}

export interface HttpConfig {
  baseUrl: string;
  token: string | null;
  operatorSessionToken?: string | null;
  deviceId?: string | null;
}

export class HttpClient {
  constructor(private getConfig: () => HttpConfig) {}

  async request<T>(
    path: string,
    opts: { method?: string; body?: unknown; timeoutMs?: number } = {}
  ): Promise<T> {
    const { baseUrl, token, operatorSessionToken, deviceId } = this.getConfig();
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
      throw new ApiError('未配置有效的服务器地址（设置 → 服务器地址）', 0, undefined, 'SERVER_URL_REQUIRED');
    }
    const url = baseUrl.replace(/\/+$/, '') + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
    let res: Response;
    try {
      const operatorFreePaths = new Set([
        '/api/admin/pos/operator-sessions',
      ]);
      const includeOperator = path.startsWith('/api/admin/pos/')
        && !operatorFreePaths.has(path)
        && !path.startsWith('/api/admin/pos/bootstrap')
        && !path.startsWith('/api/admin/pos/catalog')
        && operatorSessionToken
        && deviceId;
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(includeOperator ? {
            'X-POS-Operator-Session': operatorSessionToken,
            'X-POS-Device-ID': deviceId,
          } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiError(`网络请求失败: ${msg}`, 0, undefined, 'NETWORK_ERROR', true);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const parsed = parseTradingWebErrorEnvelope(json, res.status);
      const gatewayRetryable = [502, 503, 504].includes(res.status);
      const retryable = res.status >= 400 && res.status < 500
        ? false
        : gatewayRetryable || parsed.retryable;

      if (parsed.kind === 'legacy') {
        if (res.status === 400) throw new ApiValidationError(parsed.message, json, 'INVALID_REQUEST');
        throw new ApiError(parsed.message, res.status, json, 'LEGACY_ERROR', retryable);
      }

      const message = parsed.legacyMessage ?? parsed.code;
      if (res.status === 400) {
        throw new ApiValidationError(message, json, parsed.code, parsed.params, parsed.requestId);
      }
      throw new ApiError(
        message,
        res.status,
        json,
        parsed.code,
        retryable,
        parsed.params,
        parsed.requestId,
      );
    }
    return json as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }
}

/** 端点未实现（404/405/501）：可选能力的降级判定，页面据此提示"需后端支持" */
export function isMissingEndpoint(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
}

export function isRetryableApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.retryable;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function localizedErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof ApiError) {
    if (error.code === 'LEGACY_ERROR') return error.message;
    return translateApiErrorCode(error.code, locale);
  }
  return translateApiErrorCode('UNEXPECTED_ERROR', locale);
}
