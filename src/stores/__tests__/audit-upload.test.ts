import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PosDataSource } from '@/api/types';
import { AUDIT_GENESIS, entryHash, verifyChain } from '@/utils/auditchain';
import { auditLog, isAuditUuid, migrateAuditState, useAudit } from '../audit';

function resetAudit(): void {
  useAudit.setState({
    entries: [],
    uploadStatuses: {},
    uploadState: { status: 'idle', lastError: null },
  });
}

const SCOPE_ONE = {
  serverUrl: 'https://one.example.test',
  storeId: '11111111-1111-4111-8111-111111111111',
  operatorId: '22222222-2222-4222-8222-222222222222',
  deviceId: 'android-installation-1',
};

const SCOPE_TWO = { ...SCOPE_ONE, operatorId: '99999999-9999-4999-8999-999999999999' };

function sourceWithUpload(
  uploadAuditBatch: (records: any[]) => Promise<{ accepted: number; duplicates: number }>,
  scope = SCOPE_ONE,
) {
  return {
    kind: 'tradingweb',
    getSourceScope: () => scope,
    uploadAuditBatch,
  } as unknown as PosDataSource;
}

function logScoped(
  action: 'shift_open' | 'cash_move' | 'shift_close',
  detail: string,
  scope = SCOPE_ONE,
): void {
  (useAudit.getState().log as any)(action, detail, 'Clerk', null, scope);
}

