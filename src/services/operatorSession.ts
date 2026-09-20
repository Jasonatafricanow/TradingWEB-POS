import * as SecureStore from 'expo-secure-store';

import { HttpClient } from '@/api/client';
import type { PosBootstrapDto, PosOperatorSessionDto } from '@/api/contracts/pos';
import type { PosPermission } from '@/api/types';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';

const SESSION_KEY = 'twpos.operator-session.v1';
const DEVICE_KEY = 'twpos.installation-id.v1';

let currentSession: PosOperatorSessionDto | null = null;
let installationId: string | null = null;

const POS_PERMISSIONS = new Set<PosPermission>([
  'checkout', 'refund', 'exchange', 'discount', 'stock_adjust',
  'inventory_read', 'inventory_adjust', 'inventory_transfer',
  'purchase_order_read', 'purchase_order_create', 'purchase_order_receive',
]);

function sessionWithKnownPermissions(session: PosOperatorSessionDto): PosOperatorSessionDto {
  const permissions = Array.isArray(session.operator?.permissions)
    ? session.operator.permissions.filter((permission): permission is PosPermission =>
      POS_PERMISSIONS.has(permission as PosPermission))
    : [];
  return { ...session, operator: { ...session.operator, permissions } };
}

const http = new HttpClient(() => ({
  baseUrl: useSettings.getState().serverUrl,
  token: useAuth.getState().token,
  operatorSessionToken: currentSession?.token ?? null,
  deviceId: currentSession?.operator.deviceId ?? installationId,
}));

function unwrap<T>(value: { data?: T } | T): T {
  return value && typeof value === 'object' && 'data' in value
    ? (value as { data: T }).data
    : value as T;
}

