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
  let foreground = true;
  let online = true;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  const available = () => active && foreground && online;
  const cancelWaiting = () => {
    cancelScheduled?.();
    cancelScheduled = null;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const stillCurrent = (identity: string): boolean => (
    available() && deps.snapshot()?.identity === identity
  );

  const execute = async (): Promise<void> => {
    const initial = deps.snapshot();
    if (!available() || !initial) return;
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
    const identity = deps.snapshot()?.identity;
    inFlight = execute().finally(() => {
      inFlight = null;
      const current = deps.snapshot();
      if (!current?.canSyncPending) retryAttempt = 0;
      if (!available() || !current?.canSyncPending || current.identity !== identity) return;
      if (retryTimer !== null) clearTimeout(retryTimer);
      const delay = Math.min(3000 * 2 ** Math.min(retryAttempt++, 5), 60000);
      retryTimer = setTimeout(() => { retryTimer = null; schedule(); }, delay);
    });
    return inFlight;
  };

  const schedule = () => {
    if (!available() || cancelScheduled) return;
    cancelScheduled = deps.schedule(async () => {
      cancelScheduled = null;
      await runNow();
    });
  };

  return {
    start() { active = true; schedule(); },
    foreground() { foreground = true; cancelWaiting(); retryAttempt = 0; schedule(); },
    background() { foreground = false; cancelWaiting(); },
    connectionChanged(connected: boolean) {
      if (connected === online) return;
      online = connected;
      cancelWaiting();
      if (online) { retryAttempt = 0; schedule(); }
    },
    stop() {
      active = false;
      cancelWaiting();
    },
    runNow,
  };
}
