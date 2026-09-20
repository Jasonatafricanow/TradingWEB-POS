import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it } from 'vitest';

import {
  cancelInventoryOperation,
  completeInventoryOperation,
  reserveInventoryOperation,
} from '../inventoryOperationIdentity';
import type { PosSourceScope } from '@/api/types';

const scope: PosSourceScope = {
  serverUrl: 'https://example.test',
  storeId: '11111111-1111-4111-8111-111111111111',
  operatorId: '22222222-2222-4222-8222-222222222222',
  deviceId: 'android-installation-1',
};

describe('Task 11 persisted inventory operation identities', () => {
  it('reuses the same identity across a simulated restart for the same scoped payload', async () => {
    const payload = { productId: 'p1', variantId: null, delta: 2, note: null };
    const first = await reserveInventoryOperation('adjustment', scope, payload);
    const second = await reserveInventoryOperation('adjustment', { ...scope }, { ...payload });

    expect(second).toEqual(first);
    expect(first.clientRef).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses a new identity when payload or any authenticated scope fact changes', async () => {
    const first = await reserveInventoryOperation('transfer', scope, { from: 'a', to: 'b', qty: 1 });
    const changedPayload = await reserveInventoryOperation('transfer', scope, { from: 'a', to: 'b', qty: 2 });
    const changedOperator = await reserveInventoryOperation(
      'transfer',
      { ...scope, operatorId: '33333333-3333-4333-8333-333333333333' },
      { from: 'a', to: 'b', qty: 1 },
    );

    expect(changedPayload.clientRef).not.toBe(first.clientRef);
    expect(changedOperator.clientRef).not.toBe(first.clientRef);
  });

  it('only clears an exact successful identity', async () => {
    const first = await reserveInventoryOperation('purchase-order', scope, { supplier: 'A', qty: 1 });
    await completeInventoryOperation({ ...first, clientRef: 'wrong-client-ref' });
    await expect(reserveInventoryOperation('purchase-order', scope, { supplier: 'A', qty: 1 }))
      .resolves.toEqual(first);

    await completeInventoryOperation(first);
    const afterSuccess = await reserveInventoryOperation('purchase-order', scope, { supplier: 'A', qty: 1 });
    expect(afterSuccess.clientRef).not.toBe(first.clientRef);

  });

  it('never evicts an unresolved identity and blocks the 33rd distinct operation', async () => {
    const first = await reserveInventoryOperation('transfer', scope, { index: 0 });
    for (let index = 1; index < 32; index += 1) {
      await reserveInventoryOperation('transfer', scope, { index });
    }

    await expect(reserveInventoryOperation('transfer', scope, { index: 32 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_JOURNAL_FULL',
      retryable: false,
    });
    await expect(reserveInventoryOperation('transfer', scope, { index: 0 })).resolves.toEqual(first);
    const persisted = JSON.parse(String(await AsyncStorage.getItem('twpos.inventory-operation-identities.v1')));
    expect(persisted).toHaveLength(32);
  });

  it('clears an unresolved identity only through the explicit safe-cancel API', async () => {
    const first = await reserveInventoryOperation('adjustment', scope, { productId: 'p1', delta: 1 });
    await cancelInventoryOperation(first);
    const replacement = await reserveInventoryOperation('adjustment', scope, { productId: 'p1', delta: 1 });
    expect(replacement.clientRef).not.toBe(first.clientRef);
  });
});
