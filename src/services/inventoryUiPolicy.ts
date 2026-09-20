import type { DataSourceKind, PosPermission, PosSourceScope, Staff, StoreLocation } from '@/api/types';

export function canUsePosPermission(
  source: DataSourceKind,
  staff: Staff | null | undefined,
  permission: PosPermission,
): boolean {
  if (source === 'mock') return !!staff;
  return !!staff?.permissions?.includes(permission);
}

export function activeDefaultLocations(locations: StoreLocation[]): StoreLocation[] {
  return locations.filter((location) => location.isActive === true && location.isStoreDefault === true);
}

export function inventoryOperationScope(
  source: DataSourceKind,
  authenticatedScope: PosSourceScope | null,
  operatorId: string | null | undefined,
): PosSourceScope | null {
  if (source === 'tradingweb') return authenticatedScope;
  if (!operatorId) return null;
  return {
    serverUrl: 'mock://local',
    storeId: 'mock-store',
    operatorId,
    deviceId: 'mock-device',
  };
}
