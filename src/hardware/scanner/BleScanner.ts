// 蓝牙 BLE 专用扫码枪来源（预留接口）。
// 多数蓝牙扫码枪走 HID 模式（无需本文件，系统级键盘输入直接被 HidScannerListener 捕获）。
// 少数走 BLE 私有协议的机型：安装 react-native-ble-plx + 开发构建后，
// 在此按厂商协议订阅特征值通知，将结果 ScannerHub.emit(data, 'ble') 即完成接入。

import { ScannerHub } from './ScannerHub';
import type { IBarcodeSource } from './types';

export function bleAvailable(): { ok: boolean; reason?: string } {
  try {
    const ble = require('react-native-ble-plx');
    if (!ble?.BleManager) return { ok: false, reason: 'react-native-ble-plx 加载异常' };
    return { ok: true };
  } catch {
    return { ok: false, reason: '需要开发构建（Expo Go 不含蓝牙原生模块）' };
  }
}

export class BleScannerSource implements IBarcodeSource {
  readonly source = 'ble' as const;
  readonly name = 'BLE 扫码枪（预留）';

  available() {
    return bleAvailable();
  }

  /**
   * 示例接入（按厂商协议改 UUID 即可）：
   *   const { BleManager } = require('react-native-ble-plx');
   *   const manager = new BleManager();
   *   const device = await manager.connectToDevice(deviceId);
   *   await device.discoverAllServicesAndCharacteristics();
   *   device.monitorCharacteristicForService(SERVICE_UUID, CHAR_UUID, (err, ch) => {
   *     if (ch?.value) ScannerHub.emit(decodeBase64(ch.value), 'ble');
   *   });
   */
  async connect(_deviceId: string): Promise<void> {
    const a = this.available();
    if (!a.ok) throw new Error(a.reason ?? 'BLE 不可用');
    throw new Error('BLE 专有协议扫码枪需按厂商文档填入 Service/Characteristic UUID（见本文件注释）');
  }

  emit(data: string): void {
    ScannerHub.emit(data, 'ble');
  }
}
