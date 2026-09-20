import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDataSource } from '@/api/types';
import { flushTelemetry, pendingTelemetryCount, recordTelemetry, sanitizeTelemetryMessage } from '../telemetry';

describe('POS operational telemetry', () => {
  const scope = { serverUrl: 'https://example.test', storeId: 'store-1', operatorId: 'staff-1', deviceId: 'device-1' };
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('redacts credentials and customer-like identifiers from messages', () => {
    const safe = sanitizeTelemetryMessage('Bearer abc.secret token=xyz PIN: 1234 user@example.com card 4111111111111111');
    expect(safe).not.toContain('abc.secret');
    expect(safe).not.toContain('xyz');
    expect(safe).not.toContain('1234');
    expect(safe).not.toContain('user@example.com');
    expect(safe).not.toContain('4111111111111111');
  });

  it('keeps failed uploads queued and removes only an acknowledged batch', async () => {
    await recordTelemetry({ type: 'sync_failed', code: 'NETWORK', pendingCount: 3 }, scope);
    expect(await pendingTelemetryCount()).toBe(1);
    const failed = { getSourceScope: () => scope, uploadTelemetryBatch: vi.fn(async () => { throw new Error('offline'); }) } as unknown as PosDataSource;
    await expect(flushTelemetry(failed)).rejects.toThrow('offline');
    expect(await pendingTelemetryCount()).toBe(1);

    const source = { getSourceScope: () => scope, uploadTelemetryBatch: vi.fn(async (records) => ({ accepted: records.length, duplicates: 0 })) } as unknown as PosDataSource;
    await expect(flushTelemetry(source)).resolves.toEqual({ accepted: 1, duplicates: 0 });
    expect(await pendingTelemetryCount()).toBe(0);
  });

  it('never uploads a queued event to a different server or operator scope', async () => {
    await recordTelemetry({ type: 'print_failed', driver: 'network', message: 'offline' }, scope);
    const other = { ...scope, serverUrl: 'https://other.example.test' };
    const source = { getSourceScope: () => other, uploadTelemetryBatch: vi.fn() } as unknown as PosDataSource;
    await expect(flushTelemetry(source)).resolves.toEqual({ accepted: 0, duplicates: 0 });
    expect(source.uploadTelemetryBatch).not.toHaveBeenCalled();
    expect(await pendingTelemetryCount()).toBe(1);
  });
});
