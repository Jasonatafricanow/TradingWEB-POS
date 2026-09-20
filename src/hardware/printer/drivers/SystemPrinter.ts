// 系统打印驱动：走 iOS AirPrint / Android 打印服务（expo-print）。
// 无需任何原生打印机驱动即可用（Expo Go 亦可），作为 ESC/POS 之外的通用兜底。

import type { IPrinterDriver, ReceiptDoc } from '../types';
import { receiptDocToHtml } from '../receipt';

export class SystemPrinter implements IPrinterDriver {
  readonly name = '系统打印（AirPrint / 打印服务）';

  async print(doc: ReceiptDoc): Promise<void> {
    const Print = require('expo-print');
    await Print.printAsync({ html: receiptDocToHtml(doc) });
  }
}
