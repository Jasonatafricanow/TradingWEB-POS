export interface SourceIdentityInput {
  dataSource: 'mock' | 'tradingweb';
  serverUrl: string;
  storeId?: string | null;
}

export function normalizedServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

export interface PosSourceScopeInput {
  serverUrl: string;
  storeId?: string | null;
  operatorId?: string | null;
  deviceId?: string | null;
}

export interface NormalizedPosSourceScope {
  serverUrl: string;
  storeId: string;
  operatorId: string;
  deviceId: string;
}

export interface ServerFinancialStateInput {
  open: boolean;
  accountingSource: 'local' | 'server';
  pendingCashMovement: unknown | null;
  pendingClose: unknown | null;
}

export function serverFinancialStateCount(state: ServerFinancialStateInput): number {
  return (state.open && state.accountingSource === 'server' ? 1 : 0)
    + (state.pendingCashMovement ? 1 : 0)
    + (state.pendingClose ? 1 : 0);
}

export function normalizePosSourceScope(input: PosSourceScopeInput): NormalizedPosSourceScope | null {
  const serverUrl = normalizedServerUrl(input.serverUrl);
  const storeId = input.storeId?.trim() ?? '';
  const operatorId = input.operatorId?.trim() ?? '';
  const deviceId = input.deviceId?.trim() ?? '';
  if (!/^https?:\/\//.test(serverUrl) || !storeId || !operatorId || !deviceId) return null;
  return { serverUrl, storeId, operatorId, deviceId };
}

export function samePosSourceScope(
  left: NormalizedPosSourceScope | null | undefined,
  right: NormalizedPosSourceScope | null | undefined,
): boolean {
  return !!left && !!right
    && left.serverUrl === right.serverUrl
    && left.storeId === right.storeId
    && left.operatorId === right.operatorId
    && left.deviceId === right.deviceId;
}

export function sourceIdentity(input: SourceIdentityInput): string {
  return input.dataSource === 'mock'
    ? 'mock'
    : `tradingweb|${normalizedServerUrl(input.serverUrl)}|${input.storeId ?? ''}`;
}

export function canSwitchSource(
  current: SourceIdentityInput,
  next: SourceIdentityInput,
  businessStateCount: number,
  financialStateCount = 0,
): boolean {
  return (businessStateCount <= 0 && financialStateCount <= 0)
    || sourceIdentity(current) === sourceIdentity(next);
}
