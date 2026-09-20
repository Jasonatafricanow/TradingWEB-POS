import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PosSourceScope } from '@/api/types';
import { ApiError } from '@/api/client';
import { hashPosApprovalRequest } from './posRequests';
import { createLocalUuid } from '@/utils/uuid';

export type InventoryOperationKind = 'adjustment' | 'purchase-order' | 'transfer';

export interface InventoryOperationIdentity {
  kind: InventoryOperationKind;
  scope: PosSourceScope;
  requestHash: string;
  clientRef: string;
  createdAt: string;
}

const STORAGE_KEY = 'twpos.inventory-operation-identities.v1';
const MAX_RECORDS = 32;
let serializedWrite: Promise<void> = Promise.resolve();

function normalizeScope(scope: PosSourceScope): PosSourceScope {
  return {
    serverUrl: scope.serverUrl.trim().replace(/\/+$/, ''),
    storeId: scope.storeId,
    operatorId: scope.operatorId,
    deviceId: scope.deviceId,
  };
}

function sameScope(left: PosSourceScope, right: PosSourceScope): boolean {
  return left.serverUrl === right.serverUrl
    && left.storeId === right.storeId
    && left.operatorId === right.operatorId
    && left.deviceId === right.deviceId;
}

async function readRecords(): Promise<InventoryOperationIdentity[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is InventoryOperationIdentity => {
      if (!record || typeof record !== 'object') return false;
      const value = record as Partial<InventoryOperationIdentity>;
      return (value.kind === 'adjustment' || value.kind === 'purchase-order' || value.kind === 'transfer')
        && typeof value.clientRef === 'string'
        && typeof value.requestHash === 'string'
        && typeof value.createdAt === 'string'
        && !!value.scope
        && typeof value.scope.serverUrl === 'string'
        && typeof value.scope.storeId === 'string'
        && typeof value.scope.operatorId === 'string'
        && typeof value.scope.deviceId === 'string';
    });
  } catch {
    return [];
  }
}

function withSerializedWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = serializedWrite.then(operation, operation);
  serializedWrite = result.then(() => undefined, () => undefined);
  return result;
}

export async function reserveInventoryOperation(
  kind: InventoryOperationKind,
  sourceScope: PosSourceScope,
  payload: Record<string, unknown>,
): Promise<InventoryOperationIdentity> {
  const scope = normalizeScope(sourceScope);
  const requestHash = hashPosApprovalRequest(payload);
  return withSerializedWrite(async () => {
    const records = await readRecords();
    const existing = records.find((record) =>
      record.kind === kind && record.requestHash === requestHash && sameScope(record.scope, scope));
    if (existing) return existing;
    if (records.length >= MAX_RECORDS) {
      throw new ApiError(
        'Too many unresolved inventory operations; retry or safely cancel an existing operation first',
        409,
        { maxRecords: MAX_RECORDS },
        'IDEMPOTENCY_JOURNAL_FULL',
        false,
      );
    }

    const identity: InventoryOperationIdentity = {
      kind,
      scope,
      requestHash,
      clientRef: createLocalUuid(),
      createdAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([identity, ...records]));
    return identity;
  });
}

async function removeInventoryOperation(identity: InventoryOperationIdentity): Promise<void> {
  await withSerializedWrite(async () => {
    const records = await readRecords();
    const remaining = records.filter((record) => !(
      record.kind === identity.kind
      && record.clientRef === identity.clientRef
      && record.requestHash === identity.requestHash
      && sameScope(record.scope, normalizeScope(identity.scope))
    ));
    if (remaining.length !== records.length) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    }
  });
}

/** Call only after the server explicitly acknowledged success. */
export function completeInventoryOperation(identity: InventoryOperationIdentity): Promise<void> {
  return removeInventoryOperation(identity);
}

/** Call only after the user explicitly abandons an operation that is known not to have reached the server. */
export function cancelInventoryOperation(identity: InventoryOperationIdentity): Promise<void> {
  return removeInventoryOperation(identity);
}
