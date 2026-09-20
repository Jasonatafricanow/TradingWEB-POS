import { describe, expect, it, vi } from 'vitest';

import { createPerformanceRecorder } from '../recorder';

describe('performance recorder', () => {
  it('measures monotonic durations from named marks', () => {
    const sink = vi.fn();
    const ticks = [10, 35];
    const recorder = createPerformanceRecorder({
      enabled: true,
      clock: () => ticks.shift()!,
      sink,
    });

    recorder.mark('app_start');
    recorder.mark('security_ready');

    expect(recorder.measure('cold_start', 'app_start', 'security_ready')).toEqual({
      kind: 'measure',
      name: 'cold_start',
      durationMs: 25,
    });
    expect(sink).toHaveBeenNthCalledWith(1, { kind: 'mark', name: 'app_start', atMs: 10 });
    expect(sink).toHaveBeenNthCalledWith(2, { kind: 'mark', name: 'security_ready', atMs: 35 });
  });

  it('keeps diagnostics silent when disabled while retaining local measurements', () => {
    const sink = vi.fn();
    const ticks = [5, 15];
    const recorder = createPerformanceRecorder({
      enabled: false,
      clock: () => ticks.shift()!,
      sink,
    });

    recorder.mark('app_start');
    recorder.mark('shell_mounted');

    expect(recorder.measure('cold_start', 'app_start', 'shell_mounted')?.durationMs).toBe(10);
    expect(sink).not.toHaveBeenCalled();
  });

  it('rejects missing and backwards mark pairs', () => {
    const ticks = [20, 10];
    const recorder = createPerformanceRecorder({ enabled: true, clock: () => ticks.shift()!, sink: vi.fn() });

    recorder.mark('app_start');
    expect(recorder.measure('route_ready', 'app_start', 'route_operational')).toBeNull();
    recorder.mark('route_operational');
    expect(recorder.measure('route_ready', 'app_start', 'route_operational')).toBeNull();
  });
});
