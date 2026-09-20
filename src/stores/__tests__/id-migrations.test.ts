import { describe, expect, it } from 'vitest';
import { migrateAuthState } from '../auth';
import { migrateCartState } from '../cart';
import { migratePendingState } from '../pending';
import { migrateSettingsState } from '../settings';

describe('legacy numeric entity ID migrations', () => {
  it('migrates active, held, exchange and customer cart IDs without dropping data', () => {
    const migrated = migrateCartState(
      {
        lines: [
          { key: 'p1:101', productId: 1, variantId: 101, custom: false, name: '商品' },
          { key: 'custom-old', productId: 0, variantId: null, custom: true, name: '自定义' },
        ],
        customer: { id: 2, name: '客户' },
        holds: [
          {
            id: 'hold-1',
            lines: [{ key: 'p3:0', productId: 3, variantId: null, custom: false, name: '挂单商品' }],
            customer: { id: 4, name: '挂单客户' },
          },
        ],
        exchange: {
          orderId: 'order-1',
          items: [{ productId: 2, variantId: 104, name: '退货商品' }],
        },
      },
      0,
    );

    expect(migrated.lines).toHaveLength(2);
    expect(migrated.lines[0]).toMatchObject({
      key: 'pmock-product-1:mock-variant-1-1',
      productId: 'mock-product-1',
      variantId: 'mock-variant-1-1',
    });
    expect(migrated.lines[1]).toMatchObject({
      key: 'custom-old',
      productId: 'local-product-custom',
      variantId: null,
    });
    expect(migrated.customer?.id).toBe('mock-customer-2');
    expect(migrated.holds[0].lines[0].productId).toBe('mock-product-3');
    expect(migrated.holds[0].customer?.id).toBe('mock-customer-4');
    expect(migrated.exchange?.items[0]).toMatchObject({
      productId: 'mock-product-2',
      variantId: 'mock-variant-2-1',
    });
  });

  it('migrates all staff references and per-staff lockout keys', () => {
    const migrated = migrateAuthState(
      {
        account: { id: 1, name: '店长' },
        currentStaff: { id: 2, name: '店员' },
        staffList: [{ id: 1, name: '店长' }, { id: 'staff-uuid', name: 'UUID 店员' }],
        pinLockouts: {
          1: { attempts: 2, lockUntil: null },
          'staff-uuid': { attempts: 1, lockUntil: null },
        },
      },
      1,
    );

    expect(migrated.account?.id).toBe('mock-staff-manager');
    expect(migrated.currentStaff?.id).toBe('mock-staff-clerk');
    expect(migrated.staffList.map((staff) => staff.id)).toEqual([
      'mock-staff-manager',
      'staff-uuid',
    ]);
    expect(migrated.pinLockouts).toEqual({
      'mock-staff-manager': { attempts: 2, lockUntil: null },
      'staff-uuid': { attempts: 1, lockUntil: null },
    });
  });

  it('safely invalidates unrecoverable UUIDs that legacy JSON stored as null', () => {
    const legacyCart = JSON.parse(
      JSON.stringify({
        lines: [{ key: 'broken', productId: Number.NaN, variantId: null, custom: false }],
        customer: { id: Number.NaN, name: '损坏客户' },
        holds: [],
        exchange: {
          orderId: 'order-1',
          creditCents: 2000,
          items: [
            { productId: 1, variantId: null, name: '可恢复退货行' },
            { productId: Number.NaN, variantId: null, name: '损坏退货行' },
          ],
        },
      }),
    );
    const legacyAuth = JSON.parse(
      JSON.stringify({
        account: { id: Number.NaN, name: '损坏账号' },
        currentStaff: { id: Number.NaN, name: '损坏员工' },
        staffList: [{ id: Number.NaN, name: '损坏员工' }],
        pinLockouts: { '': { attempts: 2, lockUntil: null } },
        locked: false,
      }),
    );

    const cart = migrateCartState(legacyCart, 0);
    const auth = migrateAuthState(legacyAuth, 1);

    expect(cart.lines).toEqual([]);
    expect(cart.customer).toBeNull();
    expect(cart.exchange).toBeNull();
    expect(auth.account).toBeNull();
    expect(auth.currentStaff).toBeNull();
    expect(auth.staffList).toEqual([]);
    expect(auth.pinLockouts).toEqual({});
    expect(auth.locked).toBe(true);
  });

  it('migrates legacy mock location IDs and keeps null unchanged', () => {
    expect(migrateSettingsState({ currentLocationId: 1 }, 2).currentLocationId).toBe(
      'mock-location-front',
    );
    expect(migrateSettingsState({ currentLocationId: 2 }, 2).currentLocationId).toBe(
      'mock-location-warehouse',
    );
    expect(migrateSettingsState({ currentLocationId: null }, 2).currentLocationId).toBeNull();
  });

  it('stringifies queued order IDs exactly so offline orders remain replayable', () => {
    const migrated = migratePendingState(
      {
        items: [
          {
            id: 'pending-1',
            localNumber: 'OFF-1',
            createdAt: '2026-07-13T00:00:00.000Z',
            lastError: 'offline',
            attempts: 0,
            input: {
              staffId: 1,
              customerId: 2,
              items: [
                { productId: 3, variantId: 4, qty: 1 },
                { productId: 5, variantId: null, qty: 2 },
              ],
            },
          },
        ],
      },
      0,
    );

    expect(migrated.items).toHaveLength(1);
    expect(migrated.items[0]).toMatchObject({
      status: 'pending',
      idempotencyKey: 'pending-1',
      attempts: 0,
      lastAttemptAt: null,
      serverOrderId: null,
    });
    expect(migrated.items[0].request.staffId).toBe('1');
    expect(migrated.items[0].request.customerId).toBe('2');
    expect(migrated.items[0].request.clientRef).toBe('pending-1');
    expect(migrated.items[0].request.items).toMatchObject([
      { productId: '3', variantId: '4', qty: 1 },
      { productId: '5', variantId: null, qty: 2 },
    ]);
  });
});
