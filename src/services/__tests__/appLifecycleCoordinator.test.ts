import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppLifecycleCoordinator } from '../appLifecycleCoordinator';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

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
    coordinator.stop();
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

  it('backs off retryable pending work, caps at 60 seconds, and stops when drained', async () => {
    vi.useFakeTimers();
    let pending = true;
    const syncPending = vi.fn(async () => undefined);
    const coordinator = createAppLifecycleCoordinator({
      schedule: (run) => { const timer = setTimeout(() => void run(), 0); return () => clearTimeout(timer); },
      snapshot: () => ({ identity: 'one', canSyncPending: pending }),
      syncPending, uploadAudit: async () => undefined, flushTelemetry: async () => undefined,
    });
    coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncPending).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [3000, 6000, 12000, 24000, 48000, 60000, 60000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(syncPending).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(2);
      expect(syncPending).toHaveBeenCalledTimes(index + 2);
    }
    pending = false;
    await vi.advanceTimersByTimeAsync(60001);
    expect(syncPending).toHaveBeenCalledTimes(8);
    expect(vi.getTimerCount()).toBe(0);
    coordinator.stop();
  });

  it('reconnects once, pauses offline/background, and cancels retries after stop', async () => {
    vi.useFakeTimers();
    const syncPending = vi.fn(async () => undefined);
    const coordinator = createAppLifecycleCoordinator({
      schedule: (run) => { const timer = setTimeout(() => void run(), 0); return () => clearTimeout(timer); },
      snapshot: () => ({ identity: 'one', canSyncPending: true }),
      syncPending, uploadAudit: async () => undefined, flushTelemetry: async () => undefined,
    });
    coordinator.connectionChanged(false);
    coordinator.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(syncPending).not.toHaveBeenCalled();
    coordinator.connectionChanged(true);
    coordinator.connectionChanged(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncPending).toHaveBeenCalledTimes(1);
    coordinator.background();
    coordinator.connectionChanged(false);
    coordinator.connectionChanged(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(syncPending).toHaveBeenCalledTimes(1);
    coordinator.foreground();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncPending).toHaveBeenCalledTimes(2);
    coordinator.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(syncPending).toHaveBeenCalledTimes(2);
  });
});
