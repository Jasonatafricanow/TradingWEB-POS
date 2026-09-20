// ESC/POS 指令编码器（纯 TS，无原生依赖）。
// 覆盖通用热敏小票机指令集：初始化/中文模式/对齐/加粗/倍宽倍高/走纸/切纸/
// CODE128 条码/QR 码/钱箱。生成的字节流交给任意 ITransport 输出。

import type { EscPosCharset, PaperWidthCols } from '../types';
import { encodeGbk } from '../encoders/gbk';
import { utf8Encode } from '../encoders/utf8';
import { padEndVisual, visualWidth, wrapVisual } from '../text-layout';

export interface EncoderOptions {
  charset: EscPosCharset;
  widthCols: PaperWidthCols;
}

export class EscPosEncoder {
  private bytes: number[] = [];

  constructor(readonly opts: EncoderOptions) {}

  private push(...b: number[]): this {
    for (const x of b) this.bytes.push(x & 0xff);
    return this;
  }

  private pushBytes(arr: Uint8Array): this {
    for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i]);
    return this;
  }

  /** ESC @ 初始化；GBK 模式下开启汉字打印 FS & */
  init(): this {
    this.push(0x1b, 0x40);
    if (this.opts.charset === 'gbk') this.push(0x1c, 0x26);
    return this;
  }

  align(a: 'left' | 'center' | 'right'): this {
    return this.push(0x1b, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.push(0x1b, 0x45, on ? 1 : 0);
  }

  /** 字号：1=正常 2=倍宽倍高 */
  size(w: 1 | 2, h: 1 | 2): this {
    return this.push(0x1d, 0x21, ((w - 1) << 4) | (h - 1));
  }

  text(s: string): this {
    return this.pushBytes(this.opts.charset === 'gbk' ? encodeGbk(s) : utf8Encode(s));
  }

  line(s = ''): this {
    this.text(s);
    return this.push(0x0a);
  }

  /** 左右两端对齐的一行（左侧超长自动换行） */
  row(left: string, right: string): this {
    const w = this.opts.widthCols;
    const rw = visualWidth(right);
    let lw = w - rw - 1;
    if (lw < 6) lw = 6;
    const parts = wrapVisual(left, lw);
    const first = parts.shift() ?? '';
    this.line(padEndVisual(first, Math.max(0, w - rw)) + right);
    for (const p of parts) this.line(p);
    return this;
  }

  hr(ch = '-'): this {
    return this.line(ch.repeat(this.opts.widthCols));
  }

  feed(n = 3): this {
    return this.push(0x1b, 0x64, Math.max(0, Math.min(255, n)));
  }

  /** 部分切纸（带走纸），不支持切刀的机型忽略该指令 */
  cut(): this {
    return this.push(0x1d, 0x56, 0x42, 0x00);
  }

  /** 弹钱箱：ESC p 0 */
  cashDrawer(): this {
    return this.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  }

  /** CODE128 条码（HRI 在下方） */
  barcode(data: string, height = 64): this {
    const payload: number[] = [0x7b, 0x42]; // {B → Code Set B
    for (const ch of data) {
      const c = ch.charCodeAt(0);
      if (c >= 32 && c <= 126) payload.push(c);
    }
    if (payload.length <= 2) return this;
    this.push(0x1d, 0x48, 0x02); // HRI below
    this.push(0x1d, 0x68, Math.max(24, Math.min(255, height)));
    this.push(0x1d, 0x77, 0x02); // module width
    this.push(0x1d, 0x6b, 73, payload.length, ...payload);
    return this.push(0x0a);
  }

  /** QR 码（Model 2，纠错 L） */
  qr(data: string, moduleSize = 6): this {
    const d = utf8Encode(data);
    const len = d.length + 3;
    this.push(0x1d, 0x28, 0x6b, 4, 0, 49, 65, 50, 0);
    this.push(0x1d, 0x28, 0x6b, 3, 0, 49, 67, Math.max(2, Math.min(12, moduleSize)));
    this.push(0x1d, 0x28, 0x6b, 3, 0, 49, 69, 48);
    this.push(0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48);
    this.pushBytes(d);
    this.push(0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48);
    return this;
  }

  encode(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