function makeInstallationId(): string {
  return `android-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

async function getInstallationId(): Promise<string> {
  if (installationId) return installationId;
  installationId = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!installationId) {
    installationId = makeInstallationId();
    await SecureStore.setItemAsync(DEVICE_KEY, installationId);
  }
  return installationId;
}

async function persistSession(session: PosOperatorSessionDto | null): Promise<void> {
  if (session) {
    const sanitizedSession = sessionWithKnownPermissions(session);
    currentSession = sanitizedSession;
    useAuth.getState().applyOperatorPermissions(
      sanitizedSession.operator.staffId,
      sanitizedSession.operator.permissions as PosPermission[],
    );
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(sanitizedSession));
  }
  else {
    currentSession = null;
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}

function taxRateToBps(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number <= 1 ? number * 10_000 : number * 100);
}

function applyBootstrap(bootstrap: PosBootstrapDto): void {
  if (bootstrap.contract_version !== 'pos-v1') throw new Error('Unsupported POS contract version');
  const settings = useSettings.getState();
  settings.set({
    storeId: bootstrap.store.id,
    pricingVersion: bootstrap.pricing_version,
    currency: bootstrap.currency as typeof settings.currency,
    taxRateBps: taxRateToBps(bootstrap.tax_rate),
    store: { ...settings.store, name: bootstrap.store.name },
    paymentMethods: bootstrap.payment_methods.map((method) => ({
      method: method.code,
      label: method.label,
      enabled: true,
    })),
  });
}

async function createSession(staffId: string, pin: string, storeId: string): Promise<PosOperatorSessionDto> {
  const deviceId = await getInstallationId();
  const response = await http.post<{ data: PosOperatorSessionDto }>('/api/admin/pos/operator-sessions', {
    staff_id: staffId,
    store_id: storeId,
    device_id: deviceId,
    pin,
  });
  const session = unwrap(response);
  if (session.operator.staffId !== staffId || session.operator.storeId !== storeId) {
    throw new Error('Operator session identity mismatch');
  }
  return session;
}

export async function loadOperatorSession(): Promise<PosOperatorSessionDto | null> {
  await getInstallationId();
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) {
    currentSession = null;
    return null;
  }
  try {
    const session = JSON.parse(raw) as PosOperatorSessionDto;
    if (!session.token || Date.parse(session.expiresAt) <= Date.now()) {
      await persistSession(null);
      return null;
    }
    currentSession = sessionWithKnownPermissions(session);
    useAuth.getState().applyOperatorPermissions(
      currentSession.operator.staffId,
      currentSession.operator.permissions as PosPermission[],
    );
    return currentSession;
  } catch {
    await persistSession(null);
    return null;
  }
}

export function getOperatorSessionToken(): string | null {
  return currentSession?.token ?? null;
}

export function getUsableOperatorSessionStaffId(): string | null {
  if (!currentSession?.token || Date.parse(currentSession.expiresAt) <= Date.now()) return null;
  return currentSession.operator.staffId;
}

export function getUsableOperatorSessionPermissions(): PosPermission[] | null {
  if (!currentSession?.token || Date.parse(currentSession.expiresAt) <= Date.now()) return null;
  return [...currentSession.operator.permissions] as PosPermission[];
}

export function getOperatorDeviceId(): string | null {
  return currentSession?.operator.deviceId ?? installationId;
}

export async function unlockOperator(
  staffId: string,
  pin: string,
  storeId: string,
): Promise<PosOperatorSessionDto> {
  const bootstrapResponse = await http.get<{ data: PosBootstrapDto }>(
    `/api/admin/pos/bootstrap?store_id=${encodeURIComponent(storeId)}`,
  );
  const bootstrap = unwrap(bootstrapResponse);
  if (bootstrap.store.id !== storeId) throw new Error('POS bootstrap store mismatch');
  applyBootstrap(bootstrap);

  const session = await createSession(staffId, pin, storeId);
  await persistSession(session);
  return session;
}

export async function lockOperator(): Promise<void> {
  try {
    if (!currentSession) await loadOperatorSession();
    if (currentSession) {
      await http.request('/api/admin/pos/operator-sessions/current', { method: 'DELETE' });
    }
  } finally {
    await persistSession(null);
  }
}

export interface ReauthenticationCleanupResult {
  cleanupError: unknown | null;
}

/** Clear both authentication layers before the user signs in and opens a new operator session. */
export async function requireAccountReauthentication(): Promise<ReauthenticationCleanupResult> {
  let operatorCleanupFailed = false;
  let operatorCleanupError: unknown;
  try {
    await lockOperator();
  } catch (error) {
    operatorCleanupFailed = true;
    operatorCleanupError = error;
  }

  let accountCleanupFailed = false;
  let accountCleanupError: unknown;
  try {
    await useAuth.getState().signOut();
  } catch (error) {
    accountCleanupFailed = true;
    accountCleanupError = error;
  }

  if (accountCleanupFailed) throw accountCleanupError;
  return { cleanupError: operatorCleanupFailed ? operatorCleanupError : null };
}

export async function requestApproval(
  operation: string,
  resourceHash: string,
  managerId: string,
  pin: string,
): Promise<string> {
  const storeId = useSettings.getState().storeId;
  if (!storeId) throw new Error('POS store is not configured');
  const previous = currentSession;
  const managerSession = await createSession(managerId, pin, storeId);
  // The manager session exists only in memory for the approval request. The clerk's
  // durable session remains untouched, and the manager PIN is never persisted.
  currentSession = managerSession;
  try {
    const response = await http.post<{ data: { token: string; expiresAt: string } }>('/api/admin/pos/approvals', {
      operation,
      resource_hash: resourceHash,
      store_id: storeId,
    });
    return unwrap(response).token;
  } finally {
    try {
      await http.request('/api/admin/pos/operator-sessions/current', { method: 'DELETE' });
    } finally {
      if (previous && Date.parse(previous.expiresAt) > Date.now()) {
        currentSession = previous;
      } else {
        await persistSession(null);
      }
    }
  }
}
