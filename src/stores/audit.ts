import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getCurrentPosSourceScope } from '@/api';
import type { PosAuditUploadRecord, PosDataSource, PosSourceScope } from '@/api/types';
import { normalizePosSourceScope, samePosSourceScope } from '@/services/sourceIdentity';
import { AUDIT_GENESIS, chainEntry, entryHash, verifyChain } from '@/utils/auditchain';
import type { ChainedEntry } from '@/utils/auditchain';
import { sha256Hex } from '@/utils/hash';
import { createLocalUuid, isRfc4122Uuid, stableUuidFromSeed } from '@/utils/uuid';

export type AuditAction =
  | 'discount_cart'
  | 'discount_line'
  | 'refund'
  | 'exchange'
  | 'stock_adjust'
  | 'no_shift_sale'
  | 'settings_enter'
  | 'settings_change'
  | 'shift_open'
  | 'shift_close'
  | 'cash_move'
  | 'pending_delete'
  | 'po_create'
  | 'po_receive'
  | 'log_cleared';

export const AUDIT_META: Record<AuditAction, { label: string; group: 'money' | 'stock' | 'system' }> = {
  discount_cart: { label: '整单折扣', group: 'money' },
  discount_line: { label: '行级折扣', group: 'money' },
  refund: { label: '退款', group: 'money' },
  exchange: { label: '换货', group: 'money' },
  no_shift_sale: { label: '未开班收款', group: 'money' },
  cash_move: { label: '现金进出', group: 'money' },
  pending_delete: { label: '删除待同步单', group: 'money' },
  stock_adjust: { label: '库存调整', group: 'stock' },
  po_create: { label: '新建采购单', group: 'stock' },
  po_receive: { label: '采购收货', group: 'stock' },
  settings_enter: { label: '进入设置', group: 'system' },
  settings_change: { label: '设置变更', group: 'system' },
  shift_open: { label: '开班', group: 'system' },
  shift_close: { label: '交班', group: 'system' },
  log_cleared: { label: '日志清空', group: 'system' },
};

export interface AuditEntry {
  id: string;
  at: number;
  action: AuditAction;
  staff: string;
  detail: string;
  approvedBy: string | null;
  sourceScope: PosSourceScope | null;
  prevHash: string;
  hash: string;
}

export interface AuditUploadStatus {
  status: 'uploaded' | 'ineligible';
  uploadedAt?: number;
  reason?: string;
}

export interface AuditUploadState {
  status: 'idle' | 'uploading' | 'synced' | 'error' | 'conflict';
  lastError: string | null;
}

export interface AuditState {
  entries: AuditEntry[];
  uploadStatuses: Record<string, AuditUploadStatus>;
  uploadState: AuditUploadState;
  log: (
    action: AuditAction,
    detail: string,
    staff: string,
    approvedBy?: string | null,
    sourceScope?: PosSourceScope | null,
  ) => void;
  clear: (staff?: string, approvedBy?: string | null, sourceScope?: PosSourceScope | null) => void;
  verify: () => { ok: boolean; brokenAt: number | null };
  uploadUnsynced: (source: PosDataSource) => Promise<{ accepted: number; duplicates: number }>;
}

const MAX_UPLOADED_ENTRIES = 500;

export function isAuditUuid(value: string): boolean {
  return isRfc4122Uuid(value);
}

function rebuildChain(entries: Pick<AuditEntry,
  'id' | 'at' | 'action' | 'staff' | 'detail' | 'approvedBy' | 'sourceScope'
>[]): AuditEntry[] {
  let head: ChainedEntry | undefined;
  const rebuilt: AuditEntry[] = [];
  for (const entry of [...entries].reverse()) {
    head = chainEntry(head, entry);
    rebuilt.push(head as AuditEntry);
  }
  return rebuilt.reverse();
}

