export type PerformanceEventName =
  | 'app_start'
  | 'security_ready'
  | 'shell_mounted'
  | 'route_operational'
  | 'register_data_ready';

export type PerformanceMeasureName = 'cold_start' | 'route_ready' | 'register_ready';

export type PerformanceSample =
  | { kind: 'mark'; name: PerformanceEventName; atMs: number }
  | { kind: 'measure'; name: PerformanceMeasureName; durationMs: number };

interface RecorderOptions {
  enabled: boolean;
  clock: () => number;
  sink: (sample: PerformanceSample) => void;
}

export function createPerformanceRecorder(options: RecorderOptions) {
  const marks = new Map<PerformanceEventName, number>();

  return {
    mark(name: PerformanceEventName): number {
      const atMs = options.clock();
      marks.set(name, atMs);
      if (options.enabled) options.sink({ kind: 'mark', name, atMs });
      return atMs;
    },

    measure(name: PerformanceMeasureName, start: PerformanceEventName, end: PerformanceEventName) {
      const from = marks.get(start);
      const to = marks.get(end);
      if (from === undefined || to === undefined || to < from) return null;
      const sample = { kind: 'measure' as const, name, durationMs: to - from };
      if (options.enabled) options.sink(sample);
      return sample;
    },
  };
}

const recorder = createPerformanceRecorder({
  enabled: process.env.EXPO_PUBLIC_PERF_DIAGNOSTICS === '1',
  clock: () => globalThis.performance?.now?.() ?? Date.now(),
  sink: (sample) => console.info(`[TWPOS_PERF] ${JSON.stringify(sample)}`),
});

export const markPerformance = recorder.mark;
export const measurePerformance = recorder.measure;
