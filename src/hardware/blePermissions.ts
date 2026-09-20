// Android BLE 运行时权限：
//  - Android 12+ (API 31+)：BLUETOOTH_SCAN / BLUETOOTH_CONNECT
//  - Android 6–11：扫描蓝牙需要定位权限 ACCESS_FINE_LOCATION
// iOS 由系统按 Info.plist 自动弹授权。

import { PermissionsAndroid, Platform } from 'react-native';

export async function ensureBlePermissions(): Promise<{ ok: boolean; message?: string }> {
  if (Platform.OS !== 'android') return { ok: true };
  try {
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      const ok = Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
      return ok ? { ok: true } : { ok: false, message: '未授予蓝牙扫描/连接权限，请在系统设置中开启' };
    }
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return r === PermissionsAndroid.RESULTS.GRANTED
      ? { ok: true }
      : { ok: false, message: 'Android 11 及以下扫描蓝牙需要定位权限' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
