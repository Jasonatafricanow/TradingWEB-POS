// ESC/POS 驱动：ReceiptDoc -> ESC/POS 字节流 -> ITransport（网口/蓝牙/USB 均可）

import { EscPosEncoder } from '../escpos/EscPosEncoder';
import type { EncoderOptions } from '../escpos/EscPosEncoder';
import type { IPrinterDriver, ITransport, ReceiptDoc } from '../types';

export class EscPosPrinter implements IPrinterDriver {
  constructor(
    readonly name: string,
    private makeTransport: () => ITransport,
    private opts: EncoderOptions & { autoCut: boolean }
  ) {}

  private render(doc: ReceiptDoc): Uint8Array {
    const enc = new EscPosEncoder({ charset: this.opts.charset, widthCols: this.opts.widthCols });
    enc.init();
    for (const l of doc.lines) {
      switch (l.kind) {
        case 'text': {
          const size = l.size ?? 1;
          enc.align(l.align ?? 'left').bold(!!l.bold).size(size, size);
          enc.line(l.text);
          enc.size(1, 1).bold(false).align('left');
          break;
        }
        case 'row':
          enc.bold(!!l.bold).row(l.left, l.right).bold(false);
          break;
        case 'hr':
          enc.hr();
          break;
        case 'feed':
          enc.feed(l.n);
          break;
        case 'barcode':
          enc.align('center').barcode(l.data).align('left');
          break;
        case 'qr':
          enc.align('center').qr(l.data).align('left');
          break;
        case 'cut':
          if (this.opts.autoCut) enc.feed(3).cut();
          else enc.feed(5);
          break;
        case 'drawer':
          enc.cashDrawer();
          break;
      }
    }
    return enc.encode();
  }

  private async send(bytes: Uint8Array): Promise<void> {
    const t = this.makeTransport();
    await t.open();
    try {
      await t.write(bytes);
    } finally {
      await t.close();
    }
  }

  async print(doc: ReceiptDoc): Promise<void> {
    await this.send(this.render(doc));
  }

  async openDrawer(): Promise<void> {
    const enc = new EscPosEncoder({ charset: this.opts.charset, widthCols: this.opts.widthCols });
    enc.init().cashDrawer();
    await this.send(enc.encode());
  }
}
