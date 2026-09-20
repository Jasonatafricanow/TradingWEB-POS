// 扫码通用接口：所有扫码来源（相机 / HID 扫码枪 / 蓝牙 SPP/BLE）统一走 ScannerHub 分发。
// 新增一种扫码硬件 = 实现一个"来源"，把结果 emit 给 Hub，业务层零改动。

export type ScanSource = 'camera' | 'hid' | 'ble';

export interface ScanEvent {
  data: string;
  source: ScanSource;
  at: number;
}

export type ScanListener = (e: ScanEvent) => void;

export interface IBarcodeSource {
  readonly source: ScanSource;
  readonly name: string;
  /** 该来源在当前运行环境是否可用（如 BLE 需要开发构建） */
  available(): { ok: boolean; reason?: string };
}
