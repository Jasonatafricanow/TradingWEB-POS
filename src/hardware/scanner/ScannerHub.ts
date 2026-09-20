import type { ScanEvent, ScanListener, ScanSource } from './types';

/**
 * 扫码事件总线（单例）。
 * - 任何扫码来源调用 emit()
 * - 业务页面 subscribe() 消费
 * - 800ms 内同一条码去重（扫码枪常见连发）
 */
class ScannerHubImpl {
  private listeners = new Set<ScanListener>();
  private lastData = '';
  private lastAt = 0;

  emit(data: string, source: ScanSource): void {
    const trimmed = data.trim();
    if (!trimmed) return;
    const now = Date.now();
    if (trimmed === this.lastData && now - this.lastAt < 800) return;
    this.lastData = trimmed;
    this.lastAt = now;
    const e: ScanEvent = { data: trimmed, source, at: now };
    this.listeners.forEach((l) => {
      try {
        l(e);
      } catch {
        // 监听器异常不影响其他消费者
      }
    });
  }

  subscribe(l: ScanListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const ScannerHub = new ScannerHubImpl();
