import { describe, expect, it } from 'vitest';

import { activeDefaultLocations, canUsePosPermission } from '../inventoryUiPolicy';

describe('Task 11 inventory UI policy', () => {
  it('treats TradingWEB permissions as authoritative for staff, managers, and admins', () => {
    for (const role of ['staff', 'manager', 'admin'] as const) {
      expect(canUsePosPermission('tradingweb', { id: role, name: role, role, permissions: [] }, 'inventory_adjust'))
        .toBe(false);
      expect(canUsePosPermission(
        'tradingweb',
        { id: role, name: role, role, permissions: ['inventory_adjust'] },
        'inventory_adjust',
      )).toBe(true);
    }
    expect(canUsePosPermission('mock', { id: 'staff', name: 'Staff', role: 'staff' }, 'inventory_adjust'))
      .toBe(true);
  });

  it('keeps only active store-default locations for adjustments and purchase orders', () => {
    expect(activeDefaultLocations([
      { id: 'inactive-default', name: 'Inactive', isActive: false, isStoreDefault: true },
      { id: 'active-not-default', name: 'Warehouse', isActive: true, isStoreDefault: false },
      { id: 'active-default', name: 'Sales floor', isActive: true, isStoreDefault: true },
    ])).toEqual([{ id: 'active-default', name: 'Sales floor', isActive: true, isStoreDefault: true }]);
  });
});