describe('Task 10 local audit upload', () => {
  beforeEach(() => {
    resetAudit();
    vi.useRealTimers();
  });

  it('creates RFC4122 UUIDs and deterministically migrates historical non-UUID entries', () => {
    const legacy = {
      id: 'a17212932000001', at: 1721293200000, action: 'shift_open', staff: 'Clerk',
      detail: 'Opened shift', approvedBy: null, prevHash: AUDIT_GENESIS, hash: '',
    };
    legacy.hash = entryHash(legacy);

    const first = migrateAuditState({ entries: [legacy] }, 1);
    const second = migrateAuditState({ entries: [legacy] }, 1);

    expect(first.entries[0].id).toBe(second.entries[0].id);
    expect(isAuditUuid(first.entries[0].id)).toBe(true);
    expect(first.entries[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first.entries[0].at).toBe(legacy.at);
    expect(verifyChain(first.entries)).toEqual({ ok: true, brokenAt: null });
  });

  it('keeps UUID, occurred timestamp, hashes, and wire records identical across retries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T09:00:00.000Z'));
    logScoped('shift_open', 'Opened with PIN 1234 and token secret');
    const original = { ...useAudit.getState().entries[0] };
    const attempts: unknown[][] = [];
    const source = sourceWithUpload(async (records) => {
      attempts.push(records);
      if (attempts.length === 1) throw new Error('offline');
      return { accepted: records.length, duplicates: 0 };
    });

    await expect(useAudit.getState().uploadUnsynced(source)).rejects.toThrow('offline');
    expect(useAudit.getState().entries[0]).toEqual(original);
    expect(useAudit.getState().uploadStatuses).toEqual({});
    await useAudit.getState().uploadUnsynced(source);

    expect(isAuditUuid(original.id)).toBe(true);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0][0]).toMatchObject({
      id: original.id, hash: original.hash, prev_hash: null,
      occurred_at: '2026-07-18T09:00:00.000Z',
    });
    const wire = JSON.stringify(attempts[0][0]);
    expect(wire).not.toContain('1234');
    expect(wire).not.toContain('secret');
    expect(useAudit.getState().uploadStatuses[original.id]?.status).toBe('uploaded');
  });

  it('marks a batch uploaded only when accepted plus duplicates covers every record', async () => {
    logScoped('shift_open', 'Opened shift');
    const id = useAudit.getState().entries[0].id;
    const partial = sourceWithUpload(async () => ({ accepted: 0, duplicates: 0 }));

    await expect(useAudit.getState().uploadUnsynced(partial)).rejects.toThrow(/acknowledge/i);
    expect(useAudit.getState().uploadStatuses[id]).toBeUndefined();
    expect(useAudit.getState().entries).toHaveLength(1);
  });

  it('retains entries and the hash chain when the server reports a UUID conflict', async () => {
    logScoped('cash_move', 'Cash out 5.00');
    const before = useAudit.getState().entries.map((entry) => ({ ...entry }));
    const conflict = sourceWithUpload(async () => {
      throw Object.assign(new Error('conflict'), { code: 'AUDIT_UUID_CONFLICT' });
    });

    await expect(useAudit.getState().uploadUnsynced(conflict)).rejects.toThrow('conflict');

    expect(useAudit.getState().entries).toEqual(before);
    expect(useAudit.getState().uploadStatuses).toEqual({});
    expect(useAudit.getState().uploadState).toMatchObject({ status: 'conflict' });
    expect(verifyChain(useAudit.getState().entries)).toEqual({ ok: true, brokenAt: null });
  });

  it('batches only records that have not already been uploaded', async () => {
    const batches: string[][] = [];
    const source = sourceWithUpload(async (records: any[]) => {
      batches.push(records.map((record) => record.id));
      return { accepted: records.length, duplicates: 0 };
    });
    logScoped('shift_open', 'Opened shift');
    const first = useAudit.getState().entries[0].id;
    await useAudit.getState().uploadUnsynced(source);
    logScoped('cash_move', 'Cash in 5.00');
    const second = useAudit.getState().entries[0].id;
    await useAudit.getState().uploadUnsynced(source);

    expect(batches).toEqual([[first], [second]]);
  });

  it('persists immutable scope and restores it through the real storage adapter', async () => {
    logScoped('shift_open', 'Opened shift');
    const original = { ...useAudit.getState().entries[0] } as any;
    const raw = JSON.parse(String(await AsyncStorage.getItem('twpos-audit')));

    expect(raw.state.entries[0].sourceScope).toEqual(SCOPE_ONE);

    resetAudit();
    await AsyncStorage.setItem('twpos-audit', JSON.stringify(raw));
    await useAudit.persist.rehydrate();
    expect(useAudit.getState().entries[0]).toEqual(original);
    expect(useAudit.getState().verify()).toEqual({ ok: true, brokenAt: null });
  });

  it('keeps legacy unscoped records local and uploads only the exact authenticated scope', async () => {
    auditLog('shift_open', 'Legacy local record', 'Legacy Clerk');
    logScoped('cash_move', 'Scope one');
    logScoped('shift_close', 'Scope two', SCOPE_TWO);
    const uploaded: any[] = [];
    const source = sourceWithUpload(async (records) => {
      uploaded.push(...records);
      return { accepted: records.length, duplicates: 0 };
    });

    await useAudit.getState().uploadUnsynced(source);

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ event_type: 'cash_move' });
    const [scopeTwo, scopeOne, legacy] = useAudit.getState().entries as any[];
    expect(useAudit.getState().uploadStatuses[scopeOne.id]?.status).toBe('uploaded');
    expect(useAudit.getState().uploadStatuses[scopeTwo.id]?.status).toBeUndefined();
    expect(useAudit.getState().uploadStatuses[legacy.id]?.status).toBe('ineligible');
    expect((uploaded[0] as Record<string, unknown>)).not.toHaveProperty('sourceScope');
    expect(JSON.stringify(uploaded[0])).not.toContain(SCOPE_ONE.deviceId);
  });

  it('appends a clear marker without rewriting or removing the prior immutable chain', async () => {
    const source = sourceWithUpload(async (records) => ({ accepted: records.length, duplicates: 0 }));
    logScoped('shift_open', 'Opened shift');
    await useAudit.getState().uploadUnsynced(source);
    logScoped('cash_move', 'Cash in');
    const before = useAudit.getState().entries.map((entry) => ({ ...entry }));

    (useAudit.getState().clear as any)('Manager', null, SCOPE_ONE);

    const after = useAudit.getState().entries;
    expect(after.slice(1)).toEqual(before);
    expect(after[0]).toMatchObject({ action: 'log_cleared', prevHash: before[0].hash });
    expect(useAudit.getState().verify()).toEqual({ ok: true, brokenAt: null });
  });

  it('drains all eligible pages before reporting the scoped audit queue synced', async () => {
    for (let index = 0; index < 205; index += 1) {
      logScoped('cash_move', `Movement ${index}`);
    }
    const pageSizes: number[] = [];
    const source = sourceWithUpload(async (records) => {
      pageSizes.push(records.length);
      return { accepted: records.length, duplicates: 0 };
    });

    const result = await useAudit.getState().uploadUnsynced(source);

    expect(pageSizes).toEqual([100, 100, 5]);
    expect(result).toEqual({ accepted: 205, duplicates: 0 });
    expect(useAudit.getState().uploadState).toEqual({ status: 'synced', lastError: null });
  });

  it('coalesces concurrent foreground and manual uploads behind one in-flight request', async () => {
    logScoped('shift_open', 'Opened shift');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upload = vi.fn(async (records: any[]) => {
      await gate;
      return { accepted: records.length, duplicates: 0 };
    });
    const source = sourceWithUpload(upload);

    const foreground = useAudit.getState().uploadUnsynced(source);
    const manual = useAudit.getState().uploadUnsynced(source);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    release();

    await expect(Promise.all([foreground, manual])).resolves.toEqual([
      { accepted: 1, duplicates: 0 },
      { accepted: 1, duplicates: 0 },
    ]);
    expect(upload).toHaveBeenCalledOnce();
    expect(useAudit.getState().uploadState.status).toBe('synced');
  });

  it('prunes upload statuses with the bounded 500-entry history', async () => {
    for (let index = 0; index < 500; index += 1) logScoped('cash_move', `Movement ${index}`);
    const source = sourceWithUpload(async (records) => ({ accepted: records.length, duplicates: 0 }));
    await useAudit.getState().uploadUnsynced(source);

    logScoped('cash_move', 'Newest movement');

    const state = useAudit.getState();
    const ids = new Set(state.entries.map((entry) => entry.id));
    expect(state.entries).toHaveLength(500);
    expect(Object.keys(state.uploadStatuses)).toHaveLength(499);
    expect(Object.keys(state.uploadStatuses).every((id) => ids.has(id))).toBe(true);
  });

  it('never silently drops un-uploaded history entries beyond the bounded history', () => {
    for (let index = 0; index < 700; index += 1) logScoped('cash_move', `Movement ${index}`);

    const state = useAudit.getState();
    expect(state.entries).toHaveLength(700);
    expect(state.uploadStatuses).toEqual({});
    expect(verifyChain(state.entries)).toEqual({ ok: true, brokenAt: null });
  });

  it('does not let an in-flight upload rewrite entries when clear appends its marker', async () => {
    logScoped('shift_open', 'Opened shift');
    logScoped('cash_move', 'Cash in');
    const immutable = useAudit.getState().entries.map((entry) => ({ ...entry }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const source = sourceWithUpload(async (records) => {
      await gate;
      return { accepted: records.length, duplicates: 0 };
    });

    const uploading = useAudit.getState().uploadUnsynced(source);
    await vi.waitFor(() => expect(useAudit.getState().uploadState.status).toBe('uploading'));
    (useAudit.getState().clear as any)('Manager', null, SCOPE_ONE);
    release();
    await uploading;

    expect(useAudit.getState().entries.slice(1)).toEqual(immutable);
    expect(useAudit.getState().uploadState.status).not.toBe('synced');
  });
});
