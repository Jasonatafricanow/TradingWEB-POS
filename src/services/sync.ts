import { ApiError, errorMessage } from '@/api';
import type { PosDataSource } from '@/api/types';
import type { PendingOrder, SyncErrorSnapshot } from '@/stores/pending';
import { recordTelemetry } from '@/services/telemetry';
import { getSyncHmacKey } from '@/services/syncIntegrityKey';
import { hmacSha256Hex } from '@/utils/hash';

export type SyncDecision = 'retry' | 'reauth' | 'block';

export interface PendingAutoSyncEligibility {
  pendingCount: number;
  dataSource: 'mock' | 'tradingweb';
  token: string | null;
  locked: boolean;
  staffId: string | null;
  operatorSessionStaffId: string | null;
}

/** Avoid turning an expected cold-start or locked state into a permanent 401 block. */
export function canAutoSyncPending(eligibility: PendingAutoSyncEligibility): boolean {
  return eligibility.pendingCount > 0
    && eligibility.dataSource === 'tradingweb'
    && !!eligibility.token
    && !eligibility.locked
    && !!eligibility.staffId
    && eligibility.operatorSessionStaffId === eligibility.staffId;
}

export function classifySyncError(error: ApiError): SyncDecision {
  if (error.status === 401) return 'reauth';
  if (error.status >= 400 && error.status < 500) return 'block';
  if (error.retryable) return 'retry';
  return 'block';
}

/** The checkout gate and replay state machine share this fail-closed decision. */
export function shouldQueuePendingOrder(error: unknown): error is ApiError {
  return error instanceof ApiError && classifySyncError(error) === 'retry';
}

/** 遗留 FNV1a-32 指纹（仅防意外损坏）；新条目会在首次同步时透明升级为 HMAC。 */
export function hashPendingRequest(input: Readonly<PendingOrder['request']>): string {
  const json = JSON.stringify(input);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

/** 带密钥的 HMAC-SHA256 指纹（密钥存 SecureStore，防重算篡改）。 */
export async function hmacPendingRequest(
  input: Readonly<PendingOrder['request']>,
  keyHex: string,
): Promise<string> {
  return `hmac-${hmacSha256Hex(keyHex, JSON.stringify(input))}`;
}

export function syncErrorSnapshot(error: ApiError): SyncErrorSnapshot {
  return {
    message: error.message,
    status: error.status,
    code: error.code,
    retryable: error.retryable,
    occurredAt: new Date().toISOString(),
  };
}

function failClosedError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(errorMessage(error), 0, undefined, 'SYNC_UNKNOWN_ERROR', false);
}

function integrityError(): ApiError {
  return new ApiError(
    'Pending order integrity check failed. The order was not sent to the server.',
    0,
    undefined,
    'PENDING_REQUEST_INTEGRITY',
    false,
  );
}

/**
 * 校验/升级待同步单指纹：
 * - `hmac-` 条目用 SecureStore 密钥校验；密钥不可用或指纹不符 → fail-closed 阻断。
 * - 遗留 `fnv1a-` 条目先按旧指纹校验，通过后透明升级为 HMAC。
 * ok=false 时调用方必须阻断发送。
 */
async function resolveIntegrity(order: PendingOrder): Promise<{ order: PendingOrder; ok: boolean }> {
  if (order.idempotencyKey !== order.request.clientRef) return { order, ok: false };
  const key = await getSyncHmacKey();
  if (order.requestHash.startsWith('hmac-')) {
    if (!key) return { order, ok: false };
    const expected = await hmacPendingRequest(order.request, key);
    return { order, ok: order.requestHash === expected };
  }
  if (order.requestHash !== hashPendingRequest(order.request)) return { order, ok: false };
  if (!key) return { order, ok: true };
  const requestHash = await hmacPendingRequest(order.request, key);
  return { order: { ...order, requestHash }, ok: true };
}

export async function syncPendingOrder(order: PendingOrder, source: PosDataSource, pendingCount = 1): Promise<PendingOrder> {
  if (order.status !== 'pending') return order;

  const resolved = await resolveIntegrity(order);
  if (!resolved.ok) {
    return { ...order, status: 'blocked', lastError: syncErrorSnapshot(integrityError()) };
  }

  const attempting: PendingOrder = {
    ...resolved.order,
    status: 'syncing',
    attempts: order.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
  };

  try {
    const serverOrder = await source.createOrder(attempting.request);
    return {
      ...attempting,
      status: 'synced',
      serverOrderId: serverOrder.id,
    };
  } catch (caught) {
    const error = failClosedError(caught);
    const decision = classifySyncError(error);
    void recordTelemetry({ type: 'sync_failed', code: error.code ?? `HTTP_${error.status}`, pendingCount }).catch(() => {});
    return {
      ...attempting,
      status: decision === 'retry' ? 'pending' : 'blocked',
      lastError: syncErrorSnapshot(error),
    };
  }
}
