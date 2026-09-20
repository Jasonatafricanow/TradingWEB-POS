export interface AppLifecycleSnapshot {
  identity: string;
  canSyncPending: boolean;
}

interface AppLifecycleCoordinatorDependencies {
  schedule: (run: () => Promise<void>) => () => void;
  snapshot: () => AppLifecycleSnapshot | null;
  syncPending: () => Promise<unknown>;
  uploadAudit: () => Promise<unknown>;
  flushTelemetry: () => Promise<unknown>;
}

export function createAppLifecycleCoordinator(deps: AppLifecycleCoordinatorDependencies) {
  let active = true;
  let cancelScheduled: (() => void) | null = null;
  let inFlight: Promise<void> | null = null;

  const stillCurrent = (identity: string): boolean => (
    active && deps.snapshot()?.identity === identity
  );

  const execute = async (): Promise<void> => {
    const initial = deps.snapshot();
    if (!active || !initial) return;
    if (initial.canSyncPending) {
      await deps.syncPending();
      if (!stillCurrent(initial.identity)) return;
    }
    await deps.uploadAudit();
    if (!stillCurrent(initial.identity)) return;
    await deps.flushTelemetry();
  };

  const runNow = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = execute().finally(() => { inFlight = null; });
    return inFlight;
  };

  const schedule = () => {
    if (!active || cancelScheduled) return;
    cancelScheduled = deps.schedule(async () => {
      cancelScheduled = null;
      await runNow();
    });
  };

  return {
    start() { active = true; schedule(); },
    foreground() { schedule(); },
    stop() {
      active = false;
      cancelScheduled?.();
      cancelScheduled = null;
    },
    runNow,
  };
}
