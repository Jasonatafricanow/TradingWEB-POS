import { describe, expect, it, vi } from 'vitest';

import { createAppLifecycleCoordinator } from '../appLifecycleCoordinator';

describe('app lifecycle coordinator', () => {
  it('defers jobs and shares one in-flight run', async () => {
    let scheduled: (() => Promise<void>) | null = null;
    const events: string[] = [];
    let releasePending!: () => void;
    const pendingGate = new Promise<void>((resolve) => { releasePending = resolve; });
    const coordinator = createAppLifecycleCoordinator({
      schedule: (run) => { scheduled = run; return () => { scheduled = null; }; },
      snapshot: () => ({ identity: 'scope-1', canSyncPending: true }),
      syncPending: async () => { events.push('pending'); await pendingGate; },
      uploadAudit: async () => { events.push('audit'); },
      flushTelemetry: async () => { events.push('telemetry'); },
    });

    coordinator.start();
    expect(events).toEqual([]);
    const first = scheduled!();
    const second = coordinator.runNow();
    releasePending();
    await Promise.all([first, second]);

    expect(events).toEqual(['pending', 'audit', 'telemetry']);
  });

  it('stops when source identity changes between jobs', async () => {
    let identity = 'scope-1';
    const uploadAudit = vi.fn(async () => undefined);
    const coordinator = createAppLifecycleCoordinator({
      schedule: () => () => undefined,
      snapshot: () => ({ identity, canSyncPending: true }),
      syncPending: async () => { identity = 'scope-2'; },
      uploadAudit,
      flushTelemetry: vi.fn(async () => undefined),
    });

    await coordinator.runNow();

    expect(uploadAudit).not.toHaveBeenCalled();
  });

  it('cancels scheduled work after stop', () => {
    const cancel = vi.fn();
    const coordinator = createAppLifecycleCoordinator({
      schedule: () => cancel,
      snapshot: () => null,
      syncPending: vi.fn(async () => undefined),
      uploadAudit: vi.fn(async () => undefined),
      flushTelemetry: vi.fn(async () => undefined),
    });

    coordinator.start();
    coordinator.stop();

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
