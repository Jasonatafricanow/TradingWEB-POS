// 小票打印通用接口
// ------------------------------------------------------------------
// 三层解耦：
//   ReceiptDoc（与硬件无关的小票文档模型）
//     -> IPrinterDriver（渲染 + 输出：ESC/POS 或 系统打印）
//         -> ITransport（字节通道：网口 TCP / 蓝牙 BLE / USB，可插拔）
// 新增一种打印机 = 实现一个 ITransport 或 IPrinterDriver，业务层零改动。

export type TextSize = 1 | 2;
export type TextAlign = 'left' | 'center' | 'right';

export type ReceiptLine =
  | { kind: 'text'; text: string; align?: TextAlign; bold?: boolean; size?: TextSize }
  | { kind: 'row'; left: string; right: string; bold?: boolean }
  | { kind: 'hr' }
  | { kind: 'feed'; n: number }
  | { kind: 'barcode'; data: string }
  | { kind: 'qr'; data: string }
  | { kind: 'cut' }
  | { kind: 'drawer' };

export interface ReceiptDoc {
  lines: ReceiptLine[];
}

export type PrinterDriverKind = 'system' | 'escpos-network' | 'escpos-bluetooth' | 'escpos-usb';
export type EscPosCharset = 'gbk' | 'utf8';
/** 58mm 纸 = 32 列，80mm 纸 = 48 列 */
export type PaperWidthCols = 32 | 48;

export interface PrinterConfig {
  driver: PrinterDriverKind;
  /** 网口打印机 */
  host: string;
  port: number;
  /** 蓝牙打印机 */
  btDeviceId: string;
  btServiceUUID: string;
  btCharacteristicUUID: string;
  /** 纸宽与字符集 */
  widthCols: PaperWidthCols;
  charset: EscPosCharset;
  autoCut: boolean;
  openDrawerOnCash: boolean;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  driver: 'system',
  host: '192.168.1.100',
  port: 9100,
  btDeviceId: '',
  btServiceUUID: '000018f0-0000-1000-8000-00805f9b34fb',
  btCharacteristicUUID: '00002af1-0000-1000-8000-00805f9b34fb',
  widthCols: 32,
  charset: 'gbk',
  autoCut: true,
  openDrawerOnCash: true,
};

export interface ITransport {
  open(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface IPrinterDriver {
  readonly name: string;
  print(doc: ReceiptDoc): Promise<void>;
  /** 弹出钱箱（仅 ESC/POS 支持） */
  openDrawer?(): Promise<void>;
}

export class DriverMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverMissingError';
  }
}
