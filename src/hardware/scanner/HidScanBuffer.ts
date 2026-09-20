/**
 * HID 键盘型扫码枪（USB/蓝牙通用款，最常见）缓冲逻辑。
 * 原理：扫码枪 = 高速键盘输入 + 回车后缀。
 * - 击键间隔超过 interKeyMs 视为新一次输入（过滤人工敲键）
 * - 回车触发 submit
 * UI 层由 HidScannerListener 组件（隐藏 TextInput）接入。
 */
export class HidScanBuffer {
  private buf = '';
  private lastAt = 0;

  constructor(private opts: { interKeyMs: number; minLength: number } = { interKeyMs: 300, minLength: 3 }) {}

  feed(text: string, now = Date.now()): void {
    if (now - this.lastAt > this.opts.interKeyMs) this.buf = '';
    this.buf = text;
    this.lastAt = now;
  }

  submit(): string | null {
    const v = this.buf.trim();
    this.buf = '';
    return v.length >= this.opts.minLength ? v : null;
  }

  reset(): void {
    this.buf = '';
  }
}
