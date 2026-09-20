// 传输层：把 ESC/POS 字节流送进打印机的通道。
// - NetworkTransport：网口热敏打印机（TCP 9100），需 react-native-tcp-socket（开发构建）
// - BluetoothTransport：蓝牙 BLE 打印机，需 react-native-ble-plx（开发构建）
// - UsbTransport：USB 打印机，接口预留（Android USB Host）
// 依赖包已在 package.json 中；Expo Go 里原生模块不可用时给出清晰错误而不是崩溃。

import { DriverMissingError } from '../types';
import type { ITransport } from '../types';
import { toBase64 } from '../escpos/charset';
import { ensureBlePermissions } from '../../blePermissions';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function tcpAvailable(): { ok: boolean; reason?: string } {
  try {
    const m = require('react-native-tcp-socket');
    if (!m) return { ok: false, reason: 'react-native-tcp-socket 加载失败' };
    return { ok: true };
  } catch {
    return { ok: false, reason: '需要开发构建（Expo Go 不含 TCP 原生模块）' };
  }
}

export function bleTransportAvailable(): { ok: boolean; reason?: string } {
  try {
    const m = require('react-native-ble-plx');
    if (!m?.BleManager) return { ok: false, reason: 'react-native-ble-plx 加载失败' };
    return { ok: true };
  } catch {
    return { ok: false, reason: '需要开发构建（Expo Go 不含蓝牙原生模块）' };
  }
}

/** 网口打印机：TCP 直连 9100 端口（RAW 打印，行业通用） */
export class NetworkTransport implements ITransport {
  private socket: any = null;

  constructor(private host: string, private port: number) {}

  open(): Promise<void> {
    let TcpSocket: any;
    try {
      TcpSocket = require('react-native-tcp-socket');
    } catch {
      throw new DriverMissingError('TCP 模块不可用：需要开发构建（npx expo run:android / run:ios）');
    }
    const Tcp = TcpSocket.default ?? TcpSocket;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { this.socket?.destroy(); } catch {}
        reject(new Error(`连接打印机超时 ${this.host}:${this.port}`));
      }, 5000);
      try {
        this.socket = Tcp.createConnection({ host: this.host, port: this.port }, () => {
          clearTimeout(timer);
          resolve();
        });
        this.socket.on('error', (e: any) => {
          clearTimeout(timer);
          reject(new Error(`打印机连接失败: ${e?.message ?? e}`));
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  async write(data: Uint8Array): Promise<void> {
    const s = this.socket;
    if (!s) throw new Error('打印机未连接');
    const { Buffer } = require('buffer');
    await new Promise<void>((resolve, reject) => {
      s.write(Buffer.from(data), undefined, (err: any) => (err ? reject(err) : resolve()));
    });
    await sleep(150); // 等待打印机缓冲
  }

  async close(): Promise<void> {
    try { this.socket?.destroy(); } catch {}
    this.socket = null;
  }
}

/** 蓝牙 BLE 打印机：通用 ESC/POS BLE 服务（18F0/2AF1，可在设置中改厂商 UUID） */
export class BluetoothTransport implements ITransport {
  private manager: any = null;
  private device: any = null;

  constructor(
    private deviceId: string,
    private serviceUUID: string,
    private characteristicUUID: string
  ) {}

  async open(): Promise<void> {
    if (!this.deviceId) throw new Error('未选择蓝牙打印机（设置 → 硬件）');
    const perm = await ensureBlePermissions();
    if (!perm.ok) throw new Error(perm.message ?? '蓝牙权限不足');
    let ble: any;
    try {
      ble = require('react-native-ble-plx');
    } catch {
      throw new DriverMissingError('蓝牙模块不可用：需要开发构建（npx expo run:android / run:ios）');
    }
    try {
      this.manager = new ble.BleManager();
    } catch {
      throw new DriverMissingError('蓝牙原生模块未链接：请使用开发构建运行');
    }
    this.device = await this.manager.connectToDevice(this.deviceId, { timeout: 8000 });
    await this.device.discoverAllServicesAndCharacteristics();
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.device) throw new Error('打印机未连接');
    const CHUNK = 120; // BLE MTU 安全分片
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      await this.device.writeCharacteristicWithoutResponseForService(
        this.serviceUUID,
        this.characteristicUUID,
        toBase64(chunk)
      );
      await sleep(25);
    }
  }

  async close(): Promise<void> {
    try { await this.device?.cancelConnection(); } catch {}
    try { this.manager?.destroy(); } catch {}
    this.device = null;
    this.manager = null;
  }
}

/** USB 打印机：接口预留。Android 可接 USB Host 库，实现 open/write/close 即插即用 */
export class UsbTransport implements ITransport {
  async open(): Promise<void> {
    throw new DriverMissingError(
      'USB 打印驱动未接入：ITransport 接口已预留，接入方法见 docs/BACKEND_API.md 硬件章节'
    );
  }
  async write(_data: Uint8Array): Promise<void> {
    throw new DriverMissingError('USB 打印驱动未接入');
  }
  async close(): Promise<void> {}
}