export function migrateAuditState(persisted: unknown, version: number): AuditState {
  const raw = (persisted ?? {}) as Partial<AuditState> & { entries?: Record<string, unknown>[] };
  let entries = Array.isArray(raw.entries)
    ? raw.entries.map((entry) => ({
        id: String(entry.id ?? ''),
        at: Number(entry.at),
        action: String(entry.action) as AuditAction,
        staff: String(entry.staff ?? ''),
        detail: String(entry.detail ?? ''),
        approvedBy: (entry.approvedBy as string | null | undefined) ?? null,
        sourceScope: normalizePosSourceScope(
          (entry.sourceScope as PosSourceScope | null | undefined) ?? { serverUrl: '' },
        ),
        prevHash: String(entry.prevHash ?? AUDIT_GENESIS),
        hash: String(entry.hash ?? ''),
      }))
    : [];

  if (version < 1) entries = rebuildChain(entries);
  if (version < 2) {
    entries = entries.map((entry, index) => isAuditUuid(entry.id) ? entry : {
      ...entry,
      id: stableUuidFromSeed(JSON.stringify([
        'twpos-audit-v2', entry.id, entry.at, entry.action, entry.staff,
        entry.detail, entry.approvedBy ?? '', entries.length - index - 1,
      ])),
    });
    entries = rebuildChain(entries);
  }

  const trimmed = trimAuditHistory(entries, raw.uploadStatuses ?? {});

  return {
    ...(raw as AuditState),
    entries: trimmed.entries,
    uploadStatuses: trimmed.uploadStatuses,
    uploadState: { status: 'idle', lastError: null },
  };
}

function safeUploadPayload(entry: AuditEntry): Record<string, unknown> {
  // Free-form detail can contain addresses, tokens, PINs, or payment credentials.
  // Upload only its digest; the complete text stays local and remains covered by entry.hash.
  return {
    action: entry.action,
    approved: entry.approvedBy !== null,
    detail_hash: sha256Hex(entry.detail),
  };
}

function toUploadRecord(entry: AuditEntry): PosAuditUploadRecord {
  return {
    id: entry.id,
    event_type: entry.action,
    entity_type: 'pos_device_event',
    entity_id: null,
    payload: safeUploadPayload(entry),
    hash: entry.hash,
    prev_hash: entry.prevHash === AUDIT_GENESIS ? null : entry.prevHash,
    occurred_at: new Date(entry.at).toISOString(),
  };
}

function trimAuditHistory(
  entries: AuditEntry[],
  statuses: Record<string, AuditUploadStatus>,
): { entries: AuditEntry[]; uploadStatuses: Record<string, AuditUploadStatus> } {
  // 只裁剪已上传/已判定不可上传的旧条目；未上传的历史条目必须保留，
  // 避免证据在同步前被静默丢弃（离线设备可能长时间无法上传）。
  const retained: AuditEntry[] = [];
  for (const entry of entries) {
    if (retained.length >= MAX_UPLOADED_ENTRIES && statuses[entry.id]) continue;
    retained.push(entry);
  }
  const keep = new Set(retained.map((entry) => entry.id));
  return {
    entries: retained,
    uploadStatuses: Object.fromEntries(
      Object.entries(statuses).filter(([id]) => keep.has(id)),
    ),
  };
}

function normalizedEntryScope(entry: AuditEntry): PosSourceScope | null {
  return normalizePosSourceScope(entry.sourceScope ?? { serverUrl: '' });
}

function currentSourceScope(source: PosDataSource): PosSourceScope | null {
  return typeof source.getSourceScope === 'function'
    ? normalizePosSourceScope(source.getSourceScope() ?? { serverUrl: '' })
    : null;
}

function entryIsLocallyValid(entry: AuditEntry): boolean {
  if (!isAuditUuid(entry.id) || !Number.isFinite(entry.at)) return false;
  const { hash, ...facts } = entry;
  return entryHash(facts) === hash;
}

