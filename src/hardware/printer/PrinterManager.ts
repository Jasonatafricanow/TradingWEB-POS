// 打印统一入口：读取设置中的打印机配置，构建对应驱动执行打印。
// 页面只调 PrinterManager.printDoc / testPrint / openDrawer，不关心底层是哪种打印机。

import { useSettings } from '@/stores/settings';
import { EscPosPrinter } from './drivers/EscPosPrinter';
import { SystemPrinter } from './drivers/SystemPrinter';
import { BluetoothTransport, NetworkTransport, UsbTransport, bleTransportAvailable, tcpAvailable } from './transports';
import { buildTestReceipt } from './receipt';
import type { IPrinterDriver, PrinterConfig, ReceiptDoc } from './types';
import { CURRENCY_SYMBOL } from '@/utils/money';
import { recordTelemetry } from '@/services/telemetry';

class PrinterManagerImpl {
  buildDriver(cfg: PrinterConfig): IPrinterDriver {
    switch (cfg.driver) {
      case 'system':
        return new SystemPrinter();
      case 'escpos-network':
        return new EscPosPrinter(
          `网口打印机 ${cfg.host}:${cfg.port}`,
          () => new NetworkTransport(cfg.host, cfg.port),
          { charset: cfg.charset, widthCols: cfg.widthCols, autoCut: cfg.autoCut }
        );
      case 'escpos-bluetooth':
        return new EscPosPrinter(
          '蓝牙打印机',
          () => new BluetoothTransport(cfg.btDeviceId, cfg.btServiceUUID, cfg.btCharacteristicUUID),
          { charset: cfg.charset, widthCols: cfg.widthCols, autoCut: cfg.autoCut }
        );
      case 'escpos-usb':
        return new EscPosPrinter(
          'USB 打印机（预留）',
          () => new UsbTransport(),
          { charset: cfg.charset, widthCols: cfg.widthCols, autoCut: cfg.autoCut }
        );
    }
  }

  private current(): IPrinterDriver {
    return this.buildDriver(useSettings.getState().printer);
  }

  async printDoc(doc: ReceiptDoc): Promise<void> {
    const cfg = useSettings.getState().printer;
    try {
      await this.buildDriver(cfg).print(doc);
    } catch (error) {
      void recordTelemetry({ type: 'print_failed', driver: cfg.driver, message: error instanceof Error ? error.message : String(error) }).catch(() => {});
      throw error;
    }
  }

  async testPrint(): Promise<void> {
    const s = useSettings.getState();
    await this.printDoc(
      buildTestReceipt({
        storeName: s.store.name,
        storeAddress: s.store.address,
        footer: s.store.footer,
        symbol: CURRENCY_SYMBOL[s.currency],
        widthCols: s.printer.widthCols,
      })
    );
  }

  /** 弹钱箱；系统打印驱动不支持时报错提示 */
  async openDrawer(): Promise<void> {
    const d = this.current();
    if (!d.openDrawer) throw new Error('当前驱动不支持钱箱（需 ESC/POS 打印机）');
    await d.openDrawer();
  }

  /** 现金结账后尝试弹钱箱（静默失败，不打断收银流程） */
  async openDrawerSilently(): Promise<void> {
    try {
      const cfg = useSettings.getState().printer;
      if (!cfg.openDrawerOnCash || cfg.driver === 'system') return;
      await this.openDrawer();
    } catch {
      // 忽略
    }
  }

  driverStatus() {
    return { tcp: tcpAvailable(), ble: bleTransportAvailable() };
  }
}

export const PrinterManager = new PrinterManagerImpl();
