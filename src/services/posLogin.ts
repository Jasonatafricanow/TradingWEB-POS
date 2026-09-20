import type { PosDataSource, Staff } from '@/api/types';
import type { PinResult } from '@/stores/auth';
import { useAuth } from '@/stores/auth';
import { useAudit } from '@/stores/audit';
import { useShift } from '@/stores/shift';
import { getUsableOperatorSessionPermissions, unlockOperator } from './operatorSession';
import { flushTelemetry } from './telemetry';

function mergeOperatorAndApprovers(operator: Staff, approvers: Staff[], storeId: string): Staff[] {
  const unique = new Map<string, Staff>();
  unique.set(operator.id, { ...operator, storeId });
  for (const approver of approvers) {
    if (
      approver.storeId === storeId
      && (approver.role === 'admin' || approver.role === 'manager')
      && !unique.has(approver.id)
    ) {
      unique.set(approver.id, approver);
    }
  }
  return [...unique.values()];
}

export async function completeTradingWebUnlock(
  source: PosDataSource,
  operator: Staff,
  pin: string,
  storeId: string,
): Promise<PinResult> {
  await unlockOperator(operator.id, pin, storeId);
  const sessionPermissions = getUsableOperatorSessionPermissions();
  await useShift.getState().recoverCurrentShift(source);
  let approvers: Staff[] = [];
  try {
    approvers = await source.fetchApprovers(storeId);
  } catch {
    // The clerk session remains usable, but manager-gated actions stay fail-closed.
  }
  useAuth.getState().setStaffList(mergeOperatorAndApprovers(operator, approvers, storeId));
  useAuth.getState().applyOperatorPermissions(operator.id, sessionPermissions ?? []);
  const result = useAuth.getState().activateStaff(operator.id);
  if (result.ok) {
    void useAudit.getState().uploadUnsynced(source).catch(() => {});
    void flushTelemetry(source).catch(() => {});
  }
  return result;
}
