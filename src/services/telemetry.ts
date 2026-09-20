import AsyncStorage from '@react-native-async-storage/async-storage';

import { getCurrentPosSourceScope } from '@/api';
import type { PosDataSource, PosSourceScope, PosTelemetryRecord, PosTelemetryResult } from '@/api/types';
import { normalizePosSourceScope, samePosSourceScope } from '@/services/sourceIdentity';
import { createLocalUuid } from '@/utils/uuid';

const STORAGE_KEY = 'twpos-operational-telemetry-v1';
const MAX_RECORDS = 200;
let serialization = Promise.resolve();
interface QueuedTelemetry { record: PosTelemetryRecord; scope: PosSourceScope | null }

export type PosTelemetryEvent =
  | { type: 'sync_failed'; code: string; pendingCount: number }
  | { type: 'print_failed'; driver: string; message: string }
  | { type: 'scanner_failed'; source: string; message: string }
  | { type: 'app_error'; route: string; message: string };

export function sanitizeTelemetryMessage(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(token|pin|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .slice(0, 200);
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = serialization.then(operation, operation);
  serialization = next.then(() => undefined, () => undefined);
  return next;
}

async function read(): Promise<QueuedTelemetry[]> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECORDS).map((item) => ({
      record: item?.record ?? item,
      scope: normalizePosSourceScope(item?.scope ?? { serverUrl: '' }),
    })) : [];
  } catch {
    return [];
  }
}

export function recordTelemetry(event: PosTelemetryEvent, sourceScope: PosSourceScope | null = getCurrentPosSourceScope()): Promise<void> {
  return serialize(async () => {
    const common = { id: createLocalUuid(), occurred_at: new Date().toISOString() };
    const record: PosTelemetryRecord = event.type === 'sync_failed'
      ? { ...common, type: event.type, code: event.code.slice(0, 80), pending_count: Math.max(0, Math.trunc(event.pendingCount)) }
      : event.type === 'print_failed'
        ? { ...common, type: event.type, driver: event.driver.slice(0, 80), message: sanitizeTelemetryMessage(event.message) }
        : event.type === 'scanner_failed'
          ? { ...common, type: event.type, source: event.source.slice(0, 80), message: sanitizeTelemetryMessage(event.message) }
          : { ...common, type: event.type, route: event.route.slice(0, 120), message: sanitizeTelemetryMessage(event.message) };
    const records = await read();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ record, scope: normalizePosSourceScope(sourceScope ?? { serverUrl: '' }) }, ...records].slice(0, MAX_RECORDS)));
  });
}

export function pendingTelemetryCount(): Promise<number> {
  return serialize(async () => (await read()).length);
}

export function flushTelemetry(source: PosDataSource): Promise<PosTelemetryResult> {
  return serialize(async () => {
    const queued = await read();
    const scope = normalizePosSourceScope(source.getSourceScope() ?? { serverUrl: '' });
    if (!scope) return { accepted: 0, duplicates: 0 };
    const selected = queued.filter((item) => samePosSourceScope(item.scope, scope)).slice().reverse().slice(0, 50);
    if (!selected.length) return { accepted: 0, duplicates: 0 };
    const batch = selected.map((item) => item.record);
    const result = await source.uploadTelemetryBatch(batch);
    if (result.accepted + result.duplicates !== batch.length) throw new Error('Telemetry server did not acknowledge the complete batch');
    const uploaded = new Set(batch.map((record) => record.id));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queued.filter((item) => !uploaded.has(item.record.id))));
    return result;
  });
}