export function countPendingAuditUploads(
  entries: AuditEntry[],
  statuses: Record<string, AuditUploadStatus>,
  scope: PosSourceScope | null,
): number {
  const normalizedScope = normalizePosSourceScope(scope ?? { serverUrl: '' });
  if (!normalizedScope) return 0;
  return entries.filter((entry) => (
    entryIsLocallyValid(entry)
    && samePosSourceScope(normalizedEntryScope(entry), normalizedScope)
    && !statuses[entry.id]
  )).length;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

let uploadInFlight: Promise<{ accepted: number; duplicates: number }> | null = null;

export const partializeAudit = (state: AuditState) => ({
  entries: state.entries,
  uploadStatuses: state.uploadStatuses,
});

export const useAudit = create<AuditState>()(
  persist(
    (set, get) => ({
      entries: [],
      uploadStatuses: {},
      uploadState: { status: 'idle', lastError: null },

      log: (action, detail, staff, approvedBy = null, requestedScope) => set((state) => {
        const sourceScope = normalizePosSourceScope(
          requestedScope ?? getCurrentPosSourceScope() ?? { serverUrl: '' },
        );
        const base = {
          id: createLocalUuid(),
          at: Date.now(),
          action,
          staff,
          detail,
          approvedBy: approvedBy || null,
          sourceScope,
        };
        const prevHash = state.entries[0]?.hash ?? AUDIT_GENESIS;
        const entry: AuditEntry = { ...base, prevHash, hash: entryHash({ ...base, prevHash }) };
        return trimAuditHistory([entry, ...state.entries], state.uploadStatuses);
      }),

      clear: (staff = '系统', approvedBy = null, requestedScope) => set((state) => {
        const sourceScope = normalizePosSourceScope(
          requestedScope ?? getCurrentPosSourceScope() ?? { serverUrl: '' },
        );
        const base = {
          id: createLocalUuid(),
          at: Date.now(),
          action: 'log_cleared' as AuditAction,
          staff,
          detail: '操作日志清空标记',
          approvedBy: approvedBy || null,
          sourceScope,
        };
        const prevHash = state.entries[0]?.hash ?? AUDIT_GENESIS;
        const marker: AuditEntry = { ...base, prevHash, hash: entryHash({ ...base, prevHash }) };
        return trimAuditHistory([marker, ...state.entries], state.uploadStatuses);
      }),

      verify: () => verifyChain(get().entries),

      uploadUnsynced: async (source) => {
        if (source.kind !== 'tradingweb') return { accepted: 0, duplicates: 0 };
        if (uploadInFlight) return uploadInFlight;
        const run = async (): Promise<{ accepted: number; duplicates: number }> => {
          const scope = currentSourceScope(source);
          if (!scope) throw new Error('TradingWEB audit source scope is unavailable');

          set((state) => {
            const ineligible = state.entries.filter((entry) => (
              !entryIsLocallyValid(entry) || !normalizedEntryScope(entry)
            ) && !state.uploadStatuses[entry.id]);
            return trimAuditHistory(state.entries, {
              ...state.uploadStatuses,
              ...Object.fromEntries(ineligible.map((entry) => [entry.id, {
                status: 'ineligible' as const,
                reason: normalizedEntryScope(entry)
                  ? 'Historical audit record is invalid'
                  : 'Historical audit record has no immutable source scope',
              }])),
            });
          });

          const candidates = [...get().entries]
            .reverse()
            .filter((entry) => (
              entryIsLocallyValid(entry)
              && samePosSourceScope(normalizedEntryScope(entry), scope)
              && !get().uploadStatuses[entry.id]
            ));
          if (candidates.length === 0) {
            set({ uploadState: { status: 'synced', lastError: null } });
            return { accepted: 0, duplicates: 0 };
          }

          set({ uploadState: { status: 'uploading', lastError: null } });
          let accepted = 0;
          let duplicates = 0;
          try {
            for (let offset = 0; offset < candidates.length; offset += 100) {
              if (!samePosSourceScope(currentSourceScope(source), scope)) {
                throw new Error('TradingWEB audit source scope changed during upload');
              }
              const page = candidates.slice(offset, offset + 100);
              const records = page.map(toUploadRecord);
              const result = await source.uploadAuditBatch(records);
              if (result.accepted + result.duplicates !== records.length) {
                throw new Error('Server did not acknowledge every audit record');
              }
              accepted += result.accepted;
              duplicates += result.duplicates;
              const uploadedAt = Date.now();
              set((state) => {
                const trimmed = trimAuditHistory(state.entries, {
                  ...state.uploadStatuses,
                  ...Object.fromEntries(page.map((entry) => [entry.id, {
                    status: 'uploaded' as const,
                    uploadedAt,
                  }])),
                });
                return { ...trimmed, uploadState: state.uploadState };
              });
            }
            const eligibleRemain = get().entries.some((entry) => (
              entryIsLocallyValid(entry)
              && samePosSourceScope(normalizedEntryScope(entry), scope)
              && !get().uploadStatuses[entry.id]
            ));
            set({
              uploadState: eligibleRemain
                ? { status: 'idle', lastError: null }
                : { status: 'synced', lastError: null },
            });
            return { accepted, duplicates };
          } catch (error) {
            set({
              uploadState: {
                status: errorCode(error) === 'AUDIT_UUID_CONFLICT' ? 'conflict' : 'error',
                lastError: errorText(error),
              },
            });
            throw error;
          }
        };
        const promise = run();
        uploadInFlight = promise;
        try {
          return await promise;
        } finally {
          if (uploadInFlight === promise) uploadInFlight = null;
        }
      },
    }),
    {
      name: 'twpos-audit',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      migrate: migrateAuditState,
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AuditState>),
        uploadState: { status: 'idle', lastError: null },
      }),
      partialize: partializeAudit,
    },
  ),
);

export function auditLog(action: AuditAction, detail: string, staff: string, approvedBy?: string | null): void {
  useAudit.getState().log(action, detail, staff, approvedBy, getCurrentPosSourceScope());
}
